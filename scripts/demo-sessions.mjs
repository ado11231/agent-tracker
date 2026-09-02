#!/usr/bin/env node
// Builds a set of invented session logs for the README images.
//
// The images cannot be recorded against ~/.claude/projects: they would
// put real project names, real file paths and real prompts on a public
// page. Scrubbed fixtures cannot be used either, since every string in
// them is a placeholder and the screenshots would read as nonsense.
// So the demo data is written from scratch here, in the same shape the
// real logs use, and AgentTracker reads it through its demo roots.
//
// Everything below is invented. Any resemblance to a real session is
// the point, and a coincidence.
//
//   node scripts/demo-sessions.mjs [outDir]
//
// Defaults to .demo/projects, which is gitignored.

import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const OUT = process.argv[2] ?? join(process.cwd(), ".demo", "projects");
const CODEX_OUT = join(OUT, "..", "codex");

// Relative to the real clock, not a fixed date: the dashboard reads
// the system clock for its today and this week rows, so demo data
// pinned to a past date would render as an empty week. The cost of
// that is that two renders months apart are not identical, which
// matters less than a hero image that looks abandoned.
//
// One wrinkle worth knowing when re-recording: in the first days of a
// calendar month the "this month" row is genuinely smaller than "this
// week", which is correct and still reads oddly in a screenshot.
// Mid month is the better time to shoot it.
const TODAY = new Date();

export const MODELS = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

function iso(date) {
  return date.toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

// Deterministic noise, so the dashboard looks lived in without the
// images changing every time they are rendered.
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Builds the lines of one session. Tool calls come in as a small
// script so each demo session can tell a different story.
export function buildSession({ sessionId, cwd, model, start, turns, random }) {
  const lines = [];
  let parent = null;
  let clock = start;

  const push = (line) => {
    const uuid = randomUUID();
    lines.push({ ...line, uuid, parentUuid: parent, sessionId, cwd, version: "2.1.0", isSidechain: false, timestamp: iso(clock) });
    parent = uuid;
    return uuid;
  };

  // Context grows the way a real one does: a big fixed prefix for the
  // system prompt and tools, then whatever the turn added.
  let context = 24_000 + Math.floor(random() * 6000);

  for (const turn of turns) {
    clock = addMinutes(clock, 1 + Math.floor(random() * 4));
    push({ type: "user", message: { role: "user", content: turn.prompt } });

    const messageId = `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const content = [];
    if (turn.thinking) {
      // Real logs keep the block and strip the text, so the demo does
      // the same rather than inventing thinking that never existed.
      content.push({ type: "thinking", thinking: "", signature: "demo" });
    }
    if (turn.say) content.push({ type: "text", text: turn.say });

    const calls = turn.calls ?? [];
    for (const call of calls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.tool,
        input: call.input,
      });
    }

    // An abandoned attempt: it hangs off the same parent as the real
    // reply, and nothing is ever chained onto it, so the walk from
    // leafUuid never reaches it. That is exactly the shape a retry or
    // an interrupted answer leaves in a real log, and it is what the
    // wasted figure is counting.
    if (turn.abandoned) {
      const fork = parent;
      clock = addMinutes(clock, 1);
      push({
        type: "assistant",
        message: {
          id: `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          role: "assistant",
          model,
          content: [{ type: "text", text: turn.abandoned.say }],
          usage: {
            input_tokens: 2,
            output_tokens: turn.abandoned.output,
            cache_read_input_tokens: context,
            cache_creation_input_tokens: turn.abandoned.tokens,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: turn.abandoned.tokens,
            },
          },
        },
      });
      parent = fork;
    }

    const added = turn.tokens ?? 1500 + Math.floor(random() * 4000);
    const previous = context;
    context += added;
    clock = addMinutes(clock, 1);
    push({
      type: "assistant",
      message: {
        id: messageId,
        role: "assistant",
        model,
        content,
        usage: {
          input_tokens: 2,
          output_tokens: turn.output ?? 400 + Math.floor(random() * 900),
          cache_read_input_tokens: previous,
          cache_creation_input_tokens: context - previous,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            ephemeral_1h_input_tokens: context - previous,
          },
        },
      },
    });

    for (const call of calls) {
      clock = addMinutes(clock, 1);
      push({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: call.id,
              content: call.result,
              is_error: call.failed === true,
            },
          ],
        },
      });
    }
  }

  // The last prompt line names the branch tip, which is how the parser
  // knows which fork is the live one.
  lines.push({ type: "last-prompt", leafUuid: parent, sessionId, timestamp: iso(clock) });
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

let counter = 0;
export function callId() {
  counter += 1;
  return `toolu_demo${String(counter).padStart(4, "0")}`;
}

export function read(path, lines) {
  return {
    id: callId(),
    tool: "Read",
    input: { file_path: path },
    result: Array.from({ length: lines }, (_, i) => `${i + 1}→  // ${path.split("/").pop()} line ${i + 1}`).join("\n"),
  };
}

export function bash(command, description, output) {
  return {
    id: callId(),
    tool: "Bash",
    input: { command, description },
    result: output,
  };
}

export function edit(path, size) {
  return {
    id: callId(),
    tool: "Edit",
    input: {
      file_path: path,
      old_string: "x".repeat(Math.floor(size / 2)),
      new_string: "y".repeat(size),
      replace_all: false,
    },
    result: `The file ${path} has been updated.`,
  };
}

// The four projects the README talks about. api-gateway is the
// expensive one, which is what makes the dashboard worth looking at.
const PROJECTS = [
  { name: "checkout-api", slug: "-Users-you-code-checkout-api", cwd: "/Users/you/code/checkout-api", weight: 3.4 },
  { name: "landing-page", slug: "-Users-you-code-landing-page", cwd: "/Users/you/code/landing-page", weight: 1.6 },
  { name: "dotfiles", slug: "-Users-you-code-dotfiles", cwd: "/Users/you/code/dotfiles", weight: 0.7 },
  { name: "ccvitals", slug: "-Users-you-code-ccvitals", cwd: "/Users/you/code/ccvitals", weight: 2.1 },
];

// The session the context and view images are taken from. Written by
// hand rather than generated, because these two images are the ones
// people actually read, and the story has to make sense.
function featureSession(project) {
  const start = new Date("2026-08-01T16:12:00Z");
  return buildSession({
    sessionId: "8b8c2bdf-1f00-4a8c-a0c1-dfa7fd1586a2",
    cwd: project.cwd,
    model: MODELS.opus,
    start,
    random: makeRandom(7),
    turns: [
      {
        prompt: "the checkout total is wrong when a discount code is applied twice. find it",
        say: "Let me look at how discounts are applied before I guess at the cause.",
        calls: [
          read(`${project.cwd}/src/pricing/discount.ts`, 180),
          read(`${project.cwd}/src/pricing/total.ts`, 140),
        ],
        tokens: 3600,
      },
      {
        prompt: "keep going",
        say: "`applyDiscount` mutates the running total instead of returning a new one, so a second call compounds against the already discounted figure.",
        calls: [
          bash("npm test -- pricing", "Run the pricing tests", "FAIL src/pricing/__tests__/total.test.ts\n  ● applies a discount code once\n\n    expected 4000, received 3600\n\n  1 failed, 18 passed"),
          read(`${project.cwd}/src/pricing/discount.ts`, 180),
        ],
        tokens: 4400,
      },
      {
        prompt: "fix it and add a test for the double apply case",
        // Interrupted and retried, which is where the wasted figure on
        // the statusline comes from.
        abandoned: {
          say: "I'll guard against a second call by tracking which codes have already been applied on the cart.",
          tokens: 5200,
          output: 1400,
        },
        say: "Making `applyDiscount` pure, then covering the repeat case.",
        calls: [
          edit(`${project.cwd}/src/pricing/discount.ts`, 2400),
          edit(`${project.cwd}/src/pricing/__tests__/total.test.ts`, 1800),
          bash("npm test -- pricing", "Re-run the pricing tests", "PASS src/pricing/__tests__/total.test.ts\n\n  20 passed, 20 total"),
        ],
        tokens: 5600,
      },
      {
        prompt: "does anything else call applyDiscount?",
        say: "Two callers, both in the cart flow. Neither relies on the old mutating behaviour.",
        calls: [
          bash("rg -n 'applyDiscount' src/", "Search for callers of applyDiscount", "src/cart/summary.ts:14:  const total = applyDiscount(subtotal, code);\nsrc/checkout/review.ts:52:  const due = applyDiscount(cart.subtotal, cart.code);"),
          read(`${project.cwd}/src/cart/summary.ts`, 90),
          read(`${project.cwd}/src/checkout/review.ts`, 120),
          read(`${project.cwd}/src/pricing/discount.ts`, 180),
        ],
        tokens: 6400,
      },
      {
        prompt: "good. write it up in the changelog",
        say: "Added under Unreleased, with the failing case spelled out.",
        calls: [edit(`${project.cwd}/CHANGELOG.md`, 900)],
        tokens: 2600,
      },
    ],
  });
}

// Filler sessions across the past year, so the contribution graph has
// something to show. Cheap and short, since none of them are read.
function fillerSessions(project, random) {
  const out = [];
  const days = 330;
  for (let back = 0; back < days; back += 1) {
    // Quiet weekends and a slow start to the year, which is what makes
    // a contribution graph look like a real one rather than static.
    const day = new Date(TODAY);
    day.setDate(day.getDate() - back);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const recency = 1 - back / days;
    const chance = project.weight * 0.12 * (weekend ? 0.25 : 1) * (0.35 + recency);
    if (random() > chance) continue;

    const start = new Date(day);
    start.setUTCHours(9 + Math.floor(random() * 9), Math.floor(random() * 60), 0, 0);
    const turnCount = 1 + Math.floor(random() * 5);
    const model = random() > 0.75 ? MODELS.sonnet : random() > 0.95 ? MODELS.haiku : MODELS.opus;
    const turns = Array.from({ length: turnCount }, (_, i) => ({
      prompt: `demo prompt ${i + 1}`,
      say: "demo reply",
      thinking: random() > 0.5,
      calls: random() > 0.4 ? [bash("npm test", "Run the tests", "ok")] : [],
      tokens: 2000 + Math.floor(random() * 9000),
      output: 300 + Math.floor(random() * 1500),
    }));
    out.push({
      sessionId: randomUUID(),
      content: buildSession({
        sessionId: randomUUID(),
        cwd: project.cwd,
        model,
        start,
        random,
        turns,
      }),
      mtime: start,
    });
  }
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await rm(CODEX_OUT, { recursive: true, force: true });

  let files = 0;
  let featurePath;
  for (const project of PROJECTS) {
    const dir = join(OUT, project.slug);
    await mkdir(dir, { recursive: true });
    const random = makeRandom(project.name.length * 977 + 13);

    if (project.name === "checkout-api") {
      const content = featureSession(project);
      featurePath = join(dir, "8b8c2bdf-1f00-4a8c-a0c1-dfa7fd1586a2.jsonl");
      await writeFile(featurePath, content);
      files += 1;
    }

    for (const session of fillerSessions(project, random)) {
      await writeFile(join(dir, `${session.sessionId}.jsonl`), session.content);
      files += 1;
    }
  }

  // ccvitals resolves "the latest session" by file mtime, and the filler
  // is written after the feature session, so without this the context
  // and statusline images land on whichever throwaway session happened
  // to be written last. That is usually a one turn session with an
  // empty context window, which is the opposite of what those two
  // images exist to show.
  // A whole minute ahead, not a millisecond: every file here is written
  // inside the same second, and a tie is broken by directory order
  // rather than by anything we control.
  if (featurePath !== undefined) {
    const ahead = new Date(Date.now() + 60_000);
    await utimes(featurePath, ahead, ahead);
  }

  // A small, separate Codex rollout for the live-panel recording. It
  // follows Codex's cumulative token snapshots, so the real parser is
  // exercised instead of faking its rendered output.
  const codexDir = join(CODEX_OUT, "2026", "09", "02");
  const codexId = "4b4f32d1-a8e0-4c7d-b039-bcb13a46fd2d";
  const codexStart = new Date("2026-09-02T14:20:00Z");
  const codexLines = [
    { timestamp: iso(codexStart), type: "session_meta", payload: { session_id: codexId, cwd: "/Users/you/code/checkout-api", cli_version: "0.150.1", git: { branch: "main" } } },
    { timestamp: iso(addMinutes(codexStart, 1)), type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/Users/you/code/checkout-api" } },
    { timestamp: iso(addMinutes(codexStart, 2)), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Track down the checkout total rounding error." }] } },
    // Codex counts cached tokens inside input_tokens rather than
    // beside it, and states both the live window and the plan limit on
    // every snapshot. The demo follows that shape so the recording
    // exercises the real parser instead of a flattering fiction.
    { timestamp: iso(addMinutes(codexStart, 3)), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 70_400, cached_input_tokens: 52_000, cache_write_input_tokens: 0, output_tokens: 1_240 }, last_token_usage: { input_tokens: 70_400, cached_input_tokens: 52_000, cache_write_input_tokens: 0, output_tokens: 1_240 }, model_context_window: 272_000 }, rate_limits: { primary: { used_percent: 18, window_minutes: 43_200 }, secondary: null } } },
    { timestamp: iso(addMinutes(codexStart, 4)), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I found the rounding path and added coverage for it." }] } },
    { timestamp: iso(addMinutes(codexStart, 5)), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 164_900, cached_input_tokens: 138_400, cache_write_input_tokens: 0, output_tokens: 2_180 }, last_token_usage: { input_tokens: 94_500, cached_input_tokens: 86_400, cache_write_input_tokens: 0, output_tokens: 940 }, model_context_window: 272_000 }, rate_limits: { primary: { used_percent: 34, window_minutes: 43_200 }, secondary: null } } },
  ];
  await mkdir(codexDir, { recursive: true });
  const codexPath = join(codexDir, `rollout-2026-09-02T14-20-00-${codexId}.jsonl`);
  await writeFile(codexPath, `${codexLines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const codexAhead = new Date(Date.now() + 120_000);
  await utimes(codexPath, codexAhead, codexAhead);

  console.log(`wrote ${files} demo sessions to ${OUT}`);
  console.log(`wrote Codex demo session to ${CODEX_OUT}`);
  console.log("point AgentTracker at them with:");
  console.log(`  AGENTTRACKER_CLAUDE_ROOT=${OUT} AGENTTRACKER_CODEX_ROOT=${CODEX_OUT} node dist/main.js`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
