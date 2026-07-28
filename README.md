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

Anything here takes `--json` if you would rather pipe it somewhere, plus
`--project`, `--since` and `--until` to narrow it down. Color drops out on
its own when you pipe, and `--ascii` swaps the fancy glyphs.

## Dashboard

```
ccplus · 37 sessions · $561.78 · cache hit 98.9%

  today       $36.34  4.7k in  128k out  56.0M cached
  this week  $153.36  6.3k in  757k out   223M cached

  project      sessions     cost
  JrnymanApp         17  $365.68
  ccprism            15  $188.84
  adnanalagic         5    $7.26

  model     messages     cost
  opus-4-8      2853  $426.43
  fable-5        417   $99.01
  opus-5         203   $36.34
```

A tool table follows, with calls, failures and cost for each.

`--span` decides how far back to look. `--span month` swaps the top two rows
for this week and this month, and `--span year` keeps those and puts a
contribution graph above them:

```
  daily cost · last 53 weeks · by model
        Aug  Sep Oct Nov  Dec Jan Feb Mar  Apr May  Jun Jul
      ┌─────────────────────────────────────────────────────┐
      │···················································▒▒│
  Mon │·················································░▓▒░│
      │·················································░░▒ │
  Wed │················································░·▒░ │
      │·················································░█▓ │
  Fri │··················································▓· │
      │··················································░· │
      └─────────────────────────────────────────────────────┘

  most active Jul 16 · $177.53   longest 11d   current 2d
  less ·░▒▓█ more
```

Each day is tinted by whichever model spent the most on it, and the glyph
says how much. Two answers, one grid, and it still reads fine with color off.

## Sessions

```
id        when       dur  turns    cost  project  model
95f5296c  21:47   1h 43m     10  $32.77  ccprism  opus-5
7e1f27df  Jul 26   6h 2m     15  $20.87  ccprism  opus-4-8
```

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

```
sec-review  ·  opus-5  ·  high  ·  2 turns
$0.19  ·  $2.40/hr  ·  $0.03 wasted  ·  +156 −23
▓▓▓░░░░░░░░░░░  14%   27.4k / 200k ctx
▓▓▓▓░░░░░░░░░░  24%   5h · 41% week · 89% cache
```

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

```
ccplus doctor · 37 sessions · 17,730 lines read

  all clean, every line parsed and priced
```

If a number ever looks wrong, start here. A model ccplus has no price for
still gets its tokens counted, and the cost is marked unknown rather than
guessed at. Prices live in `src/cost/pricing.json`, one file keyed by model,
and that is the only thing that needs touching when a new model ships. Pull
requests adding one are very welcome.

## License

MIT
