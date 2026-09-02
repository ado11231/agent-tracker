import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Wiring the live panels into both agents.
//
// This is the one place the tool writes outside its own install, so it
// is deliberate about it: it prints exactly what it will change before
// changing anything, --dry-run stops short of writing, and --uninstall
// removes every line it added. The read-only promise covers session
// logs, which are still never written; this touches only the two
// config files the user is asking us to edit.
//
// The two agents need different treatment:
//
//   Claude Code  settings.json, a statusLine command entry
//   Codex        config.toml, a Stop hook, plus a trust prompt
//
// Codex gates every hook behind a trust review, so its panel cannot be
// installed silently and is opt-in rather than part of the default
// run. Saying so plainly is better than letting an unexplained
// approval prompt appear in someone's next session.

export interface SetupFlags {
  claude: boolean;
  codex: boolean;
  dryRun: boolean;
  uninstall: boolean;
}

// Marks the block we own inside config.toml. Codex config is TOML with
// no schema of ours to hang a key off, so the block is delimited by
// comments and uninstall removes exactly what sits between them. This
// leaves anything the user wrote by hand untouched.
const BEGIN = "# >>> agenttracker >>>";
const END = "# <<< agenttracker <<<";

export function claudeSettingsPath(home = homedir()): string {
  return join(home, ".claude", "settings.json");
}

export function codexConfigPath(home = homedir()): string {
  return join(home, ".codex", "config.toml");
}

// An absolute node plus script path, not the bare `agenttracker` name.
// Both agents spawn the command with their own environment, and a
// global npm bin is not reliably on the PATH they inherit, especially
// under a version manager. Resolving our own location sidesteps that
// and survives the user changing shells.
export function selfCommand(): string {
  const script = fileURLToPath(new URL("main.js", import.meta.url));
  return `${process.execPath} ${script}`;
}

async function readOrEmpty(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export interface Change {
  path: string;
  // What the file will hold afterwards, or undefined when nothing
  // needs to change.
  next: string | undefined;
  // One line for the plan we print before writing.
  summary: string;
}

// Claude Code reads settings.json as plain JSON, so it is parsed,
// edited and re-serialized rather than patched as text. A file we
// cannot parse is left alone: overwriting someone's settings because
// of a stray comma would be much worse than not installing.
export function planClaude(
  raw: string | undefined,
  command: string,
  uninstall: boolean,
): Change | { error: string } {
  const wanted = `${command} statusline`;
  let settings: Record<string, unknown> = {};
  if (raw !== undefined && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { error: "settings.json is not a json object" };
      }
      settings = parsed as Record<string, unknown>;
    } catch {
      return { error: "settings.json is not valid json; leaving it alone" };
    }
  }

  const current = settings.statusLine as { command?: unknown } | undefined;
  const currentCommand =
    typeof current?.command === "string" ? current.command : undefined;

  if (uninstall) {
    // Only remove a status line that is ours. Someone else's command
    // sitting there is not something we should quietly delete.
    if (currentCommand === undefined || !currentCommand.includes("statusline")) {
      return { path: "", next: undefined, summary: "no agenttracker status line to remove" };
    }
    delete settings.statusLine;
    return {
      path: "",
      next: `${JSON.stringify(settings, null, 2)}\n`,
      summary: "remove the statusLine entry",
    };
  }

  if (currentCommand === wanted) {
    return { path: "", next: undefined, summary: "status line already points here" };
  }

  settings.statusLine = { type: "command", command: wanted };
  const summary =
    currentCommand === undefined
      ? "add a statusLine entry"
      : `replace the statusLine command, which currently points at ${currentCommand}`;
  return { path: "", next: `${JSON.stringify(settings, null, 2)}\n`, summary };
}

// Codex config is TOML, and there is no small dependable way to edit
// TOML in place without a parser that round-trips comments. Appending
// a delimited block avoids the problem: [[hooks.Stop]] opens a new
// array-of-tables entry, so appending at the end is valid whatever
// came before, and uninstall just cuts between the markers.
export function planCodex(
  raw: string | undefined,
  command: string,
  uninstall: boolean,
): Change {
  const body = raw ?? "";
  const begin = body.indexOf(BEGIN);
  const end = body.indexOf(END);
  const installed = begin !== -1 && end > begin;

  if (uninstall) {
    if (!installed) {
      return { path: "", next: undefined, summary: "no agenttracker hook to remove" };
    }
    const before = body.slice(0, begin).replace(/\n+$/, "\n");
    const after = body.slice(end + END.length).replace(/^\n+/, "");
    return {
      path: "",
      next: after === "" ? before : `${before}${after}`,
      summary: "remove the Stop hook block",
    };
  }

  const block = [
    BEGIN,
    "# Prints the AgentTracker panel after each turn. Remove this block",
    "# or run `agenttracker setup --uninstall` to undo.",
    "[[hooks.Stop]]",
    "",
    "[[hooks.Stop.hooks]]",
    'type = "command"',
    `command = "${command} hook"`,
    END,
  ].join("\n");

  if (installed) {
    const rebuilt = `${body.slice(0, begin)}${block}${body.slice(end + END.length)}`;
    if (rebuilt === body) {
      return { path: "", next: undefined, summary: "hook already installed and current" };
    }
    return { path: "", next: rebuilt, summary: "update the existing Stop hook block" };
  }

  const prefix = body === "" ? "" : body.replace(/\n*$/, "\n\n");
  return { path: "", next: `${prefix}${block}\n`, summary: "append a Stop hook block" };
}

export async function runSetup(flags: SetupFlags): Promise<number> {
  const command = selfCommand();
  // Neither flag named means both are considered, but Codex still
  // needs its own opt-in below.
  const both = !flags.claude && !flags.codex;
  const doClaude = flags.claude || both;
  const doCodex = flags.codex;

  const writes: { path: string; next: string }[] = [];
  const lines: string[] = [];

  if (doClaude) {
    const path = claudeSettingsPath();
    const plan = planClaude(await readOrEmpty(path), command, flags.uninstall);
    if ("error" in plan) {
      console.error(`claude code: ${plan.error}`);
      return 1;
    }
    lines.push(`claude code  ${path}`);
    lines.push(`             ${plan.summary}`);
    if (plan.next !== undefined) writes.push({ path, next: plan.next });
  }

  if (doCodex) {
    const path = codexConfigPath();
    const plan = planCodex(await readOrEmpty(path), command, flags.uninstall);
    lines.push(`codex        ${path}`);
    lines.push(`             ${plan.summary}`);
    if (plan.next !== undefined) writes.push({ path, next: plan.next });
  }

  console.log(lines.join("\n"));

  if (writes.length === 0) {
    console.log("\nnothing to do");
    return 0;
  }

  if (flags.dryRun) {
    console.log("\ndry run, nothing written");
    return 0;
  }

  for (const write of writes) {
    await mkdir(dirname(write.path), { recursive: true });
    await writeFile(write.path, write.next, "utf8");
  }

  if (flags.uninstall) {
    console.log("\nremoved. restart any open sessions to clear the panel.");
    return 0;
  }

  console.log("\ndone.");
  if (doClaude) {
    console.log("claude code picks the status line up on its next session.");
  }
  if (doCodex) {
    // The trust prompt is not something we can pre-approve, and a user
    // who is not expecting it should not meet it cold.
    console.log(
      "codex asks you to review and trust the hook the next time it starts.\n" +
        "that prompt is Codex gating hook execution, and it appears once.",
    );
  }
  if (both) {
    console.log(
      "\ncodex was not touched. its panel needs a hook, which Codex gates\n" +
        "behind a trust prompt, so it is opt in:\n" +
        "  agenttracker setup --codex",
    );
  }
  return 0;
}
