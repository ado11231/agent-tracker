import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexSessionFile } from "../src/parser/codex.js";
import { currentContext } from "../src/render/live.js";

describe("parseCodexSessionFile", () => {
  it("converts cumulative token snapshots into per-turn usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "agenttracker-codex-"));
    const path = join(root, "rollout-2026-01-01T00-00-00-12345678-1234-1234-1234-123456789abc.jsonl");
    const lines = [
      { timestamp: "2026-01-01T00:00:00Z", type: "session_meta", payload: { session_id: "12345678-1234-1234-1234-123456789abc", cwd: "/work/app", cli_version: "1.0", git: { branch: "main" } } },
      { timestamp: "2026-01-01T00:00:01Z", type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/work/app" } },
      { timestamp: "2026-01-01T00:00:02Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 10, output_tokens: 30 } } } },
      // last_token_usage is the live window Codex states per turn, and
      // is deliberately unrelated to the running totals beside it.
      { timestamp: "2026-01-01T00:00:03Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 30, cache_write_input_tokens: 12, output_tokens: 50 }, last_token_usage: { input_tokens: 80, cached_input_tokens: 30, cache_write_input_tokens: 10, output_tokens: 20 } } } },
    ];
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const parsed = await parseCodexSessionFile(path);
    expect(parsed.session.meta).toMatchObject({ sessionId: "12345678-1234-1234-1234-123456789abc", cwd: "/work/app", gitBranch: "main", models: ["gpt-5-codex"] });
    expect(parsed.session.usage).toHaveLength(2);
    // Codex nests cache reads inside input_tokens, so fresh input is
    // input_tokens minus cached_input_tokens: 100 - 20 and then the
    // delta of 150 - 30 against it. Billing the raw input_tokens would
    // charge the cached half twice.
    expect(parsed.session.usage.map((entry) => entry.usage.input)).toEqual([80, 40]);
    expect(parsed.session.usage.map((entry) => entry.usage.cacheRead)).toEqual([20, 10]);
    expect(parsed.session.usage.map((entry) => entry.usage.output)).toEqual([30, 20]);
    // The window is what Codex says is resident right now, not a sum
    // over the session. Summing the deltas would report every token
    // ever spent, which climbs past the window on a long session.
    expect(currentContext(parsed.session)).toEqual({
      tokens: 90,
      model: "gpt-5-codex",
    });
  });
});
