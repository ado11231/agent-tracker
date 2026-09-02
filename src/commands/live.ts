import { cacheHitRatio } from "../cost/aggregate.js";
import { fmtTokens, fmtUsd, shortModel } from "../render/format.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import { currentContext } from "../render/live.js";
import { loadSessions, type CommandFlags } from "./load.js";

export interface LiveFlags extends CommandFlags {
  id?: string;
  refresh?: number;
}

function render(session: Awaited<ReturnType<typeof loadSessions>>[number], color: boolean): string {
  const style = makeStyle(colorEnabled(color));
  const summary = session.summary;
  const context = currentContext(session.extracted);
  const totalTokens = summary.total.tokens.input + summary.total.tokens.output + summary.total.tokens.cacheRead + summary.total.tokens.cacheWrite5m + summary.total.tokens.cacheWrite1h;
  const model = context.model ?? summary.models.at(-1);
  const cost = summary.total.unknownModels.length === 0 ? `~${fmtUsd(summary.total.usd)}` : "$?";
  const cache = summary.total.messages === 0 ? undefined : cacheHitRatio(summary.total);
  return [
    `${style.bold("agenttracker live")}  ${summary.provider}  ${summary.turns} turns`,
    `${model === undefined ? "unknown model" : shortModel(model)}  ${fmtTokens(totalTokens)} tokens  ${cost} API estimate`,
    `context ${fmtTokens(context.tokens)}  cache ${cache === undefined ? "--" : `${Math.round(cache * 100)}%`}`,
  ].join("\n");
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
