import { describe, expect, it } from "vitest";
import { planClaude, planCodex } from "../src/commands/setup.js";

const CMD = "/usr/bin/node /opt/agenttracker/main.js";

describe("planClaude", () => {
  it("adds a status line to an empty config", () => {
    const plan = planClaude(undefined, CMD, false);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(JSON.parse(plan.next ?? "{}")).toEqual({
      statusLine: { type: "command", command: `${CMD} statusline` },
    });
  });

  it("keeps every other setting when it edits", () => {
    const raw = JSON.stringify({ model: "opus", env: { A: "1" } });
    const plan = planClaude(raw, CMD, false);
    if ("error" in plan) throw new Error(plan.error);
    expect(JSON.parse(plan.next ?? "{}")).toMatchObject({
      model: "opus",
      env: { A: "1" },
    });
  });

  // The exact case on a machine where the tool was installed from a
  // directory that has since been renamed. A stale command silently
  // renders nothing, so replacing it is the whole point.
  it("replaces a status line pointing at a path that moved", () => {
    const raw = JSON.stringify({
      statusLine: { type: "command", command: "/usr/bin/node /old/ccprism/main.js statusline" },
    });
    const plan = planClaude(raw, CMD, false);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.summary).toContain("/old/ccprism/main.js");
    expect(JSON.parse(plan.next ?? "{}").statusLine.command).toBe(`${CMD} statusline`);
  });

  it("does nothing when it is already current", () => {
    const raw = JSON.stringify({
      statusLine: { type: "command", command: `${CMD} statusline` },
    });
    const plan = planClaude(raw, CMD, false);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.next).toBeUndefined();
  });

  // Overwriting settings because of a stray comma would be far worse
  // than declining to install.
  it("refuses to touch a file it cannot parse", () => {
    expect(planClaude("{ not json", CMD, false)).toEqual({
      error: expect.stringContaining("not valid json"),
    });
  });

  it("removes only its own status line on uninstall", () => {
    const mine = JSON.stringify({
      model: "opus",
      statusLine: { type: "command", command: `${CMD} statusline` },
    });
    const plan = planClaude(mine, CMD, true);
    if ("error" in plan) throw new Error(plan.error);
    expect(JSON.parse(plan.next ?? "{}")).toEqual({ model: "opus" });

    const theirs = JSON.stringify({
      statusLine: { type: "command", command: "/usr/bin/somebody-else" },
    });
    const other = planClaude(theirs, CMD, true);
    if ("error" in other) throw new Error(other.error);
    expect(other.next).toBeUndefined();
  });
});

describe("planCodex", () => {
  it("appends a delimited hook block", () => {
    const plan = planCodex("", CMD, false);
    expect(plan.next).toContain("[[hooks.Stop]]");
    expect(plan.next).toContain(`command = "${CMD} hook"`);
  });

  // [[hooks.Stop]] opens a new array-of-tables entry, so appending at
  // the end stays valid whatever the user already wrote.
  it("keeps existing config above the block", () => {
    const existing = '[projects."/work"]\ntrust_level = "trusted"\n';
    const plan = planCodex(existing, CMD, false);
    expect(plan.next?.startsWith(existing)).toBe(true);
    expect(plan.next).toContain("[[hooks.Stop]]");
  });

  it("is idempotent", () => {
    const once = planCodex("", CMD, false).next ?? "";
    expect(planCodex(once, CMD, false).next).toBeUndefined();
  });

  it("removes its block and nothing else on uninstall", () => {
    const existing = '[projects."/work"]\ntrust_level = "trusted"\n';
    const installed = planCodex(existing, CMD, false).next ?? "";
    const removed = planCodex(installed, CMD, true).next ?? "";
    expect(removed).not.toContain("hooks.Stop");
    expect(removed).toContain("trust_level");
  });

  it("does nothing when no block is present", () => {
    expect(planCodex("model = \"gpt\"\n", CMD, true).next).toBeUndefined();
  });
});
