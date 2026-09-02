import { shortId } from "../render/format.js";
import { glyphsFor } from "../render/glyphs.js";
import { roles } from "../render/palette.js";
import { colorEnabled, makeStyle } from "../render/style.js";
import { loadSessions, type CommandFlags, type LoadedSession } from "./load.js";

type Severity = "warn" | "error";

interface Issue {
  kind: Severity;
  text: string;
}

interface SessionIssues {
  provider: string | undefined;
  sessionId: string | undefined;
  projectSlug: string;
  issues: Issue[];
}

// Each issue is filed as a warning or an error. The split is what
// lets the verdict line say which kind of trouble there is, and what
// lets the per-session list mark the lines that lost data with a
// different shape than the ones that only want attention.
//
//   error   data was lost or the tree could not be walked truthfully:
//           malformed lines that were skipped, parent links the log
//           named but no line carries.
//   warn    the parse degraded but nothing was lost: unrecognized line
//           types, unknown content blocks, a leaf found by fallback
//           rather than a last-prompt line, models with no price.
function issuesOf(session: LoadedSession): Issue[] {
  const issues: Issue[] = [];
  const read = session.readStats;
  const tree = session.treeStats;

  if (read.malformedLines > 0) {
    issues.push({
      kind: "error",
      text: `${read.malformedLines} malformed line${read.malformedLines === 1 ? "" : "s"} skipped`,
    });
  }
  const unknownTypes = Object.entries(read.unknownTypes);
  if (unknownTypes.length > 0) {
    const listed = unknownTypes.map(([type, n]) => `${type} x${n}`).join(", ");
    issues.push({ kind: "warn", text: `unknown line types: ${listed}` });
  }
  if (session.unknownBlocks > 0) {
    issues.push({
      kind: "warn",
      text: `${session.unknownBlocks} unknown content block${session.unknownBlocks === 1 ? "" : "s"}`,
    });
  }
  // Stub files holding only ignorable metadata lines have no tree at
  // all. That is an empty session, not a parse problem.
  if (tree.leafSource !== "last-prompt" && read.keptLines > 0) {
    issues.push({
      kind: "warn",
      text: `active branch found via ${tree.leafSource} fallback`,
    });
  }
  if (tree.missingParents > 0) {
    issues.push({
      kind: "error",
      text: `${tree.missingParents} missing parent link${tree.missingParents === 1 ? "" : "s"}`,
    });
  }
  const unknownModels = session.summary.total.unknownModels;
  if (unknownModels.length > 0) {
    issues.push({
      kind: "warn",
      text: `models without pricing: ${unknownModels.join(", ")}`,
    });
  }
  return issues;
}

export async function runDoctor(flags: CommandFlags): Promise<number> {
  const sessions = await loadSessions(flags);
  if (sessions.length === 0) {
    console.error("no sessions found");
    return 2;
  }

  let totalLines = 0;
  let malformed = 0;
  const unknownTypes: Record<string, number> = {};
  const unknownModels = new Set<string>();
  const flagged: SessionIssues[] = [];
  let warnings = 0;
  let errors = 0;

  for (const session of sessions) {
    totalLines += session.readStats.totalLines;
    malformed += session.readStats.malformedLines;
    for (const [type, n] of Object.entries(session.readStats.unknownTypes)) {
      unknownTypes[type] = (unknownTypes[type] ?? 0) + n;
    }
    for (const model of session.summary.total.unknownModels) {
      unknownModels.add(model);
    }
    const issues = issuesOf(session);
    if (issues.length > 0) {
      for (const issue of issues) {
        if (issue.kind === "error") errors += 1;
        else warnings += 1;
      }
      flagged.push({
        provider: session.summary.provider,
        sessionId: session.summary.sessionId,
        projectSlug: session.summary.projectSlug,
        issues,
      });
    }
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          sessions: sessions.length,
          totalLines,
          malformedLines: malformed,
          unknownLineTypes: unknownTypes,
          modelsWithoutPricing: [...unknownModels],
          warnings,
          errors,
          flaggedSessions: flagged.map((session) => ({
            sessionId: session.sessionId,
            provider: session.provider,
            projectSlug: session.projectSlug,
            issues: session.issues,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const c = makeStyle(colorEnabled(flags.color));
  const r = roles(c);
  // The separator is the one glyph this report draws, and it is the one
  // reason doctor takes --ascii.
  const dot = c.dim(glyphsFor(flags.ascii === true).dot);
  const lines: string[] = [];
  lines.push(
    `${c.bold("agenttracker doctor")} ${dot} ${sessions.length} session${sessions.length === 1 ? "" : "s"} ` +
      `${dot} ${totalLines.toLocaleString()} line${totalLines === 1 ? "" : "s"} read`,
  );
  lines.push("");

  if (flagged.length === 0) {
    lines.push(`  ${r.ok("ok")} ${dot} every line parsed and priced`);
  } else {
    // The verdict names the kind and the count of trouble up front,
    // before the per-session breakdown, so a glance from the bottom of
    // a long output still answers "how bad".
    const parts = [
      `${flagged.length} session${flagged.length === 1 ? "" : "s"} flagged`,
    ];
    if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
    if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
    lines.push(`  ${parts.join(` ${dot} `)}`);
    lines.push("");

    for (const session of flagged) {
      lines.push(
        `  ${r.session(shortId(session.sessionId))}  ${r.project(session.projectSlug)}`,
      );
      for (const issue of session.issues) {
        const paint = issue.kind === "error" ? r.danger : r.warn;
        const mark = issue.kind === "error" ? "x" : "!";
        lines.push(`    ${paint(mark)} ${issue.text}`);
      }
      lines.push("");
    }
    // Trim the trailing blank from the last session so the report
    // ends tight, the way the clean case does.
    lines.pop();
  }

  console.log(lines.join("\n"));
  return 0;
}
