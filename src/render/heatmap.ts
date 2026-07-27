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
// The two vertical border columns, one each side of the grid.
const BORDER = 2;
const MAX_WEEKS = 53;
// Characters per week column: one for the glyph, the rest a gap. A
// short history stretches its columns apart so the grid reads as a
// grid instead of a solid strip; a full year falls back toward 1 so it
// still fits the width. Never wider than this many columns per week.
const MAX_CELL = 3;

// Width in characters of each week column, given the room available.
// Always at least 1, and never so wide that the weeks overflow.
function cellWidth(weeks: number, budget: number): number {
  if (weeks <= 0) return 1;
  return Math.max(1, Math.min(MAX_CELL, Math.floor(budget / weeks)));
}

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

const MIN_WEEKS = 4;

function sundayOf(date: Date): Date {
  const sunday = new Date(date);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return sunday;
}

// The first day shown (a Sunday) and the week count. Always a full
// trailing year so every month appears, active or not, the way a
// contribution graph shows the whole year. Capped only by the width,
// shrinking from the left on narrow terminals by dropping the oldest
// weeks rather than wrapping.
export function heatmapRange(
  to: Date,
  width: number,
): { from: Date; weeks: number } {
  const budget = width - GUTTER - BORDER;
  const weeks = Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, budget));
  const from = new Date(sundayOf(to));
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
// view. Works in character columns, so it lines up whatever the cell
// width: each week starts at column c * cell.
function monthHeader(
  from: Date,
  weeks: number,
  cell: number,
  lead: number,
  style: Style,
): string {
  const width = weeks * cell;
  const slots: string[] = new Array(width).fill(" ");
  let prevMonth = from.getMonth();
  for (let c = 1; c < weeks; c++) {
    const month = addDays(from, c * 7).getMonth();
    if (month === prevMonth) continue;
    prevMonth = month;
    const label = MONTHS[month] ?? "";
    const pos = c * cell;
    // Skip a label that would run off the right edge or collide with
    // one already placed a few columns back.
    if (pos + label.length > width) continue;
    if (slots.slice(pos, pos + label.length).some((s) => s !== " ")) continue;
    for (let k = 0; k < label.length; k++) slots[pos + k] = label[k] ?? " ";
  }
  return " ".repeat(lead) + style.dim(slots.join(""));
}

// Optional second dimension: hue carries a category (the model or
// project that dominated each day) while the glyph keeps carrying
// magnitude. Kept optional so the plain grid is unchanged.
export interface HeatmapColoring {
  label: string;
  // Local day key → the category that spent the most that day.
  dayCategory: Map<string, string>;
  // Categories biggest first, the order the legend lists them.
  order: string[];
  colorOf: (category: string) => (text: string) => string;
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
  coloring?: HeatmapColoring;
  // Terminal width, used only to decide how wide each week column can
  // stretch. Defaults to a plain 80.
  width?: number;
}

export function renderHeatmap(input: HeatmapInput): string[] {
  const { daily, stats, from, to, weeks, glyphs, style, coloring } = input;
  const toTime = new Date(to);
  toTime.setHours(23, 59, 59, 999);

  const budget = (input.width ?? 80) - GUTTER - BORDER;
  const cell = cellWidth(weeks, budget);
  const gap = " ".repeat(cell - 1);

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
  const title = `daily cost · last ${weeks} weeks${
    coloring !== undefined ? ` · by ${coloring.label}` : ""
  }`;
  lines.push(`  ${style.dim(title)}`);
  // The month labels sit above the grid interior, one column past the
  // left border.
  lines.push(monthHeader(from, weeks, cell, GUTTER + BORDER / 2, style));

  const box = glyphs.box;
  const interior = weeks * cell;
  const rule = box.h.repeat(interior);
  const framePad = " ".repeat(GUTTER);
  lines.push(framePad + style.dim(box.tl + rule + box.tr));

  for (let r = 0; r < 7; r++) {
    const label = (ROW_LABELS[r] ?? "").padEnd(3);
    let cells = "";
    for (let c = 0; c < weeks; c++) {
      const date = addDays(from, c * 7 + r);
      if (date.getTime() > toTime.getTime()) {
        cells += " ".repeat(cell); // future day: leave the cell empty
        continue;
      }
      const key = localDayKey(date);
      const level = levelOf(daily.get(key) ?? 0, thresholds);
      const glyph = glyphs.heatRamp[level] ?? glyphs.heatRamp[0];
      // With a coloring the glyph still carries magnitude; hue carries
      // the category. An empty day has no category, so it stays dim.
      if (coloring === undefined || level === 0) {
        cells += paint(style, level, glyph);
      } else {
        const category = coloring.dayCategory.get(key);
        cells +=
          category === undefined
            ? paint(style, level, glyph)
            : coloring.colorOf(category)(glyph);
      }
      // The gap after every column spreads the grid apart and keeps
      // each cell the same width so the border lines up.
      cells += gap;
    }
    // Weekday label in the gutter, then the row framed by the border.
    lines.push(`  ${style.dim(label)} ${style.dim(box.v)}${cells}${style.dim(box.v)}`);
  }

  lines.push(framePad + style.dim(box.bl + rule + box.br));
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

  // Without a coloring the ramp is green, reinforcing magnitude. With
  // one, green would falsely read as a category, so the ramp goes
  // neutral and the glyph shape alone says less-to-more.
  const ramp =
    coloring === undefined
      ? glyphs.heatRamp.map((ch, i) => paint(style, i, ch)).join("")
      : glyphs.heatRamp.map((ch, i) => (i === 0 ? style.dim(ch) : ch)).join("");
  lines.push(`  ${style.dim("less ")}${ramp}${style.dim(" more")}`);

  // Second legend: which hue is which category, biggest spender first.
  if (coloring !== undefined) {
    const swatch = glyphs.heatRamp[glyphs.heatRamp.length - 1] ?? "#";
    const items = coloring.order.map(
      (category) => `${coloring.colorOf(category)(swatch)} ${category}`,
    );
    if (items.length > 0) lines.push(`  ${items.join("   ")}`);
  }

  return lines;
}
