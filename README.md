<h1 align="center">agent-tracker</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/agenttracker"><img src="https://img.shields.io/npm/v/agenttracker?logo=npm&label=npm" alt="npm version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node.js 20+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8A2BE2" alt="License: MIT"></a>
  <a href="https://github.com/ado11231/agent-tracker"><img src="https://img.shields.io/github/stars/ado11231/agent-tracker?style=flat&logo=github" alt="GitHub stars"></a>
</p>

See what your agents cost, live in the terminal you already have open. Reads the session logs Claude Code and Codex already write. No API key, no account, no telemetry.

## Install

```bash
npm install -g agenttracker

agenttracker setup           # Claude Code
agenttracker setup --codex   # Codex
```

Codex asks you to trust the hook once, the first time it starts.

## Live metrics

The same panel in both agents, drawn after every turn. No second terminal.

### Claude Code

<p align="center">
  <img width="760" src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/statusline.png" alt="Claude Code live metrics">
</p>

### Codex

<p align="center">
  <img width="760" src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/codex-live.png" alt="Codex live metrics">
</p>

## Heat chart

<p align="center">
  <img src="https://raw.githubusercontent.com/ado11231/agent-tracker/main/docs/images/heatmap.png" alt="agent-tracker heat chart">
</p>

## Commands

| Command | |
| --- | --- |
| `agenttracker` | dashboard |
| `agenttracker sessions` | sessions |
| `agenttracker context` | context |
| `agenttracker live` | live panel in its own terminal |
| `agenttracker doctor` | diagnostics |
| `agenttracker setup` | install, `--uninstall` to remove |

Every command takes `--json`, `--no-color`, and `--source claude|codex`.

## Privacy

Reads `~/.claude/projects` and `~/.codex/sessions`. Nothing leaves your machine.

MIT
