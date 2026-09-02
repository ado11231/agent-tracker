import { glyphsFor } from "../render/glyphs.js";
import { currentContext, statuslinePanel } from "../render/live.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import { loadSessions, type CommandFlags } from "./load.js";

export interface LiveFlags extends CommandFlags {
  id?: string;
  refresh?: number;
}

function render(session: Awaited<ReturnType<typeof loadSessions>>[number], color: boolean): string {
  const context = currentContext(session.extracted, session.summary.provider === "codex");
  // Codex does not send a status-line payload like Claude Code does,
  // but its session logs contain the same local usage data. Reuse the
  // exact panel renderer so the companion view has the same hierarchy,
  // gauges, colours, and graceful omissions as the Claude integration.
  return statuslinePanel(session.summary, context, {
    c: makeStyle(colorEnabled(color)),
    g: glyphsFor(false),
    contextWindow: 200_000,
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
