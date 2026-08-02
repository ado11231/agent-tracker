import { describe, expect, it } from "vitest";
import { activityStats } from "../src/cost/aggregate.js";
import { glyphsFor } from "../src/render/glyphs.js";
import {
  heatThresholds,
  heatmapRange,
  levelOf,
  renderHeatmap,
} from "../src/render/heatmap.js";
import { makeStyle } from "../src/render/style.js";

// Every test runs with color off, which is also the piped / NO_COLOR
// case: it proves the structure survives with the styling stripped.
const plain = makeStyle(false);

describe("heatThresholds and levelOf", () => {
  it("splits non-zero values into rising levels", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const t = heatThresholds(values);
    expect(t[0]).toBeLessThanOrEqual(t[1]);
    expect(t[1]).toBeLessThanOrEqual(t[2]);
    expect(levelOf(0, t)).toBe(0);
    expect(levelOf(1, t)).toBeGreaterThanOrEqual(1);
    expect(levelOf(10, t)).toBe(4);
  });

  it("leaves every day at level 0 when nothing was spent", () => {
    const t = heatThresholds([0, 0, 0]);
    expect(levelOf(0, t)).toBe(0);
    expect(levelOf(5, t)).toBe(1);
  });
});

describe("heatmapRange", () => {
  it("caps at a year and starts on a Sunday", () => {
    const to = new Date("2026-07-25T12:00:00");
    const wide = heatmapRange(to, 250);
    expect(wide.weeks).toBe(53);
    expect(wide.from.getDay()).toBe(0);
    // The last column's Sunday is this week's Sunday, so the whole
    // range ends on or after `to`.
    const lastSunday = new Date(wide.from);
    lastSunday.setDate(lastSunday.getDate() + (wide.weeks - 1) * 7);
    expect(lastSunday.getTime()).toBeLessThanOrEqual(to.getTime());
  });

  it("shrinks from the left on a narrow terminal", () => {
    const to = new Date("2026-07-25T12:00:00");
    // 30 columns leaves 21 for cells after the 9 of gutter, frame and
    // pad, and every cell is at least 2 wide.
    expect(heatmapRange(to, 30).weeks).toBe(10);
    expect(heatmapRange(to, 8).weeks).toBe(4); // floored, never vanishes
  });

  it("needs the room for spaced cells before it draws a full year", () => {
    const to = new Date("2026-07-25T12:00:00");
    // 53 weeks at 2 columns each, plus the 9 of overhead.
    expect(heatmapRange(to, 115).weeks).toBe(53);
    expect(heatmapRange(to, 114).weeks).toBe(52);
  });
});

describe("activityStats", () => {
  const daily = new Map<string, number>([
    ["2026-01-01", 1],
    ["2026-01-02", 2],
    ["2026-01-03", 3], // a three-day run
    // 2026-01-04 idle, breaking the streak
    ["2026-01-05", 5],
    ["2026-01-06", 4],
    ["2026-01-07", 9], // peak day
    ["2026-01-08", 2], // a four-day run, the longest
  ]);
  const from = new Date("2026-01-01T00:00:00");

  it("finds the longest streak, peak day, and active-day count", () => {
    const s = activityStats(daily, from, new Date("2026-01-10T00:00:00"));
    expect(s.longestStreak).toBe(4);
    expect(s.activeDays).toBe(7);
    expect(s.mostActiveDay).toBe("2026-01-07");
    expect(s.mostActiveUsd).toBe(9);
  });

  it("counts the current streak back from the last day", () => {
    // Ending on the active 8th: 8,7,6,5 then an idle 4th stops it.
    expect(
      activityStats(daily, from, new Date("2026-01-08T00:00:00")).currentStreak,
    ).toBe(4);
    // Ending on an idle day reads zero, the way a contribution graph does.
    expect(
      activityStats(daily, from, new Date("2026-01-10T00:00:00")).currentStreak,
    ).toBe(0);
  });
});

describe("renderHeatmap", () => {
  // 2026-01-25 is a Sunday, so the final column has one real cell and
  // six future ones — a clean way to test the future-day blanks.
  const to = new Date("2026-01-25T12:00:00");
  const { from, weeks } = heatmapRange(to, 80);
  const daily = new Map<string, number>([
    ["2026-01-05", 0.5],
    ["2026-01-06", 5],
    ["2026-01-07", 50],
  ]);
  const stats = activityStats(daily, from, to);

  // Every day here is opus-4-8 except the biggest, so the legend has
  // two entries with the bigger spender first.
  const coloring = {
    dayCategory: new Map([
      ["2026-01-05", "opus-4-8"],
      ["2026-01-06", "opus-4-8"],
      ["2026-01-07", "fable-5"],
    ]),
    order: ["fable-5", "opus-4-8"],
    colorOf: () => (text: string) => text,
  };

  function render(ascii: boolean): string[] {
    return renderHeatmap({
      daily,
      stats,
      from,
      to,
      weeks,
      glyphs: glyphsFor(ascii),
      style: plain,
      coloring,
    });
  }

  // The framed rows that carry cells, with the blank spacers between
  // them left out.
  const dayRows = (lines: string[]): string[] =>
    lines.filter((line) => line.includes("┃") && /[·░▒▓█]/.test(line));

  it("draws a caption, seven weekday rows, a stat strip, and two legends", () => {
    const lines = render(false);
    const text = lines.join("\n");
    expect(lines[0]).toContain("daily cost");
    expect(lines[0]).toContain("by model");
    // caption, month header, top border, seven rows each followed by a
    // blank spacer bar the last, bottom border, blank, stats, blank,
    // ramp legend, model legend
    expect(lines).toHaveLength(22);
    expect(dayRows(lines)).toHaveLength(7);
    for (const label of ["Mon", "Wed", "Fri"]) expect(text).toContain(label);
    expect(text).toContain("most active");
    expect(text).toContain("less ");
    expect(text).toContain(" more");
  });

  it("names the models in the second legend, biggest spender first", () => {
    const legend = render(false).at(-1) ?? "";
    expect(legend).toContain("fable-5");
    expect(legend).toContain("opus-4-8");
    expect(legend.indexOf("fable-5")).toBeLessThan(legend.indexOf("opus-4-8"));
  });

  it("frames the grid with a heavy border", () => {
    const text = render(false).join("\n");
    for (const piece of ["┏", "┓", "┗", "┛", "┃"]) {
      expect(text).toContain(piece);
    }
  });

  it("frames the grid with ascii box pieces under --ascii", () => {
    const text = render(true).join("\n");
    expect(text).toContain("+");
    expect(text).toContain("|");
    expect(text).not.toContain("┃");
  });

  it("keeps the cells off the frame and off each other", () => {
    const rows = dayRows(render(false));
    for (const row of rows) {
      // A cell never abuts the frame on either side.
      expect(row).toMatch(/┃ /);
      expect(row).toMatch(/ ┃$/);
    }
    // Two glyphs never end up adjacent, whatever the width.
    const interior = (rows[4] ?? "").replace(/^.*┃/, "").replace(/┃$/, "");
    expect(interior).not.toMatch(/[·░▒▓█]{2}/);
  });

  // Square mode hands the level to the paint instead of the glyph, so
  // a marker paint is enough to prove the level got there.
  function squareRender(): string[] {
    return renderHeatmap({
      daily,
      stats,
      from,
      to,
      weeks,
      glyphs: glyphsFor(false),
      style: plain,
      squares: true,
      coloring: {
        dayCategory: coloring.dayCategory,
        order: coloring.order,
        colorOf: (_model: string, level: number) => (text: string) =>
          `<${level}>${text}`,
      },
    });
  }

  it("draws one square per day when color can carry the level", () => {
    const lines = squareRender();
    const framed = lines.filter((line) => line.includes("┃"));
    // Seven rows and no spacers: a half block already leaves the top
    // half of its line empty, which is the gap.
    expect(framed).toHaveLength(7);
    for (const line of framed) {
      expect(line).toContain("▆");
      // None of the shade ramp survives; every day is the same shape.
      expect(line).not.toMatch(/[·░▒▓█]/);
    }
  });

  it("sends the day's level to the paint in square mode", () => {
    const text = squareRender().join("\n");
    // The three spend days sit at three different levels, and each one
    // reaches the paint rather than changing the glyph.
    expect(text).toMatch(/<1>▆/);
    expect(text).toMatch(/<4>▆/);
    // The ramp legend runs the whole scale; the model legend takes the
    // third step, the top being too light to read as a word.
    const legend = squareRender().at(-1) ?? "";
    expect(legend).toContain("<3>■ fable-5");
  });

  it("holds the weekday rows apart with an empty run of the frame", () => {
    const lines = render(false);
    const framed = lines.filter((line) => line.includes("┃"));
    // Thirteen framed lines: seven day rows with a spacer between each
    // pair, so no two days ever share an edge vertically.
    expect(framed).toHaveLength(13);
    for (let i = 0; i < framed.length; i++) {
      const line = framed[i] ?? "";
      const isDay = /[·░▒▓█]/.test(line);
      expect(isDay).toBe(i % 2 === 0);
      // A spacer is frame, blanks, frame — the same width as a day row.
      if (!isDay) expect(line).toMatch(/┃ +┃$/);
      expect(line.length).toBe((framed[0] ?? "").length);
    }
  });

  it("stretches the columns apart when the terminal is wide", () => {
    const opts = {
      daily, stats, from, to, weeks,
      glyphs: glyphsFor(false), style: plain, coloring,
    };
    const gridRow = (ls: string[]) => ls.find((l) => l.includes("┃"))?.length ?? 0;
    const narrow = renderHeatmap({ ...opts, width: 80 });
    const wide = renderHeatmap({ ...opts, width: 250 });
    // Same weeks, but wider cells, so the framed rows are longer.
    expect(gridRow(wide)).toBeGreaterThan(gridRow(narrow));
  });

  it("carries intensity in the glyph ramp with color stripped", () => {
    const text = render(false).join("\n");
    // Three spend days at different levels must show distinct glyphs.
    expect(text).toContain("░");
    expect(text).toContain("█");
  });

  it("swaps the ramp for ascii glyphs under --ascii", () => {
    const text = render(true).join("\n");
    expect(text).toContain("#");
    expect(text).not.toContain("█");
  });

  it("leaves future days blank in the final column", () => {
    const rows = dayRows(render(false));
    // Every cell now carries a trailing gap, so a row cannot be
    // checked by what it ends with. Where the last glyph sits is the
    // real question: Sunday (row 0) is `to` and fills the final
    // column, Monday (row 1) is tomorrow and stops a column short.
    const lastGlyph = (line?: string) =>
      (line ?? "").replace(/┃$/, "").search(/[·░▒▓█](?![\s\S]*[·░▒▓█])/);
    expect(lastGlyph(rows[0])).toBeGreaterThan(lastGlyph(rows[1]));
  });
});
