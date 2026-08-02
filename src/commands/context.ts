import {
  analyzeContext,
  type ContextBreakdown,
  type ContextConsumer,
} from "../cost/context.js";
import { fmtTokens, renderTable, shortId, shortModel } from "../render/format.js";
import { glyphsFor } from "../render/glyphs.js";
import { bar, fillPaint } from "../render/live.js";
import { roles, toolPaint } from "../render/palette.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import { contentWidth, shortenPath, truncatePath, wrapPlain } from "../render/text.js";
import type { CommandFlags } from "./load.js";
import { resolveTarget } from "./target.js";

// What is filling the context window of one session, and where it
// came from. The reason to reach for this over the statusline gauge:
// the gauge says the window is 80% gone, this says which files and
// which tool output took it.
//
// The honesty rules for the numbers live in cost/context.ts. What
// matters here is that the render keeps the two kinds apart on the
// page: measured numbers are printed plain, estimated ones carry a
// leading ~, and the footer says how much of the window the estimate
// could actually see.

export interface ContextFlags extends CommandFlags {
  id: string | undefined;
  // Window size to measure fill against, when the default guess is
  // wrong for the model in use.
  window: number | undefined;
}

// Claude Code's default window and the extended tier, matching the
// statusline. Nothing on disk names the window, so a session already
// past the default proves it is on the bigger one.
const DEFAULT_WINDOW = 200_000;
const EXTENDED_WINDOW = 1_000_000;

function assumeWindow(tokens: number): number {
  return tokens > DEFAULT_WINDOW ? EXTENDED_WINDOW : DEFAULT_WINDOW;
}

// Rows worth printing. Past this the tail is single percent noise and
// the point of the report, the few things actually holding the
// window, is already made.
const TOP_ROWS = 12;

// How much of a row a path may take before it is cut. Leaves room for
// the three number columns on an 80 column terminal.
const PATH_WIDTH = 44;

export async function runContext(flags: ContextFlags): Promise<number> {
  const target = await resolveTarget(flags);
  if ("code" in target) return target.code;
  const { session } = target;

  const probe = analyzeContext(session, { window: DEFAULT_WINDOW });
  if (probe === undefined) {
    console.error("that session has no api requests, so it has no context yet");
    return 2;
  }
  const breakdown =
    flags.window === undefined
      ? analyzeContext(session, { window: assumeWindow(probe.total) })
      : analyzeContext(session, { window: flags.window });
  if (breakdown === undefined) return 2;

  if (flags.json) {
    console.log(JSON.stringify(breakdown, null, 2));
    return 0;
  }

  // Paths stay absolute in the json and are shortened only for the
  // terminal, where the project is already the context of the report.
  printContext(breakdown, flags, session.meta.cwd);
  return 0;
}

function printContext(
  data: ContextBreakdown,
  flags: ContextFlags,
  cwd: string | undefined,
): void {
  const c = makeStyle(colorEnabled(flags.color));
  const g = glyphsFor(flags.ascii);
  const r = roles(c);
  const dot = c.dim(g.dot);
  const lines: string[] = [];

  const ratio = data.window === 0 ? 0 : data.total / data.window;
  const paint = fillPaint(c, ratio);

  const model = data.model === undefined ? undefined : shortModel(data.model);
  lines.push(
    [
      c.bold("context"),
      r.session(shortId(data.sessionId)),
      ...(model === undefined ? [] : [c.magenta(model)]),
    ].join(` ${dot} `),
  );
  lines.push("");

  // The gauge answers "how much room is left" before anything tries
  // to answer "what took it", same shape and thresholds as the
  // statusline so the two never appear to disagree.
  lines.push(
    `  ${paint(bar(ratio, g))}  ${paint(`${Math.round(ratio * 100)}%`.padStart(4))}` +
      `   ${fmtTokens(data.total)} of ${fmtTokens(data.window)}`,
  );
  lines.push("");

  // The baseline is measured, not estimated, so it is printed on its
  // own above the split rather than as one more row inside it.
  if (data.startup > 0) {
    const startupShare = data.total === 0 ? 0 : data.startup / data.total;
    const [label, detail] = data.compacted
      ? ["summary", "what the compaction kept"]
      : ["startup", "system prompt, tools, project files"];
    lines.push(
      `  ${c.bold(label)}  ${fmtTokens(data.startup)}` +
        `  ${pct(startupShare)}   ${c.dim(detail)}`,
    );
    lines.push("");
  }

  if (data.consumers.length === 0) {
    lines.push(`  ${c.dim("nothing else in the window yet")}`);
    console.log(lines.join("\n"));
    return;
  }

  lines.push(`  ${c.bold(r.tool("what filled the rest"))}`);

  const shown = data.consumers.slice(0, TOP_ROWS);
  const rows: string[][] = [];
  for (const consumer of shown) {
    const glyph =
      consumer.category === undefined
        ? consumer.kind === "prompts"
          ? g.user
          : g.claude
        : g.tools[consumer.category];
    // A path drops to its project relative form first, and is only
    // front truncated if it is still too long, so the basename that
    // identifies it always survives.
    const label =
      consumer.kind === "file"
        ? truncatePath(shortenPath(consumer.label, cwd), PATH_WIDTH, g.ellipsis)
        : consumer.label;
    rows.push([
      `${glyph} ${label}`,
      `~${fmtTokens(consumer.tokens)}`,
      pct(consumer.share),
      // Reading the same file twice puts the same bytes in the window
      // twice, which is the one actionable thing this report finds.
      countLabel(consumer),
    ]);
  }

  const table = renderTable(rows, ["left", "right", "right", "left"]);
  table.forEach((line, i) => {
    const consumer = shown[i];
    const tint =
      consumer?.category === undefined ? undefined : toolPaint(c, consumer.category);
    // Only the leading glyph takes the hue. The numbers stay plain so
    // the column reads as one block, the same rule the dashboard
    // tables follow.
    lines.push(`  ${tint === undefined ? line : tint(line.slice(0, 1)) + line.slice(1)}`);
  });

  const hidden = data.consumers.length - shown.length;
  if (hidden > 0) {
    const rest = data.consumers
      .slice(TOP_ROWS)
      .reduce((sum, consumer) => sum + consumer.tokens, 0);
    lines.push(`  ${c.dim(`and ${hidden} more, ~${fmtTokens(rest)} together`)}`);
  }

  // Footnotes are prose, so they wrap rather than run off the edge.
  // Wrapping happens on the plain text and the paint goes on after,
  // because a style applied first would be measured as content.
  lines.push("");
  const width = Math.max(contentWidth() - 2, 20);
  for (const note of footnotes(data)) {
    for (const line of wrapPlain(note.text, width)) {
      lines.push(`  ${note.warn ? r.warn(line) : c.dim(line)}`);
    }
  }

  console.log(lines.join("\n"));
}

// Says what the count counts, since the same number means different
// things per row: a file was opened that many times, a tool was
// called that many times. One is a warning, the other is just volume.
function countLabel(consumer: ContextConsumer): string {
  if (consumer.touches < 2) return "";
  if (consumer.kind !== "file") return `${consumer.touches} calls`;
  return consumer.category === "edit"
    ? `written ${consumer.touches}x`
    : `read ${consumer.touches}x`;
}

function pct(ratio: number): string {
  const percent = ratio * 100;
  // Under half a percent still rounds to something rather than 0%,
  // so a row that earned a place in the table never reads as nothing.
  return percent < 1 && percent > 0 ? "<1%" : `${Math.round(percent)}%`;
}

interface Footnote {
  text: string;
  warn: boolean;
}

// What the reader has to know to trust the numbers above, and nothing
// more. Each note only appears when it has something to say.
function footnotes(data: ContextBreakdown): Footnote[] {
  const notes: Footnote[] = [];
  if (data.compacted) {
    notes.push({
      warn: true,
      text:
        "this session was compacted: the window was rebuilt from a summary," +
        " so only what happened after that is broken down below it",
    });
  }
  if (data.coverage !== undefined) {
    const covered = Math.round(data.coverage * 100);
    // Over 100% means the branch holds more text than the window
    // does, which is Claude Code having dropped old tool output. The
    // shares are still the best available reading, but saying the log
    // "accounts for" the window would be false.
    notes.push({
      warn: false,
      text:
        covered > 110
          ? "shares are estimated, and the session has logged more text than the" +
            " window holds, so some of it has already been dropped from the" +
            " context. Rows are ranked by what each origin loaded, not by what survives."
          : `shares are estimated: the log accounts for about ${covered}% of what the` +
            " window grew by. Thinking and per-turn reminders are never written" +
            " down, so their tokens sit inside the rows above.",
    });
  }
  if (data.images > 0) {
    notes.push({
      warn: false,
      text:
        `${data.images} image${data.images === 1 ? "" : "s"} in tool output, counted at a` +
        " flat rate: the log stores the pixels, not the size the model was billed for.",
    });
  }
  return notes;
}
