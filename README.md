# ccplus

Find out where your Claude Code money went, and read any session back as a
proper conversation.

Claude Code already writes a log for every session. ccplus just reads them.
Nothing is sent anywhere, nothing is written outside its own install, and
there is no config file to set up. Uninstall it and there is no trace left.

## Install

```bash
npx ccplus
```

or keep it around:

```bash
npm install -g ccplus
```

Needs Node 20 or newer.

## Commands

While a session is running:

```
ccplus statusline               a panel for Claude Code's status line
ccplus view --follow            the transcript, appended live
ccplus view --follow --compact  one line each time the cost moves
```

Afterwards:

```
ccplus            where the money went, today and this week
ccplus sessions   recent sessions with cost, duration, and turns
ccplus view [id]  read a session back, the latest one if you skip the id
ccplus doctor     anything it could not parse or price
```

Every command takes `--json` for piped output, and drops color on its own
when you pipe. `--ascii` swaps the fancy glyphs (on the dashboard, `view`,
and `statusline`); `--no-color` forces it off. The dashboard and `sessions`
narrow by date with `--since` and `--until`, and by directory with `--project`;
`doctor` also takes `--project`. `view` and `statusline` target one session,
so they take neither.

## Dashboard

Running `ccplus` with no command shows where the money went: today and this
week, with totals by project, model, and tool. A tool table follows, with
calls, failures and cost for each.

`--span` decides how far back to look. `--span month` swaps the top two rows
for this week and this month, and `--span year` keeps those and puts a
contribution graph above them. Each day is tinted by whichever model spent the
most on it, and the glyph says how much. Two answers, one grid, and it still
reads fine with color off.

## Sessions

Newest first. That short id is what `view` wants, and any prefix that is not
ambiguous will do. `--grep` searches what you typed and shows you the line
that matched; `--model` narrows it to one model.

## View

`ccplus view` renders a session as something you can actually read, and picks
the most recent one if you do not name one. `--full` opens up the raw
commands, tool output and thinking. `--costs` puts a price on every tool
call.

`--export` writes it to markdown instead, which is what you want for a gist
or a pull request. It lands at `./<id>.md`, or wherever you point it:
`--export notes/session.md`.

## Statusline

One row each for what is running, what it cost, how much context is left and
how much quota is left. **Wasted** is what you paid for retries and abandoned
branches, and the **cache** share is usually the difference between a cheap
session and an expensive one. Empty fields vanish rather than show a zero,
and a row too wide for your terminal drops its right hand side instead of
wrapping. Rate limits need a Pro or Max plan.

Add it to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "ccplus statusline" } }
```

If the bar comes up blank, use absolute paths. A status line runs in a bare
shell that may not know about your version managed `node`.

## Doctor

If a number ever looks wrong, start here. A model ccplus has no price for
still gets its tokens counted, and the cost is marked unknown rather than
guessed at. Prices live in `src/cost/pricing.json`, one file keyed by model,
and that is the only thing that needs touching when a new model ships. Pull
requests adding one are very welcome.

## License

MIT
