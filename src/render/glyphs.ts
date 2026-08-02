import type { ToolCategory } from "../cost/tools.js";

// Structural marks for reports and live panels. Every mark has an
// ascii twin so --ascii can swap the whole set at once, and the two
// sets share one shape so a mark can never exist in only one of them.

export interface GlyphSet {
  user: string;
  claude: string;
  thinking: string;
  // Joins a tool call line to the raw command below it.
  connector: string;
  // Horizontal rule at session boundaries.
  rule: string;
  // Separator between badge fields.
  dot: string;
  // Marks truncation, both inline and in collapse counts.
  ellipsis: string;
  // Leads a removed line count. A true minus, not a hyphen, so it
  // sits at the same width and height as the + beside it.
  minus: string;
  // Filled and empty cells of the context gauge.
  gaugeFull: string;
  gaugeEmpty: string;
  // Five rising intensities for the activity heatmap, index 0 the
  // quietest. The glyph carries the level on its own so the heatmap
  // reads with color stripped; green shading only reinforces it.
  heatRamp: [string, string, string, string, string];
  // One day of the heatmap when color is available to carry the level
  // instead. A block that fills the bottom three quarters of its cell
  // leaves the top quarter empty, and that empty strip is what
  // holds the weekday rows apart without spending a blank line between
  // them. Three quarters rather than a half because a terminal cell is
  // about twice as tall as it is wide: at a half the vertical gap came
  // out wider than the mark, while the horizontal gap is only a little
  // over half a mark. At three quarters the two gaps are about equal
  // and the lattice reads tight.
  heatSquare: string;
  // The same mark standing in a line of text, for the legends. A half
  // block sits on the floor of its cell, which lines up with the row
  // above it in the grid and looks dropped beside a word; a centered
  // square sits on the text's own middle.
  swatch: string;
  // Box drawing pieces for the heatmap frame: horizontal, vertical,
  // and the four corners. Heavy weight, since the frame is drawn
  // undimmed and has to hold its own against a grid of block glyphs.
  box: {
    h: string;
    v: string;
    tl: string;
    tr: string;
    bl: string;
    br: string;
  };
  tools: Record<ToolCategory, string>;
}

export const UNICODE_GLYPHS: GlyphSet = {
  user: "●",
  claude: "◆",
  thinking: "⋮",
  connector: "└",
  rule: "─",
  dot: "·",
  ellipsis: "…",
  minus: "−",
  gaugeFull: "▓",
  gaugeEmpty: "░",
  heatRamp: ["·", "░", "▒", "▓", "█"],
  heatSquare: "▆",
  swatch: "■",
  box: { h: "━", v: "┃", tl: "┏", tr: "┓", bl: "┗", br: "┛" },
  tools: {
    bash: "⚡",
    edit: "✎",
    read: "⌕",
    web: "⛁",
    agents: "◎",
    mcp: "⌘",
    other: "•",
    chat: "◆",
  },
};

export const ASCII_GLYPHS: GlyphSet = {
  user: "*",
  claude: ">",
  thinking: ":",
  connector: "\\_",
  rule: "-",
  dot: ".",
  ellipsis: "...",
  minus: "-",
  gaugeFull: "#",
  gaugeEmpty: "-",
  heatRamp: [".", ":", "+", "*", "#"],
  heatSquare: "#",
  swatch: "#",
  box: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
  tools: {
    bash: "$",
    edit: "+",
    read: "?",
    web: "@",
    agents: "&",
    mcp: "%",
    other: "-",
    chat: ">",
  },
};

export function glyphsFor(ascii: boolean): GlyphSet {
  return ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
}
