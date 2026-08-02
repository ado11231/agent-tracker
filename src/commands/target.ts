import { resolve } from "node:path";
import { summarizeSession } from "../cost/aggregate.js";
import {
  defaultProjectsRoot,
  discoverSessionFiles,
  type SessionFile,
} from "../parser/discover.js";
import type { ExtractedSession } from "../parser/events.js";
import { parseSessionFile } from "../parser/session.js";

// The fields session resolution needs. Shared by every report that
// opens a single session by id rather than scanning the whole root.
export interface TargetFlags {
  id: string | undefined;
  project: string | undefined;
  root?: string;
}

export type Target =
  | { file: SessionFile; session: ExtractedSession }
  | { code: number };

// Picks the session to render: the id prefix when given, the newest
// otherwise. Files are parsed newest first, one at a time, so the
// common case touches a single file. Without an explicit id, files
// that hold no conversation are skipped. Claude Code writes stub
// files with only bookkeeping lines, and the newest file is often
// one.
export async function resolveTarget(flags: TargetFlags): Promise<Target> {
  const files = await discoverSessionFiles(flags.root ?? defaultProjectsRoot());

  let candidates = files;
  if (flags.id !== undefined) {
    const id = flags.id;
    candidates = files.filter((file) => file.sessionId.startsWith(id));
    if (candidates.length > 1) {
      console.error(`ambiguous session id ${id}, matches:`);
      for (const file of candidates.slice(0, 10)) {
        console.error(`  ${file.sessionId}`);
      }
      return { code: 1 };
    }
  }

  const wantedCwd =
    flags.project === undefined ? undefined : resolve(flags.project);

  for (const file of candidates) {
    const parsed = await parseSessionFile(file.filePath);
    if (wantedCwd !== undefined) {
      const summary = summarizeSession(file, parsed.session);
      if (summary.cwd !== wantedCwd) continue;
    }
    if (flags.id === undefined && parsed.session.events.length === 0) continue;
    return { file, session: parsed.session };
  }

  console.error(
    flags.id === undefined ? "no sessions found" : `no session matching ${flags.id}`,
  );
  return { code: 2 };
}