import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultProjectsRoot,
  discoverSessionFiles,
} from "../src/parser/discover.js";

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ccvitals-discover-"));
}

describe("discoverSessionFiles", () => {
  it("returns an empty list for a missing root", async () => {
    const files = await discoverSessionFiles("/nonexistent/ccvitals-test-root");
    expect(files).toEqual([]);
  });

  it("finds jsonl files per project, newest first", async () => {
    const root = await makeRoot();
    const projectA = join(root, "-Users-someone-projectA");
    const projectB = join(root, "-Users-someone-projectB");
    await mkdir(projectA);
    await mkdir(projectB);

    const older = join(projectA, "11111111-aaaa-bbbb-cccc-000000000001.jsonl");
    const newer = join(projectB, "22222222-aaaa-bbbb-cccc-000000000002.jsonl");
    await writeFile(older, "{}\n");
    await writeFile(newer, "{}\n");
    // Ignored: not jsonl, and a stray file at the root.
    await writeFile(join(projectA, "notes.txt"), "ignore me");
    await writeFile(join(root, "stray.jsonl"), "ignore me");

    await utimes(older, new Date("2026-01-01"), new Date("2026-01-01"));
    await utimes(newer, new Date("2026-02-01"), new Date("2026-02-01"));

    const files = await discoverSessionFiles(root);
    expect(files).toHaveLength(2);
    expect(files[0]?.sessionId).toBe("22222222-aaaa-bbbb-cccc-000000000002");
    expect(files[0]?.projectSlug).toBe("-Users-someone-projectB");
    expect(files[1]?.sessionId).toBe("11111111-aaaa-bbbb-cccc-000000000001");
    expect(files[1]?.sizeBytes).toBeGreaterThan(0);
  });
});

describe("defaultProjectsRoot", () => {
  const original = process.env.CCVITALS_ROOT;

  afterEach(() => {
    if (original === undefined) delete process.env.CCVITALS_ROOT;
    else process.env.CCVITALS_ROOT = original;
  });

  it("points at Claude Code's own directory by default", () => {
    delete process.env.CCVITALS_ROOT;
    expect(defaultProjectsRoot()).toMatch(/\.claude\/projects$/);
  });

  // The escape hatch the README recordings use, so demo sessions can
  // stand in for real ones without a flag on every command.
  it("follows CCVITALS_ROOT when it names somewhere", () => {
    process.env.CCVITALS_ROOT = "/tmp/ccvitals-demo";
    expect(defaultProjectsRoot()).toBe("/tmp/ccvitals-demo");
  });

  it("ignores an empty CCVITALS_ROOT rather than reading the filesystem root", () => {
    process.env.CCVITALS_ROOT = "";
    expect(defaultProjectsRoot()).toMatch(/\.claude\/projects$/);
  });
});
