/** The CodeMirror `EditorView` instances: one per editor group. `view` is the editor in use (the one of the group that has the focus); code throughout the application works on `view`, so it always works on the group in use. */
import { EditorView } from "@codemirror/view";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { $ } from "../app/dom";
import { initialDocumentText } from "../documents/start-text";
import { editorExtensions } from "./editor-extensions";

/** The editor in use (the one with the focus). Reassigned only by `setActiveView` (and when the editor in use is destroyed). */
export let view: EditorView;
const views: EditorView[] = [];
const viewSetups: ((target: EditorView) => void)[] = [];

/** Registers something to do for every editor, now and for each editor created later (listeners on its DOM, attributes). */
export function registerViewSetup(setup: (target: EditorView) => void): void {
  viewSetups.push(setup);
  for (const existing of views) setup(existing);
}

/** An editor for a group, showing the given state inside `parent`. */
export function createEditorView(state: EditorState, parent: HTMLElement): EditorView {
  const created = new EditorView({ state, parent });
  // Spell checking is switched off in the webview (the program has its own) and the language is Polish by default.
  created.contentDOM.setAttribute("spellcheck", views[0]?.contentDOM.getAttribute("spellcheck") ?? "false");
  created.contentDOM.setAttribute("lang", views[0]?.contentDOM.getAttribute("lang") ?? "pl-PL");
  views.push(created);
  for (const setup of viewSetups) setup(created);
  return created;
}

/** The editor of the first group, created at start inside `#editor`. */
export function initEditorView(): void {
  view = createEditorView(EditorState.create({ doc: initialDocumentText, extensions: editorExtensions }), $("editor"));
}

export function setActiveView(next: EditorView): void { view = next; }

/** Every editor that exists. */
export function allEditorViews(): readonly EditorView[] { return views; }

/** Removes an editor. The one in use must be replaced (`setActiveView`) by the caller first. */
export function destroyEditorView(target: EditorView): void {
  const index = views.indexOf(target);
  if (index < 0 || views.length < 2) return;
  views.splice(index, 1);
  if (view === target) view = views[0];
  target.destroy();
}

/** Sends a change that concerns the whole editor (theme, wrapping, white space…) to every editor. */
export function dispatchToAllViews(spec: TransactionSpec): void { for (const target of views) target.dispatch(spec); }
