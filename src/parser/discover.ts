import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionFile {
  filePath: string;
  provider: SessionProvider;
  // File name without the .jsonl suffix.
  sessionId: string;
  // Directory name under the projects root. It encodes the project
  // path with slashes turned into dashes, which cannot be decoded
  // reliably, so the real path comes from the session meta instead.
  projectSlug: string;
  modifiedAt: Date;
  sizeBytes: number;
}

export type SessionProvider = "claude" | "codex";
export type SessionSource = SessionProvider | "auto";

// Claude Code session root. The legacy variable supports old demos.
export function defaultProjectsRoot(): string {
  const override = process.env.AGENTTRACKER_CLAUDE_ROOT ?? process.env.CCVITALS_ROOT;
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".claude", "projects");
}

export function defaultCodexRoot(): string {
  const override = process.env.AGENTTRACKER_CODEX_ROOT;
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".codex", "sessions");
}

// Lists every session file under the projects root, newest first.
// A missing or unreadable root just means no sessions.
export async function discoverSessionFiles(
  root: string = defaultProjectsRoot(),
): Promise<SessionFile[]> {
  let projectDirs;
  try {
    projectDirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: SessionFile[] = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(root, dir.name);
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, entry.name);
      let info;
      try {
        info = await stat(filePath);
      } catch {
        continue;
      }
      files.push({
        filePath,
        provider: "claude",
        sessionId: entry.name.slice(0, -".jsonl".length),
        projectSlug: dir.name,
        modifiedAt: info.mtime,
        sizeBytes: info.size,
      });
    }
  }

  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files;
}

export async function discoverCodexSessionFiles(
  root: string = defaultCodexRoot(),
): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      let info;
      try {
        info = await stat(entryPath);
      } catch {
        continue;
      }
      const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
      files.push({
        filePath: entryPath,
        provider: "codex",
        sessionId: match?.[1] ?? entry.name.slice(0, -".jsonl".length),
        projectSlug: "codex",
        modifiedAt: info.mtime,
        sizeBytes: info.size,
      });
    }
  }
  await walk(root);
  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files;
}

export async function discoverFiles(
  source: SessionSource = "auto",
  roots?: Partial<Record<SessionProvider, string>>,
): Promise<SessionFile[]> {
  const groups = await Promise.all([
    source === "codex" ? [] : discoverSessionFiles(roots?.claude ?? defaultProjectsRoot()),
    source === "claude" ? [] : discoverCodexSessionFiles(roots?.codex ?? defaultCodexRoot()),
  ]);
  return groups.flat().sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
