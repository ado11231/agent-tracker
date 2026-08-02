import type { Style } from "./style.js";

// The color code, in one place, so every command says the same thing
// with the same hue.
//
// Two rules hold on every surface, and nothing else may use these two
// colors:
//
//   red     it failed
//   yellow  it wants your attention
//
// The four remaining hues name the thing being counted, and only show
// up where that thing is the subject of the line:
//
//   cyan     a project
//   blue     a session
//   magenta  a model
//   green    a tool
//
// Green also marks a healthy gauge on the statusline, which is the one
// reuse in the scheme. The two never share a surface: gauges are live
// output and the tool hue is a report heading.
//
// Color is never the only thing saying it. Every hue here sits on a
// glyph, a column, or a heading that already carries the meaning, so
// the output reads the same with color stripped.

export type Paint = (text: string) => string;

const plain: Paint = (text) => text;

export interface RolePaints {
  // It failed.
  danger: Paint;
  // It wants your attention, but nothing is broken.
  warn: Paint;
  // It is fine.
  ok: Paint;
  // Headings and labels, by what the thing is.
  project: Paint;
  session: Paint;
  model: Paint;
  tool: Paint;
}

export function roles(c: Style): RolePaints {
  return {
    danger: c.red,
    warn: c.yellow,
    ok: c.green,
    project: c.cyan,
    session: c.blue,
    model: c.magenta,
    tool: c.green,
  };
}

// The hues a model may take, in the order a legend hands them out.
const HUES = ["magenta", "blue", "green", "cyan"] as const;
type Hue = (typeof HUES)[number];

// A model family always gets the same hue, so switching models is
// visible at a glance and a model looks the same on the statusline as
// it does in a heatmap legend. Opus takes magenta, the hue models get
// everywhere else in the scheme.
const FAMILY_HUES: [string, Hue][] = [
  ["opus", "magenta"],
  ["sonnet", "blue"],
  ["haiku", "green"],
  ["fable", "cyan"],
];

function familyHue(model: string): Hue | undefined {
  for (const [family, hue] of FAMILY_HUES) {
    if (model.includes(family)) return hue;
  }
  return undefined;
}

// One model on its own, which is the statusline case. A family we do
// not know stays plain rather than borrowing a hue that means
// something else.
export function modelPaint(c: Style, model: string): Paint {
  const hue = familyHue(model);
  return hue === undefined ? plain : c[hue];
}

// Several models shown together, which is the heatmap legend case.
// Two of one family, opus 4.8 beside opus 5, must not come out the
// same color, so the bigger spender keeps the family hue and the next
// one takes the first hue still free. Pass the models ranked, biggest
// spender first.
function assignHues(ranked: string[]): Map<string, Hue> {
  const hues = new Map<string, Hue>();
  const taken = new Set<Hue>();
  for (const model of ranked) {
    // More models than hues starts the cycle over rather than leaving
    // the rest of the legend uncolored.
    if (taken.size >= HUES.length) taken.clear();
    const wanted = familyHue(model);
    const hue =
      wanted !== undefined && !taken.has(wanted)
        ? wanted
        : (HUES.find((h) => !taken.has(h)) ?? HUES[0]);
    taken.add(hue);
    hues.set(model, hue);
  }
  return hues;
}

export function assignModelPaints(
  c: Style,
  ranked: string[],
): Map<string, Paint> {
  const paints = new Map<string, Paint>();
  for (const [model, hue] of assignHues(ranked)) paints.set(model, c[hue]);
  return paints;
}

// Four rising intensities of one hue, for a cell that has to say both
// which model and how much it spent.
export type Shades = [Paint, Paint, Paint, Paint];

// A 24 bit paint. Written by hand because picocolors is a 16 color
// library, and this is the one place in ccplus that wants more: a heat
// ramp built from dim, normal, bright and bold spends its lowest step
// on a washed out grey-ish tone, and the low step is the one most days
// land on.
function rgb(hex: string): Paint {
  const value = Number.parseInt(hex.slice(1), 16);
  const code = `\u001B[38;2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m`;
  return (text) => `${code}${text}\u001B[39m`;
}

// Each family climbs in lightness while holding its hue, so a cell is
// still read as "which model" first and "how much" second. Two rules
// set the ends. The bottom step has to sit clearly brighter than the
// grey an empty day takes, or a quiet day reads as quieter than nothing
// at all; the top stays saturated rather than washing out to pastel,
// since the busiest day is the one the grid exists to point at.
const VIVID: Record<Hue, [string, string, string, string]> = {
  magenta: ["#c235bd", "#dd4ad6", "#f065e8", "#ff85f2"],
  blue: ["#3f7dff", "#5e94ff", "#7fadff", "#a3c6ff"],
  green: ["#2fbf5c", "#45d873", "#5eee8b", "#86ffa8"],
  cyan: ["#26b8d1", "#35d4ec", "#55e8fa", "#8af3ff"],
};

// With truecolor announced the steps are real 24 bit colors. Without
// it they are the four the 16 color palette has — dimmed, normal,
// bright, bright bold — which is duller at the bottom but inherits the
// user's theme, so it holds up on any background.
export function hueShades(c: Style, hue: Hue, truecolor = false): Shades {
  if (truecolor && c.isColorSupported) {
    const [one, two, three, four] = VIVID[hue];
    return [rgb(one), rgb(two), rgb(three), rgb(four)];
  }
  const base = c[hue];
  const bright = c[`${hue}Bright`];
  return [
    (text) => c.dim(base(text)),
    base,
    bright,
    (text) => c.bold(bright(text)),
  ];
}

// The same hue assignment as assignModelPaints, handed back as intensity
// ramps. The heatmap draws one square per day and lets brightness carry
// the spend, so it needs the whole ramp rather than the single hue.
export function assignModelShades(
  c: Style,
  ranked: string[],
  truecolor = false,
): Map<string, Shades> {
  const shades = new Map<string, Shades>();
  for (const [model, hue] of assignHues(ranked)) {
    shades.set(model, hueShades(c, hue, truecolor));
  }
  return shades;
}

// Tool category hues for the context and dashboard reports. Green ran
// something, magenta changed a file, blue read one. The rest keep their
// glyph and take no hue — web, mcp and agent calls are rare enough that
// a shape is plenty. Nothing is yellow or red: those two stay reserved
// for failure and attention everywhere.
export function toolPaint(c: Style, category: string): Paint {
  switch (category) {
    case "bash":
      return c.green;
    case "edit":
      return c.magenta;
    case "read":
      return c.blue;
    default:
      return plain;
  }
}
