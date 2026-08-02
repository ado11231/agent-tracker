import {
  burnRatePerHour,
  cacheHitRatio,
  type SessionSummary,
} from "../cost/aggregate.js";
import type { ExtractedSession } from "../parser/events.js";
import { emptyHostFacts, type HostFacts } from "../parser/host.js";
import { fmtTokens, fmtUsd, shortModel } from "./format.js";
import type { GlyphSet } from "./glyphs.js";
import { modelPaint, roles, type Paint } from "./palette.js";
import type { Style } from "./style.js";
import { displayWidth } from "./text.js";

// Live surface renderers for the statusline panel Claude Code prints
// after each assistant message.

// The live context window fill and the model behind it, taken from
// the most recent api call on the main thread. Matches Claude Code's
// own used_percentage, which counts the input side only (fresh input
// plus cache reads plus cache writes), not output.
export interface CurrentContext {
  tokens: number;
  model: string | undefined;
}

export function currentContext(session: ExtractedSession): CurrentContext {
  let latest: (typeof session.usage)[number] | undefined;
  for (const entry of session.usage) {
    if (entry.isSidechain || !entry.onActiveBranch) continue;
    latest = entry;
  }
  if (latest === undefined) return { tokens: 0, model: undefined };
  const u = latest.usage;
  return {
    tokens: u.input + u.cacheRead + u.cacheCreationTotal,
    model: latest.model,
  };
}

// The statusline panel, up to four rows, one job each:
//
//   sec-review · opus-4-8 · high · 2 turns                what is running
//   $0.19 · $2.40/hr · $0.03 wasted · +156 −23            what it cost
//   ctx    ▓▓▓░░░░░░░░░░░░░░░░░  14%   27.4k / 200k        room left
//   5h     ▓▓▓▓▓░░░░░░░░░░░░░░░  24%   41% week · 89% cache  quota left
//
// The gauges label themselves in a fixed left column, so the bars start
// in the same place and the pair reads as one block rather than as two
// unrelated lines.
//
// Each returned string is one row, since Claude Code renders a line
// of output per row. Every row and every segment within a row drops
// out when its data is missing rather than rendering a zero, so the
// panel shrinks to the two rows it has always been on an api plan
// with nothing to report. That also means a row never half exists:
// no empty gauges, no "$0.00 wasted".
//
// Gauges are the only color that carries information rather than
// decoration. Context and rate limit shift green to yellow to red as
// they fill, warning before compaction and before a cutoff. Cache hit
// is inverted, since a low cache share is the expensive case.
//
// On a narrow terminal a row that does not fit is dropped from the
// right, one field at a time, rather than wrapped. A wrapped statusline
// costs a whole extra line of the user's screen and reads as broken,
// while a shortened one still answers the question the row exists for:
// the fields are already ordered most to least important, left to
// right, so the tail is what can go.

export interface PanelOptions {
  c: Style;
  g: GlyphSet;
  // Total context window for the current model, from the session json
  // Claude Code pipes in. Only the size is taken from there; the token
  // count stays ccplus's own so it agrees with the dashboard.
  contextWindow: number;
  // Everything else the host told us about the live session. Defaults
  // to all absent, which is what a manual run from a shell gets.
  host?: HostFacts;
  // Columns available for one row. Undefined means unknown, and an
  // unknown width never shortens anything: guessing narrow would hide
  // fields on a wide terminal, which is the worse mistake.
  width?: number;
}

const GAUGE_WIDTH = 20;
// A gauge row is a label, a bar and a percentage; only the bar can give
// ground. Below this it stops being a bar and becomes a smudge, so a
// terminal narrower than that gets an overflowing row rather than a
// meaningless one.
const GAUGE_MIN = 6;
// Plain spacing after a gauge, wider than the dot separator so the bar
// reads as its own object rather than as the first field in a list.
const GAUGE_GAP = "   ";
// The label column ahead of a gauge. Every gauge row pads its label to
// this, so the bars start in the same column and stack as one block
// instead of two loose lines. Wide enough for the longest label there
// is, `cache`: it shares the panel with `ctx` whenever there is no
// subscription to report, and a column sized to `ctx` alone put the two
// bars two apart.
const LABEL_WIDTH = 5;
const GAUGE_WARN = 0.5;
const GAUGE_DANGER = 0.8;

// A cache share this low means most of the prompt is being paid at
// the full input rate, which is the thing worth flagging.
const CACHE_POOR = 0.5;
const CACHE_GOOD = 0.8;

// Dim is deliberately not used for any content on this panel: it
// renders as low contrast gray and the statusline is small text on
// someone else's background. Dim is kept for separators only, which
// are structure and should recede.

// Fuller is worse: context filling toward compaction, quota burning
// toward a cutoff. Exported because the context report draws the same
// gauge for the same quantity, and a window that reads yellow on the
// statusline has to read yellow there too.
export function fillPaint(c: Style, ratio: number): Paint {
  const r = roles(c);
  return ratio >= GAUGE_DANGER ? r.danger : ratio >= GAUGE_WARN ? r.warn : r.ok;
}

// Emptier is worse. Kept separate from fillPaint rather than folded in
// as an inverted flag, because the thresholds are genuinely different
// numbers and not a mirror of each other. Exported for the dashboard
// headline, so a cache share reads the same color there as it does on
// the statusline.
export function cachePaint(c: Style, ratio: number): Paint {
  const r = roles(c);
  return ratio >= CACHE_GOOD ? r.ok : ratio >= CACHE_POOR ? r.warn : r.danger;
}

export function bar(ratio: number, g: GlyphSet, width = GAUGE_WIDTH): string {
  // Always show at least one filled cell once anything is used, so a
  // low percentage still reads as started rather than empty.
  const filled = Math.min(width, Math.max(1, Math.round(ratio * width)));
  return g.gaugeFull.repeat(filled) + g.gaugeEmpty.repeat(width - filled);
}

// The bar takes whatever the row can spare. Everything else on a gauge
// row is a known width — the label, a 4 column percentage and two gaps
// of two — so the bar is the only part that can stretch or shrink with
// the terminal. A label wider than the column, which only the lone
// cache gauge is, is charged to the bar rather than allowed to push the
// row past the edge.
function gaugeWidth(label: string, width: number | undefined): number {
  if (width === undefined) return GAUGE_WIDTH;
  const fixed = Math.max(LABEL_WIDTH, label.length) + 2 + 2 + 4;
  return Math.max(GAUGE_MIN, Math.min(GAUGE_WIDTH, width - fixed));
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// A named gauge: what is being measured, the bar, and the percentage,
// all in the same color. The label says which limit this is at any
// width, which is why it leads rather than trailing the bar. The
// percent is padded so whatever follows it does not jitter as the
// number grows.
function gauge(
  label: string,
  ratio: number,
  paint: Paint,
  options: PanelOptions,
): string {
  return [
    paint(label.padEnd(LABEL_WIDTH)),
    paint(bar(ratio, options.g, gaugeWidth(label, options.width))),
    paint(pct(ratio).padStart(4)),
  ].join("  ");
}

// One row before it is fitted to the terminal. The lead is the field
// that gives the row its reason to exist and is never dropped, so a
// row is either absent or still says something.
interface PanelRow {
  lead: string;
  parts: string[];
  // Between the lead and the first surviving part. Differs from sep on
  // the gauge rows, where the gauge is set off by plain spacing.
  gap: string;
  // Between the parts.
  sep: string;
}

// Builds a row from its fields in priority order, the first present
// one leading. Absent fields are dropped here, before any fitting, so
// a field the session has no data for never costs a field the terminal
// had room for.
function panelRow(
  fields: (string | undefined)[],
  sep: string,
  gap: string = sep,
): PanelRow {
  const present = fields.filter((field): field is string => field !== undefined);
  return { lead: present[0] ?? "", parts: present.slice(1), gap, sep };
}

// Widths are measured on the styled strings: string-width ignores ansi
// escapes, so there is no need to keep a plain copy of every field in
// step with the painted one.
function fitRow(row: PanelRow, width: number | undefined): string {
  let parts = row.parts;
  for (;;) {
    const text =
      parts.length === 0
        ? row.lead
        : `${row.lead}${row.gap}${parts.join(row.sep)}`;
    if (width === undefined || parts.length === 0) return text;
    if (displayWidth(text) <= width) return text;
    parts = parts.slice(0, -1);
  }
}

// Row 1 — which session this is and what is running in it.
function identityRow(
  summary: SessionSummary,
  context: CurrentContext,
  options: PanelOptions,
  host: HostFacts,
): PanelRow {
  const { c } = options;
  const model = context.model ?? summary.models[summary.models.length - 1];
  // The session name answers "which of my terminals is this", which is
  // the question a name is for. A subagent's name stands in only when
  // the session has none, rather than taking a second segment.
  const name = host.sessionName ?? host.agentName;
  return panelRow(
    [
      name === undefined ? undefined : c.bold(name),
      model === undefined ? undefined : modelPaint(c, model)(shortModel(model)),
      host.effort,
      host.fastMode ? "fast" : undefined,
      `${summary.turns} ${summary.turns === 1 ? "turn" : "turns"}`,
    ],
    c.dim(` ${options.g.dot} `),
  );
}

// Row 2 — what it cost. Wasted spend and the line counts are omitted
// at zero: "$0.00 wasted" and "+0 −0" are noise, and their absence is
// the good news.
function costRow(
  summary: SessionSummary,
  options: PanelOptions,
  host: HostFacts,
): PanelRow {
  const { c, g } = options;
  const r = roles(c);
  const known = summary.total.unknownModels.length === 0;
  const burn = known
    ? burnRatePerHour(summary.total.usd, summary.durationMs)
    : undefined;
  const wasted = known && summary.offBranch.usd > 0 ? summary.offBranch.usd : 0;
  const added = host.linesAdded ?? 0;
  const removed = host.linesRemoved ?? 0;
  return panelRow(
    [
      c.bold(known ? fmtUsd(summary.total.usd) : "$?"),
      burn === undefined ? undefined : `${fmtUsd(burn)}/hr`,
      wasted > 0 ? r.warn(`${fmtUsd(wasted)} wasted`) : undefined,
      added > 0 || removed > 0
        ? `${r.ok(`+${added}`)} ${r.danger(`${g.minus}${removed}`)}`
        : undefined,
    ],
    c.dim(` ${g.dot} `),
  );
}

// Row 3 — how much of the context window is gone. The gauge leads and
// stays: it carries the percentage, so a narrow terminal loses the
// raw token counts and keeps the answer.
function contextRow(tokens: number, options: PanelOptions): PanelRow {
  const { c, g } = options;
  const ratio = Math.min(tokens / options.contextWindow, 1);
  const paint = fillPaint(c, ratio);
  // No "ctx" suffix on the counts: the gauge label already said it.
  const detail = `${fmtTokens(tokens)} / ${fmtTokens(options.contextWindow)}`;
  // The token detail takes the gauge's color too: it is the same
  // measurement, and it has to stay readable at statusline size.
  return panelRow([gauge("ctx", ratio, paint, options), paint(detail)], GAUGE_GAP);
}

// Row 4 — how much quota is left, plus the cache share, which belongs
// with the limits because it is the other thing silently deciding how
// far the remaining quota goes.
//
// The five hour window gets the bar because it is the one that cuts a
// working session off. When there is no subscription to report, the
// cache share takes the bar instead, so the row still leads with a
// gauge rather than a lone number.
function limitsRow(
  summary: SessionSummary,
  options: PanelOptions,
  host: HostFacts,
): PanelRow | undefined {
  const { c, g } = options;
  const cache =
    summary.total.messages > 0 ? cacheHitRatio(summary.total) : undefined;
  const cacheText =
    cache === undefined ? undefined : cachePaint(c, cache)(`${pct(cache)} cache`);
  const sep = c.dim(` ${g.dot} `);

  if (host.fiveHour !== undefined) {
    const ratio = host.fiveHour.usedPercentage / 100;
    const paint = fillPaint(c, ratio);
    const week = host.sevenDay;
    return panelRow(
      [
        gauge("5h", ratio, paint, options),
        week === undefined
          ? undefined
          : fillPaint(c, week.usedPercentage / 100)(
              `${pct(week.usedPercentage / 100)} week`,
            ),
        cacheText,
      ],
      sep,
      // Plain spacing between the gauge and the fields it leads, the
      // same as the context row, so the two bars sit in a block and
      // what follows them starts at the same place.
      GAUGE_GAP,
    );
  }

  if (cache === undefined) return undefined;
  const paint = cachePaint(c, cache);
  return panelRow([gauge("cache", cache, paint, options), paint("hit rate")], GAUGE_GAP);
}

export function statuslinePanel(
  summary: SessionSummary,
  context: CurrentContext,
  options: PanelOptions,
): string[] {
  const host = options.host ?? emptyHostFacts();
  const rows = [
    identityRow(summary, context, options, host),
    costRow(summary, options, host),
  ];
  if (context.tokens > 0 && options.contextWindow > 0) {
    rows.push(contextRow(context.tokens, options));
  }
  const limits = limitsRow(summary, options, host);
  if (limits !== undefined) rows.push(limits);
  return rows.map((row) => fitRow(row, options.width));
}
