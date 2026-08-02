import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runContext, type ContextFlags } from "../src/commands/context.js";
import { analyzeContext } from "../src/cost/context.js";
import type {
  Compaction,
  ExtractedSession,
  MessageUsage,
  SessionEvent,
} from "../src/parser/events.js";

// Requests are what the context size is read from, so a fixture
// declares the window each one carried rather than token tiers: the
// analysis only ever looks at their sum.
function request(messageId: string, context: number, timestamp?: string): MessageUsage {
  return {
    messageId,
    model: "claude-opus-4-8",
    usage: {
      input: context,
      output: 0,
      cacheRead: 0,
      cacheCreationTotal: 0,
      cacheCreation5m: undefined,
      cacheCreation1h: undefined,
    },
    isSidechain: false,
    onActiveBranch: true,
    timestamp,
  };
}

function call(
  messageId: string,
  toolName: string,
  toolUseId: string,
  input: unknown,
  timestamp?: string,
): SessionEvent {
  return {
    kind: "tool-call",
    toolName,
    toolUseId,
    description: undefined,
    input,
    messageId,
    timestamp,
  };
}

function result(toolUseId: string, text: string, timestamp?: string): SessionEvent {
  return { kind: "tool-result", toolUseId, text, isError: false, timestamp };
}

function reply(messageId: string, text: string, timestamp?: string): SessionEvent {
  return { kind: "assistant-text", text, model: undefined, messageId, timestamp };
}

function prompt(text: string, timestamp?: string): SessionEvent {
  return { kind: "user", text, isMeta: false, timestamp };
}

function session(
  events: SessionEvent[],
  usage: MessageUsage[],
  compaction?: Compaction,
): ExtractedSession {
  return {
    meta: {
      sessionId: "test",
      version: undefined,
      cwd: "/repo",
      gitBranch: undefined,
      firstTimestamp: undefined,
      lastTimestamp: undefined,
      models: [],
      compaction,
    },
    events,
    sidechains: [],
    usage,
    stats: { unknownBlocks: 0 },
  };
}

const WINDOW = { window: 200_000 };

function labels(breakdown: { consumers: { label: string }[] }): string[] {
  return breakdown.consumers.map((consumer) => consumer.label);
}

describe("analyzeContext", () => {
  it("reports nothing for a session that never made a request", () => {
    expect(analyzeContext(session([prompt("hi")], []), WINDOW)).toBeUndefined();
  });

  it("takes the total from the last request and startup from the first", () => {
    const result = analyzeContext(
      session(
        [prompt("hi"), reply("m1", "hello"), prompt("more"), reply("m2", "sure")],
        [request("m1", 30_000), request("m2", 50_000)],
      ),
      WINDOW,
    );
    expect(result?.total).toBe(50_000);
    expect(result?.startup).toBe(30_000);
    expect(result?.window).toBe(200_000);
  });

  it("splits the growth so the parts and startup sum back to the total", () => {
    const breakdown = analyzeContext(
      session(
        [
          prompt("hi"),
          reply("m1", "x".repeat(400)),
          call("m1", "Bash", "t1", { command: "ls" }),
          result("t1", "y".repeat(2000)),
          reply("m2", "done"),
        ],
        [request("m1", 10_000), request("m2", 20_000)],
      ),
      WINDOW,
    );
    const parts = breakdown!.consumers.reduce((sum, c) => sum + c.tokens, 0);
    // Rounding each row to whole tokens can drift by less than one
    // token per row, and never more.
    expect(Math.abs(parts + breakdown!.startup - breakdown!.total)).toBeLessThan(
      breakdown!.consumers.length + 1,
    );
  });

  it("does not attribute the opening request, which startup already counts", () => {
    // The long prompt lands before the first reply, so its bytes are
    // inside the 10k startup rather than on top of it.
    const breakdown = analyzeContext(
      session(
        [prompt("q".repeat(5000)), reply("m1", "hi"), reply("m2", "again")],
        [request("m1", 10_000), request("m2", 12_000)],
      ),
      WINDOW,
    );
    expect(labels(breakdown!)).not.toContain("your prompts");
  });

  it("groups every read of one file into a single row and counts the reads", () => {
    const breakdown = analyzeContext(
      session(
        [
          prompt("hi"),
          reply("m1", "ok"),
          call("m2", "Read", "t1", { file_path: "/repo/a.ts" }),
          result("t1", "a".repeat(1000)),
          call("m2", "Read", "t2", { file_path: "/repo/a.ts" }),
          result("t2", "a".repeat(1000)),
          call("m2", "Read", "t3", { file_path: "/repo/b.ts" }),
          result("t3", "b".repeat(100)),
          reply("m3", "done"),
        ],
        [request("m1", 10_000), request("m3", 30_000)],
      ),
      WINDOW,
    );
    const a = breakdown!.consumers.find((c) => c.label === "/repo/a.ts");
    const b = breakdown!.consumers.find((c) => c.label === "/repo/b.ts");
    expect(a?.touches).toBe(2);
    expect(b?.touches).toBe(1);
    // Twice the bytes read twice over should outweigh the file read
    // once, which is the finding the report exists to surface.
    expect(a!.tokens).toBeGreaterThan(b!.tokens);
    expect(a?.kind).toBe("file");
  });

  it("keeps tool output that names no file under its category", () => {
    const breakdown = analyzeContext(
      session(
        [
          prompt("hi"),
          reply("m1", "ok"),
          call("m2", "Bash", "t1", { command: "ls" }),
          result("t1", "x".repeat(2000)),
          reply("m3", "done"),
        ],
        [request("m1", 10_000), request("m3", 20_000)],
      ),
      WINDOW,
    );
    expect(labels(breakdown!)).toContain("command output");
  });

  it("counts images and does not let their placeholder text stand in for them", () => {
    const withImage = analyzeContext(
      session(
        [
          prompt("hi"),
          reply("m1", "ok"),
          call("m2", "Bash", "t1", { command: "shot" }),
          result("t1", "[image]"),
          call("m2", "Bash", "t2", { command: "ls" }),
          result("t2", "z".repeat(200)),
          reply("m3", "done"),
        ],
        [request("m1", 10_000), request("m3", 20_000)],
      ),
      WINDOW,
    );
    expect(withImage?.images).toBe(1);
    // Seven characters of placeholder must not read as seven
    // characters of context.
    expect(withImage!.consumers[0]!.logged).toBeGreaterThan(500);
  });

  it("ignores subagent and abandoned-branch requests", () => {
    const offBranch: MessageUsage = { ...request("m3", 900_000), onActiveBranch: false };
    const sidechain: MessageUsage = { ...request("m4", 800_000), isSidechain: true };
    const breakdown = analyzeContext(
      session(
        [prompt("hi"), reply("m1", "ok"), reply("m2", "done")],
        [request("m1", 10_000), request("m2", 20_000), offBranch, sidechain],
      ),
      WINDOW,
    );
    expect(breakdown?.total).toBe(20_000);
  });

  it("reports coverage, which is what says how much of the window was logged", () => {
    const breakdown = analyzeContext(
      session(
        [
          prompt("hi"),
          reply("m1", "ok"),
          call("m2", "Bash", "t1", { command: "ls" }),
          // 20k characters of output at roughly two per token is
          // about 10k tokens, against 10k of measured growth.
          result("t1", "x".repeat(20_000)),
          reply("m3", "done"),
        ],
        [request("m1", 10_000), request("m3", 20_000)],
      ),
      WINDOW,
    );
    expect(breakdown!.coverage).toBeGreaterThan(0.8);
    expect(breakdown!.coverage).toBeLessThan(1.2);
  });
});

describe("analyzeContext after a compaction", () => {
  const compaction: Compaction = {
    trigger: "auto",
    preTokens: 190_000,
    postTokens: 15_000,
    timestamp: "2026-07-30T12:00:00.000Z",
  };

  function compacted() {
    return session(
      [
        prompt("old", "2026-07-30T11:00:00.000Z"),
        reply("m1", "ok", "2026-07-30T11:00:01.000Z"),
        call("m1", "Read", "t1", { file_path: "/repo/dropped.ts" }, "2026-07-30T11:00:02.000Z"),
        result("t1", "d".repeat(50_000), "2026-07-30T11:00:03.000Z"),
        // Everything below the boundary is what survived.
        prompt("new", "2026-07-30T12:00:01.000Z"),
        call("m2", "Read", "t2", { file_path: "/repo/kept.ts" }, "2026-07-30T12:00:02.000Z"),
        result("t2", "k".repeat(2000), "2026-07-30T12:00:03.000Z"),
        reply("m2", "done", "2026-07-30T12:00:04.000Z"),
      ],
      [
        request("m1", 180_000, "2026-07-30T11:00:01.000Z"),
        request("m2", 25_000, "2026-07-30T12:00:04.000Z"),
      ],
      compaction,
    );
  }

  it("uses what the compaction kept as the baseline, not the opening request", () => {
    const breakdown = analyzeContext(compacted(), WINDOW);
    expect(breakdown?.compacted).toBe(true);
    expect(breakdown?.startup).toBe(15_000);
  });

  it("leaves out what the compaction dropped, since it is no longer in the window", () => {
    const breakdown = analyzeContext(compacted(), WINDOW);
    expect(labels(breakdown!)).toContain("/repo/kept.ts");
    expect(labels(breakdown!)).not.toContain("/repo/dropped.ts");
  });
});

describe("runContext", () => {
  const FIXTURES = join(__dirname, "fixtures");
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function logged(): string {
    return logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
  }

  function flags(root: string, extra: Partial<ContextFlags> = {}): ContextFlags {
    return {
      json: false,
      color: false,
      ascii: false,
      project: undefined,
      since: undefined,
      until: undefined,
      root,
      id: undefined,
      window: undefined,
      ...extra,
    };
  }

  async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "ccplus-context-"));
    const project = join(root, "-scrubbed-project");
    await mkdir(project);
    await copyFile(
      join(FIXTURES, "basic.jsonl"),
      join(project, "11111111-aaaa-bbbb-cccc-000000000001.jsonl"),
    );
    return root;
  }

  it("renders the gauge and the split for the latest session", async () => {
    const code = await runContext(flags(await makeRoot()));
    expect(code).toBe(0);
    const text = logged();
    expect(text).toContain("context");
    expect(text).toContain("of 200k");
    expect(text).toContain("startup");
  });

  it("marks every estimated number and leaves the measured ones bare", async () => {
    await runContext(flags(await makeRoot()));
    const text = logged();
    for (const line of text.split("\n")) {
      // Rows of the split are the estimate. The startup row and the
      // gauge are measured and must not wear a tilde.
      if (line.includes("startup")) expect(line).not.toContain("~");
    }
    expect(text).toContain("~");
  });

  it("takes the window size from --window", async () => {
    await runContext(flags(await makeRoot(), { window: 1_000_000 }));
    expect(logged()).toContain("of 1.0M");
  });

  it("emits json with the parts summing to the measured total", async () => {
    await runContext(flags(await makeRoot(), { json: true }));
    const data = JSON.parse(logged());
    const parts = data.consumers.reduce(
      (sum: number, c: { tokens: number }) => sum + c.tokens,
      0,
    );
    expect(data.total).toBeGreaterThan(0);
    expect(Math.abs(parts + data.startup - data.total)).toBeLessThan(
      data.consumers.length + 1,
    );
  });

  it("exits 2 when no session matches", async () => {
    const code = await runContext(flags(await makeRoot(), { id: "9999" }));
    expect(code).toBe(2);
  });

  it("renders with no color and no unicode when asked", async () => {
    await runContext(flags(await makeRoot(), { ascii: true }));
    const text = logged();
    expect(text).not.toContain("[");
    expect(text).not.toContain("▓");
  });
});
