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
import { SYNTHETIC_MODEL } from "../cost/cost.js";
import {
  mergeToolBreakdowns,
  toolBreakdown,
  type ToolBreakdown,
} from "../cost/tools.js";
import {
  fmtPercent,
  fmtTokens,
  fmtUsd,
  renderTable,
  shortModel,
} from "../render/format.js";
import { glyphsFor } from "../render/glyphs.js";
import { heatmapRange, renderHeatmap } from "../render/heatmap.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import {
  inWindow,
  loadSessions,
  parseWindow,
  projectLabel,
  type CommandFlags,
  type TimeWindow,
} from "./load.js";

// --year adds the activity heatmap; --ascii swaps its glyph ramp.
export type DashboardFlags = CommandFlags & {
  year?: boolean;
  ascii?: boolean;
};

interface ProjectRow {
  name: string;
  sessions: number;
  rollup: UsageRollup;
}

interface Heatmap {
  from: Date;
  to: Date;
  weeks: number;
  daily: Map<string, number>;
  stats: ActivityStats;
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
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
    heatmap = { from, to: now, weeks, daily, stats: activityStats(daily, from, now) };
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
                  .map(([date, usd]) => ({ date, usd })),
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
  subagents: UsageRollup;
  retries: UsageRollup;
  projects: ProjectRow[];
  models: [string, UsageRollup][];
  toolRows: [string, { calls: number; failures: number; usd: number }][];
  windowGiven: boolean;
  heatmap: Heatmap | undefined;
}

function printDashboard(data: DashboardData, flags: DashboardFlags): void {
  const { sessionCount, total, today, week, subagents, retries, projects, models, toolRows, windowGiven, heatmap } = data;
  const c = makeStyle(colorEnabled(flags.color));
  const lines: string[] = [];
  const dot = c.dim("·");

  lines.push(
    `${c.bold("ccprism")} ${dot} ${sessionCount} sessions ${dot} ` +
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
  const spendRows = windowGiven
    ? [spendRow("window", total)]
    : [spendRow("today", today), spendRow("this week", week)];
  for (const line of renderTable(spendRows, ["left", "right", "right", "right", "right"])) {
    lines.push(`  ${line}`);
  }
  if (subagents.messages > 0 || retries.messages > 0) {
    lines.push(
      c.dim(
        `  of the total: subagents ${fmtUsd(subagents.usd)} (${subagents.messages} msgs)` +
          ` · retries ${fmtUsd(retries.usd)} (${retries.messages} msgs)`,
      ),
    );
  }
  lines.push("");

  const projectRows: string[][] = [["project", "sessions", "cost"]];
  for (const p of projects) {
    projectRows.push([p.name, String(p.sessions), fmtUsd(p.rollup.usd)]);
  }
  const projectTable = renderTable(projectRows, ["left", "right", "right"]);
  lines.push(`  ${c.dim(projectTable[0] ?? "")}`);
  for (const line of projectTable.slice(1)) lines.push(`  ${line}`);
  lines.push("");

  const modelRows: string[][] = [["model", "messages", "cost"]];
  for (const [model, rollup] of models) {
    modelRows.push([shortModel(model), String(rollup.messages), fmtUsd(rollup.usd)]);
  }
  const modelTable = renderTable(modelRows, ["left", "right", "right"]);
  lines.push(`  ${c.dim(modelTable[0] ?? "")}`);
  for (const line of modelTable.slice(1)) lines.push(`  ${line}`);
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
  const toolTable = renderTable(toolTableRows, ["left", "right", "right", "right"]);
  lines.push(`  ${c.dim(toolTable[0] ?? "")}`);
  for (const line of toolTable.slice(1)) lines.push(`  ${line}`);

  if (total.unknownModels.length > 0) {
    lines.push("");
    lines.push(
      c.dim(
        `  some usage has no pricing (${total.unknownModels.join(", ")}), see ccprism doctor`,
      ),
    );
  }

  console.log(lines.join("\n"));
}
