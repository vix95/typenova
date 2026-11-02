/** Pure helpers for the math and Mermaid editors: finding the formula or diagram around the caret and building the Markdown to write back. */

export interface FormulaMatch { from: number; to: number; latex: string; display: boolean }
export interface MermaidMatch { from: number; to: number; source: string }

const overlaps = (start: number, end: number, from: number, to: number) => from >= start && to <= end;

/**
 * The `$$…$$` block or `$…$` inline formula that contains the selection (or caret), or null. Display formulas are
 * looked up first so the dollars of `$$` are never taken for two empty inline formulas.
 */
export function findFormulaAt(text: string, from: number, to: number): FormulaMatch | null {
  const display = /\$\$([\s\S]*?)\$\$/g;
  const blocks: Array<[number, number]> = [];
  for (let match = display.exec(text); match; match = display.exec(text)) {
    const start = match.index, end = start + match[0].length;
    blocks.push([start, end]);
    if (overlaps(start, end, from, to)) return { from: start, to: end, latex: match[1].trim(), display: true };
  }
  const inline = /(?<![\\$])\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g;
  for (let match = inline.exec(text); match; match = inline.exec(text)) {
    const start = match.index, end = start + match[0].length;
    if (blocks.some(([a, b]) => start >= a && end <= b)) continue;
    if (overlaps(start, end, from, to)) return { from: start, to: end, latex: match[1].trim(), display: false };
  }
  return null;
}

/** The fenced ```mermaid block that contains the position, or null. */
export function findMermaidBlockAt(text: string, position: number): MermaidMatch | null {
  const fence = /^(```|~~~)[ \t]*mermaid[^\n]*\n([\s\S]*?)\n?\1[ \t]*$/gm;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const start = match.index, end = start + match[0].length;
    if (position >= start && position <= end) return { from: start, to: end, source: match[2] };
  }
  return null;
}

/**
 * MathLive writes colours and boxes as `\colorbox{…}{\textcolor{…}{$ x $}}`, with `$` for math inside text. The `$$…$$`
 * and `$…$` parsers of the preview stop at such a dollar and leave the whole formula as plain text, so the inner
 * dollars are written as `\( … \)`, which KaTeX reads the same way.
 */
export function latexForMarkdown(latex: string): string {
  let open = true;
  return latex.replace(/(?<!\\)\$/g, () => { const mark = open ? "\\(" : "\\)"; open = !open; return mark; });
}

/** The reverse, so a formula written by {@link latexForMarkdown} opens in the editor the way MathLive expects it. */
export function latexFromMarkdown(latex: string): string {
  return latex.replace(/\\[()]/g, "$");
}

export function formulaMarkdown(latex: string, display: boolean): string {
  const clean = latexForMarkdown(latex.trim());
  return display ? `$$\n${clean}\n$$` : `$${clean}$`;
}

export function mermaidMarkdown(source: string): string {
  return "```mermaid\n" + source.replace(/\s+$/, "") + "\n```";
}

const FLOWCHART_WORDS = new Set(["flowchart", "graph", "subgraph", "end", "classdef", "class", "style", "linkstyle", "click", "direction", "td", "tb", "lr", "rl", "bt"]);

/** Names of the nodes used in a flowchart's source, in order of first appearance. */
export function flowchartNodeIds(source: string): string[] {
  const ids: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) continue;
    const first = line.split(/\s+/, 1)[0].toLowerCase();
    if (FLOWCHART_WORDS.has(first) && first !== "class") continue;
    // Texts in quotes and in nested brackets such as ((x)), [(x)] or ([x]) are removed from the inside out.
    let stripped = line.replace(/"[^"]*"/g, " ").replace(/\|[^|]*\|/g, " ");
    for (let previous = ""; previous !== stripped;) {
      previous = stripped;
      stripped = stripped.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, " ");
    }
    for (const token of stripped.split(/-->|---|==>|-\.->|-\.-|~~~|--[ox>]|&|;/)) {
      const id = token.trim();
      if (/^[A-Za-z_]\w*$/.test(id) && !FLOWCHART_WORDS.has(id.toLowerCase()) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** The kind of a Mermaid diagram from its first line: "flowchart", "sequence", "class", "state", "er", "gantt", "pie", "mindmap", ... or "other". */
export function mermaidKind(source: string): string {
  const first = (source.split("\n").find(line => line.trim() && !line.trim().startsWith("%%")) || "").trim().toLowerCase();
  if (/^(flowchart|graph)\b/.test(first)) return "flowchart";
  if (/^sequencediagram\b/.test(first)) return "sequence";
  if (/^classdiagram\b/.test(first)) return "class";
  if (/^statediagram/.test(first)) return "state";
  if (/^erdiagram\b/.test(first)) return "er";
  if (/^gantt\b/.test(first)) return "gantt";
  if (/^pie\b/.test(first)) return "pie";
  if (/^mindmap\b/.test(first)) return "mindmap";
  if (/^journey\b/.test(first)) return "journey";
  if (/^gitgraph\b/.test(first)) return "gitgraph";
  if (/^timeline\b/.test(first)) return "timeline";
  return "other";
}
