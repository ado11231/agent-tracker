import type { ToolCategory } from "../cost/tools.js";

// The transcript's structural marks. Every mark has an ascii twin so
// --ascii can swap the whole set at once, and the two sets share one
// shape so a mark can never exist in only one of them.

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
  // Box drawing pieces for the heatmap border: horizontal, vertical,
  // and the four corners.
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
  box: { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" },
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
