import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runHook, transcriptPathFrom } from "../src/commands/hook.js";
import { panelInputs } from "../src/render/live.js";
import { parseCodexSessionFile } from "../src/parser/codex.js";

// A Codex rollout with two cumulative token snapshots, a stated
// context window and a rate limit window, which is the shape the Stop
// hook sees in a real session.
async function writeRollout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agenttracker-hook-"));
  const path = join(root, "rollout-2026-01-01T00-00-00-12345678-1234-1234-1234-123456789abc.jsonl");
  const lines = [
    { timestamp: "2026-01-01T00:00:00Z", type: "session_meta", payload: { session_id: "12345678-1234-1234-1234-123456789abc", cwd: "/work/app", cli_version: "1.0" } },
    { timestamp: "2026-01-01T00:00:01Z", type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/work/app" } },
    {
      timestamp: "2026-01-01T00:00:02Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 100, output_tokens: 200 }, model_context_window: 258_400 },
        rate_limits: { primary: { used_percent: 42, window_minutes: 43_200 }, secondary: null },
      },
    },
  ];
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return path;
}

describe("transcriptPathFrom", () => {
  it("reads the session file Codex names", () => {
    expect(transcriptPathFrom('{"transcript_path":"/a/b.jsonl"}')).toBe("/a/b.jsonl");
  });

  // A hook must never break its host, so bad input is quiet, not loud.
  it("returns undefined rather than throwing on unusable input", () => {
    expect(transcriptPathFrom(undefined)).toBeUndefined();
    expect(transcriptPathFrom("not json")).toBeUndefined();
    expect(transcriptPathFrom("{}")).toBeUndefined();
    expect(transcriptPathFrom('{"transcript_path":""}')).toBeUndefined();
  });
});

describe("panelInputs for codex", () => {
  it("carries the window and limits Codex logged", async () => {
    const parsed = await parseCodexSessionFile(await writeRollout());
    const { host: facts } = panelInputs(parsed.session, "codex");
    expect(facts.contextWindow).toBe(258_400);
    // 43200 minutes is a rolling month, so the gauge says 30d rather
    // than the 5h the Claude panel hardcodes.
    expect(facts.fiveHour).toEqual({ usedPercentage: 42, label: "30d" });
    expect(facts.sevenDay).toBeUndefined();
  });
});

describe("runHook", () => {
  it("prints one json object carrying the panel as systemMessage", async () => {
    const path = await writeRollout();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runHook(
      { json: false, color: false, ascii: true, project: undefined, since: undefined, until: undefined },
      { stdin: JSON.stringify({ transcript_path: path, hook_event_name: "Stop" }), columns: 80 },
    );
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(log.mock.calls[0]?.[0] as string) as { systemMessage: string };
    log.mockRestore();

    // Codex shows systemMessage and nothing else, so the panel has to
    // arrive whole in that one field. It leads with a newline because
    // Codex prints it after a label of its own, and without the break
    // the first row continues that sentence instead of starting the
    // panel.
    const rows = payload.systemMessage.split("\n");
    expect(rows[0]).toBe("");
    expect(rows[1]).toContain("gpt-5-codex");
    // 600 fresh input, 400 cache reads and 100 cache writes against the
    // window Codex stated, not the Claude default of 200k.
    expect(payload.systemMessage).toContain("258k");
    expect(payload.systemMessage).toContain("30d");
  });

  // Everything below is a host that gave us nothing usable. None of it
  // may produce output or a failing exit code.
  it("stays silent when the transcript cannot be read", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runHook(
      { json: false, color: false, ascii: false, project: undefined, since: undefined, until: undefined },
      { stdin: JSON.stringify({ transcript_path: "/nope/missing.jsonl" }), columns: 80 },
    );
    expect(code).toBe(0);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("stays silent when the payload names no transcript", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runHook(
      { json: false, color: false, ascii: false, project: undefined, since: undefined, until: undefined },
      { stdin: "{}", columns: 80 },
    );
    expect(code).toBe(0);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
