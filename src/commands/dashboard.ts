import {
  activityStats,
  cacheHitRatio,
  dayOf,
  emptyRollup,
  mergeRollups,
  rollupByKey,
  rollupOf,
  type ActivityStats,
  type UsageRollup,
} from "../cost/aggregate.js";
import { costOfUsage, SYNTHETIC_MODEL } from "../cost/cost.js";
import {
  mergeToolBreakdowns,
  toolBreakdown,
  type ToolBreakdown,
} from "../cost/tools.js";
import { glyphsFor, type GlyphSet } from "../render/glyphs.js";
import { cachePaint } from "../render/live.js";
import {
  fmtPercent,
  fmtTokens,
  fmtUsd,
  renderTable,
  shortModel,
} from "../render/format.js";
import {
  heatmapRange,
  renderHeatmap,
  type HeatmapColoring,
} from "../render/heatmap.js";
import {
  assignModelPaints,
  assignModelShades,
  roles,
  toolPaint,
  type Paint,
} from "../render/palette.js";
import {
  colorEnabled,
  makeStyle,
  supportsTruecolor,
  type Style,
} from "../render/style.js";
import { displayWidth } from "../render/text.js";
import {
  inWindow,
  loadSessions,
  parseWindow,
  projectLabel,
  type CommandFlags,
  type TimeWindow,
} from "./load.js";

// How far back the dashboard looks, one rung at a time. Each step
// zooms out and keeps what the step below showed: week is today and
// this week, month widens both rows, year adds the activity heatmap
// on top of the month rows.
export const DASHBOARD_SPANS = ["week", "month", "year"] as const;
export type DashboardSpan = (typeof DASHBOARD_SPANS)[number];

// --ascii swaps the heatmap glyph ramp (inherited from CommandFlags).
// span stays optional so callers holding a plain CommandFlags still fit.
export type DashboardFlags = CommandFlags & {
  span?: DashboardSpan;
};

interface ProjectRow {
  name: string;
  sessions: number;
  rollup: UsageRollup;
}

// The model that spent the most on each day, plus the models ranked
// biggest first. Kept color-free here so it can go straight into
// --json; the hue is assigned later, only for the terminal render.
interface DayModels {
  dayModel: Map<string, string>;
  order: string[];
}

interface Heatmap {
  from: Date;
  to: Date;
  weeks: number;
  daily: Map<string, number>;
  stats: ActivityStats;
  models: DayModels;
}

// Reduces per-message spend into the single model that spent the most
// on each day, and the overall ranking used for the legend.
function dominantByDay(
  rows: Iterable<{ day: string | undefined; category: string; usd: number }>,
): { dayCategory: Map<string, string>; order: string[] } {
  const perDay = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const { day, category, usd } of rows) {
    if (day === undefined) continue;
    let byCat = perDay.get(day);
    if (byCat === undefined) {
      byCat = new Map();
      perDay.set(day, byCat);
    }
    byCat.set(category, (byCat.get(category) ?? 0) + usd);
    totals.set(category, (totals.get(category) ?? 0) + usd);
  }
  const dayCategory = new Map<string, string>();
  for (const [day, byCat] of perDay) {
    let best: string | undefined;
    let bestUsd = -Infinity;
    for (const [category, usd] of byCat) {
      if (usd > bestUsd) {
        bestUsd = usd;
        best = category;
      }
    }
    if (best !== undefined) dayCategory.set(day, best);
  }
  const order = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category);
  return { dayCategory, order };
}

// Model hues come from the shared palette, so a model reads the same
// here as it does on the statusline. Ranked spender first, which is
// what decides who keeps the family hue when two of a family show up.
// Each model brings a four step intensity ramp of its hue, which is
// what lets one square stand for a day and still say how much it cost.
function buildColoring(models: DayModels, c: Style): HeatmapColoring {
  // Truecolor buys a real ramp: without it the four steps have to come
  // out of dim, normal, bright and bold, and the step most days land on
  // is the dim one.
  const shades = assignModelShades(c, models.order, supportsTruecolor());
  return {
    dayCategory: models.dayModel,
    order: models.order,
    colorOf: (name, level) => {
      const ramp = shades.get(name);
      if (ramp === undefined) return (text) => text;
      return ramp[Math.min(3, Math.max(0, level - 1))] ?? ((text) => text);
    },
  };
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfLocalMonth(date: Date): Date {
  const start = startOfLocalDay(date);
  start.setDate(1);
  return start;
}

export async function runDashboard(flags: DashboardFlags): Promise<number> {
  let window: TimeWindow;
  try {
    window = parseWindow(flags);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }

  const sessions = await loadSessions(flags);
  if (sessions.length === 0) {
    console.error("no sessions found");
    return 2;
  }

  const windowGiven = window.since !== undefined || window.until !== undefined;
  const windowed = sessions.map((session) => ({
    session,
    usage: session.usage.filter((u) => inWindow(u.timestamp, window)),
  }));
  const allUsage = windowed.flatMap((w) => w.usage);
  const total = rollupOf(allUsage);

  const now = new Date();
  const todayKey = dayOf(now.toISOString());
  const today = rollupOf(allUsage.filter((u) => dayOf(u.timestamp) === todayKey));
  const weekStart = startOfLocalDay(now);
  weekStart.setDate(weekStart.getDate() - 6);
  const week = rollupOf(
    allUsage.filter((u) => inWindow(u.timestamp, { since: weekStart })),
  );
  const thisMonth = rollupOf(
    allUsage.filter((u) => inWindow(u.timestamp, { since: startOfLocalMonth(now) })),
  );

  const byProject = new Map<string, ProjectRow>();
  for (const { session, usage } of windowed) {
    if (windowGiven && usage.length === 0) continue;
    // The slug is the grouping key: one directory under the projects
    // root is one project, even when scrubbed cwds collide.
    const key = session.summary.projectSlug;
    let row = byProject.get(key);
    if (row === undefined) {
      row = { name: projectLabel(session.summary), sessions: 0, rollup: emptyRollup() };
      byProject.set(key, row);
    }
    row.sessions += 1;
    mergeRollups(row.rollup, rollupOf(usage));
  }
  const projects = [...byProject.values()].sort(
    (a, b) => b.rollup.usd - a.rollup.usd,
  );

  const byModel = rollupByKey(allUsage, (entry) =>
    entry.model === SYNTHETIC_MODEL ? undefined : entry.model,
  );
  const models = [...byModel.entries()].sort((a, b) => b[1].usd - a[1].usd);

  // Subsets of the total, never additions to it.
  const subagents = rollupOf(allUsage.filter((u) => u.isSidechain));
  const retries = rollupOf(allUsage.filter((u) => !u.onActiveBranch));

  const allowedIds = windowGiven
    ? new Set(allUsage.map((u) => u.messageId))
    : undefined;
  const tools: ToolBreakdown = new Map();
  for (const session of sessions) {
    mergeToolBreakdowns(tools, toolBreakdown(session.extracted, allowedIds));
  }
  const toolRows = [...tools.entries()].sort((a, b) => b[1].usd - a[1].usd);

  const sessionCount = windowGiven
    ? windowed.filter((w) => w.usage.length > 0).length
    : sessions.length;

  let heatmap: Heatmap | undefined;
  if (flags.span === "year") {
    const daily = new Map<string, number>();
    for (const [key, rollup] of rollupByKey(allUsage, (u) => dayOf(u.timestamp))) {
      daily.set(key, rollup.usd);
    }
    const width = process.stdout.columns ?? 80;
    const { from, weeks } = heatmapRange(now, width);

    // Each day is tinted by whichever model spent the most on it,
    // which rides straight on the usage entries. The glyph still
    // carries the magnitude, so the grid answers both questions.
    const { dayCategory, order } = dominantByDay(
      allUsage
        .filter((u) => u.model !== SYNTHETIC_MODEL)
        .map((u) => ({
          day: dayOf(u.timestamp),
          category: shortModel(u.model),
          usd: costOfUsage(u.usage, u.model) ?? 0,
        })),
    );

    heatmap = {
      from,
      to: now,
      weeks,
      daily,
      stats: activityStats(daily, from, now),
      models: { dayModel: dayCategory, order },
    };
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          sessions: sessionCount,
          window: windowGiven
            ? {
                since: window.since?.toISOString() ?? null,
                until: window.until?.toISOString() ?? null,
              }
            : null,
          total,
          cacheHitRatio: cacheHitRatio(total),
          today,
          week,
          month: thisMonth,
          subagents,
          retries,
          byProject: projects.map((p) => ({
            name: p.name,
            sessions: p.sessions,
            ...p.rollup,
          })),
          byModel: models.map(([model, rollup]) => ({ model, ...rollup })),
          byTool: toolRows.map(([category, stats]) => ({ category, ...stats })),
          ...(heatmap
            ? {
                activity: {
                  since: heatmap.from.toISOString(),
                  ...heatmap.stats,
                },
                byDay: [...heatmap.daily.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([date, usd]) => ({
                    date,
                    usd,
                    model: heatmap.models.dayModel.get(date) ?? null,
                  })),
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  printDashboard(
    {
      sessionCount,
      total,
      today,
      week,
      month: thisMonth,
      subagents,
      retries,
      projects,
      models,
      toolRows,
      windowGiven,
      heatmap,
    },
    flags,
  );
  return 0;
}

interface DashboardData {
  sessionCount: number;
  total: UsageRollup;
  today: UsageRollup;
  week: UsageRollup;
  month: UsageRollup;
  subagents: UsageRollup;
  retries: UsageRollup;
  projects: ProjectRow[];
  models: [string, UsageRollup][];
  toolRows: [string, { calls: number; failures: number; usd: number }][];
  windowGiven: boolean;
  heatmap: Heatmap | undefined;
}

// The share bar beside each row of the tables.
const SHARE_WIDTH = 10;

// A name with its number under it. The label reads first and plain, so
// it takes the terminal's own foreground rather than a grey that fights
// the theme; the number below carries the emphasis. Both are padded to
// one width so several tiles line up as columns.
interface Tile {
  value: string;
  label: string;
  paint?: Paint;
}

function renderTiles(tiles: Tile[], c: Style): string[] {
  const gap = "    ";
  const widths = tiles.map((t) => Math.max(t.value.length, t.label.length));
  // The last column keeps no trailing pad, so neither line ends in
  // styled blanks.
  const pad = (text: string, i: number): string => {
    const padded = text.padEnd(widths[i] ?? 0);
    return i === tiles.length - 1 ? padded.trimEnd() : padded;
  };
  const labels = tiles.map((t, i) => pad(t.label, i)).join(gap);
  const values = tiles
    .map((t, i) => {
      const cell = c.bold(pad(t.value, i));
      return t.paint === undefined ? cell : t.paint(cell);
    })
    .join(gap);
  return [`  ${labels}`, `  ${values}`];
}

// A row's slice of the total, drawn as a small gauge so the table can
// be read as a shape before any of its numbers are. Zero draws an
// empty bar rather than nothing, keeping the column aligned.
function shareCell(part: number, whole: number, g: GlyphSet): string {
  const ratio = whole <= 0 ? 0 : Math.max(0, Math.min(1, part / whole));
  const filled = ratio <= 0 ? 0 : Math.max(1, Math.round(ratio * SHARE_WIDTH));
  const bar =
    g.gaugeFull.repeat(filled) + g.gaugeEmpty.repeat(SHARE_WIDTH - filled);
  return `${bar} ${`${Math.round(ratio * 100)}%`.padStart(4)}`;
}

function printDashboard(data: DashboardData, flags: DashboardFlags): void {
  const { sessionCount, total, today, week, month, subagents, retries, projects, models, toolRows, windowGiven, heatmap } = data;
  // month and year both widen the rows; year additionally draws the
  // grid above them.
  const wideRows = flags.span === "month" || flags.span === "year";
  const c = makeStyle(colorEnabled(flags.color));
  const r = roles(c);
  const g = glyphsFor(flags.ascii === true);
  const lines: string[] = [];
  const columns = process.stdout.columns ?? 80;

  // The masthead: the name, then the four numbers that answer "how
  // much, over what" before any table is read. No rule under the name —
  // a line that long is the widest thing on the screen and reads as a
  // divider between two halves of a report rather than as a heading for
  // the block below it. The blank line does that job.
  lines.push(`  ${c.bold("ccvitals")}`);
  lines.push("");
  const cache = cacheHitRatio(total);
  lines.push(
    ...renderTiles(
      [
        { value: fmtUsd(total.usd), label: windowGiven ? "in window" : "all time" },
        { value: String(sessionCount), label: "sessions" },
        { value: fmtTokens(total.messages), label: "messages" },
        {
          value: fmtPercent(cache),
          label: "cache hit",
          paint: cachePaint(c, cache),
        },
      ],
      c,
    ),
  );
  lines.push("");

  if (heatmap !== undefined) {
    const rendered = renderHeatmap({
      daily: heatmap.daily,
      stats: heatmap.stats,
      from: heatmap.from,
      to: heatmap.to,
      weeks: heatmap.weeks,
      glyphs: g,
      style: c,
      width: columns,
      coloring: buildColoring(heatmap.models, c),
      // Squares need both halves of the deal: color to carry the level,
      // and a half block glyph to be square in the first place.
      squares: c.isColorSupported && flags.ascii !== true,
    });
    for (const line of rendered) lines.push(line);
    lines.push("");
  }

  // Each table gets the hue of the thing it lists, so the eye can jump
  // straight to a section and the same hue means the same thing in
  // every other command. Color stays on the heading, the row's own name
  // and its share bar; the numbers are left plain and readable, and the
  // layout survives color being stripped because the columns are
  // aligned and the rule under the heading is drawn in text.
  //
  // rowPaint hues one row of the body, name and bar together. Returning
  // undefined leaves the row plain, which is what a table with nothing
  // per-row to say does.
  const table = (
    rows: string[][],
    align: ("left" | "right")[],
    head: Paint,
    rowPaint?: (row: number) => Paint | undefined,
  ): void => {
    const last = (rows[0]?.length ?? 1) - 1;
    const rendered = renderTable(rows, align, (cell, col, row) => {
      if (row === 0) return c.bold(head(cell));
      const paint = rowPaint?.(row - 1);
      if (paint === undefined) return cell;
      // The name says which row this is and the bar says how big it is.
      // Those are the two cells worth hueing; the raw numbers between
      // them read better plain.
      return col === 0 || col === last ? paint(cell) : cell;
    });
    lines.push(`  ${rendered[0] ?? ""}`);
    // A rule under the heading, sized to the widest row, so a long
    // table reads as one block instead of a drift of numbers.
    const width = Math.max(...rendered.map((line) => displayWidth(line)));
    lines.push(`  ${c.dim(g.rule.repeat(width))}`);
    for (const line of rendered.slice(1)) lines.push(`  ${line}`);
  };

  const spendRow = (label: string, rollup: UsageRollup): string[] => [
    label,
    fmtUsd(rollup.usd),
    fmtTokens(rollup.tokens.input),
    fmtTokens(rollup.tokens.output),
    fmtTokens(rollup.tokens.cacheRead),
  ];
  // An explicit window collapses to a single row. Otherwise the two
  // rows climb one rung of the ladder as --span widens: today/week
  // becomes week/month.
  const spendRows: string[][] = [["period", "cost", "input", "output", "cached"]];
  if (windowGiven) {
    spendRows.push(spendRow("window", total));
  } else if (wideRows) {
    spendRows.push(spendRow("this week", week), spendRow("this month", month));
  } else {
    spendRows.push(spendRow("today", today), spendRow("this week", week));
  }
  // No hue: a period is not one of the four things the scheme names,
  // and the heading is doing the work here.
  table(spendRows, ["left", "right", "right", "right", "right"], (t) => t);
  if (subagents.messages > 0 || retries.messages > 0) {
    lines.push(
      `  ${c.dim("of the total:")} subagents ${fmtUsd(subagents.usd)}` +
        ` (${subagents.messages} msg${subagents.messages === 1 ? "" : "s"})` +
        ` ${g.dot} retries ${fmtUsd(retries.usd)}` +
        ` (${retries.messages} msg${retries.messages === 1 ? "" : "s"})`,
    );
  }
  lines.push("");

  const projectRows: string[][] = [["project", "sessions", "cost", "share"]];
  for (const p of projects) {
    projectRows.push([
      p.name,
      String(p.sessions),
      fmtUsd(p.rollup.usd),
      shareCell(p.rollup.usd, total.usd, g),
    ]);
  }
  table(projectRows, ["left", "right", "right", "left"], r.project, () => r.project);
  lines.push("");

  // Models keep the hues the heatmap legend gave them, so a color in
  // the grid can be looked up in this table.
  const modelPaints = assignModelPaints(
    c,
    models.map(([model]) => shortModel(model)),
  );
  const modelRows: string[][] = [["model", "messages", "cost", "share"]];
  for (const [model, rollup] of models) {
    modelRows.push([
      shortModel(model),
      String(rollup.messages),
      fmtUsd(rollup.usd),
      shareCell(rollup.usd, total.usd, g),
    ]);
  }
  table(modelRows, ["left", "right", "right", "left"], r.model, (row) =>
    modelPaints.get(shortModel(models[row]?.[0] ?? "")),
  );
  lines.push("");

  const toolTableRows: string[][] = [["tool", "calls", "fails", "cost", "share"]];
  for (const [category, stats] of toolRows) {
    toolTableRows.push([
      category,
      stats.calls === 0 ? "-" : String(stats.calls),
      stats.calls === 0 ? "-" : String(stats.failures),
      fmtUsd(stats.usd),
      shareCell(stats.usd, total.usd, g),
    ]);
  }
  // Tools carry the hue they wear in context, so bash reads green here
  // and green there. The ones with no tool hue stay plain.
  table(
    toolTableRows,
    ["left", "right", "right", "right", "left"],
    r.tool,
    (row) => toolPaint(c, toolRows[row]?.[0] ?? ""),
  );

  if (total.unknownModels.length > 0) {
    lines.push("");
    lines.push(
      `  ${r.warn("no pricing")} for ${total.unknownModels.join(", ")}` +
        `, see ccvitals doctor`,
    );
  }

  console.log(lines.join("\n"));
}
