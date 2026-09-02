import { resolve } from "node:path";
import { summarizeSession } from "../cost/aggregate.js";
import {
  discoverFiles,
  type SessionFile,
} from "../parser/discover.js";
import type { ExtractedSession } from "../parser/events.js";
import { parseDiscoveredSession } from "../parser/session.js";

// The fields session resolution needs. Shared by every report that
// opens a single session by id rather than scanning the whole root.
export interface TargetFlags {
  id: string | undefined;
  project: string | undefined;
  root?: string;
  source?: import("../parser/discover.js").SessionSource;
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
  const source = flags.source ?? (flags.root === undefined ? "auto" : "claude");
  const roots = flags.root === undefined
    ? undefined
    : source === "codex"
      ? { codex: flags.root }
      : { claude: flags.root };
  const files = await discoverFiles(source, roots);

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
    const parsed = await parseDiscoveredSession(file);
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
