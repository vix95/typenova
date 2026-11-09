/** Highlights in the editor: marks that move with the text and are drawn on a coloured background (yellow by default). */
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import type { HighlightColor } from "./highlights-model";

/** One highlight to show: where it is in the open document, its colour and the text of its tooltip. */
export interface HighlightMark { id: string; from: number; to: number; color: HighlightColor; label: string; hasNote: boolean }

let noteClick: ((id: string) => void) | null = null;
/** Registers what a click on the note icon of a highlight does (it needs the window, which imports the controller). */
export function onHighlightNoteClick(handler: (id: string) => void): void { noteClick = handler; }

/** A small note icon after a highlight that has a note; its tooltip is the note. */
class NoteIcon extends WidgetType {
  constructor(readonly id: string, readonly color: HighlightColor, readonly label: string) { super(); }
  eq(other: NoteIcon): boolean { return other.id === this.id && other.color === this.color && other.label === this.label; }
  ignoreEvent(): boolean { return false; }
  toDOM(): HTMLElement {
    const icon = document.createElement("span");
    icon.className = `cm-highlight-note tn-hl-${this.color}`;
    icon.innerHTML = ICONS.note;
    icon.dataset.tooltip = this.label;
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", `${langText("Notatka", "Note")}: ${this.label}`);
    icon.addEventListener("mousedown", event => { event.preventDefault(); noteClick?.(this.id); });
    return icon;
  }
}

/** Replaces every mark of the document (after the store changed or a file was opened). */
export const setHighlightMarks = StateEffect.define<readonly HighlightMark[]>();

function build(length: number, marks: readonly HighlightMark[]): DecorationSet {
  const clamped = marks
    .map(mark => ({ ...mark, from: Math.max(0, Math.min(mark.from, length)), to: Math.max(0, Math.min(mark.to, length)) }))
    .filter(mark => mark.to > mark.from);
  const ranges = clamped.map(mark => Decoration.mark({
    class: `cm-highlight tn-hl-${mark.color}`,
    // A highlight with a note has the note icon after it, and that icon carries the tooltip; the text itself then shows none.
    attributes: mark.hasNote ? { "data-highlight-id": mark.id } : { "data-tooltip": mark.label, "data-highlight-id": mark.id },
    highlightId: mark.id,
    // Text typed at an edge of a highlight is not drawn as part of it.
    inclusiveStart: false,
    inclusiveEnd: false,
  }).range(mark.from, mark.to));
  const icons = clamped.filter(mark => mark.hasNote).map(mark => Decoration.widget({ widget: new NoteIcon(mark.id, mark.color, mark.label), side: 1 }).range(mark.to));
  return Decoration.set([...ranges, ...icons], true);
}

export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHighlightMarks)) return build(transaction.state.doc.length, effect.value);
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: field => EditorView.decorations.from(field),
});

/** Where each highlight is now: the positions of its mark in the document. A highlight whose text was deleted has no mark any more. */
export function highlightPositions(state: EditorState): { id: string; from: number; to: number }[] {
  const found: { id: string; from: number; to: number }[] = [];
  state.field(highlightField).between(0, state.doc.length, (from, to, value) => {
    const id = (value.spec as { highlightId?: string }).highlightId;
    if (id && to > from) found.push({ id, from, to });
  });
  return found;
}

export const highlightExtension = [highlightField];
