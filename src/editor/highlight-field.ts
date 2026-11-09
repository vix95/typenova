/** Highlights in the editor: marks that move with the text and are drawn on a coloured background (yellow by default). */
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { HighlightColor } from "./highlights-model";

/** One highlight to show: where it is in the open document, its colour and the text of its tooltip. */
export interface HighlightMark { id: string; from: number; to: number; color: HighlightColor; label: string }

/** Replaces every mark of the document (after the store changed or a file was opened). */
export const setHighlightMarks = StateEffect.define<readonly HighlightMark[]>();

function build(length: number, marks: readonly HighlightMark[]): DecorationSet {
  const ranges = marks
    .map(mark => ({ ...mark, from: Math.max(0, Math.min(mark.from, length)), to: Math.max(0, Math.min(mark.to, length)) }))
    .filter(mark => mark.to > mark.from)
    .map(mark => Decoration.mark({
      class: `cm-highlight tn-hl-${mark.color}`,
      attributes: { "data-tooltip": mark.label, "data-highlight-id": mark.id },
      highlightId: mark.id,
      // Text typed at an edge of a highlight is not drawn as part of it.
      inclusiveStart: false,
      inclusiveEnd: false,
    }).range(mark.from, mark.to));
  return Decoration.set(ranges, true);
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
