import { describe, expect, it } from "vitest";
import { emptyRollup, type SessionSummary } from "../src/cost/aggregate.js";
import { toMarkdown } from "../src/render/export.js";
import { makeStyle } from "../src/render/style.js";

const c = makeStyle(true);

function summary(): SessionSummary {
  return {
    sessionId: "13af1923-3b85-44dc-9715-0af802703bd6",
    projectSlug: "-scrubbed-project",
    filePath: "/tmp/x.jsonl",
    cwd: "/tmp",
    gitBranch: "main",
    version: "2.0.0",
    models: ["claude-opus-4-8"],
    firstTimestamp: "2026-07-20T19:00:00.000Z",
    lastTimestamp: "2026-07-20T19:30:00.000Z",
    durationMs: 1_800_000,
    longestGapMs: 1000,
    turns: 3,
    total: { ...emptyRollup(), usd: 0.42 },
    sidechain: emptyRollup(),
    offBranch: emptyRollup(),
  };
}

describe("toMarkdown", () => {
  const lines = ["header line", "● YOU", "  hello"];

  it("titles the document and keeps the body in a fence", () => {
    const md = toMarkdown(lines, summary());
    expect(md).toContain("# session 13af1923");
    expect(md).toContain("opus-4-8 · $0.42 · 3 turns · 30m");
    expect(md).toContain("● YOU");
    // The rendered header is replaced by the title, not repeated.
    expect(md).not.toContain("header line");
  });

  // A transcript can hold a code block of its own, so the fence has to
  // be one no ordinary content closes.
  it("fences with four backticks", () => {
    const md = toMarkdown(["header", "```js", "x", "```"], summary());
    expect(md).toContain("````text");
    expect(md.trimEnd().endsWith("````")).toBe(true);
  });
});

