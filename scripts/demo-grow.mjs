#!/usr/bin/env node
// Writes a demo session slowly, one turn at a time, so the follow gif
// has something that is actually growing to follow. Without this the
// gif would show a static transcript and prove nothing.
//
// Run it in the background, then run ccplus view --follow against the
// same root. It writes into its own new session file, which is the
// newest in the root, so follow with no id lands on it.
//
//   node scripts/demo-grow.mjs [root] [secondsBetweenTurns]

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { bash, edit, read } from "./demo-sessions.mjs";

const ROOT = process.argv[2] ?? join(process.cwd(), ".demo", "projects");
const GAP = Number(process.argv[3] ?? 2.4) * 1000;

const CWD = "/Users/you/code/checkout-api";
const SLUG = "-Users-you-code-checkout-api";
const MODEL = "claude-opus-5";
const SESSION = randomUUID();

const TURNS = [
  {
    prompt: "the retry banner shows up even when the request succeeded",
    say: "Checking how the banner decides it should be visible.",
    calls: [read(`${CWD}/src/ui/RetryBanner.tsx`, 90)],
  },
  {
    prompt: "yeah that looks off",
    say: "`shouldShow` reads the last attempt rather than the final outcome, so a success after a retry still leaves it true.",
    calls: [bash("npm test -- retry", "Run the retry tests", "FAIL src/ui/__tests__/RetryBanner.test.tsx\n  ● hides after a successful retry\n\n  1 failed, 12 passed")],
  },
  {
    prompt: "fix it",
    say: "Switching it to the outcome and covering the case.",
    calls: [
      edit(`${CWD}/src/ui/RetryBanner.tsx`, 1200),
      edit(`${CWD}/src/ui/__tests__/RetryBanner.test.tsx`, 900),
    ],
  },
  {
    prompt: "run the whole suite",
    say: "All green.",
    calls: [bash("npm test", "Run the full test suite", "PASS  142 passed, 142 total\n\nTest Suites: 24 passed, 24 total\nTime: 11.4s")],
  },
];

let parent = null;
let context = 27_400;
let clock = new Date();
const file = join(ROOT, SLUG, `${SESSION}.jsonl`);

function line(body) {
  const uuid = randomUUID();
  const record = {
    ...body,
    uuid,
    parentUuid: parent,
    sessionId: SESSION,
    cwd: CWD,
    version: "2.1.0",
    isSidechain: false,
    timestamp: clock.toISOString(),
  };
  parent = uuid;
  return `${JSON.stringify(record)}\n`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await mkdir(join(ROOT, SLUG), { recursive: true });
  await writeFile(file, "");

  for (const turn of TURNS) {
    clock = new Date();
    await appendFile(file, line({ type: "user", message: { role: "user", content: turn.prompt } }));
    // A beat between the prompt landing and the reply, so the gif
    // reads as a conversation rather than a dump.
    await sleep(GAP / 2);

    const content = [{ type: "text", text: turn.say }];
    for (const call of turn.calls) {
      content.push({ type: "tool_use", id: call.id, name: call.tool, input: call.input });
    }
    const previous = context;
    context += 2600 + turn.calls.length * 900;
    clock = new Date();
    await appendFile(
      file,
      line({
        type: "assistant",
        message: {
          id: `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          role: "assistant",
          model: MODEL,
          content,
          usage: {
            input_tokens: 2,
            output_tokens: 520,
            cache_read_input_tokens: previous,
            cache_creation_input_tokens: context - previous,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: context - previous,
            },
          },
        },
      }),
    );

    for (const call of turn.calls) {
      clock = new Date();
      await appendFile(
        file,
        line({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: call.id, content: call.result, is_error: false },
            ],
          },
        }),
      );
    }
    // The branch tip moves with every turn, which is what follow
    // watches for.
    await appendFile(file, `${JSON.stringify({ type: "last-prompt", leafUuid: parent, sessionId: SESSION, timestamp: clock.toISOString() })}\n`);
    await sleep(GAP);
  }
}

await main();
