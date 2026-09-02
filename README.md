# AgentTracker

Local token, context, and API-cost estimates for Claude Code and Codex.

AgentTracker reads the session logs already on your machine. It makes no network
requests, writes no configuration, and sends no telemetry.

```bash
npx agenttracker
npm install -g agenttracker
```

Node 20 or newer is required.

## Commands

| Command | Purpose |
| --- | --- |
| `agenttracker` | Dashboard for sessions, projects, models, and tools |
| `agenttracker sessions` | Recent sessions with cost, duration, and turns |
| `agenttracker context [id]` | Context usage and contributors for one session |
| `agenttracker live` | Refreshing view of the latest Claude Code or Codex session |
| `agenttracker statusline` | Claude Code status-line integration |
| `agenttracker doctor` | Parse and pricing diagnostics |

Use `--source claude`, `--source codex`, or `--source auto` with reports.
`auto` is the default and includes both providers.

## Live tracking

`agenttracker live --source codex` watches the newest Codex rollout log and
refreshes the model, turns, tokens, cache share, context, and API-cost estimate.
Use `--id <prefix>` for a specific session or `--refresh 0` to print once.

Codex sessions are read from `~/.codex/sessions`; Claude Code sessions are read
from `~/.claude/projects`. AgentTracker only reads these locations.

## Costs and context

Token counts come from each provider's local logs. Claude Code costs use the
local pricing table. Codex values are API-price estimates, not subscription
charges, and are shown as estimates. Unknown models retain token counts and use
`$?` until a local price is added.

The detailed `context` report has the most complete attribution for Claude Code.
Codex uses the context and token values recorded in its rollout log, with any
breakdown clearly treated as an estimate.

## Claude Code status line

Add this to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "agenttracker statusline" } }
```

## Flags

Every command supports `--json` and `--no-color`. Reports also accept
`--project`, `--since`, `--until`, and `--source`. `sessions` accepts
`--limit`, `--model`, and `--grep`; `context` accepts `--window`.

## License

MIT
