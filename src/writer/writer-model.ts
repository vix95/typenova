/** Small pure rules of the Writer (live rendering) mode: when the Markdown syntax of an element is shown instead of hidden, and the few text changes its widgets make. No DOM. */

export interface Span { from: number; to: number }

/** The syntax of an element is shown while the caret or the selection touches it (also at its edges, so that the hidden characters can never trap the caret). */
export function touches(selection: readonly Span[], from: number, to: number): boolean {
  return selection.some(range => range.from <= to && range.to >= from);
}

/** Bullets are drawn as a dot; the character in the text stays what it is. */
export const BULLET = "•";

/** `[ ]` becomes `[x]` and the other way round; null when the text is not a task marker. */
export function toggledTask(marker: string): string | null {
  if (marker === "[ ]") return "[x]";
  if (/^\[[xX]\]$/.test(marker)) return "[ ]";
  return null;
}

export const isTaskDone = (marker: string): boolean => /^\[[xX]\]$/.test(marker);

/** The language shown on a rendered code block: the first word of its info string (empty when there is none). */
export function languageLabel(info: string): string {
  return info.trim().split(/\s+/)[0] ?? "";
}

/** What a link points to, for Ctrl+click: an address on the web or a mail address, a path to a file, or an anchor in the same document. */
export type LinkTarget = { kind: "external"; url: string } | { kind: "file"; path: string } | { kind: "anchor"; id: string } | { kind: "none" };

export function classifyLink(target: string): LinkTarget {
  const value = target.trim().replace(/^<|>$/g, "");
  if (!value) return { kind: "none" };
  if (/^(?:https?:|mailto:|tel:)/i.test(value)) return { kind: "external", url: value };
  if (value.startsWith("#")) return { kind: "anchor", id: value.slice(1) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return { kind: "none" };
  let path = value.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { /* a literal percent stays */ }
  return path ? { kind: "file", path } : { kind: "none" };
}

/** The TeX of a paragraph that is one display formula (`$$ … $$`, on one line or several); null when the paragraph is anything else. */
export function mathBlock(text: string): string | null {
  const match = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(text);
  const latex = match?.[1].trim();
  return latex && !latex.includes("$$") ? latex : null;
}

export interface InlineMath { from: number; to: number; latex: string; display: boolean }

/** The formulas inside one line of text: `$x$` (the same rules as the preview: no space inside the dollars, no digit after the closing one) and `$$x$$`. */
export function inlineMath(line: string): InlineMath[] {
  const found: InlineMath[] = [];
  const pattern = /\$\$(?!\s)([^$\n]+?)(?<!\s)\$\$|(?<![\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    const display = match[1] !== undefined;
    found.push({ from: match.index, to: match.index + match[0].length, latex: (display ? match[1] : match[2]).trim(), display });
  }
  return found;
}
