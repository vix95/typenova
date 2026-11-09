/** Bookmarks in the editor: markers that move with the text, a gutter column with an icon, and a soft highlight of the line. */
import { RangeSet, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";
import { ICONS } from "../ui/icons";

/** One bookmark to show: where it is in the open document and the text of its tooltip. */
export interface BookmarkMark { id: string; position: number; label: string }

class BookmarkMarker extends GutterMarker {
  /** A marker stays with the text that follows it: pressing Enter at the start of a bookmarked line pushes the bookmark down with its text. */
  startSide = 1;
  /** Both sides must agree, otherwise text typed exactly at the marker would turn it into an inverted range and drop it. */
  endSide = 1;
  constructor(readonly id: string, readonly label: string) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof BookmarkMarker && other.id === this.id && other.label === this.label; }
  toDOM(): Node {
    const icon = document.createElement("span");
    icon.className = "cm-bookmark-marker";
    icon.innerHTML = ICONS.bookmarkFilled;
    icon.dataset.tooltip = this.label;
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", this.label);
    return icon;
  }
}

/** Replaces every marker of the document (after the store changed or a file was opened). */
export const setBookmarkMarks = StateEffect.define<readonly BookmarkMark[]>();

function buildMarkers(length: number, marks: readonly BookmarkMark[]): RangeSet<BookmarkMarker> {
  const ranges = marks.map(mark => new BookmarkMarker(mark.id, mark.label).range(Math.min(Math.max(mark.position, 0), length)));
  return RangeSet.of(ranges, true);
}

export const bookmarkField = StateField.define<RangeSet<BookmarkMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setBookmarkMarks)) return buildMarkers(transaction.state.doc.length, effect.value);
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
});

/** Where each bookmark is now: the document position of its marker. */
export function bookmarkPositions(state: EditorState): { id: string; position: number }[] {
  const found: { id: string; position: number }[] = [];
  state.field(bookmarkField).between(0, state.doc.length, (from, _to, value) => { found.push({ id: value.id, position: from }); });
  return found;
}

let gutterClick: ((line: number) => void) | null = null;
/** Registers what a click on the bookmark column does (it needs the controller, which imports this module). */
export function onBookmarkGutterClick(handler: (line: number) => void): void { gutterClick = handler; }

const lineHighlight = Decoration.line({ class: "cm-bookmark-line" });
const lineDecorations = EditorView.decorations.compute([bookmarkField], (state): DecorationSet =>
  Decoration.set(bookmarkPositions(state).map(item => lineHighlight.range(state.doc.lineAt(item.position).from)), true));

const spacer = new (class extends GutterMarker { toDOM() { const element = document.createElement("span"); element.className = "cm-bookmark-marker"; element.innerHTML = ICONS.bookmarkFilled; return element; } })();

export const bookmarkExtension = [
  bookmarkField,
  lineDecorations,
  gutter({
    class: "cm-bookmark-gutter",
    markers: view => view.state.field(bookmarkField),
    initialSpacer: () => spacer,
    // Every line gets an (empty) element, so a click anywhere in the column can add a bookmark.
    renderEmptyElements: true,
    domEventHandlers: {
      mousedown(view, block, event) {
        if ((event as MouseEvent).button !== 0) return false;
        gutterClick?.(view.state.doc.lineAt(block.from).number);
        return true;
      },
    },
  }),
];
