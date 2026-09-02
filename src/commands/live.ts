import { glyphsFor } from "../render/glyphs.js";
import { panelInputs, statuslinePanel } from "../render/live.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import { loadSessions, type CommandFlags } from "./load.js";

export interface LiveFlags extends CommandFlags {
  id?: string;
  refresh?: number;
}

// The same panel both agents show in their own chrome, watched from a
// terminal of its own. Useful when you want it always visible rather
// than reprinted per turn, and for an agent with no live surface at
// all. It reads the session log, so it draws the same numbers the
// statusline and the Codex hook do.
function render(session: Awaited<ReturnType<typeof loadSessions>>[number], color: boolean): string {
  const { context, host, contextWindow } = panelInputs(
    session.extracted,
    session.summary.provider,
  );
  return statuslinePanel(session.summary, context, {
    c: makeStyle(colorEnabled(color)),
    g: glyphsFor(false),
    contextWindow,
    host,
    width: process.stdout.isTTY ? process.stdout.columns : undefined,
  }).join("\n");
}

export async function runLive(flags: LiveFlags): Promise<number> {
  const requestedId = flags.id;
  const renderOnce = async (): Promise<string | undefined> => {
    const sessions = await loadSessions(flags);
    const matching = requestedId === undefined ? sessions[0] : sessions.find((session) => session.summary.sessionId?.startsWith(requestedId));
    return matching === undefined ? undefined : render(matching, flags.color);
  };
  const first = await renderOnce();
  if (first === undefined) { console.error("no sessions found"); return 2; }
  if (!process.stdout.isTTY || flags.refresh === 0) { console.log(first); return 0; }
  const refreshMs = Math.max(500, (flags.refresh ?? 2) * 1000);
  for (;;) {
    const output = await renderOnce();
    if (output !== undefined) process.stdout.write(`\x1b[H\x1b[2J${output}\n`);
    await new Promise((resolve) => setTimeout(resolve, refreshMs));
  }
}
