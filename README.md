<h3 align="center">AgentTracker</h3>

<p align="center">
  Local token, context, and cost tracking for Claude Code and Codex.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/heatmap.png" alt="AgentTracker yearly activity heatmap">
</p>

```bash
npm install -g agenttracker
agenttracker
```

AgentTracker reads local session logs only. No network, telemetry, config, or
state. Node 20 or newer is required.

## Live tracking

```bash
agenttracker live --source codex
```

<p align="center">
  <img width="760" src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/codex-live.png" alt="AgentTracker live Codex metrics showing model, turns, tokens, API estimate, context, and cache share">
</p>

The live view refreshes in place. Use `--id <prefix>` for one session or
`--refresh 0` for a single snapshot. Codex costs are API-price estimates, not
subscription charges.

## Commands

| Command | Purpose |
| --- | --- |
| `agenttracker` | Dashboard by project, model, and tool |
| `agenttracker live` | Live tokens, context, cache, and estimated cost |
| `agenttracker sessions` | Recent sessions with cost and duration |
| `agenttracker context [id]` | Context usage for one session |
| `agenttracker doctor` | Parsing and pricing diagnostics |
| `agenttracker statusline` | Claude Code status-line integration |

Use `--source claude`, `--source codex`, or `--source auto` on reports.
`auto` includes both providers.

## Claude Code status line

```json
{ "statusLine": { "type": "command", "command": "agenttracker statusline" } }
```

Add this to `~/.claude/settings.json`. For Codex, use `agenttracker live`.

## License

MIT
