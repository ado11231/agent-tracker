import { localDayKey, type ActivityStats } from "../cost/aggregate.js";
import { fmtUsd, fmtWhen } from "./format.js";
import type { GlyphSet } from "./glyphs.js";
import { roles } from "./palette.js";
import type { Style } from "./style.js";

// A GitHub-style contribution graph for daily cost, drawn in the
// terminal. Weeks are columns (Sunday at the top), the last one being
// this week; days are the seven rows. Intensity rides the glyph ramp
// so the graph reads with color stripped — the green shading only
// reinforces it, and a piped or NO_COLOR run still shows the pattern.

// "  Mon " — two lead spaces, a three-wide weekday label, one space.
const GUTTER = 6;
// The two vertical frame columns, one each side of the grid.
const FRAME = 2;
// One space inside the left frame column so the first cell of a row
// does not touch it. The right side gets the same from the trailing
// gap every cell carries.
const LEAD_PAD = 1;
// Everything a row spends on something other than cells.
const OVERHEAD = GUTTER + FRAME + LEAD_PAD;
const MAX_WEEKS = 53;
// Characters per week column: one for the glyph, the rest a gap. Never
// less than two, so cells always stand apart instead of fusing into a
// solid strip, and never more than three, past which the grid reads as
// scattered dots. A narrow terminal drops old weeks rather than
// closing the gaps.
const MIN_CELL = 2;
const MAX_CELL = 3;
// A blank line between weekday rows. The ramp glyphs fill the whole
// character cell, so two spend days in the same week fused into one
// vertical bar and a run of days read as a single blob. The gap costs
// six lines and buys a real grid: every day is its own mark, spaced on
// both axes.
const ROW_GAP = 1;
// Spacing inside the strip under the grid. Each stat is already a label
// beside a value, and each legend item a swatch beside a name, so the
// gap between items has to be clearly wider than the gap inside one or
// the line reads as six loose words.
const STAT_GAP = "      ";
const LEGEND_GAP = "     ";

// Width in characters of each week column, given the room available.
// Squares cap themselves at the tightest width: a half block already
// leaves half a line of gap above it, so one space beside it makes the
// lattice about even, and a second would leave the days looking
// scattered instead of woven.
function cellWidth(weeks: number, budget: number, max = MAX_CELL): number {
  if (weeks <= 0) return MIN_CELL;
  return Math.max(MIN_CELL, Math.min(max, Math.floor(budget / weeks)));
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
  const budget = width - OVERHEAD;
  const weeks = Math.max(
    MIN_WEEKS,
    Math.min(MAX_WEEKS, Math.floor(budget / MIN_CELL)),
  );
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

// A day with no spend has no model, so it dims to a faint grey the way
// an empty gauge cell does. Every other day takes its model's hue. In
// square mode grey is doing GitHub's job of keeping the empty days
// visible as part of the lattice, so it is muted rather than dimmed
// away.
function paintEmpty(style: Style, ch: string, squares: boolean): string {
  return squares ? style.gray(ch) : style.dim(ch);
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
  // Axis labels are chrome: they place the grid and then get out of
  // the way, so they recede rather than compete with the cells.
  return " ".repeat(lead) + style.dim(slots.join("").trimEnd());
}

// The second dimension: hue carries the model that dominated each day.
// How much it spent rides on the level, which is a brightness of that
// hue in square mode and a glyph from the ramp otherwise.
export interface HeatmapColoring {
  // Local day key → the model that spent the most that day.
  dayCategory: Map<string, string>;
  // Models biggest first, the order the legend lists them.
  order: string[];
  // level is 1 to 4; the legends ask for the brightest.
  colorOf: (category: string, level: number) => (text: string) => string;
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
  coloring: HeatmapColoring;
  // Terminal width, used only to decide how wide each week column can
  // stretch. Defaults to a plain 80.
  width?: number;
  // Draw every day as the same square and let brightness say how much
  // was spent, the way a contribution graph does. Only correct when
  // color is actually going to reach the reader, so the caller passes
  // it: color on and unicode glyphs. Without it the grid falls back to
  // the shade ramp with a blank line between weekday rows, which is
  // what a piped, NO_COLOR or --ascii run gets.
  squares?: boolean;
}

export function renderHeatmap(input: HeatmapInput): string[] {
  const { daily, stats, from, to, weeks, glyphs, style, coloring } = input;
  const squares = input.squares === true;
  const toTime = new Date(to);
  toTime.setHours(23, 59, 59, 999);

  const budget = (input.width ?? 80) - OVERHEAD;
  const cell = cellWidth(weeks, budget, squares ? MIN_CELL : MAX_CELL);
  const gap = " ".repeat(cell - 1);
  const pad = " ".repeat(LEAD_PAD);

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

  const r = roles(style);
  const lines: string[] = [];
  // Each part of the caption is styled for the job it does: what the
  // grid measures in bold, the span it covers dim, and what the colors
  // mean in the model hue, so the caption names the legend below it.
  const dot = style.dim(glyphs.dot);
  lines.push(
    `  ${style.bold("daily cost")} ${dot} ${style.dim(`last ${weeks} weeks`)}` +
      ` ${dot} ${r.model("by model")}`,
  );
  // The month labels sit above the first cell of each week, so they
  // clear the left frame column and its padding.
  lines.push(monthHeader(from, weeks, cell, GUTTER + 1 + LEAD_PAD, style));

  const box = glyphs.box;
  const interior = LEAD_PAD + weeks * cell;
  const rule = box.h.repeat(interior);
  const framePad = " ".repeat(GUTTER);
  // The frame is drawn plain, not dim. It is the one piece of chrome
  // that has to hold a shape against a grid of block glyphs, and dim
  // left it barely visible on most themes.
  lines.push(framePad + box.tl + rule + box.tr);

  // An empty run of the frame, used to hold the weeks apart vertically.
  // Squares hold themselves apart, so they need none of these.
  const blankRow = `${framePad}${box.v}${" ".repeat(interior)}${box.v}`;
  const rowGap = squares ? 0 : ROW_GAP;

  for (let row = 0; row < 7; row++) {
    for (let i = 0; i < (row === 0 ? 0 : rowGap); i++) lines.push(blankRow);
    const label = (ROW_LABELS[row] ?? "").padEnd(3);
    let cells = "";
    for (let c = 0; c < weeks; c++) {
      const date = addDays(from, c * 7 + row);
      if (date.getTime() > toTime.getTime()) {
        cells += " ".repeat(cell); // future day: leave the cell empty
        continue;
      }
      const key = localDayKey(date);
      const level = levelOf(daily.get(key) ?? 0, thresholds);
      // Square mode draws one shape for every day and says how much in
      // brightness; otherwise the shape itself is the magnitude.
      const glyph = squares
        ? glyphs.heatSquare
        : (glyphs.heatRamp[level] ?? glyphs.heatRamp[0]);
      // The hue carries the day's top model. An empty day has no model,
      // so it stays neutral.
      const model = level === 0 ? undefined : coloring.dayCategory.get(key);
      cells +=
        model === undefined
          ? paintEmpty(style, glyph, squares)
          : coloring.colorOf(model, level)(glyph);
      // The gap after every column spreads the grid apart and keeps
      // each cell the same width so the border lines up.
      cells += gap;
    }
    // Weekday label in the gutter, then the row inside the frame. The
    // lead pad keeps the first cell off the frame; the last cell's own
    // trailing gap does the same on the right.
    lines.push(`  ${style.dim(label)} ${box.v}${pad}${cells}${box.v}`);
  }

  lines.push(framePad + box.bl + rule + box.br);
  lines.push("");

  const when =
    stats.mostActiveDay === undefined
      ? "—"
      : `${fmtWhen(`${stats.mostActiveDay}T00:00:00`, to)} ${glyphs.dot} ${fmtUsd(stats.mostActiveUsd)}`;
  // Label plain, value bold, so the number carries the emphasis while
  // the word introducing it still reads at full contrast. Wide spacing
  // between the three, since each is a label and a value already
  // holding hands.
  const stat = (label: string, value: string): string =>
    `${label} ${style.bold(value)}`;
  lines.push(
    "  " +
      [
        stat("most active", when),
        stat("longest", `${stats.longestStreak}d`),
        stat("current", `${stats.currentStreak}d`),
      ].join(STAT_GAP),
  );
  // The legends read as their own block, not as more of the stat strip.
  lines.push("");

  // In a line of text the mark has to sit on the text's middle rather
  // than on the floor of its cell, so the legends take the swatch and
  // leave the half block to the grid.
  const swatch = squares
    ? glyphs.swatch
    : (glyphs.heatRamp[glyphs.heatRamp.length - 1] ?? "#");

  // First legend: less to more. In square mode that is the brightness
  // ramp, drawn in the top spender's hue since a neutral white ramp
  // would be invisible on a light background. Otherwise the glyph shape
  // alone says it, left uncolored so that green never reads as a model.
  const top = coloring.order[0];
  const ramp = squares
    ? [
        paintEmpty(style, swatch, true),
        ...[1, 2, 3, 4].map((level) =>
          top === undefined ? swatch : coloring.colorOf(top, level)(swatch),
        ),
      ].join(" ")
    : glyphs.heatRamp.map((ch, i) => (i === 0 ? style.dim(ch) : ch)).join(" ");
  lines.push(`  less ${ramp} more`);

  // Second legend: which hue is which model, biggest spender first. The
  // name takes the hue too, so a color in the grid can be matched by
  // reading rather than by lining up swatches. It takes the third step
  // rather than the fourth: the top of a ramp is its lightest point,
  // which is right for a busy day in a grid and washed out for a word.
  const items = coloring.order.map((model) =>
    coloring.colorOf(model, 3)(`${swatch} ${model}`),
  );
  if (items.length > 0) lines.push(`  ${items.join(LEGEND_GAP)}`);

  return lines;
}
