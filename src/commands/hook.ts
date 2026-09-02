import { basename, dirname } from "node:path";
import { summarizeSession } from "../cost/aggregate.js";
import { parseCodexSessionFile } from "../parser/codex.js";
import { panelInputs, statuslinePanel } from "../render/live.js";
import { glyphsFor } from "../render/glyphs.js";
import { colorEnabledWhenCaptured, makeStyle } from "../render/style.js";
import type { CommandFlags } from "./load.js";

// The same panel the Claude Code statusline draws, for Codex.
//
// Codex has no external statusline: its status_line config takes a
// fixed set of built-in items, with no way to call a command. What it
// does have is hooks, and a Stop hook fires once when the agent
// finishes a turn, which is the same cadence Claude Code repaints its
// status line at. A hook that prints {"systemMessage": "..."} has that
// text shown in the transcript, ansi colors and all.
//
// Codex hands us transcript_path on stdin, exactly as Claude Code
// does, so the active session never has to be guessed by mtime.
//
// Like the statusline, this must never break its host: every failure
// path prints nothing and exits 0. A broken hook that emitted noise
// after every turn would be far worse than one that stays quiet.

export interface HookFlags extends CommandFlags {}

export interface HookInput {
  // The hook JSON Codex piped in, or undefined when run from a shell
  // with nothing piped. Injected so the logic stays testable without
  // touching process.stdin.
  stdin: string | undefined;
  columns?: number | undefined;
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text === "" ? undefined : text;
}

// Only the transcript path is taken from the hook payload. Everything
// else the panel shows is read from the rollout log, so the numbers
// agree with what the dashboard reports for the same session.
export function transcriptPathFrom(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const path = (value as Record<string, unknown>).transcript_path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

export async function runHook(
  flags: HookFlags,
  input?: HookInput,
): Promise<number> {
  const raw = input === undefined ? await readStdin() : input.stdin;
  const width = input === undefined ? process.stdout.columns : input.columns;
  const filePath = transcriptPathFrom(raw);
  if (filePath === undefined) {
    if (raw === undefined) {
      console.error("no hook payload on stdin; run this from a Codex hook");
      return 2;
    }
    return 0;
  }

  let parsed;
  try {
    parsed = await parseCodexSessionFile(filePath);
  } catch {
    // A transcript path that does not resolve is not ours to report.
    return 0;
  }

  const summary = summarizeSession(
    { filePath, projectSlug: basename(dirname(filePath)) },
    parsed.session,
  );
  // The window, the rate limits and the cumulative token handling all
  // come from the one place that knows how the two providers differ.
  const { context, host, contextWindow } = panelInputs(parsed.session, "codex");

  const rows = statuslinePanel(summary, context, {
    c: makeStyle(colorEnabledWhenCaptured(flags.color)),
    g: glyphsFor(flags.ascii),
    contextWindow,
    host,
    width,
  });
  if (rows.length === 0) return 0;

  // Codex reads one JSON object from a hook. systemMessage is the
  // field it shows to the user; anything else here would go to the
  // model instead, which is not what this panel is for.
  console.log(JSON.stringify({ systemMessage: rows.join("\n") }));
  return 0;
}
