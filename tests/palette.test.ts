import { describe, expect, it } from "vitest";
import {
  assignModelPaints,
  assignModelShades,
  modelPaint,
  roles,
  toolPaint,
  userPaint,
} from "../src/render/palette.js";
import { makeStyle } from "../src/render/style.js";

// Color on, so the tests can see which hue landed where. Every other
// render test runs with it off, which covers the piped case.
const c = makeStyle(true);
const plain = makeStyle(false);

// picocolors wraps text in the escape for its hue, so the code in the
// output is what names the color.
function hueOf(paint: (text: string) => string): string {
  const match = /\[(\d+)m/.exec(paint("x"));
  return match?.[1] ?? "none";
}

const RED = "31";
const GREEN = "32";
const YELLOW = "33";
const BLUE = "34";
const MAGENTA = "35";
const CYAN = "36";

describe("roles", () => {
  it("reserves red for failure and yellow for attention", () => {
    const r = roles(c);
    expect(hueOf(r.danger)).toBe(RED);
    expect(hueOf(r.warn)).toBe(YELLOW);
  });

  it("gives each counted thing its own hue", () => {
    const r = roles(c);
    const hues = [r.project, r.session, r.model, r.tool].map(hueOf);
    expect(hues).toEqual([CYAN, BLUE, MAGENTA, GREEN]);
  });

  it("keeps the reserved two out of the counted hues", () => {
    const r = roles(c);
    for (const paint of [r.project, r.session, r.model, r.tool]) {
      expect([RED, YELLOW]).not.toContain(hueOf(paint));
    }
  });
});

describe("modelPaint", () => {
  it("gives a family the same hue whatever the version", () => {
    expect(hueOf(modelPaint(c, "opus-4-8"))).toBe(
      hueOf(modelPaint(c, "claude-opus-5")),
    );
    expect(hueOf(modelPaint(c, "opus-4-8"))).toBe(MAGENTA);
    expect(hueOf(modelPaint(c, "sonnet-5"))).toBe(BLUE);
    expect(hueOf(modelPaint(c, "haiku-4-5"))).toBe(GREEN);
    expect(hueOf(modelPaint(c, "fable-5"))).toBe(CYAN);
  });

  it("leaves a family it does not know alone", () => {
    expect(modelPaint(c, "some-new-model")("x")).toBe("x");
  });
});

describe("assignModelPaints", () => {
  it("hands the family hue to the biggest spender", () => {
    const paints = assignModelPaints(c, ["opus-4-8", "fable-5"]);
    expect(hueOf(paints.get("opus-4-8")!)).toBe(MAGENTA);
    expect(hueOf(paints.get("fable-5")!)).toBe(CYAN);
  });

  it("keeps two of one family apart", () => {
    const paints = assignModelPaints(c, ["opus-4-8", "opus-5"]);
    // The bigger spender keeps magenta, the other takes a free hue.
    expect(hueOf(paints.get("opus-4-8")!)).toBe(MAGENTA);
    expect(hueOf(paints.get("opus-5")!)).not.toBe(MAGENTA);
  });

  it("never repeats a hue while one is still free", () => {
    const models = ["opus-5", "opus-4-8", "opus-4-5", "opus-4-1"];
    const paints = assignModelPaints(c, models);
    const hues = models.map((m) => hueOf(paints.get(m)!));
    expect(new Set(hues).size).toBe(4);
  });

  it("starts the cycle over rather than leaving a model uncolored", () => {
    const models = ["opus-5", "sonnet-5", "haiku-4-5", "fable-5", "opus-4-8"];
    const paints = assignModelPaints(c, models);
    for (const model of models) {
      expect(paints.get(model)).toBeDefined();
      expect(hueOf(paints.get(model)!)).not.toBe("none");
    }
  });

  it("paints nothing when color is off", () => {
    const paints = assignModelPaints(plain, ["opus-5", "fable-5"]);
    expect(paints.get("opus-5")!("x")).toBe("x");
  });
});

describe("assignModelShades", () => {
  it("gives each model four rising steps of its own hue", () => {
    const shades = assignModelShades(c, ["opus-5", "fable-5"]);
    const opus = shades.get("opus-5")!;
    expect(opus).toHaveLength(4);
    // The middle two steps are the plain and bright forms of the hue
    // the model already had everywhere else.
    expect(hueOf(opus[1]!)).toBe(MAGENTA);
    expect(opus[2]!("x")).toContain("[95m");
    // The ends are that same hue dimmed and bolded, so the four steps
    // read as one color getting stronger rather than four colors.
    expect(opus[0]!("x")).toContain("[2m");
    expect(opus[3]!("x")).toContain("[1m");
    // Every step is distinct, which is the whole point of a ramp.
    expect(new Set(opus.map((paint) => paint("x"))).size).toBe(4);
    // A second model still gets a different hue.
    expect(hueOf(shades.get("fable-5")![1]!)).toBe(CYAN);
  });

  it("collapses to plain text when color is off", () => {
    const shades = assignModelShades(plain, ["opus-5"]);
    for (const paint of shades.get("opus-5")!) expect(paint("x")).toBe("x");
    // Truecolor never overrides the decision not to color at all.
    const vivid = assignModelShades(plain, ["opus-5"], true);
    for (const paint of vivid.get("opus-5")!) expect(paint("x")).toBe("x");
  });

  // The channels of a 24 bit paint, or nothing if it is not one.
  function channels(paint: (text: string) => string): [number, number, number] {
    const match = /\[38;2;(\d+);(\d+);(\d+)m/.exec(paint("x"));
    expect(match).not.toBeNull();
    const [r, g, b] = [1, 2, 3].map((i) => Number(match?.[i] ?? 0));
    return [r ?? 0, g ?? 0, b ?? 0];
  }

  const luma = ([r, g, b]: [number, number, number]): number =>
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  it("climbs in brightness on a truecolor terminal", () => {
    for (const model of ["opus-5", "sonnet-5", "haiku-4-5", "fable-5"]) {
      const ramp = assignModelShades(c, [model], true).get(model)!;
      const steps = ramp.map(channels);
      // Real 24 bit steps, each brighter than the one below it.
      expect(steps.map(luma)).toEqual([...steps.map(luma)].sort((a, b) => a - b));
      const bottom = steps[0]!;
      // The quietest step is a lit, saturated color rather than a dark
      // one: a day with spend must never read as quieter than the grey
      // of a day without.
      expect(Math.max(...bottom)).toBeGreaterThanOrEqual(180);
      expect(Math.max(...bottom) - Math.min(...bottom)).toBeGreaterThanOrEqual(90);
      // The busiest step stays a color rather than washing out to white.
      expect(luma(steps[3]!)).toBeLessThan(0.95);
      expect(Math.max(...steps[3]!) - Math.min(...steps[3]!)).toBeGreaterThan(40);
    }
  });
});

describe("toolPaint", () => {
  it("marks the three common tools apart", () => {
    const hues = ["bash", "edit", "read"].map((k) => hueOf(toolPaint(c, k)));
    expect(new Set(hues).size).toBe(3);
  });

  it("keeps red and yellow out of the transcript glyphs", () => {
    for (const kind of ["bash", "edit", "read", "web", "mcp", "agents", "other"]) {
      expect([RED, YELLOW]).not.toContain(hueOf(toolPaint(c, kind)));
    }
  });

  it("leaves cyan to the user anchor", () => {
    for (const kind of ["bash", "edit", "read", "web", "mcp", "agents", "other"]) {
      expect(hueOf(toolPaint(c, kind))).not.toBe(CYAN);
    }
    expect(userPaint(c)("you")).toContain("[36m");
  });
});
