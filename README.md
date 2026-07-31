# ccplus

Find out where your Claude Code money went, and read any session back as a
proper conversation.

Claude Code already writes a log for every session. ccplus just reads them.
Nothing is sent anywhere, nothing is written outside its own install, and
there is no config file to set up. Uninstall it and there is no trace left.

![The ccplus dashboard: a year of daily cost as a contribution graph, then spend by project, model, and tool](https://raw.githubusercontent.com/ado11231/ccplus/main/docs/images/dashboard.png)

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

## Dashboard

Running `ccplus` with no command shows where the money went: today and this
week, with totals by project, model, and tool. A tool table follows, with
calls, failures and cost for each.

`--span` decides how far back to look. `--span month` swaps the top two rows
for this week and this month, and `--span year` keeps those and puts a
contribution graph above them. Each day is tinted by whichever model spent the
most on it, and the glyph says how much. Two answers, one grid, and it still
reads fine with color off.

The graph fits itself to your terminal. A full year needs 115 columns, and it
spreads the weeks further apart as the window gets wider. Narrower than that
it drops the oldest weeks from the left rather than squeezing the cells
together, and the caption tells you how many weeks you are looking at.

## Sessions

Newest first. That short id is what `view` wants, and any prefix that is not
ambiguous will do. `--grep` searches what you typed and shows you the line
that matched; `--model` narrows it to one model.

```
id        when       dur  turns    cost  project       model
70197a1c  00:19      11m      1   $3.90  ccplus        opus-5
8b8c2bdf  Jul 30  1h 15m     17   $9.37  landing-page  opus-5
5cd88cd1  Jul 30  1h 32m      9   $3.18  dotfiles      opus-4-8
95f5296c  Jul 27  1h 59m     14  $43.84  api-gateway   opus-5+
```

## View

`ccplus view` renders a session as something you can actually read, and picks
the most recent one if you do not name one. `--full` opens up the raw
commands, tool output and thinking. `--costs` puts a price on every tool
call.

![A session transcript: your prompts in cyan, tool calls with a glyph and a one line description, thinking collapsed to a count](https://raw.githubusercontent.com/ado11231/ccplus/main/docs/images/view.png)

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

![The statusline panel: session name and model, then cost, then a context gauge, then a quota gauge](https://raw.githubusercontent.com/ado11231/ccplus/main/docs/images/statusline.png)

Add it to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "ccplus statusline" } }
```

If the bar comes up blank, use absolute paths. A status line runs in a bare
shell that may not know about your version managed `node`.

## Colors

Two colors are reserved everywhere, so they always mean one thing:

| | |
| --- | --- |
| red | it failed |
| yellow | it wants your attention |

The other four name whatever the line is counting:

| | |
| --- | --- |
| cyan | a project, and your own words in a transcript |
| blue | a session |
| magenta | a model |
| green | a tool, and a gauge with room left in it |

A model family keeps its color wherever it turns up, so opus is the same on
the statusline as it is in the heatmap legend. When two models of one family
show up together the bigger spender keeps the family color and the other
takes the next one free, so a legend never has two entries the same.

None of it is load bearing. Color only ever repeats something a glyph, a
column or a heading already said, so `--no-color`, `NO_COLOR`, and piping to
a file all read the same. `--ascii` swaps the glyphs too, for terminals that
cannot draw them.

## Flags

Every command takes these:

| | |
| --- | --- |
| `--json` | machine readable output |
| `--no-color` | plain output, also implied by `NO_COLOR` or piping |

The reports narrow the same way:

| | Where |
| --- | --- |
| `--project <path>` | dashboard, `sessions`, `doctor` |
| `--since <date>`, `--until <date>` | dashboard, `sessions` |

And the rest belong to one command each:

| | Command |
| --- | --- |
| `--span week\|month\|year` | dashboard |
| `--limit <n>`, `--model <text>`, `--grep <text>` | `sessions` |
| `--full`, `--costs`, `--follow`, `--compact`, `--export [path]` | `view` |
| `--ascii` | dashboard, `view`, `statusline` |

`view` and `statusline` are about one session, so they take no window flags.

## Doctor

If a number ever looks wrong, start here. A model ccplus has no price for
still gets its tokens counted, and the cost is marked unknown rather than
guessed at. Prices live in `src/cost/pricing.json`, one file keyed by model,
and that is the only thing that needs touching when a new model ships. Pull
requests adding one are very welcome.

## License

MIT
