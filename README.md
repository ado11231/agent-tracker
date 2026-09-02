<h3 align="center">agenttracker</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/agenttracker"><img src="https://img.shields.io/npm/v/agenttracker?style=flat&color=CB3837&logo=npm&logoColor=white" alt="npm version"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/agenttracker?style=flat&color=5FA04E&logo=nodedotjs&logoColor=white" alt="Node version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat" alt="MIT license"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/heatmap.png" alt="A year of daily agent session cost as a contribution graph">
</p>

<p align="center"><b>Where your coding-agent tokens went.</b></p>

<p align="center">
  Claude Code and Codex already write local session logs. AgentTracker reads them.
  Nothing leaves your machine, nothing is written outside its own install, and
  uninstalling leaves no trace.
</p>

```bash
npx agenttracker              # try it after publishing
npm install -g agenttracker   # keep it
```

Needs Node 20 or newer.

## Commands

While a session is running:

|                       |                                                |
| --------------------- | ---------------------------------------------- |
| `agenttracker live`   | live tokens, cost estimate, cache, and context |
| `agenttracker context`| what is filling a session's context window     |
| `agenttracker statusline` | a panel for Claude Code's status line      |

Afterwards:

|                        |                                                |
| ---------------------- | ---------------------------------------------- |
| `agenttracker`         | where the tokens and estimates went            |
| `agenttracker sessions`| recent sessions with cost, duration, and turns |
| `agenttracker doctor`  | anything it could not parse or price           |

## Codex

Codex support is built in. AgentTracker reads rollout logs from
`~/.codex/sessions` and can combine them with Claude Code logs from
`~/.claude/projects`.

```bash
agenttracker live --source codex
agenttracker sessions --source codex
agenttracker context --source codex
```

`live` refreshes while the terminal is interactive. Use `--id <prefix>` to
track one session, or `--refresh 0` to print a single snapshot. Codex costs are
API-price estimates, not subscription charges. Token counts come from the local
rollout log.

## Context

Your status line says the window is 91% gone. This says what took it.

![The context report: a fill gauge, an exact startup line, then the top consumers with estimated tokens and how many times each file was touched](https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/context.gif)

For Claude Code, the fill and startup line are exact. The split below them is
estimated and uses `~` to make that clear. Codex uses its recorded context and
token values; attribution remains an estimate.

## Dashboard and sessions

`agenttracker` shows today, this week, and totals by project, model, and tool.
Use `--source claude`, `--source codex`, or `--source auto`; `auto` is the
default and includes both providers.

<p align="center">
  <img width="620" src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/dashboard.png" alt="The AgentTracker dashboard: spend by project, model, and tool">
</p>

`--span year` adds a daily contribution graph. `agenttracker sessions` lists
sessions newest first. `--grep` searches your prompts and shows the matching
line.

## Claude Code status line

One row each for what is running, what it cost, how much context is left, and
how much quota is left. **Wasted** is spend on retries and abandoned branches.
The **cache** share is often the difference between a cheap and costly session.

![The statusline panel: model and turn count, cost, context, and cache hit gauge](https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/statusline.png)

```json
{ "statusLine": { "type": "command", "command": "agenttracker statusline" } }
```

Put this in `~/.claude/settings.json`. Codex has no equivalent host status-line
hook, so use `agenttracker live --source codex` for the same live tracking.

## Flags

`--json` and `--no-color` work everywhere. `--project`, `--since`, `--until`,
and `--source` narrow reports. The rest belong to one command each:

|                                |                                                      |
| ------------------------------ | ---------------------------------------------------- |
| `--span`                       | dashboard: week, month, or year                     |
| `--limit`, `--model`, `--grep` | `sessions`                                           |
| `--window <tokens>`            | `context`                                            |
| `--id`, `--refresh`            | `live`                                               |
| `--ascii`                      | terminal reports                                     |

## Incorrect values

Start with `agenttracker doctor`. A model with no local price still has its
tokens counted, with cost shown as unknown instead of guessed. Prices live in
`src/cost/pricing.json`.

## License

MIT
