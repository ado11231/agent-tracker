import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("cli scaffold", () => {
  it("registers the v1 commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(["statusline", "context", "sessions", "doctor"]);
  });

  // Commands are grouped in --help by what they are for, and commander
  // orders the groups by first registration. That makes declaration
  // order load bearing, so both the grouping and the fact that live
  // commands come first are pinned here.
  it("groups the commands, live ones first", () => {
    const groups = buildProgram().commands.map((command) => [
      command.name(),
      command.helpGroup(),
    ]);
    // The hidden alias carries no group, so it drops out here.
    expect(groups.filter(([, group]) => group !== "")).toEqual([
      ["statusline", "Live:"],
      ["context", "Live:"],
      ["sessions", "Reports:"],
      ["doctor", "Reports:"],
    ]);
  });

  // The dashboard is a feature without a command of its own, so the
  // grouped list cannot mention it.
  it("documents the bare dashboard feature", () => {
    // Via outputHelp, not helpInformation: the trailing text is added
    // by an addHelpText hook, which only the former runs.
    const program = buildProgram();
    let help = "";
    program.configureOutput({
      writeOut: (chunk) => {
        help += chunk;
      },
    });
    program.outputHelp();
    expect(help).toContain("Live:");
    expect(help).toContain("Reports:");
    expect(help).toContain("Run with no command for the dashboard");
  });

  it("is named ccvitals", () => {
    expect(buildProgram().name()).toBe("ccvitals");
  });
});

describe("option routing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Flags like --json exist on the root for the dashboard and on
  // every subcommand. Commander can route them to either scope, so
  // actions must read optsWithGlobals. This locks that in.
  it("delivers shared flags to subcommand actions", async () => {
    const program = buildProgram();
    const sessions = program.commands.find((c) => c.name() === "sessions");
    expect(sessions).toBeDefined();
    let seen: Record<string, unknown> | undefined;
    sessions!.action((_opts: unknown, command: { optsWithGlobals(): Record<string, unknown> }) => {
      seen = command.optsWithGlobals();
    });
    await program.parseAsync([
      "node", "ccvitals", "sessions", "--json", "--limit", "3", "--since", "2026-01-01",
    ]);
    expect(seen).toMatchObject({ json: true, limit: "3", since: "2026-01-01" });
  });
});
