/** Highlights in the editor's undo history: marking, unmarking and editing a highlight are history events, so Ctrl+Z takes them back and Ctrl+Y brings them again. The list of highlights lives outside the document, so each of these is a state effect that the history keeps (and inverts), and a listener applies the ones that undo and redo bring back. */
import { invertedEffects } from "@codemirror/commands";
import { Annotation, StateEffect, type ChangeDesc, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Highlight } from "./highlights-model";

export interface HighlightChange { before: Highlight; after: Highlight }

const mapped = (item: Highlight, mapping: ChangeDesc): Highlight => ({ ...item, from: mapping.mapPos(item.from, 1), to: Math.max(mapping.mapPos(item.from, 1), mapping.mapPos(item.to, -1)) });

/** Highlights were added (undo removes them). */
export const highlightsAdded = StateEffect.define<readonly Highlight[]>({ map: (items, mapping) => items.map(item => mapped(item, mapping)) });
/** Highlights were removed (undo adds them back). */
export const highlightsRemoved = StateEffect.define<readonly Highlight[]>({ map: (items, mapping) => items.map(item => mapped(item, mapping)) });
/** A highlight's note, group or colour was changed (undo puts `before` back). */
export const highlightChanged = StateEffect.define<HighlightChange>({ map: (change, mapping) => ({ before: mapped(change.before, mapping), after: mapped(change.after, mapping) }) });

/** Marks a transaction whose effect the program has already applied to the list: only undo and redo transactions are applied by the listener. */
export const highlightApplied = Annotation.define<boolean>();

export type HighlightOperation =
  | { kind: "add"; items: readonly Highlight[] }
  | { kind: "remove"; items: readonly Highlight[] }
  | { kind: "change"; change: HighlightChange };

let apply: ((operations: HighlightOperation[]) => void) | null = null;
/** Registers what is done with the highlight effects that undo or redo bring back (it needs the list, which imports this module). */
export function onHighlightHistory(handler: (operations: HighlightOperation[]) => void): void { apply = handler; }

const inverseOf = (transaction: Transaction) => {
  const inverse: StateEffect<unknown>[] = [];
  for (const effect of transaction.effects) {
    if (effect.is(highlightsAdded)) inverse.push(highlightsRemoved.of(effect.value));
    else if (effect.is(highlightsRemoved)) inverse.push(highlightsAdded.of(effect.value));
    else if (effect.is(highlightChanged)) inverse.push(highlightChanged.of({ before: effect.value.after, after: effect.value.before }));
  }
  return inverse;
};

export const highlightHistory = [
  invertedEffects.of(inverseOf),
  EditorView.updateListener.of(update => {
    const operations: HighlightOperation[] = [];
    for (const transaction of update.transactions) {
      if (transaction.annotation(highlightApplied)) continue;
      for (const effect of transaction.effects) {
        if (effect.is(highlightsAdded)) operations.push({ kind: "add", items: effect.value });
        else if (effect.is(highlightsRemoved)) operations.push({ kind: "remove", items: effect.value });
        else if (effect.is(highlightChanged)) operations.push({ kind: "change", change: effect.value });
      }
    }
    // The editor may not be changed while it is updating, and the list redraws the marks: that happens right after.
    if (operations.length && apply) queueMicrotask(() => apply?.(operations));
  }),
];
