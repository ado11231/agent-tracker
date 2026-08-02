import type {
  ExtractedSession,
  MessageUsage,
  SessionEvent,
  ToolCallEvent,
} from "../parser/events.js";
import { toolCategory, type ToolCategory } from "./tools.js";

// What is filling the context window right now, and where it came
// from. Two of the three numbers here are exact and one is estimated,
// which is the whole shape of this module:
//
//   total     exact. What the last request actually carried, straight
//             from its usage: input + cache read + cache write.
//   startup   exact. What the first request carried before the
//             conversation had added anything, so the system prompt,
//             the tool definitions, and any project files loaded at
//             start. Measured, not assumed.
//   the split estimated. The log records text, not tokens, so the
//             share each origin holds is fitted from character counts
//             and never presented as exact.
//
// The estimate is built to be wrong in the safest way available.
// Rather than converting characters to tokens with a fixed divisor
// and reporting whatever total falls out, it splits the real measured
// growth between the origins in proportion to their weighted
// characters. The parts therefore always sum to a number the user can
// check against the statusline, and the only claim being made is
// about relative share, which is the part character counts predict
// well.
//
// Calibrated against 43 real sessions: characters per token sit at
// 2.0 for tool output, 2.3 for prose, and 1.9 for tool inputs, and
// the first request lands between 22k and 32k tokens with a median of
// 28k. Those weights only set the ratios between origins; the scale
// comes from the measured growth.
//
// Two things the log never records and this cannot see: thinking
// blocks, which appear in every session with their text stripped, and
// the reminders Claude Code injects per turn. Their tokens are real
// and land in the measured growth, so they end up spread across the
// rows in proportion to everything else. `coverage` on the result is
// what exposes that: near 1 means almost everything in the window was
// written down, well under 1 means much of it was not.

// Relative token weight per kind of text, from the calibration above.
// Only the ratios between these matter, since the result is scaled to
// the measured growth afterwards.
const CHARS_PER_TOKEN = {
  prose: 2.3,
  toolOutput: 2.0,
  toolInput: 1.9,
} as const;

// A screenshot costs tokens the character count cannot see, because
// the log stores base64 rather than the dimensions the price depends
// on. Claude bills an image at roughly (width * height) / 750 tokens,
// capped near 1600, so a mid sized one is worth about this much text.
const IMAGE_CHARS = 1400 * CHARS_PER_TOKEN.toolOutput;

// Tools whose file_path makes their bytes worth grouping per file.
// Everything else groups by category, since one bash call is not
// worth a row of its own.
const FILE_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookRead",
  "NotebookEdit",
]);

export type ConsumerKind = "file" | "tool" | "prompts" | "replies";

export interface ContextConsumer {
  kind: ConsumerKind;
  // A path for files, a plain name for everything else.
  label: string;
  // Set for file and tool rows, so the renderer can reuse the
  // transcript's tool glyphs and hues.
  category: ToolCategory | undefined;
  // Tokens this row's logged text is worth on its own, before the
  // split is scaled to the measured growth. Kept so --json can show
  // the working rather than only the conclusion.
  logged: number;
  // Estimated tokens: this row's share of the measured growth.
  tokens: number;
  // Share of the whole window, startup included, 0 to 1.
  share: number;
  // How many times a file was read or written. Above one means the
  // same bytes are in the window more than once.
  touches: number;
}

export interface ContextBreakdown {
  sessionId: string | undefined;
  model: string | undefined;
  // Exact, from the api's own accounting.
  total: number;
  window: number;
  // What the window held before this session's conversation added to
  // it: the opening request normally, and the size of the surviving
  // summary when the session was compacted.
  startup: number;
  // Estimated, and always summing to total - startup.
  consumers: ContextConsumer[];
  // How much of the measured growth the logged text accounts for, as
  // a ratio. Near 1 means the window is almost entirely things the
  // log wrote down. Well under 1 means thinking and injected
  // reminders hold a large share, and every row below is carrying
  // part of it.
  coverage: number | undefined;
  // Images found in tool output. Counted separately because their
  // cost is the least certain thing in the report.
  images: number;
  // Compaction rebuilt the window mid session, so startup no longer
  // describes what is in it and the split covers the whole window
  // instead of the growth since startup.
  compacted: boolean;
}

// Every active branch request, oldest first. Sidechains run their own
// windows, so a subagent's context is not this session's context.
function mainBranchRequests(session: ExtractedSession): MessageUsage[] {
  return session.usage.filter(
    (entry) => !entry.isSidechain && entry.onActiveBranch,
  );
}

function contextOf(entry: MessageUsage): number {
  const u = entry.usage;
  return u.input + u.cacheRead + u.cacheCreationTotal;
}

function filePathOf(call: ToolCallEvent): string | undefined {
  if (!FILE_TOOLS.has(call.toolName)) return undefined;
  const input = call.input;
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).file_path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

// Human name for a category's output, used when the bytes cannot be
// pinned to a file.
const CATEGORY_LABELS: Record<ToolCategory, string> = {
  bash: "command output",
  edit: "file edits",
  read: "search results",
  web: "web fetches",
  agents: "subagent reports",
  mcp: "mcp results",
  other: "other tool output",
  chat: "conversation",
};

interface Bucket {
  kind: ConsumerKind;
  label: string;
  category: ToolCategory | undefined;
  // Tokens the logged text is worth, already weighted for its kind.
  logged: number;
  touches: number;
}

class Buckets {
  private readonly map = new Map<string, Bucket>();

  add(
    key: string,
    seed: Omit<Bucket, "logged" | "touches">,
    logged: number,
    touch: boolean,
  ): void {
    let bucket = this.map.get(key);
    if (bucket === undefined) {
      bucket = { ...seed, logged: 0, touches: 0 };
      this.map.set(key, bucket);
    }
    bucket.logged += logged;
    if (touch) bucket.touches += 1;
  }

  list(): Bucket[] {
    return [...this.map.values()];
  }
}

// Images are the one thing counted rather than measured, so they come
// back alongside the character total.
interface Measured {
  chars: number;
  images: number;
}

function measureResult(text: string): Measured {
  // The parser turns an image block into this placeholder, so the
  // count survives even though the base64 behind it does not.
  const images = (text.match(/\[image\]/g) ?? []).length;
  const chars = text.length - images * "[image]".length + images * IMAGE_CHARS;
  return { chars, images };
}

export interface ContextOptions {
  // Size of the window to measure fill against.
  window: number;
}

export function analyzeContext(
  session: ExtractedSession,
  options: ContextOptions,
): ContextBreakdown | undefined {
  const requests = mainBranchRequests(session);
  const last = requests[requests.length - 1];
  const first = requests[0];
  if (last === undefined || first === undefined) return undefined;

  const total = contextOf(last);
  const compaction = session.meta.compaction;
  // A compaction rebuilds the window from a summary, so the opening
  // request of the file describes a window that no longer exists and
  // everything logged before the boundary was thrown away. The
  // boundary line records the size of what survived, which makes it
  // the baseline in place of startup, and only what came after it is
  // still in the window to attribute.
  const startup = compaction === undefined ? contextOf(first) : compaction.postTokens;
  const growth = Math.max(total - startup, 0);

  const buckets = new Buckets();
  const callById = new Map<string, ToolCallEvent>();
  let images = 0;
  // Content of the opening request is already inside startup, so it
  // must not also be attributed. Skipped until the first reply lands,
  // or until the compaction boundary when there was one.
  let started = false;
  const after =
    compaction?.timestamp === undefined
      ? undefined
      : new Date(compaction.timestamp).getTime();

  const attribute = (event: SessionEvent): void => {
    switch (event.kind) {
      case "user": {
        // Meta lines are Claude Code's own bookkeeping, not prose the
        // user wrote, but they do occupy the window.
        buckets.add(
          "prompts",
          { kind: "prompts", label: "your prompts", category: undefined },
          event.text.length / CHARS_PER_TOKEN.prose,
          false,
        );
        return;
      }
      case "assistant-text": {
        buckets.add(
          "replies",
          { kind: "replies", label: "assistant replies", category: undefined },
          event.text.length / CHARS_PER_TOKEN.prose,
          false,
        );
        return;
      }
      case "thinking": {
        // Real tokens, but the log strips the text of every thinking
        // block, so there is nothing here to measure. Its share lands
        // in the scaling instead.
        return;
      }
      case "tool-call": {
        if (event.toolUseId !== undefined) callById.set(event.toolUseId, event);
        const chars =
          JSON.stringify(event.input ?? "").length / CHARS_PER_TOKEN.toolInput;
        const path = filePathOf(event);
        const category = toolCategory(event.toolName);
        if (path !== undefined) {
          // A Write or an Edit carries the new file text in its input,
          // which is usually far bigger than the result it gets back.
          buckets.add(
            `file:${path}`,
            { kind: "file", label: path, category },
            chars,
            true,
          );
        } else {
          buckets.add(
            `tool:${category}`,
            { kind: "tool", label: CATEGORY_LABELS[category], category },
            chars,
            true,
          );
        }
        return;
      }
      case "tool-result": {
        const call =
          event.toolUseId === undefined
            ? undefined
            : callById.get(event.toolUseId);
        const measured = measureResult(event.text);
        images += measured.images;
        const chars = measured.chars / CHARS_PER_TOKEN.toolOutput;
        const path = call === undefined ? undefined : filePathOf(call);
        const category =
          call === undefined ? "other" : toolCategory(call.toolName);
        if (path !== undefined) {
          buckets.add(
            `file:${path}`,
            { kind: "file", label: path, category },
            chars,
            false,
          );
        } else {
          buckets.add(
            `tool:${category}`,
            { kind: "tool", label: CATEGORY_LABELS[category], category },
            chars,
            false,
          );
        }
        return;
      }
    }
  };

  for (const event of session.events) {
    if (!started) {
      if (after !== undefined) {
        // Everything up to the compaction was dropped from the
        // window, so only what is stamped after it still counts.
        const at =
          event.timestamp === undefined
            ? undefined
            : new Date(event.timestamp).getTime();
        if (at === undefined || Number.isNaN(at) || at <= after) continue;
      } else {
        // The first reply is the boundary: everything before it was
        // part of the opening request that startup already counts.
        const id =
          event.kind === "assistant-text" ||
          event.kind === "thinking" ||
          event.kind === "tool-call"
            ? event.messageId
            : undefined;
        if (id === undefined || id !== first.messageId) continue;
      }
      started = true;
    }
    attribute(event);
  }

  const rows = buckets.list();
  const logged = rows.reduce((sum, row) => sum + row.logged, 0);
  const consumers: ContextConsumer[] = rows
    .map((row) => {
      // The split is proportional: the measured growth is real, and
      // the logged text only says how to divide it.
      const tokens =
        logged === 0 ? 0 : Math.round((row.logged / logged) * growth);
      return {
        kind: row.kind,
        label: row.label,
        category: row.category,
        logged: Math.round(row.logged),
        tokens,
        share: total === 0 ? 0 : tokens / total,
        touches: row.touches,
      };
    })
    .filter((row) => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  return {
    sessionId: session.meta.sessionId,
    model: last.model,
    total,
    window: options.window,
    startup,
    consumers,
    coverage: growth === 0 ? undefined : logged / growth,
    images,
    compacted: compaction !== undefined,
  };
}
