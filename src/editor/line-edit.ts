/** Pure helpers for editing Mermaid diagrams of any type line by line: which line a clicked label belongs to, and replace, move, duplicate or delete a line or block. */

export const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface LineMatch { indices: number[]; current: number; /** The part of the clicked text that was found in the code. */ found: string }

/** Lines whose code contains the clicked label (or what is left of it without a trailing `[8]`-style value); `occurrence` picks among several. */
export function matchLines(lines: readonly string[], clicked: string, occurrence = 0): LineMatch | null {
  const text = normalizeText(clicked);
  if (!text) return null;
  const candidates = [text, text.replace(/\s*[[(][^\])]*[\])]$/, "").trim(), text.split(" ")[0]].filter((item, position, all) => item.length > 1 && all.indexOf(item) === position);
  for (const found of candidates) {
    const indices: number[] = [];
    lines.forEach((line, index) => { if (!line.trim().startsWith("%%") && line.includes(found)) indices.push(index); });
    if (indices.length) return { indices, current: Math.min(Math.max(occurrence, 0), indices.length - 1), found };
  }
  return null;
}

/** Replaces the first occurrence of `from` in the line. */
export function replaceInLine(line: string, from: string, to: string): string {
  const at = line.indexOf(from);
  return at < 0 ? line : line.slice(0, at) + to + line.slice(at + from.length);
}

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const BLOCK_START = /^(loop|alt|opt|par|critical|break|rect|box|subgraph)\b/i;
const count = (text: string, char: string) => text.split(char).length - 1;

/** First and last line (inclusive) of the line at `index` together with what belongs to it: a `{ … }` body, an `end`-closed block, or the deeper-indented lines of a mind map. */
export function blockRange(lines: readonly string[], index: number, kind: string): [number, number] {
  const trimmed = (lines[index] ?? "").trim();
  if (kind === "mindmap" || kind === "timeline") {
    let end = index;
    while (end + 1 < lines.length && lines[end + 1].trim() && indentOf(lines[end + 1]) > indentOf(lines[index])) end++;
    return [index, end];
  }
  if (trimmed.endsWith("{")) {
    let depth = 0;
    for (let line = index; line < lines.length; line++) {
      depth += count(lines[line], "{") - count(lines[line], "}");
      if (depth <= 0) return [index, line];
    }
    return [index, lines.length - 1];
  }
  if (BLOCK_START.test(trimmed)) {
    let depth = 0;
    for (let line = index; line < lines.length; line++) {
      const text = lines[line].trim();
      if (BLOCK_START.test(text)) depth++; else if (/^end\b/i.test(text)) depth--;
      if (depth === 0) return [index, line];
    }
    return [index, lines.length - 1];
  }
  return [index, index];
}

export function deleteRange(lines: readonly string[], [from, to]: [number, number]): string[] {
  return [...lines.slice(0, from), ...lines.slice(to + 1)];
}

export function duplicateRange(lines: readonly string[], [from, to]: [number, number]): string[] {
  return [...lines.slice(0, to + 1), ...lines.slice(from, to + 1), ...lines.slice(to + 1)];
}

/** Moves a block up (-1) or down (1) past its neighbouring line; null when it cannot move. The result carries the block's new first line. */
export function moveRange(lines: readonly string[], range: [number, number], direction: -1 | 1): { lines: string[]; start: number } | null {
  const [from, to] = range;
  if (direction < 0) {
    if (from <= 1) return null; // the first line names the diagram type
    const out = [...lines.slice(0, from - 1), ...lines.slice(from, to + 1), lines[from - 1], ...lines.slice(to + 1)];
    return { lines: out, start: from - 1 };
  }
  if (to + 1 >= lines.length || !lines[to + 1].trim()) return null;
  const out = [...lines.slice(0, from), lines[to + 1], ...lines.slice(from, to + 1), ...lines.slice(to + 2)];
  return { lines: out, start: from + 1 };
}
