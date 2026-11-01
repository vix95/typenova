/** Hidden sections in the editor: gone from view, skipped by the caret and by search, protected from edits. */
import { findNext, findPrevious } from "@codemirror/search";
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { HiddenRange } from "../documents/section-ranges";

export const setHiddenSections = StateEffect.define<readonly HiddenRange[]>();

type Resolved = { from: number; to: number; range: HiddenRange };
interface Hidden { decorations: DecorationSet; resolved: readonly Resolved[] }

/** A hidden section leaves nothing behind in the editor: an empty block of no height takes the place of its lines. */
class HiddenSectionWidget extends WidgetType {
  constructor(readonly key: string) { super(); }
  eq(other: HiddenSectionWidget) { return other.key === this.key; }
  toDOM() {
    const empty = document.createElement("div");
    empty.className = "cm-hidden-section"; empty.setAttribute("aria-hidden", "true");
    return empty;
  }
}

function build(state: EditorState, ranges: readonly HiddenRange[]): Hidden {
  const decorations: Range<Decoration>[] = [];
  const resolved: Resolved[] = [];
  for (const range of ranges) {
    if (range.startLine < 1 || range.endLine > state.doc.lines || range.endLine < range.startLine) continue;
    const from = state.doc.line(range.startLine).from, to = state.doc.line(range.endLine).to;
    const widget = new HiddenSectionWidget(range.key);
    decorations.push(Decoration.replace({ widget, block: true }).range(from, to));
    resolved.push({ from, to, range });
  }
  return { decorations: Decoration.set(decorations, true), resolved };
}

const hiddenField = StateField.define<Hidden>({
  create: () => ({ decorations: Decoration.none, resolved: [] }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHiddenSections)) return build(transaction.state, effect.value);
    if (!transaction.docChanged) return value;
    // Edits elsewhere shift the ranges; they are rebuilt from the outline as soon as the preview reports the new headings.
    return { decorations: value.decorations.map(transaction.changes), resolved: value.resolved.map(item => ({ ...item, from: transaction.changes.mapPos(item.from, 1), to: transaction.changes.mapPos(item.to, -1) })) };
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).decorations),
    // Changes inside a hidden section (for example from "replace all") are dropped: the user cannot see that text.
    EditorState.changeFilter.of(transaction => transaction.startState.field(field).resolved.flatMap(item => [item.from, item.to])),
  ],
});

/** The hidden section ranges (line numbers) currently applied in this editor state. */
export function hiddenSectionsInState(state: EditorState): readonly HiddenRange[] { return state.field(hiddenField).resolved.map(item => item.range); }

/** The ranges currently hidden in this editor state (document positions). */
export function hiddenPositions(state: EditorState): readonly { from: number; to: number }[] { return state.field(hiddenField).resolved; }

const MAX_SEARCH_SKIPS = 200;
let searchSkips = 0;

/**
 * Search selects its match as a user event. The editor cannot place the caret inside a hidden section (it is atomic), so
 * a match there leaves the caret at the section's edge; in that case jump over the section and search again, in the
 * direction the search was moving. Gives up after a number of skips (when every remaining match is hidden).
 */
const skipHiddenSearchMatches = EditorView.updateListener.of(update => {
  if (!update.transactions.some(transaction => transaction.isUserEvent("select.search"))) return;
  const selection = update.state.selection.main;
  const section = hiddenPositions(update.state).find(item => (selection.from < item.to && selection.to > item.from) || selection.from === item.from);
  if (!section) { searchSkips = 0; return; }
  if (++searchSkips > MAX_SEARCH_SKIPS) { searchSkips = 0; return; }
  const forward = selection.from >= update.startState.selection.main.from;
  queueMicrotask(() => {
    update.view.dispatch({ selection: { anchor: forward ? section.to : section.from }, userEvent: "select.search" });
    (forward ? findNext : findPrevious)(update.view);
  });
});

export const hiddenSectionsExtension = [hiddenField, skipHiddenSearchMatches];
