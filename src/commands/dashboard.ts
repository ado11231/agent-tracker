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
import { glyphsFor } from "../render/glyphs.js";
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
import { colorEnabled, makeStyle, type Style } from "../render/style.js";
import {
  inWindow,
  loadSessions,
  parseWindow,
  projectLabel,
  type CommandFlags,
  type TimeWindow,
} from "./load.js";

// The dashboard takes flags beyond the shared set: --year draws the
// activity heatmap, --month widens the summary rows, and --ascii swaps
// the heatmap glyph ramp. All optional so callers holding a plain
// CommandFlags still fit.
export type DashboardFlags = CommandFlags & {
  year?: boolean;
  month?: boolean;
  ascii?: boolean;
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

// Distinct 16-color hues for models, ranked spender first. Red is left
// out: it means an error elsewhere in the tool. Cycles if there are
// somehow more models than hues.
function buildColoring(models: DayModels, c: Style): HeatmapColoring {
  const palette = [c.cyan, c.magenta, c.yellow, c.blue, c.green];
  const colorMap = new Map<string, (text: string) => string>();
  models.order.forEach((name, i) => {
    colorMap.set(name, palette[i % palette.length] ?? c.green);
  });
  return {
    dayCategory: models.dayModel,
    order: models.order,
    colorOf: (name) => colorMap.get(name) ?? c.green,
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
  if (flags.year === true) {
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

function printDashboard(data: DashboardData, flags: DashboardFlags): void {
  const { sessionCount, total, today, week, month, subagents, retries, projects, models, toolRows, windowGiven, heatmap } = data;
  const monthView = flags.month === true;
  const c = makeStyle(colorEnabled(flags.color));
  const lines: string[] = [];
  const dot = c.dim("·");

  lines.push(
    `${c.bold("ccplus")} ${dot} ${sessionCount} sessions ${dot} ` +
      `${c.bold(fmtUsd(total.usd))} ${dot} cache hit ${fmtPercent(cacheHitRatio(total))}`,
  );
  lines.push("");

  if (heatmap !== undefined) {
    const rendered = renderHeatmap({
      daily: heatmap.daily,
      stats: heatmap.stats,
      from: heatmap.from,
      to: heatmap.to,
      weeks: heatmap.weeks,
      glyphs: glyphsFor(flags.ascii === true),
      style: c,
      width: process.stdout.columns ?? 80,
      coloring: buildColoring(heatmap.models, c),
    });
    for (const line of rendered) lines.push(line);
    lines.push("");
  }

  const spendRow = (label: string, rollup: UsageRollup): string[] => [
    label,
    fmtUsd(rollup.usd),
    `${fmtTokens(rollup.tokens.input)} in`,
    `${fmtTokens(rollup.tokens.output)} out`,
    `${fmtTokens(rollup.tokens.cacheRead)} cached`,
  ];
  // An explicit window collapses to a single row. Otherwise the two
  // rows climb one rung of the ladder under --month: today/week
  // becomes week/month.
  let spendRows: string[][];
  if (windowGiven) {
    spendRows = [spendRow("window", total)];
  } else if (monthView) {
    spendRows = [spendRow("this week", week), spendRow("this month", month)];
  } else {
    spendRows = [spendRow("today", today), spendRow("this week", week)];
  }
  for (const line of renderTable(spendRows, ["left", "right", "right", "right", "right"])) {
    lines.push(`  ${line}`);
  }
  if (subagents.messages > 0 || retries.messages > 0) {
    lines.push(
      `  ${c.cyan("of the total:")} subagents ${fmtUsd(subagents.usd)}` +
        ` (${subagents.messages} msgs) · retries ${fmtUsd(retries.usd)}` +
        ` (${retries.messages} msgs)`,
    );
  }
  lines.push("");

  // Each table gets its own heading hue so the eye can jump straight to
  // a section. The heading is the only colored text in a table, which
  // leaves the numbers plain and readable, and the layout survives
  // color being stripped because the columns are already aligned.
  const heading = (table: string[], paint: (text: string) => string): void => {
    lines.push(`  ${c.bold(paint(table[0] ?? ""))}`);
    for (const line of table.slice(1)) lines.push(`  ${line}`);
  };

  const projectRows: string[][] = [["project", "sessions", "cost"]];
  for (const p of projects) {
    projectRows.push([p.name, String(p.sessions), fmtUsd(p.rollup.usd)]);
  }
  heading(renderTable(projectRows, ["left", "right", "right"]), c.cyan);
  lines.push("");

  const modelRows: string[][] = [["model", "messages", "cost"]];
  for (const [model, rollup] of models) {
    modelRows.push([shortModel(model), String(rollup.messages), fmtUsd(rollup.usd)]);
  }
  heading(renderTable(modelRows, ["left", "right", "right"]), c.magenta);
  lines.push("");

  const toolTableRows: string[][] = [["tool", "calls", "fails", "cost"]];
  for (const [category, stats] of toolRows) {
    toolTableRows.push([
      category,
      stats.calls === 0 ? "-" : String(stats.calls),
      stats.calls === 0 ? "-" : String(stats.failures),
      fmtUsd(stats.usd),
    ]);
  }
  heading(
    renderTable(toolTableRows, ["left", "right", "right", "right"]),
    c.yellow,
  );

  if (total.unknownModels.length > 0) {
    lines.push("");
    lines.push(
      `  ${c.yellow("no pricing")} for ${total.unknownModels.join(", ")}` +
        `, see ccplus doctor`,
    );
  }

  console.log(lines.join("\n"));
}
