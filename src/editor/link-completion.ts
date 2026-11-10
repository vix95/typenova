/** Completion inside `[[`: first the file a link leads to, then (after `#`) one of its sections, so that every link names its file and its header. */
import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { documentState } from "../documents/document-state";
import { pathKeyOf, textOfTab } from "../documents/link-rename-apply";
import { indexedNow, warmProject } from "../documents/project-index";
import { sameSessionPath } from "../documents/session";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { canBeLinkTitle, linkNamesFile, linkPathFor } from "../graph/link-rename";
import { indexFile, type IndexedFile } from "../graph/project-index-model";
import { langText } from "../i18n/language";

const OPEN_LINK = /(?<!!)\[\[([^\]\n|]*)$/;

/** The Markdown files links may lead to: the open documents (as they are now) and the project's files in the index (the part read so far, while the first read goes on). */
function linkableFiles(): IndexedFile[] {
  const tabs = documentState.tabs.filter(tab => isMarkdownPath(tab.path || tab.label));
  warmProject();
  const open = tabs.map(tab => indexFile(pathKeyOf(tab), tab.path ? basename(tab.path) : tab.label, "", textOfTab(tab).toString()));
  return [...open, ...indexedNow().filter(file => !tabs.some(tab => sameSessionPath(tab.path, file.path)))];
}

const afterLink = (editor: EditorView, to: number): number => (editor.state.sliceDoc(to, to + 2) === "]]" ? 2 : 0);

/** Null when the caret is not inside an open `[[`. */
export async function completeWikiLink(context: CompletionContext): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const open = OPEN_LINK.exec(line.text.slice(0, context.pos - line.from));
  if (!open) return null;
  const typed = open[1];
  const active = documentState.tabs.find(tab => tab.id === documentState.activeTabId);
  const sourcePath = active ? pathKeyOf(active) : "";
  const files = linkableFiles();
  const paths = files.map(file => file.path);
  const hash = typed.indexOf("#");
  if (hash < 0) {
    const query = typed.trim().toLocaleLowerCase();
    const options: Completion[] = files
      .map(file => ({ file, written: linkPathFor(sourcePath, file.path, paths) }))
      .filter(item => !query || item.written.toLocaleLowerCase().includes(query))
      .map(({ file, written }): Completion => ({
        label: written,
        type: "file",
        detail: langText("plik, potem sekcja", "file, then a section"),
        boost: file.path === sourcePath ? 1 : 0,
        apply: (editor: EditorView, _completion: Completion, from: number, to: number) => {
          editor.dispatch({ changes: { from, to, insert: `${written}#` }, selection: { anchor: from + written.length + 1 } });
          requestAnimationFrame(() => { if (editor.hasFocus) startCompletion(editor); });
        },
      }));
    return options.length ? { from: context.pos - typed.length, options, filter: false } : null;
  }
  const file = files.find(item => linkNamesFile(sourcePath, item.path, paths, typed.slice(0, hash)));
  if (!file) return null;
  const query = typed.slice(hash + 1).trim().toLocaleLowerCase();
  const options: Completion[] = file.sections
    .filter(section => canBeLinkTitle(section.title) && section.title.toLocaleLowerCase().includes(query))
    .map((section): Completion => ({
      label: section.title,
      type: "text",
      detail: langText(`wiersz ${section.line}`, `line ${section.line}`),
      apply: (editor: EditorView, _completion: Completion, from: number, to: number) => {
        const close = afterLink(editor, to);
        editor.dispatch({ changes: { from, to: to + close, insert: `${section.title}]]` }, selection: { anchor: from + section.title.length + 2 } });
      },
    }));
  return options.length ? { from: context.pos - (typed.length - hash - 1), options, filter: false } : null;
}
