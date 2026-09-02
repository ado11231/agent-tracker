import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ExtractedSession, MessageUsage, SessionEvent, SessionMeta, Usage } from "./events.js";
import type { ReadStats } from "./types.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

function usage(value: unknown): Usage | undefined {
  const totals = record(value);
  if (totals === undefined) return undefined;
  return {
    input: number(totals.input_tokens), output: number(totals.output_tokens),
    cacheRead: number(totals.cached_input_tokens),
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
        const total = usage(record(payload.info)?.total_token_usage);
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
