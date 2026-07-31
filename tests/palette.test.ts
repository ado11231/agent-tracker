import { describe, expect, it } from "vitest";
import {
  assignModelPaints,
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
