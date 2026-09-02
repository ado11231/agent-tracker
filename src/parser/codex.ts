import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ExtractedSession, MessageUsage, ProviderRateLimit, SessionEvent, SessionMeta, Usage } from "./events.js";
import type { ReadStats } from "./types.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

// The two providers disagree on what input_tokens means. Anthropic
// reports it exclusive of cache reads, so input + cacheRead is a valid
// sum. Codex nests them: its input_tokens already contains
// cached_input_tokens, which is why total_tokens works out to
// input_tokens + output_tokens with no room for cache on top. Adding
// the two as siblings would bill every cached token twice, at the full
// input rate as well as the cache rate. Subtracting here is what lets
// the shared cost engine and the shared panel stay provider agnostic.
function usage(value: unknown): Usage | undefined {
  const totals = record(value);
  if (totals === undefined) return undefined;
  const cacheRead = number(totals.cached_input_tokens);
  return {
    input: Math.max(0, number(totals.input_tokens) - cacheRead),
    output: number(totals.output_tokens),
    cacheRead,
    cacheCreationTotal: number(totals.cache_write_input_tokens),
    cacheCreation5m: undefined, cacheCreation1h: undefined,
  };
}

function delta(current: Usage, previous: Usage | undefined): Usage {
  const before = previous ?? { input: 0, output: 0, cacheRead: 0, cacheCreationTotal: 0, cacheCreation5m: 0, cacheCreation1h: 0 };
  return {
    input: Math.max(0, current.input - before.input), output: Math.max(0, current.output - before.output),
    cacheRead: Math.max(0, current.cacheRead - before.cacheRead), cacheCreationTotal: Math.max(0, current.cacheCreationTotal - before.cacheCreationTotal),
    cacheCreation5m: undefined, cacheCreation1h: undefined,
  };
}

// Codex reports a window in minutes rather than naming it, so the
// label is derived: 300 minutes reads as "5h", 43200 as "30d". Days
// win once a window is at least a day long, which is how the plans
// themselves are described.
function windowLabel(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

// A percentage outside 0 to 100 would push a gauge past its ends, so
// it is dropped rather than clamped. Same rule the Claude host parser
// applies, for the same reason.
function rateLimit(value: unknown): ProviderRateLimit | undefined {
  const window = record(value);
  if (window === undefined) return undefined;
  const used = window.used_percent;
  const minutes = window.window_minutes;
  if (typeof used !== "number" || !Number.isFinite(used)) return undefined;
  if (used < 0 || used > 100) return undefined;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return { usedPercentage: used, label: windowLabel(minutes) };
}

function messageEvents(payload: Record<string, unknown>, timestamp: string | undefined, events: SessionEvent[]): void {
  if (payload.type !== "message") return;
  const content = payload.content;
  if (!Array.isArray(content)) return;
  const role = text(payload.role);
  for (const item of content) {
    const block = record(item);
    if (block === undefined || block.type !== "input_text" && block.type !== "output_text") continue;
    const body = text(block.text) ?? "";
    if (role === "user") events.push({ kind: "user", text: body, isMeta: false, timestamp });
    if (role === "assistant") events.push({ kind: "assistant-text", text: body, model: undefined, messageId: text(payload.id), timestamp });
  }
}

export async function parseCodexSessionFile(path: string): Promise<{ session: ExtractedSession; readStats: ReadStats }> {
  const meta: SessionMeta = { sessionId: undefined, version: undefined, cwd: undefined, gitBranch: undefined, firstTimestamp: undefined, lastTimestamp: undefined, models: [], compaction: undefined };
  const events: SessionEvent[] = [];
  const usageEntries: MessageUsage[] = [];
  const stats: ReadStats = { totalLines: 0, keptLines: 0, ignoredLines: 0, malformedLines: 0, unknownTypes: {} };
  let activeModel: string | undefined;
  let previousTotal: Usage | undefined;
  let usageIndex = 0;
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of reader) {
      if (rawLine.trim() === "") continue;
      stats.totalLines += 1;
      let line: Record<string, unknown>;
      try { line = JSON.parse(rawLine) as Record<string, unknown>; } catch { stats.malformedLines += 1; continue; }
      const kind = text(line.type);
      const payload = record(line.payload);
      const timestamp = text(line.timestamp);
      if (timestamp !== undefined) { meta.firstTimestamp ??= timestamp; meta.lastTimestamp = timestamp; }
      if (kind === "session_meta" && payload !== undefined) {
        meta.sessionId ??= text(payload.session_id) ?? text(payload.id); meta.version ??= text(payload.cli_version); meta.cwd ??= text(payload.cwd);
        meta.gitBranch ??= text(record(payload.git)?.branch); stats.keptLines += 1; continue;
      }
      if (kind === "turn_context" && payload !== undefined) {
        activeModel = text(payload.model) ?? activeModel; if (activeModel !== undefined && !meta.models.includes(activeModel)) meta.models.push(activeModel);
        meta.cwd ??= text(payload.cwd); stats.keptLines += 1; continue;
      }
      if (kind === "response_item" && payload !== undefined) { messageEvents(payload, timestamp, events); stats.keptLines += 1; continue; }
      if (kind === "event_msg" && payload?.type === "token_count") {
        const info = record(payload.info);
        // The window and the limits are restated on every snapshot, so
        // the last one seen is the live one.
        const window = info?.model_context_window;
        if (typeof window === "number" && Number.isFinite(window) && window > 0) {
          meta.contextWindow = window;
        }
        // The live window, straight from the provider. input_tokens
        // already contains the cached half here, so the two are not
        // added; cache writes are counted because they are resident
        // too. Restated every snapshot, so the last one is current.
        const last = record(info?.last_token_usage);
        if (last !== undefined) {
          const resident = number(last.input_tokens) + number(last.cache_write_input_tokens);
          if (resident > 0) meta.contextTokens = resident;
        }
        const limits = record(payload.rate_limits);
        if (limits !== undefined) {
          meta.rateLimits = {
            primary: rateLimit(limits.primary),
            secondary: rateLimit(limits.secondary),
          };
        }
        const total = usage(info?.total_token_usage);
        if (total !== undefined && activeModel !== undefined) {
          const change = delta(total, previousTotal); previousTotal = total;
          if (change.input + change.output + change.cacheRead + change.cacheCreationTotal > 0) usageEntries.push({ messageId: `codex-${usageIndex++}`, model: activeModel, usage: change, isSidechain: false, onActiveBranch: true, timestamp });
        }
        stats.keptLines += 1; continue;
      }
      stats.ignoredLines += 1;
    }
  } finally { reader.close(); stream.close(); }
  return { session: { meta, events, sidechains: [], usage: usageEntries, stats: { unknownBlocks: 0 } }, readStats: stats };
}
