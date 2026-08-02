import { copyFile, mkdir, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyRollup,
  type SessionSummary,
} from "../src/cost/aggregate.js";
import {
  panelWidth,
  runStatusline,
  type StatuslineFlags,
} from "../src/commands/statusline.js";
import { glyphsFor } from "../src/render/glyphs.js";
import { makeStyle } from "../src/render/style.js";
import {
  currentContext,
  statuslinePanel,
} from "../src/render/live.js";
import { parseSessionFile } from "../src/parser/session.js";
import {
  emptyHostFacts,
  parseHostJson,
  type HostFacts,
} from "../src/parser/host.js";

const FIXTURES = join(__dirname, "fixtures");
const BASIC = join(FIXTURES, "basic.jsonl");

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(): string {
  return logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
}

function flags(extra: Partial<StatuslineFlags> = {}): StatuslineFlags {
  return {
    json: false,
    color: false,
    project: undefined,
    since: undefined,
    until: undefined,
    ascii: false,
    ...extra,
  };
}

function summary(extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "abc123",
    projectSlug: "p",
    filePath: "/x.jsonl",
    cwd: undefined,
    gitBranch: undefined,
    version: undefined,
    models: ["claude-opus-4-8"],
    firstTimestamp: undefined,
    lastTimestamp: undefined,
    durationMs: undefined,
    longestGapMs: undefined,
    turns: 3,
    total: emptyRollup(),
    sidechain: emptyRollup(),
    offBranch: emptyRollup(),
    ...extra,
  };
}

// Two fixtures under a projects-root layout, basic the newer one.
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ccplus-status-"));
  const project = join(root, "-scrubbed-project");
  await mkdir(project);
  const newer = join(project, "11111111-aaaa-bbbb-cccc-000000000001.jsonl");
  await copyFile(BASIC, newer);
  const now = Date.now() / 1000;
  await utimes(newer, now, now);
  return root;
}

describe("statuslinePanel", () => {
  function panel(
    tokens: number,
    contextWindow = 200_000,
    extra: Partial<SessionSummary> = {},
    ascii = false,
    host: Partial<HostFacts> = {},
    width?: number,
  ): string[] {
    return statuslinePanel(
      summary({ total: { ...emptyRollup(), usd: 0.19 }, turns: 2, ...extra }),
      { tokens, model: "claude-opus-4-8" },
      {
        c: makeStyle(false),
        g: glyphsFor(ascii),
        contextWindow,
        host: { ...emptyHostFacts(), ...host },
        width,
      },
    );
  }

  it("puts model and turns on the identity row", () => {
    expect(panel(27_400)[0]).toBe("opus-4-8 · 2 turns");
  });

  it("puts cost on its own row", () => {
    expect(panel(27_400)[1]).toBe("$0.19");
  });

  it("draws a context gauge with percent and token detail", () => {
    const row = panel(27_400)[2] as string;
    expect(row).toContain("▓");
    expect(row).toContain("░");
    expect(row).toContain("14%");
    // The label says what is being measured, so the counts drop "ctx".
    expect(row).toMatch(/^ctx {4}▓/);
    expect(row).toContain("27.4k / 200k");
  });

  it("fills the gauge proportionally", () => {
    const low = (panel(20_000)[2] as string).split("▓").length - 1;
    const high = (panel(180_000)[2] as string).split("▓").length - 1;
    expect(high).toBeGreaterThan(low);
  });

  it("shows at least one filled cell once any context is used", () => {
    expect(panel(200)[2] as string).toMatch(/^ctx {4}▓░+/);
  });

  it("respects a larger context window from the session json", () => {
    const row = panel(200_000, 1_000_000)[2] as string;
    expect(row).toContain("20%");
    expect(row).toContain("200k / 1.0M");
  });

  it("drops the context row before the first api call", () => {
    expect(panel(0)).toHaveLength(2);
  });

  it("swaps gauge glyphs for ascii", () => {
    const row = panel(27_400, 200_000, {}, true)[2] as string;
    expect(row).toContain("#");
    expect(row).not.toContain("▓");
  });

  it("marks cost unknown without breaking the row", () => {
    const rows = panel(1000, 200_000, {
      total: { ...emptyRollup(), usd: 0, unknownModels: ["mystery"] },
    });
    expect(rows[1]).toContain("$?");
  });

  it("names the session and badges effort and fast mode", () => {
    const row = panel(1000, 200_000, {}, false, {
      sessionName: "sec-review",
      effort: "high",
      fastMode: true,
    })[0] as string;
    expect(row).toBe("sec-review · opus-4-8 · high · fast · 2 turns");
  });

  it("falls back to the agent name when the session is unnamed", () => {
    const row = panel(1000, 200_000, {}, false, {
      agentName: "Explore",
    })[0] as string;
    expect(row).toContain("Explore");
  });

  it("shows lines changed and a burn rate on the cost row", () => {
    const row = panel(
      1000,
      200_000,
      { durationMs: 3_600_000 },
      false,
      { linesAdded: 156, linesRemoved: 23 },
    )[1] as string;
    expect(row).toContain("$0.19/hr");
    expect(row).toContain("+156 −23");
  });

  it("uses a plain hyphen for removed lines in ascii", () => {
    const row = panel(1000, 200_000, {}, true, {
      linesAdded: 5,
      linesRemoved: 2,
    })[1] as string;
    expect(row).toContain("+5 -2");
  });

  it("omits a burn rate for a session too short to divide by", () => {
    const row = panel(1000, 200_000, { durationMs: 4000 })[1] as string;
    expect(row).not.toContain("/hr");
  });

  it("shows wasted spend only when a branch was abandoned", () => {
    expect(panel(1000)[1]).not.toContain("wasted");
    const row = panel(1000, 200_000, {
      offBranch: { ...emptyRollup(), usd: 0.03 },
    })[1] as string;
    expect(row).toContain("$0.03 wasted");
  });

  it("gauges the five hour window and names the weekly one", () => {
    const row = panel(1000, 200_000, {}, false, {
      fiveHour: { usedPercentage: 24 },
      sevenDay: { usedPercentage: 41.2 },
    })[3] as string;
    expect(row).toMatch(/^5h {5}▓+░+ +24%/);
    expect(row).toContain("41% week");
  });

  it("drops the limits row entirely with no subscription and no usage", () => {
    expect(panel(1000)).toHaveLength(3);
  });

  it("gives the bar to the cache share when there is no rate limit", () => {
    const rows = panel(1000, 200_000, {
      total: {
        ...emptyRollup(),
        messages: 4,
        usd: 0.19,
        tokens: {
          input: 1000,
          output: 0,
          cacheRead: 9000,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
      },
    });
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatch(/^cache {2}▓+░* +90%/);
    expect(rows[3]).toContain("hit rate");
  });

  // The cache gauge shares the panel with the context gauge whenever
  // there is no subscription, and `cache` is longer than `ctx`, so a
  // label column sized to `ctx` put the two bars two columns apart.
  it("starts every gauge bar in the same column", () => {
    const rows = panel(27_400, 200_000, {
      total: {
        ...emptyRollup(),
        messages: 4,
        usd: 0.19,
        tokens: {
          input: 1000,
          output: 0,
          cacheRead: 9000,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
      },
    });
    const gauges = rows.filter((row) => row.includes("▓"));
    expect(gauges).toHaveLength(2);
    const starts = gauges.map((row) => row.indexOf("▓"));
    expect(new Set(starts).size).toBe(1);
    // The longest label is what sets the column width.
    expect(starts[0]).toBe("cache".length + 2);
  });

  it("appends the cache share to the rate limit row when both exist", () => {
    const row = panel(
      1000,
      200_000,
      {
        total: {
          ...emptyRollup(),
          messages: 4,
          usd: 0.19,
          tokens: {
            input: 1000,
            output: 0,
            cacheRead: 9000,
            cacheWrite5m: 0,
            cacheWrite1h: 0,
          },
        },
      },
      false,
      { fiveHour: { usedPercentage: 24 } },
    )[3] as string;
    expect(row).toContain("5h");
    expect(row).toContain("90% cache");
  });

  // The four rows at their full width, which the cases below narrow:
  //   sec-review · opus-4-8 · high · fast · 2 turns           45
  //   $0.19 · $0.19/hr · +156 −23                             27
  //   ctx    ▓▓▓░░░░░░░░░░░░░░░░░   14%   27.4k / 200k        48
  //   5h     ▓▓▓▓▓░░░░░░░░░░░░░░░   24%   41% week · 90% cache  56
  function wide(width?: number): string[] {
    return panel(
      27_400,
      200_000,
      {
        durationMs: 3_600_000,
        total: {
          ...emptyRollup(),
          messages: 4,
          usd: 0.19,
          tokens: {
            input: 1000,
            output: 0,
            cacheRead: 9000,
            cacheWrite5m: 0,
            cacheWrite1h: 0,
          },
        },
      },
      false,
      {
        sessionName: "sec-review",
        effort: "high",
        fastMode: true,
        linesAdded: 156,
        linesRemoved: 23,
        fiveHour: { usedPercentage: 24 },
        sevenDay: { usedPercentage: 41.2 },
      },
      width,
    );
  }

  it("drops fields from the right of a row too wide for the terminal", () => {
    const rows = wide(40);
    expect(rows[0]).toBe("sec-review · opus-4-8 · high · fast");
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(40);
  });

  it("shortens only the rows that do not fit", () => {
    // 48 columns is exactly the context row, so only the limits row
    // under it has anything to give up.
    const rows = wide(48);
    expect(rows[0]).toBe(wide()[0]);
    expect(rows[1]).toBe(wide()[1]);
    expect(rows[2]).toBe(wide()[2]);
    expect(rows[3]).not.toBe(wide()[3]);
  });

  it("keeps the leading field of a row when nothing else fits", () => {
    const rows = wide(12);
    expect(rows[0]).toBe("sec-review");
    expect(rows[1]).toBe("$0.19");
  });

  it("keeps a gauge and its percent when the detail beside it will not", () => {
    const rows = wide(30);
    // The label leads the gauge, so a row stripped back to the bar
    // still says which limit it is drawing. The bar itself narrows to
    // whatever the terminal left it.
    expect(rows[2]).toMatch(/^ctx {4}▓+░+ {3}14%$/);
    expect(rows[3]).toMatch(/^5h {5}▓+░+ {3}24%$/);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(30);
  });

  it("shortens nothing when the width is unknown", () => {
    expect(wide(undefined)[0]).toBe(
      "sec-review · opus-4-8 · high · fast · 2 turns",
    );
  });

  it("measures the visible width, not the ansi escapes", () => {
    // Styled, this row is far past 48 bytes and still 48 columns, so
    // the detail survives rather than being counted out by escapes.
    const row = statuslinePanel(
      summary({ total: { ...emptyRollup(), usd: 0.19 }, turns: 2 }),
      { tokens: 27_400, model: "claude-opus-4-8" },
      {
        c: makeStyle(true),
        g: glyphsFor(false),
        contextWindow: 200_000,
        width: 48,
      },
    )[2] as string;
    expect(row.length).toBeGreaterThan(48);
    expect(row).toContain("27.4k / 200k");
  });
});

describe("parseHostJson", () => {
  // Verbatim from the schema at code.claude.com/docs/en/statusline, so
  // this test fails if a field is ever renamed under us.
  const FULL = {
    session_id: "abc123",
    session_name: "my-session",
    transcript_path: "/path/to/transcript.jsonl",
    model: { id: "claude-opus-4-8", display_name: "Opus" },
    cost: {
      total_cost_usd: 0.01234,
      total_duration_ms: 45000,
      total_lines_added: 156,
      total_lines_removed: 23,
    },
    context_window: { context_window_size: 200000, used_percentage: 8 },
    fast_mode: false,
    effort: { level: "high" },
    thinking: { enabled: true },
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
      seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
    },
    agent: { name: "security-reviewer" },
  };

  it("reads every field it renders off the documented shape", () => {
    const facts = parseHostJson(JSON.stringify(FULL));
    expect(facts).toEqual({
      transcriptPath: "/path/to/transcript.jsonl",
      contextWindow: 200000,
      sessionName: "my-session",
      agentName: "security-reviewer",
      effort: "high",
      fastMode: false,
      linesAdded: 156,
      linesRemoved: 23,
      fiveHour: { usedPercentage: 23.5 },
      sevenDay: { usedPercentage: 41.2 },
    });
  });

  it("returns everything absent for junk, empty, or missing input", () => {
    const empty = emptyHostFacts();
    expect(parseHostJson(undefined)).toEqual(empty);
    expect(parseHostJson("not json at all")).toEqual(empty);
    expect(parseHostJson("null")).toEqual(empty);
    expect(parseHostJson("[]")).toEqual(empty);
    expect(parseHostJson("{}")).toEqual(empty);
  });

  it("treats each rate limit window as independently absent", () => {
    const facts = parseHostJson(
      JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12 } } }),
    );
    expect(facts.fiveHour).toEqual({ usedPercentage: 12 });
    expect(facts.sevenDay).toBeUndefined();
  });

  it("drops a percentage outside 0 to 100 rather than clamping it", () => {
    const facts = parseHostJson(
      JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 140 },
          seven_day: { used_percentage: -1 },
        },
      }),
    );
    expect(facts.fiveHour).toBeUndefined();
    expect(facts.sevenDay).toBeUndefined();
  });

  it("ignores wrong-typed and empty-string fields", () => {
    const facts = parseHostJson(
      JSON.stringify({
        transcript_path: "",
        session_name: "",
        effort: { level: 3 },
        cost: { total_lines_added: "156" },
        context_window: { context_window_size: 0 },
        fast_mode: "yes",
      }),
    );
    expect(facts.transcriptPath).toBeUndefined();
    expect(facts.sessionName).toBeUndefined();
    expect(facts.effort).toBeUndefined();
    expect(facts.linesAdded).toBeUndefined();
    expect(facts.contextWindow).toBeUndefined();
    // Only a real boolean true turns the badge on.
    expect(facts.fastMode).toBe(false);
  });
});

describe("currentContext", () => {
  it("reports the input side of the latest main-thread call", async () => {
    const parsed = await parseSessionFile(BASIC);
    const context = currentContext(parsed.session);
    expect(context.tokens).toBeGreaterThan(0);
    expect(context.model).toBe("claude-opus-4-8");
  });
});

describe("runStatusline", () => {
  it("renders the session named by transcript_path on stdin", async () => {
    const code = await runStatusline(flags(), {
      stdin: JSON.stringify({ transcript_path: BASIC }),
    });
    expect(code).toBe(0);
    expect(logged()).toContain("opus-4-8");
    expect(logged()).toContain("ctx");
    expect(logged()).toContain("turns");
  });

  it("emits a json object with source stdin", async () => {
    const code = await runStatusline(flags({ json: true }), {
      stdin: JSON.stringify({ transcript_path: BASIC }),
    });
    expect(code).toBe(0);
    const out = JSON.parse(logged());
    expect(out.source).toBe("stdin");
    expect(out.turns).toBeGreaterThan(0);
    expect(out.contextTokens).toBeGreaterThan(0);
    expect(typeof out.usd).toBe("number");
  });

  it("falls back to the newest session with no stdin", async () => {
    const root = await makeRoot();
    const code = await runStatusline(flags({ json: true, root }), {
      stdin: undefined,
    });
    expect(code).toBe(0);
    expect(JSON.parse(logged()).source).toBe("latest");
  });

  it("stays quiet and exits 0 when transcript_path does not resolve", async () => {
    const code = await runStatusline(flags(), {
      stdin: JSON.stringify({ transcript_path: "/no/such/file.jsonl" }),
    });
    expect(code).toBe(0);
    expect(logged()).toBe("");
  });

  it("tolerates non-json on stdin and falls back", async () => {
    const root = await makeRoot();
    const code = await runStatusline(flags({ json: true, root }), {
      stdin: "not json at all",
    });
    expect(code).toBe(0);
    expect(JSON.parse(logged()).source).toBe("latest");
  });

  it("errors and exits 2 when run by hand with no sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ccplus-status-empty-"));
    const code = await runStatusline(flags({ root }), { stdin: undefined });
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("fits every row into the columns it was given", async () => {
    const code = await runStatusline(flags(), {
      stdin: JSON.stringify({ transcript_path: BASIC }),
      columns: 24,
    });
    expect(code).toBe(0);
    for (const row of logged().split("\n")) {
      expect(row.length).toBeLessThanOrEqual(24);
    }
  });
});

describe("panelWidth", () => {
  const saved = process.env.COLUMNS;

  afterEach(() => {
    if (saved === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = saved;
  });

  it("reads COLUMNS, the only width a captured statusline is told", () => {
    process.env.COLUMNS = "72";
    expect(panelWidth()).toBe(72);
  });

  it("ignores a COLUMNS that is not a usable width", () => {
    // Falls through to stdout.columns, which is undefined under a
    // captured or piped test run.
    for (const bad of ["", "wide", "0", "-10"]) {
      process.env.COLUMNS = bad;
      expect(panelWidth()).toBe(process.stdout.columns);
    }
  });
});
