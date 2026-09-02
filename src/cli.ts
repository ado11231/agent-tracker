import { Command, Option } from "commander";
import { version } from "../package.json";
import {
  runDashboard,
  DASHBOARD_SPANS,
  type DashboardSpan,
} from "./commands/dashboard.js";
import { runContext } from "./commands/context.js";
import { runDoctor } from "./commands/doctor.js";
import { runSessions } from "./commands/sessions.js";
import { runStatusline } from "./commands/statusline.js";
import { runLive } from "./commands/live.js";
import { runHook } from "./commands/hook.js";
import { runSetup } from "./commands/setup.js";
import type { CommandFlags } from "./commands/load.js";

// Help group headings. Live commands run beside a session in
// progress; reports read sessions that already exist. The trailing
// colon is commander's convention for a heading.
const LIVE = "Live:";
const REPORTS = "Reports:";
// Run once, when installing. Kept out of the two groups above so the
// help stays a list of things you do with the tool, not to it.
const SETUP = "Setup:";

interface SetupOpts {
  claude?: boolean;
  codex?: boolean;
  dryRun?: boolean;
  uninstall?: boolean;
}

interface RawOpts {
  json?: boolean;
  color?: boolean;
  ascii?: boolean;
  project?: string;
  since?: string;
  until?: string;
  limit?: string;
  model?: string;
  grep?: string;
  span?: DashboardSpan;
  window?: string;
  source?: "auto" | "claude" | "codex";
  refresh?: string;
}

function toFlags(opts: RawOpts): CommandFlags {
  return {
    json: opts.json === true,
    color: opts.color !== false,
    ascii: opts.ascii === true,
    project: opts.project,
    since: opts.since,
    until: opts.until,
    source: opts.source,
  };
}

// Truly universal: every handler reads both. Commander scopes options
// to one command, so each command registers its own copy.
function withCommonFlags(command: Command): Command {
  return command
    .option("--json", "machine readable output")
    .option("--no-color", "plain output, also implied by NO_COLOR or piping");
}

// The report scan narrowing flags. Only the commands that actually
// consult loadSessions' time/cwd window take these, so doctor
// (except --project) and statusline do not. --ascii is not here
// either: it is registered per-command on the ones whose render uses
// glyphs, which is every command but sessions — the only report that
// prints nothing outside ascii already.
function withReportWindowFlags(command: Command): Command {
  return command
    .option("--project <path>", "only sessions from this project directory")
    .option("--source <provider>", "claude, codex, or auto", "auto")
    .option("--since <date>", "window start, YYYY-MM-DD or an ISO timestamp")
    .option("--until <date>", "window end, inclusive");
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("agenttracker")
    .description("Local token metrics for Claude Code and Codex sessions")
    .version(version);

  // Commands are grouped in --help by what they are for: the ones you
  // run beside a session in progress, and the ones you run over
  // sessions that already exist. Commander orders the groups by first
  // registration, so the live commands are declared first to put them
  // at the top. Moving these blocks reorders the help.
  withCommonFlags(program.command("statusline"))
    .option("--ascii", "swap unicode glyphs for ascii")
    .helpGroup(LIVE)
    .description(
      "Cost, context, and rate limit panel for Claude Code's custom statusLine",
    )
    .action(async (_opts: RawOpts, command: Command) => {
      const opts = command.optsWithGlobals() as RawOpts;
      process.exitCode = await runStatusline(toFlags(opts));
    });

  withCommonFlags(program.command("hook"))
    .option("--ascii", "swap unicode glyphs for ascii")
    .helpGroup(LIVE)
    .description("Same panel for Codex, printed by a Codex Stop hook")
    .action(async (_opts: RawOpts, command: Command) => {
      const opts = command.optsWithGlobals() as RawOpts;
      process.exitCode = await runHook(toFlags(opts));
    });

  withCommonFlags(program.command("context"))
    .option("--ascii", "swap unicode glyphs for ascii")
    .helpGroup(LIVE)
    .description(
      "Show what is filling the context window, latest session if id omitted",
    )
    .argument("[id]", "session id, unambiguous prefixes accepted")
    .option("--project <path>", "only sessions from this project directory")
    .option("--source <provider>", "claude, codex, or auto", "auto")
    .option("--window <tokens>", "context window size, when the guess is wrong")
    .action(async (id: string | undefined, _opts: RawOpts, command: Command) => {
      const opts = command.optsWithGlobals() as RawOpts;
      let window: number | undefined;
      if (opts.window !== undefined) {
        window = Number(opts.window);
        if (!Number.isInteger(window) || window <= 0) {
          console.error(`invalid --window: ${opts.window}`);
          process.exitCode = 1;
          return;
        }
      }
      process.exitCode = await runContext({ ...toFlags(opts), id, window });
    });

  withCommonFlags(program.command("live"))
    .option("--source <provider>", "claude, codex, or auto", "auto")
    .option("--id <session>", "session id prefix")
    .option("--refresh <seconds>", "refresh interval; 0 prints once")
    .helpGroup(LIVE)
    .description("Track the latest local Claude Code or Codex session (Codex: companion panel)")
    .action(async (_opts: RawOpts, command: Command) => {
      const opts = command.optsWithGlobals() as RawOpts;
      const refresh = opts.refresh === undefined ? undefined : Number(opts.refresh);
      if (refresh !== undefined && (!Number.isFinite(refresh) || refresh < 0)) {
        console.error(`invalid --refresh: ${opts.refresh}`); process.exitCode = 1; return;
      }
      process.exitCode = await runLive({ ...toFlags(opts), refresh });
    });

  withReportWindowFlags(withCommonFlags(program.command("sessions")))
    .helpGroup(REPORTS)
    .description("List recent sessions with cost, duration, turns, and model")
    .option("--limit <n>", "rows to show, 0 for all", "20")
    .option("--model <text>", "only sessions that used a matching model")
    .option("--grep <text>", "only sessions with a prompt containing this text")
    .action(async (_opts: RawOpts, command: Command) => {
      const opts = command.optsWithGlobals() as RawOpts;
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 0) {
        console.error(`invalid --limit: ${opts.limit}`);
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runSessions({
        ...toFlags(opts),
        limit,
        model: opts.model,
        grep: opts.grep,
      });
    });

  withCommonFlags(program.command("doctor"))
    .option("--project <path>", "only sessions from this project directory")
    .option("--ascii", "swap unicode glyphs for ascii")
    .helpGroup(REPORTS)
    .description("Report parse health: skipped lines and unknown model ids")
    .action(async (_opts: RawOpts, command: Command) => {
      process.exitCode = await runDoctor(
        toFlags(command.optsWithGlobals() as RawOpts),
      );
    });

  program
    .command("setup")
    .helpGroup(SETUP)
    .description("Wire the live panel into Claude Code, and into Codex")
    .option("--claude", "only Claude Code's status line")
    .option("--codex", "only Codex's hook, which Codex asks you to trust")
    .option("--dry-run", "print what would change, write nothing")
    .option("--uninstall", "remove what setup added")
    .action(async (opts: SetupOpts) => {
      process.exitCode = await runSetup({
        claude: opts.claude === true,
        codex: opts.codex === true,
        dryRun: opts.dryRun === true,
        uninstall: opts.uninstall === true,
      });
    });

  // The bare command renders the dashboard.
  // far back to look, one rung at a time: week is today and this week,
  // month widens both rows, year adds the heatmap on top. It lives on
  // the root program because the bare dashboard is not a subcommand.
  withReportWindowFlags(withCommonFlags(program))
    .option("--ascii", "swap unicode glyphs for ascii")
    .addOption(
      new Option("--span <period>", "how far back the dashboard looks")
        .choices([...DASHBOARD_SPANS])
        .default("week"),
    )
    .action(async (opts: RawOpts) => {
      process.exitCode = await runDashboard({
        ...toFlags(opts),
        span: opts.span ?? "week",
      });
    });

  // The one feature that is not a command, so the grouped list above
  // cannot mention it: the bare dashboard.
  program.addHelpText(
    "after",
    [
      "",
      "Run with no command for the dashboard: today and this week, and",
      "totals by project, model and tool. --span month widens the two",
      "summary rows, and --span year adds a contribution graph of daily",
      "cost, each day colored by the model that spent the most on it.",
    ].join("\n"),
  );

  return program;
}
