# Design

## 1. Data source

Claude Code writes one JSONL file per session:

```
~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
```

Each line is an event. The ones we care about:

| Event | Key fields | Used for |
|---|---|---|
| user message | `message.content`, `timestamp` | sessions `--grep`, context |
| assistant message | `message.model`, `message.usage`, content blocks | metrics + context |
| `usage` block | `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` | cost math |
| tool_use content block | `name`, `input` (Bash calls include `input.description`!) | tool cost split, context |
| tool_result | output text, `is_error` | context fill estimate |
| `type: "last-prompt"` | `leafUuid` | finding the active branch |
| `isSidechain: true` | — | subagent attribution |

**Critical structural fact:** messages form a **tree** via `parentUuid`
(retries, branches, sidechains). Costing in raw line order is wrong. Resolve
the active branch by walking backward from `leafUuid`.

**Critical costing fact (verified against real logs, CC ~2026-07):** one API
response is written as **multiple `assistant` lines — one per content block —
each repeating the identical `message.usage` object.** Summing usage per line
multiplies real cost. Dedupe by `message.id` before any aggregation.

Known ignorable types seen in real logs: `agent-name`, `ai-title`,
`file-history-delta`, `file-history-snapshot`, `mode`, `permission-mode`,
`pr-link`, `queue-operation`, `summary`. The parser keeps two skip buckets
(known ignorable vs genuinely unknown or malformed) and `doctor` only flags
the latter. `leafUuid` lives on `last-prompt` events (several per session;
use the last).

**Tree membership fact (verified against real logs 2026-07-17):** `system`
and `attachment` lines carry `uuid` and `parentUuid` and sit inside the
message tree. User and assistant lines can have them as parents, so the
parser must keep every line that has a uuid, whatever its type, or walking
back from `leafUuid` breaks. Unknown future types with a uuid are kept for
the same reason and only counted for `doctor`.

**Compaction fact (verified against real logs 2026-07-17):** compaction
starts a fresh physical tree inside the same file. The new root is a
`system` line with `subtype: "compact_boundary"`, `parentUuid: null`, and a
`logicalParentUuid` pointing at the pre compact conversation. The branch
walk must follow `logicalParentUuid` when `parentUuid` is null, or
everything before the compaction is silently dropped (verified: 1845 of
2412 lines lost in one real session). The boundary line also carries
`compactMetadata` with pre and post token counts.

**Stub session fact (verified 2026-07-17):** a session file can hold only
metadata lines (`agent-name` and `ai-title`) with no tree at all, left
behind when a session is created and immediately abandoned. These parse to
zero kept lines and zero usage. `doctor` treats them as empty sessions,
not parse problems.

The session's own uuid can also appear as a companion directory next to the
jsonl file, holding `tool-results/*.txt` with large tool outputs stored out
of line.

Session metadata worth extracting: `version` (Claude Code version), `cwd`,
`gitBranch`, timestamps (→ duration, gaps, turns).

## 2. Parser (module 1 — zero internal deps)

Emits a typed event stream:

```ts
type Event =
  | UserMessage      // text, timestamp
  | AssistantText    // text, model, usage
  | Thinking         // text (render dim/italic/collapsed)
  | ToolCall         // toolName, description?, input, sidechain?
  | ToolResult       // text, isError, toolUseId
  | Meta             // session header info
```

Requirements:
- Streaming line reader (sessions can be tens of MB)
- Skip-and-count malformed lines; expose counts for `doctor`
- Tree resolution: `leafUuid` → active branch; sidechains grouped under their
  spawning Task call
- Fixtures from real sessions, pinned per Claude Code version

## 3. Cost engine (module 2)

`pricing.json`, keyed by model ID, five tiers per model (USD per MTok):

```json
{
  "claude-opus-4-8": { "input": _, "output": _, "cacheRead": _,
                       "cacheWrite5m": _, "cacheWrite1h": _ }
}
```

- `cost(usage, model)` → number | `unknown` (unknown model ≠ crash; dashboard
  shows tokens with a "pricing unknown" marker)
- **Cache-write tiering (decided 2026-07-17):** real logs split
  `cache_creation` into `ephemeral_5m_input_tokens` and
  `ephemeral_1h_input_tokens`, priced differently (5m ≈ 1.25× input,
  1h ≈ 2× input) — hence the five-tier schema above. If a usage block
  lacks the `cache_creation` breakdown (older logs), fall back to
  pricing all of `cache_creation_input_tokens` at the 5m tier.
- Seed pricing.json with the current Anthropic lineup plus every model ID
  observed in real logs (this machine: `claude-opus-4-8`, `claude-fable-5`,
  `claude-opus-5`).
  Model ID `<synthetic>` appears in logs for locally-generated placeholder
  messages — **skip it in costing entirely** (zero cost, not "unknown").
- **Seeded 2026-07-17** (`src/cost/pricing.json`) with the full current
  lineup: Fable 5 / Mythos 5 ($10/$50), Opus 4.6 to 4.8 ($5/$25), Sonnet 4.6
  and 5 ($3/$15), Haiku 4.5 ($1/$5); cache read is 0.1x input, writes are
  1.25x (5m) and 2x (1h). Rescan of all local logs the same day confirmed
  only `claude-opus-4-8`, `claude-fable-5`, and `<synthetic>` appear.
- **Opus 5 added 2026-07-27.** `claude-opus-5` shipped after the seed and was
  missing from the table, so every session on it reported `$?` for cost. A
  rescan of all local logs now finds `claude-opus-4-8`, `claude-fable-5`,
  `claude-opus-5`, and `<synthetic>`. Worth keeping as the worked example of
  the standing rule: nothing crashed and nothing warned in the normal reports,
  the tokens still counted, and `doctor` was the only place that named the
  model. Rates are $5/$25, the same as Opus 4.8.
- **Cache write tier in practice (verified 2026-07-17):** recent Claude Code
  sessions on this machine write cache entries exclusively at the 1h tier
  (the largest local session: 466,744 tokens at 1h, zero at 5m). The 5m
  fallback for missing splits therefore only matters for older logs.
- Aggregators: by session, day, project, model
- **Cross-file dedup is unnecessary (verified 2026-07-17):** message ids do
  not repeat across session files (checked all 41 local sessions, 3,873
  ids), so per-session rollups sum cleanly with no global dedup. Resumed
  conversations get fresh api message ids.
- **Live sessions grow mid-read (verified 2026-07-17):** the active
  session's file is appended between reads, so two measurements moments
  apart legitimately differ. Harmless for aggregation; snapshot comparisons
  must copy the file first. On a frozen copy the parser matches jq exactly.
- Differentiator metrics (beyond basic cost totals):
  - **Cache hit ratio** — cache_read vs total input; the real cost story
  - **Cost per tool category** — attribute assistant-turn cost to the tools it invoked.
    **Attribution rule (implemented 2026-07-18):** a message's cost splits
    evenly across its tool calls; messages with no tool calls land in a
    `chat` bucket; messages on abandoned branches have no surviving events
    so they also land in `chat`. The category sums always equal the total,
    nothing is lost or double counted.
  - **Subagent vs main-thread spend** — via `isSidechain`
  - **Tool stats** — call counts, failure rates per tool
  - **Time** — session duration, turn count, longest gaps

## 4. Rendering (module 3)

Reports and live panels. Structure comes from spacing and glyphs; color and
weight only reinforce. Every style must survive removal — `NO_COLOR`,
`--no-color`, and piping to a file all read the same. `--ascii` swaps glyphs
(`●◆⚡✎└` → `* > $ + \_`). Wrap at `min(terminal width, 100)`.

The transcript viewer (`view`, `--follow`, export) was cut: metrics and live
context are the product. Glyph families and `toolPaint` remain because the
dashboard and `context` still name tools the same way.

### Report coloring (2026-07-27)

Every line in a report is a number someone asked for. Dimming there just made
the whole screen grey, which is what prompted this.

**Dim is chrome only.** It survives on three things, none of which are text:
the heatmap's empty-day cells (they have to recede or the grid is noise), the
`·` separators in header lines, and the `of the total:` label. Anything else
that is a word carries a hue or weight instead.

The heatmap frame used to be dim too and is no longer (2026-07-31). It is the
one piece of chrome that has to hold a shape against a grid of block glyphs,
and dim left it barely visible on most themes. It draws plain and heavy
(`┏━┓┃┗┛`), inheriting the terminal foreground so it reads dark on a light
theme and light on a dark one.

Headings are styled **after** `renderTable` has padded them, since padding
counts `.length` and would otherwise measure the escape codes. That is also
why swapping a heading's hue can never shift a column, and why the tables
stay aligned under `--no-color`.

Where a label introduces a value, the **value** takes the weight, not the
label: the heatmap stat strip reads `most active` plain then the date bold.
Dimming the label and leaving the value plain, which is what it used to do,
put the emphasis on the wrong half.

### The color code (2026-07-31, one scheme for every command)

Every hue is assigned in `render/palette.ts` and nowhere else. Before this
the scheme had drifted three ways: yellow meant both "tool" and "warning",
`web` and `mcp` were both magenta, and models were colored by family on the
statusline but by rank of spend on the heatmap, so the same model came out a
different color on two surfaces and could change between two dashboard runs.

**Two hues are reserved everywhere.** Nothing else may use them, so a red or
a yellow anywhere in the output always means the same thing:

| Hue | Means |
| --- | --- |
| red | it failed |
| yellow | it wants your attention |

**The other four name the thing being counted**, and only appear where that
thing is the subject of the line:

| Hue | Means | Where |
| --- | --- | --- |
| cyan | project | dashboard project table, `doctor` project slug |
| blue | session | `sessions` table heading |
| magenta | model | dashboard model table |
| green | tool | dashboard tool table |

Green does double duty as a healthy gauge on the statusline. That is the one
reuse in the scheme and it is safe because the two never share a surface:
gauges are live output, the tool hue is a report heading.

**A model family keeps its hue on every surface** (`modelPaint`): opus
magenta, sonnet blue, haiku green, fable cyan. Opus takes magenta, which is
the model hue itself, since it is the common case.

A legend showing several models at once (`assignModelPaints`) has the extra
problem that two of a family, opus 4.8 beside opus 5, would come out
identical. There the models are passed ranked by spend, the biggest spender
keeps the family hue, and each one after it takes the first hue still free.
So the dominant model still looks like itself and the legend stays readable.

**Tool categories** take three hues via `toolPaint`: green ran something,
magenta changed a file, blue read one. Web, mcp and agent calls keep their
glyph and take no hue. Cyan stays free for project labels. Nothing in a tool
row is yellow or red — those two stay reserved for failure and attention.

## 5. CLI surface (v1 — frozen)

Install: `npx ccvitals` (try it), `npm install -g ccvitals` (keep it),
`npm uninstall -g ccvitals` (gone completely). Also works via `pnpm dlx` / `bunx`.

Trust guarantees: only ever **reads** `~/.claude/projects/`; no network, no
telemetry, no config file, no state; uninstall leaves zero trace.

### Commands

Split by what they are for: **live** commands run beside a session in
progress, **reports** read sessions that already exist. `--help` shows the
same two groups.

```
Live:
ccvitals statusline         cost, context, and rate limit panel for statusLine
ccvitals context [id]      what is filling the context window right now

Reports:
ccvitals                    dashboard: today / week, per project & model
ccvitals sessions           recent sessions: cost, duration, turns, model
ccvitals doctor             parse health: skipped lines, unknown model IDs
```

One of those is a feature rather than a command and so cannot appear in the
grouped command list: the bare `ccvitals` dashboard. It is covered by trailing
help text instead.

Commander orders help groups by **first registration**, so the live commands
are declared first in `buildProgram`. Declaration order is load bearing;
moving those blocks reorders the help. A test pins it.

Later, `find <query>`.

#### `statusline`

Built for Claude Code's `statusLine` setting, which runs a command after each
assistant message and pipes session JSON on stdin (schema:
code.claude.com/docs/en/statusline). The anchor field is
`transcript_path` — it names the exact session file, so there is no guessing
by mtime. We parse that file with the normal pipeline and print **ccvitals's
own** cost, so the number matches the dashboard rather than echoing
Claude Code's `cost.total_cost_usd`. Run from a shell with no piped input it
falls back to the newest session, which makes it previewable.

Reading that JSON lives in `parser/host.ts`, not in the command: it is pure
parsing with no cost or style dependency, so it belongs on the parser side of
the one-way arrow. The shape is Claude Code's and it drifts between releases,
so **every field is optional and every read is guarded** — a key that is
missing, null, or the wrong type reads as `undefined` and its part of the
panel does not render. Nothing in that file throws. Only fields we actually
render are parsed; an unrendered field is dead code.

Output is a panel of up to four rows, one job each. Claude Code renders one
row per printed line, in its own block **above** the built-in footer badges
(it does not replace them).

```
sec-review · opus-4-8 · high · 2 turns                 what is running
$0.19 · $2.40/hr · $0.03 wasted · +156 −23             what it cost
ctx    ▓▓▓░░░░░░░░░░░░░░░░░  14%   27.4k / 200k        room left
5h     ▓▓▓▓▓░░░░░░░░░░░░░░░  24%   41% week · 89% cache  quota left
```

Each gauge names itself in a fixed left column — 5 wide, sized to the longest
label there is (`cache`, which shares the panel with `ctx` whenever there is
no subscription) — so the bars start in the same place and stack as one block
rather than two loose lines. The bar is 20 cells and is the only part of a
gauge row that can give ground: label, percentage and gaps are fixed, so a
narrow terminal shrinks the bar (down to 6, past which it is a smudge rather
than a gauge) instead of overflowing.

Every row and every segment drops out when its data is missing, rather than
rendering a zero — so the panel shrinks back to two rows on an API plan with
nothing to report. A row never half exists: no empty gauges, no `$0.00
wasted`, no `+0 −0`. What is absent when:

- `session_name` — only with a `--name`/`/rename` name or a generated title;
  the default `my-app-3f` style name does not populate it. A subagent's
  `agent.name` stands in when the session has none, rather than taking a
  second segment.
- `effort.level` — only when the current model has the parameter.
- `rate_limits` — Claude.ai subscribers only, and only after the first
  response of the session. Each window is independently absent.
- Burn rate — suppressed below a minute of wall clock, where a few cents
  divides out to an alarming and meaningless hourly rate.
- Wasted spend — `offBranch` cost, money paid for output on retried and
  abandoned branches that was never seen. A subset of the total, not spend on
  top of it. Hidden at zero, which is the good news.

The **five-hour** window gets the bar, being the one that cuts a working
session off; the weekly window rides beside it as a number. With no
subscription to report, the cache share takes the bar instead, so the row
still leads with a gauge rather than a lone number.

`ctx` is the input side of the most recent main-thread API call (fresh input +
cache reads + cache writes, output excluded — the same basis as Claude Code's
`used_percentage`). The **token count is ccvitals's own** so it agrees with
the dashboard; only the **window size** is taken from the session
JSON (`context_window.context_window_size`). On a manual run no size is sent,
so one is inferred: context above 200k proves the extended tier, and assuming
the small window there would report a false red 100%. The gauge row drops
entirely before the first API call.

**Narrow terminals shorten a row rather than wrapping it.** A wrapped row
costs a whole extra line of the user's screen and reads as broken, so a row
that does not fit drops its fields one at a time from the right. The fields
are already ordered most to least important left to right, which is the whole
priority model — nothing is re-ranked. The leading field never drops, so the
row is either absent or still answers the question it exists for: the identity
row keeps the session name, the cost row keeps the cost, and a gauge row keeps
its label, bar and percentage. The label leads the gauge rather than being a
droppable field after it, so a row cut back to the bar still says which limit
it is drawing.

The width comes from `COLUMNS`, falling back to `process.stdout.columns`.
Claude Code captures our stdout to draw the panel inside its own frame, so
`stdout.columns` is undefined exactly when it matters and the environment
variable is the only width the host can hand us. An unknown width shortens
nothing: guessing narrow would hide fields on a wide terminal, which is the
worse mistake. Widths are measured on the styled strings, since `string-width`
ignores ansi escapes.

Color rules (this surface inverts two defaults on purpose):

- Color is **on by default**. Statusline stdout is *always* captured, so the
  normal pipe test would strip every color; `colorEnabledWhenCaptured` honors
  only `--no-color` and `NO_COLOR`.
- **`dim` is banned for content here.** It renders as low-contrast gray, and
  this is small text on someone else's background. Dim is kept for separators
  only, which are structure and should recede.
- Gauges shift green → yellow → red at 50% / 80%. This is the one color that
  carries information rather than decoration: it warns before compaction and
  before a cutoff. The token detail inherits the gauge color, being the same
  measurement. Cache hit is **inverted** (green ≥ 80%, red < 50%) — a low
  cache share is the expensive case. Inversion is a separate function rather
  than a flag on the first, because the thresholds are genuinely different
  numbers and not a mirror.
- Model is colored by family (opus magenta, sonnet blue, haiku green, fable
  cyan) so a model switch is visible at a glance. Cost is bold, turns plain.
  The hue comes from `modelPaint`, the same one the heatmap legend uses, so a
  model looks the same on both surfaces.

A statusLine command must never break its host, so once Claude Code has
invoked us every failure path prints best effort and exits 0. Note it runs in
a bare non-interactive shell that may not have a version-managed `node` on
PATH — absolute paths in the `command` avoid a silently blank bar.

Settings snippet:

```json
{ "statusLine": { "type": "command", "command": "ccvitals statusline" } }
```

#### `context` (2026-08-01)

Answers what the statusline gauge cannot: not how full the window is, but what
is in it. `src/cost/context.ts` does the analysis, `src/commands/context.ts`
renders it.

**Three numbers, two of them exact.** The report is built around keeping the
measured and the estimated apart on the page.

| | Where it comes from |
| --- | --- |
| fill | the last request's `input + cache_read + cache_creation`. Exact. |
| startup | the **first** request's same sum, so the system prompt, the tool definitions and any files loaded at session start. Exact, and measured rather than assumed. |
| the split | fitted from logged text. Estimated, and every number wears a `~`. |

**Why the split is a division and not a conversion.** The obvious approach,
counting characters and dividing by a tokens-per-character constant, produces
a total that does not match anything the user can check. Instead the measured
growth (`total - startup`) is divided between the origins in proportion to
their weighted characters. The parts therefore always sum to the real number,
and the only claim being made is about **relative share**, which is the part
character counts actually predict well. The absolute scale comes from the API.

**Calibration, measured over 43 real local sessions.** Characters per token
land at 2.0 for tool output, 2.3 for prose and 1.9 for tool inputs — nowhere
near the usual 4, because code and JSON tokenize far worse than English. Those
weights only set the ratios between rows; the scale is measured. The first
request lands between 22.5k and 32.3k tokens with a median of 28k, which is
the real size of the fixed overhead and is worth showing on its own line.

**What the log cannot see, and how the report says so.** Two things occupy the
window and are never written to disk. Thinking blocks are logged with their
text stripped — 2,719 of them across the 45 local sessions, every one empty —
and Claude Code injects per-turn reminders that never appear as content at
all. Their tokens are real and land in the measured growth, so the division
spreads them across the rows. `coverage` on the result is what exposes this:
it is what fraction of the growth the logged text accounts for, near 1 when
the window is almost all things the log wrote down. It runs about 0.7 to 0.85
on real sessions, and a footnote states it rather than letting the rows imply
a precision they do not have.

**Compaction.** A `type: "system", subtype: "compact_boundary"` line carries
`compactMetadata` with `preTokens`, `postTokens` and the trigger. This matters
because everything logged before that boundary was thrown out of the window,
so summing the whole branch overstates it — badly, by 4x on the one local
session that has been compacted. `SessionMeta.compaction` exposes it, the
baseline becomes `postTokens` instead of the opening request, and only events
stamped after the boundary are attributed. Rare (1 of 45 sessions) but wrong
enough to be worth handling rather than flagging.

**Images.** Tool results carry base64 image blocks the parser already collapses
to an `[image]` placeholder. Seven characters cannot stand in for a screenshot,
so they are counted and priced at a flat rate, and the footnote says the rate
is flat. The log stores pixels, not the dimensions the price depends on, so
nothing better is available without decoding megabytes of base64.

**Grouping.** Tools with a `file_path` (Read, Write, Edit, MultiEdit, and the
notebook pair) group per file, so the same file read six times is one row with
a count. That count is the actionable finding: each read puts the same bytes
in the window again. Everything else groups by `toolCategory`, since one bash
call does not deserve a row.

### Flags

Shared, though not every command registers every one — commander scopes
options per command, and a command only takes a flag it actually reads:

| Flag | Behavior | On |
|---|---|---|
| `--json` | machine-readable output | all |
| `--no-color` | strip styling (also triggered by `NO_COLOR` env and pipe detection) | all |
| `--ascii` | glyphs `●◆⚡✎└` → `* > $ + \_` (CI logs, exotic terminals) | all but `sessions` |
| `--project <path>` | scope to one project (default: all) | all but `statusline` |
| `--since <date>` / `--until <date>` | time window for metrics | dashboard, `sessions` |

`--ascii` goes on every command that prints a glyph, which is every one but
`sessions` — the only report already inside ascii. That includes `doctor`,
whose sole glyph is the `·` that separates its header and verdict fields. A
flag that swaps glyphs has to swap all of them or it is not worth having.

`sessions` only: `--limit <n>` (default 20, 0 shows all), `--model <text>`,
`--grep <text>`.

`context` only: `--window <tokens>`, for when the inferred window size is
wrong. `context` takes an optional `[id]` argument, an unambiguous session
id prefix, defaulting to the newest session.

Dashboard (bare `ccvitals`) only: `--span week|month|year`, a single ladder
where each rung keeps what the one below showed. `week` (the default) is
today and this week; `month` widens both rows to this week and this month;
`year` keeps those and renders an activity heatmap of daily cost above them
— a contribution graph capped at a rolling year, week columns and weekday
rows, magnitude on the glyph ramp so it survives `NO_COLOR` and hue naming
the model that spent the most that day, with a most-active/longest/current
streak strip and two legends beneath. `--json` adds an `activity` object and
a `byDay` series carrying each day's top `model`.

The grid fits itself to the terminal. Every week column is at least 2 wide
and at most 3, so cells always stand apart rather than fusing into a solid
strip, plus 9 columns of gutter, frame and padding. A full 53 week year
therefore needs 115 columns; narrower drops the oldest weeks from the left
rather than closing the gaps or wrapping, and the caption says how many weeks
survived.

Cells are held apart on **both** axes, and how depends on whether color is
going to reach the reader:

- **Squares** (color on, unicode glyphs). Every day is a block filling the
  bottom three quarters of its cell, and the empty strip above it *is* the
  vertical gap — so the grid is seven lines with no spacers, the way a
  contribution graph looks. Three quarters rather than a half because a
  terminal cell is about twice as tall as it is wide: at a half the vertical
  gap came out wider than the mark while the horizontal gap is a little over
  half a mark, and the lattice read loose. One blank column is the floor
  horizontally — at zero, two days of the same color merge into a stripe, so
  that is as close together as the grid goes. Level rides on brightness of
  the day's model hue, four steps of it (`hueShades`). Empty days stay visible
  in grey rather than dimming away, since the lattice is what makes it a
  calendar.

  The four steps come from **truecolor when the terminal announces it**
  (`COLORTERM`), and from the 16 color palette — dimmed, plain, bright,
  bright bold — when it does not. This is the one place ccvitals reaches past
  16 colors, and it earns it: the 16 color ramp has to spend its bottom step
  on `dim`, and the bottom step is where most days land, so a quiet day came
  out duller than the grey of a day with no spend at all. The 24 bit ramps
  hold their hue and climb in lightness, with the bottom step lit and
  saturated and the top still a color rather than a pastel.
- **Shades** (piped, `NO_COLOR`, or `--ascii`). The `·░▒▓█` ramp carries the
  level in the glyph, and a blank run of the frame goes between each pair of
  weekday rows — thirteen lines. Without that gap the ramp glyphs, which fill
  the whole character cell, fuse a run of consecutive days into one vertical
  bar.

The two modes are the same grid drawn with whatever the medium has. The
constraint that survives both: magnitude is never carried by color alone.

Under the grid: the stat strip, a blank line, then the two legends. The
legends use a **centered square**, not the grid's mark — a block sitting on
the floor of its cell lines up with the row above it in a grid but looks
dropped beside a word, and a legend is a line of text. The model legend takes
the third ramp step rather than the fourth: the top of a ramp is its lightest
point, which is right for a busy day in a grid and washed out for a word.

The words in that strip — `most active`, `longest`, `current`, `less`,
`more` — are plain, not dim. Dim is for chrome that places the grid (the
month and weekday axis labels); these name the numbers beside them and have
to read at full contrast.

### Dashboard layout

Four blocks, in the order the questions get asked:

1. **Masthead** — the name, then four tiles: total spend, sessions, messages,
   cache hit. The label reads first and plain, so it takes the terminal's own
   foreground instead of a grey that fights the theme; the number sits under
   it in bold. Both are padded to one width so the pair reads as a column.
   Only the cache share takes a hue, the same `cachePaint` thresholds the
   statusline uses, so a bad cache share reads red on both surfaces. No rule
   under the name: a line that long is the widest thing on screen and reads as
   a divider between halves of a report rather than as a heading for the block
   under it. The blank line does that job.
2. **Heatmap**, on `--span year` only.
3. **Spend rows** — period, cost, input, output, cached. No hue: a period is
   not one of the four things the color scheme names.
4. **Breakdown tables** — project, model, tool. Each is a heading in the hue
   of the thing it lists, a dim rule as wide as the widest row, then the rows.
   A **share** column closes every table: a 10 cell gauge of that row's slice
   of the total, plus the percentage, so a table can be read as a shape before
   any of its numbers are.

Within a table, color marks the row's **name** and its **share bar** only,
never the raw numbers between them. Model rows take the hue the heatmap legend
assigned that model, and tool rows take the hue the tool wears in `context`,
so a color always means the same thing across commands.

**Flag surface (audited 2026-08-01):** 11 distinct flags over 4 commands plus
the bare dashboard. Six are shared (`--json`, `--no-color`, `--ascii`,
`--project`, `--since`, `--until`); the other five belong to one command each
— three on `sessions`, `--window` on `context`, `--span` on the dashboard.
`view` and its five flags (`--full`, `--costs`, `--follow`, `--compact`,
`--export`) were cut with the transcript viewer. Earlier, `--year` and
`--month` became `--span`.

### UX rules

- `-h` output fits one screen. No pager, no walls.
- Unknown model in logs → tokens shown, cost column reads `?`, one dim
  footnote pointing at `doctor`. Never a crash, never a zero passed off as
  a real cost.
- Exit codes: 0 ok, 1 bad input (an unparseable date, a `--limit` that is not
  a count, an unknown option), 2 nothing to work with (no sessions found, no
  session matching an id). Verified across every command 2026-08-01.
- Session IDs accept unambiguous prefixes (`context 3ab5`).

### README images (2026-08-01)

`npm run record` renders every image in the README, and
`npm run record context` renders one. Needs `brew install vhs`. The tapes are
checked in at `docs/tapes/*.tape`, so an image can be rebuilt when the output
it shows changes, rather than quietly going stale.

**Nothing is recorded against `~/.claude/projects`.** A README image built
from real logs puts real project names, real file paths and real prompts on a
public page. Scrubbed fixtures do not work either: every string in them is a
placeholder, so the screenshots would read as nonsense. So
`scripts/demo-sessions.mjs` invents a set of sessions in the real log shape —
four projects, a year of activity for the contribution graph, and one hand
written session about a double applied discount code that the `context` image
is taken from.

ccvitals finds them through `CCVITALS_ROOT`, the one env var it reads. That is an
escape hatch and not configuration: there is nothing to set for normal use and
no file anywhere remembers it. `scripts/record.sh` puts a shim named `ccvitals`
on PATH that pins the variable, so a tape typing `ccvitals context` cannot reach
real logs even if it is run by hand.

**The hero gif is the exception to all of the above.** A recording of a real
Claude Code session running beside the statusline cannot be a tape, because
VHS types into a scripted shell and cannot drive Claude. So it is a manual
screen recording (`Cmd+Shift+5`, or Kap), converted by `scripts/togif.sh`. It
will not re-render when output changes and will drift eventually, which is the
price of the one asset that actually sells the tool. Record it in a throwaway
repo: whatever is on screen ends up on a public page.

`togif.sh` speeds the recording up and encodes it in two passes. The palette
pass is not optional — a gif holds 256 colors, and ffmpeg's default pick bands
a terminal into mush. `stats_mode=diff` and `diff_mode=rectangle` exploit the
fact that a screen recording is mostly a still image with a small part moving,
which roughly halves the file on terminal footage. Dithering is `bayer` rather
than the prettier `sierra2_4a`, which scatters noise across flat terminal
backgrounds and wrecks the compression.

## 6. Explicitly out of scope (v1)

Model rerouting (cut permanently — see CLAUDE.md), the transcript viewer,
LLM calls of any kind, config files, daemons/alerts, non-Claude-Code log
formats, TUI, HTML/markdown export.
