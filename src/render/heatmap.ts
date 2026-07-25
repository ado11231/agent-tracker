import { localDayKey, type ActivityStats } from "../cost/aggregate.js";
import { fmtUsd, fmtWhen } from "./format.js";
import type { GlyphSet } from "./glyphs.js";
import type { Style } from "./style.js";

// A GitHub-style contribution graph for daily cost, drawn in the
// terminal. Weeks are columns (Sunday at the top), the last one being
// this week; days are the seven rows. Intensity rides the glyph ramp
// so the graph reads with color stripped — the green shading only
// reinforces it, and a piped or NO_COLOR run still shows the pattern.

// "  Mon " — two lead spaces, a three-wide weekday label, one space.
const GUTTER = 6;
const MAX_WEEKS = 53;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
// Only the odd weekday rows are labelled, the way a contribution graph
// labels Mon/Wed/Fri and leaves the rest blank.
const ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// The first day shown (a Sunday) and the week count that fits the
// width. The graph is capped at a year and shrinks from the left on
// narrow terminals, dropping the oldest weeks rather than wrapping.
export function heatmapRange(
  to: Date,
  width: number,
): { from: Date; weeks: number } {
  const budget = Math.min(width, 100) - GUTTER;
  const weeks = Math.max(4, Math.min(MAX_WEEKS, budget));
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - from.getDay()); // back to this week's Sunday
  from.setDate(from.getDate() - (weeks - 1) * 7);
  return { from, weeks };
}

// Three cut points splitting the non-zero daily costs into levels 1–4
// by quantile, so the scale follows the actual spend whether it runs
// in cents or hundreds. All-quiet returns infinities, leaving every
// day at level 0.
export function heatThresholds(values: number[]): [number, number, number] {
  const nonzero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return [Infinity, Infinity, Infinity];
  const q = (p: number): number =>
    nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
  return [q(0.5), q(0.8), q(0.95)];
}

export function levelOf(usd: number, t: [number, number, number]): number {
  if (usd <= 0) return 0;
  if (usd < t[0]) return 1;
  if (usd < t[1]) return 2;
  if (usd < t[2]) return 3;
  return 4;
}

// The 16-color palette rule holds: the glyph already carries the
// level, so color adds only a rising green. Level 0 dims to a faint
// grey the way an empty gauge cell does.
function paint(style: Style, level: number, ch: string): string {
  switch (level) {
    case 0:
      return style.dim(ch);
    case 1:
    case 2:
      return style.green(ch);
    case 3:
      return style.greenBright(ch);
    default:
      return style.bold(style.greenBright(ch));
  }
}

// Month initials placed above the column where each new month begins,
// the leading partial month left unlabelled since its first is out of
// view.
function monthHeader(from: Date, weeks: number, style: Style): string {
  const slots: string[] = new Array(weeks).fill(" ");
  let prevMonth = from.getMonth();
  for (let c = 1; c < weeks; c++) {
    const month = addDays(from, c * 7).getMonth();
    if (month === prevMonth) continue;
    prevMonth = month;
    const label = MONTHS[month] ?? "";
    // Skip a label that would run off the right edge or collide with
    // one already placed a few columns back.
    if (c + label.length > weeks) continue;
    if (slots.slice(c, c + label.length).some((s) => s !== " ")) continue;
    for (let k = 0; k < label.length; k++) slots[c + k] = label[k] ?? " ";
  }
  return " ".repeat(GUTTER) + style.dim(slots.join(""));
}

export interface HeatmapInput {
  // Local day (localDayKey) → cost in dollars. May hold days outside
  // the shown range; only the range is drawn and only its values set
  // the scale.
  daily: Map<string, number>;
  stats: ActivityStats;
  from: Date;
  to: Date;
  weeks: number;
  glyphs: GlyphSet;
  style: Style;
}

export function renderHeatmap(input: HeatmapInput): string[] {
  const { daily, stats, from, to, weeks, glyphs, style } = input;
  const toTime = new Date(to);
  toTime.setHours(23, 59, 59, 999);

  // Values of the days actually on screen, so the scale is not skewed
  // by history scrolled off the left.
  const shown: number[] = [];
  for (let c = 0; c < weeks; c++) {
    for (let r = 0; r < 7; r++) {
      const date = addDays(from, c * 7 + r);
      if (date.getTime() > toTime.getTime()) continue;
      shown.push(daily.get(localDayKey(date)) ?? 0);
    }
  }
  const thresholds = heatThresholds(shown);

  const lines: string[] = [];
  lines.push(`  ${style.dim(`daily cost · last ${weeks} weeks`)}`);
  lines.push(monthHeader(from, weeks, style));

  for (let r = 0; r < 7; r++) {
    const label = (ROW_LABELS[r] ?? "").padEnd(3);
    let line = `  ${style.dim(label)} `;
    for (let c = 0; c < weeks; c++) {
      const date = addDays(from, c * 7 + r);
      if (date.getTime() > toTime.getTime()) {
        line += " "; // future day: leave the cell empty
        continue;
      }
      const level = levelOf(daily.get(localDayKey(date)) ?? 0, thresholds);
      line += paint(style, level, glyphs.heatRamp[level] ?? glyphs.heatRamp[0]);
    }
    lines.push(line);
  }

  lines.push("");

  const when =
    stats.mostActiveDay === undefined
      ? "—"
      : `${fmtWhen(`${stats.mostActiveDay}T00:00:00`, to)} · ${fmtUsd(stats.mostActiveUsd)}`;
  lines.push(
    "  " +
      style.dim("most active ") +
      when +
      "   " +
      style.dim("longest ") +
      `${stats.longestStreak}d` +
      "   " +
      style.dim("current ") +
      `${stats.currentStreak}d`,
  );

  const ramp = glyphs.heatRamp.map((ch, i) => paint(style, i, ch)).join("");
  lines.push(`  ${style.dim("less ")}${ramp}${style.dim(" more")}`);

  return lines;
}
