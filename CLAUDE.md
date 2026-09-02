# CLAUDE.md — AgentTracker

> Standing context for any Claude Code session working on this project.

## What this project is

A **TypeScript npm CLI** for local agent observability. It reads Claude Code
and Codex session logs (`~/.claude/projects` and `~/.codex/sessions`)
and reports where tokens and dollars went — per session, day, project, and
model — plus live surfaces for Claude Code's status line and context window.

One-sentence identity: *a local, offline CLI that tells you where your agent
tokens went.*

## Hard constraints (never violate)

- **Read-only.** The tool only reads local provider session logs. It never
  writes outside its own install. "Uninstall leaves zero trace" is a promise.
- **Offline.** No API calls, no network, no telemetry. Cost is derived from a
  local pricing table, not fetched.
- **Zero-config.** Flags only in v1. No config file, no state, no daemon.
- **Graceful degradation.** Unknown model IDs → report tokens, mark cost
  unknown. Unparseable JSONL lines → skip, count, surface via `doctor`.
  Never crash on log-format drift.

## Decisions already made (do not relitigate)

- **Cut: model rerouting.** No supported hook exists in Claude Code; it would
  just be a settings.json editor. Not observability. Possible v2 shape:
  analytics-driven "suggested model" *insights*, no switching.
- **Cut: transcript viewer (`view` / `--follow` / export).** Metrics and live
  context are the product. A readable session dump diluted that; the renderer
  and command surface went with it.
- **Cut: LLM-powered bash explanation.** Unneeded — every Bash tool_use in the
  logs already carries a model-written `description` field.
- **Cut: budgets and alerts** because they need a daemon.
- **TypeScript**, not Python — the Claude Code tooling ecosystem is
  npm-centric.

## Architecture (see docs/design.md for detail)

Three internal modules, one dependency direction:

```
parser  →  cost engine  →  renderers (dashboard, live, reports)
```

- `parser/` has **zero imports from the other two** — it may become a published
  library later. It walks the `parentUuid` tree from `leafUuid` to extract the
  active branch (logs are a tree, not a list — retries/branches exist).
- Pricing lives in a **single JSON data file** keyed by model ID with five
  token tiers (input / output / cache_read / cache_write_5m / cache_write_1h;
  real logs split cache writes into two differently-priced TTLs). Kept a
  single obvious file on purpose so new-model pricing updates stay trivial.

## Conventions

- Stack: TypeScript strict, `commander`, `picocolors`, `tsup`, `vitest`.
  `bin` entry so `npx` works.
- Every command supports `--json`. Respect `NO_COLOR` and pipe detection.
  `--ascii` swaps glyphs (`●◆⚡✎└` → `* > $ + \_`).
- Feature-detect italic and truecolor; default to the 16-color palette (it
  inherits the user's theme, so it works on light and dark backgrounds).
- **Every style must survive removal**: structure comes from spacing and
  glyphs; color/weight only reinforce. Output must read fine piped to a file.
- Test fixtures are **real session JSONL files** (scrubbed). Pin fixtures per
  Claude Code version; the log format drifts between releases.

## Doc map

- `docs/design.md` — data format, parser event model, cost math, rendering
  spec, CLI command/flag surface
- `docs/roadmap.md` — phases 0–3 with done-when criteria, backlog
