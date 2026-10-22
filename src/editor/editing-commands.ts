/** Selection and line editing helpers used by menus and shortcuts. */
import { view } from "./editor-view";

export function wrapSelection(before: string, after: string) {
  const { from, to } = view.state.selection.main, selected = view.state.sliceDoc(from, to);
  view.dispatch({ changes: { from, to, insert: before + selected + after }, selection: { anchor: from + before.length, head: from + before.length + selected.length } });
  view.focus(); return true;
}
export function prefixLine(prefix: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ changes: { from: line.from, insert: prefix } }); view.focus();
}
export function insertAtCursor(text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } }); view.focus();
}
