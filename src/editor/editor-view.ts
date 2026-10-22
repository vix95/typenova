/** Creates the single CodeMirror `EditorView` instance. */
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { $ } from "../app/dom";
import { initialDocumentText } from "../documents/start-text";
import { editorExtensions } from "./editor-extensions";

export let view: EditorView;

export function initEditorView(): void {
  const state = EditorState.create({ doc: initialDocumentText, extensions: editorExtensions });
  view = new EditorView({ state, parent: $("editor") });
}
