/** Highlights in the preview: the highlighted passages of the open document are found in the rendered blocks and drawn on the same coloured background as in the editor. */
import { previewContent } from "../app/workspace-dom";
import { plainText } from "../editor/highlights-model";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";

/** A highlight of the open document, in lines (to find the blocks it lies in) and as its source text (to find it inside them). */
export interface PreviewHighlight { id: string; startLine: number; endLine: number; text: string; color: string; label: string; hasNote: boolean }

let highlights: PreviewHighlight[] = [];
let noteClick: ((id: string) => void) | null = null;

/** Registers what a click on the note icon of a highlight does (it needs the window, which imports the controller). */
export function onPreviewNoteClick(handler: (id: string) => void): void { noteClick = handler; }

/** Unwraps every highlight mark of a block, leaving its text as it was. */
function clearMarks(element: HTMLElement): void {
  element.querySelectorAll(".tn-highlight-note").forEach(icon => icon.remove());
  const marks = element.querySelectorAll("mark.tn-highlight");
  if (!marks.length) return;
  marks.forEach(mark => mark.replaceWith(...Array.from(mark.childNodes)));
  element.normalize();
}

/** The text nodes of a block that are real content (not the copy buttons of code blocks and the like). */
function contentTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.parentElement?.closest("button, script, style, .code-copy"))) nodes.push(node as Text);
  }
  return nodes;
}

interface Position { node: Text; offset: number }

/** The text of a block with runs of white space shortened to one space, and for each of its characters where it lies in the DOM. */
function flatten(nodes: readonly Text[]): { text: string; positions: Position[] } {
  let text = "";
  const positions: Position[] = [];
  let previousSpace = true;
  for (const node of nodes) {
    for (let offset = 0; offset < node.data.length; offset++) {
      const space = /\s/.test(node.data[offset]);
      if (space && previousSpace) continue;
      text += space ? " " : node.data[offset];
      positions.push({ node, offset });
      previousSpace = space;
    }
  }
  return { text, positions };
}

/** The part of a highlight's source text that lies in the lines of one block. */
function pieceFor(item: PreviewHighlight, startLine: number, endLine: number): string {
  const first = Math.max(startLine, item.startLine) - item.startLine;
  const last = Math.min(endLine, item.endLine) - item.startLine;
  if (last < first) return "";
  return plainText(item.text.split("\n").slice(first, last + 1).join("\n"));
}

/** The note icon after the last mark of a highlight that has a note. */
function noteIcon(item: PreviewHighlight): HTMLElement {
  const icon = document.createElement("span");
  icon.className = `tn-highlight-note tn-hl-${item.color}`;
  icon.innerHTML = ICONS.note;
  icon.dataset.tooltip = item.label;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", `${langText("Notatka", "Note")}: ${item.label}`);
  icon.addEventListener("click", () => noteClick?.(item.id));
  return icon;
}

function wrap(item: PreviewHighlight, found: Position[], showNote: boolean): void {
  // Group the characters by text node, then wrap from the last node to the first so that earlier offsets stay valid.
  const spans = new Map<Text, { start: number; end: number }>();
  for (const position of found) {
    const span = spans.get(position.node);
    if (span) { span.start = Math.min(span.start, position.offset); span.end = Math.max(span.end, position.offset + 1); }
    else spans.set(position.node, { start: position.offset, end: position.offset + 1 });
  }
  let lastMark: HTMLElement | null = null;
  for (const [node, span] of [...spans].reverse()) {
    const range = document.createRange();
    range.setStart(node, span.start);
    range.setEnd(node, span.end);
    const mark = document.createElement("mark");
    mark.className = `tn-highlight tn-hl-${item.color}`;
    mark.dataset.highlightId = item.id;
    // The note icon after a highlight with a note carries the tooltip, so the marked text shows none.
    if (!item.hasNote) mark.dataset.tooltip = item.label;
    range.surroundContents(mark);
    lastMark ??= mark;
  }
  // The icon goes after the end of the passage, so only the block that holds the end of a long highlight shows it.
  if (showNote && lastMark) lastMark.after(noteIcon(item));
}

/** Draws the highlights that lie in the lines of one rendered block. Called when a block was rendered and when the highlights changed. */
export function applyBlockHighlights(element: HTMLElement, startLine: number, endLine: number): void {
  clearMarks(element);
  const relevant = highlights.filter(item => item.startLine <= endLine && item.endLine >= startLine);
  for (const item of relevant) {
    const piece = pieceFor(item, startLine, endLine);
    if (!piece) continue;
    const { text, positions } = flatten(contentTextNodes(element));
    const index = text.indexOf(piece);
    if (index < 0) continue;
    wrap(item, positions.slice(index, index + piece.length), item.hasNote && item.endLine <= endLine);
  }
}

/** Redraws the highlights in every block that is on screen. */
export function refreshPreviewHighlights(): void {
  for (const child of Array.from(previewContent.children)) {
    const element = child as HTMLElement;
    const start = Number(element.dataset.startLine), end = Number(element.dataset.endLine);
    if (Number.isFinite(start) && Number.isFinite(end)) applyBlockHighlights(element, start, end);
  }
}

/** Sets the highlights of the open document (an empty list removes them all). */
export function setPreviewHighlights(next: readonly PreviewHighlight[]): void {
  highlights = [...next];
  refreshPreviewHighlights();
}
