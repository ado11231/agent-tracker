import type { SessionSummary } from "../cost/aggregate.js";
import { fmtDuration, fmtUsd, fmtWhen, shortId, shortModel } from "./format.js";

// Turns a rendered transcript into a markdown document someone else
// can read, for gists and pull requests.
//
// It takes the terminal render as it is rather than re-walking the
// session, so an export can never disagree with what view prints. The
// layout is column based, right aligned badges and all, so it stays in
// a monospace block. Markdown outside the block would reflow it into
// nonsense.

// Exports are written at a fixed width so the same session gives the
// same file whatever the window happened to be.
export const EXPORT_WIDTH = 100;

// The rendered transcript always opens with the header line. Both
// formats replace it with a real title, so it is dropped here.
function body(lines: string[]): string[] {
  return lines.slice(1);
}

function metaLine(summary: SessionSummary): string {
  const parts = [
    summary.models.map(shortModel).join(", "),
    summary.total.unknownModels.length > 0 ? "$?" : fmtUsd(summary.total.usd),
    `${summary.turns} ${summary.turns === 1 ? "turn" : "turns"}`,
    summary.durationMs === undefined ? "" : fmtDuration(summary.durationMs),
    fmtWhen(summary.lastTimestamp),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

// Four backticks, so a fence inside the transcript cannot close it
// early. Tool output carrying code blocks is ordinary.
const FENCE = "````";

export function toMarkdown(lines: string[], summary: SessionSummary): string {
  return [
    `# session ${shortId(summary.sessionId)}`,
    "",
    metaLine(summary),
    "",
    `${FENCE}text`,
    ...body(lines),
    FENCE,
    "",
  ].join("\n");
}
