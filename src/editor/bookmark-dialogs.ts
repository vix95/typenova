/** Bookmark windows: the editor for a bookmark's name and note, and the list of all bookmarks with search. */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { MAX_NAME, MAX_NOTE, type Bookmark } from "./bookmarks-model";
import { addBookmarkAt, bookmarkAtCaret, deleteBookmark, getBookmarks, goToBookmark, titleOf, updateBookmark } from "./bookmarks";
import { button, el } from "./bookmark-browser";
import { view } from "./editor-view";

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = el("label", "bookmark-field");
  wrapper.append(el("span", "", label), control);
  return wrapper;
}

function whereText(bookmark: Bookmark): string { return `${basename(bookmark.path)} · ${langText("wiersz", "line")} ${bookmark.line}`; }

function openDialog(dialog: HTMLDialogElement, focus: HTMLElement | null): void {
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  focus?.focus();
}

let editorDialog: HTMLDialogElement | null = null;

/** The window in which a bookmark gets a name and a note, or is deleted. */
export function openBookmarkEditor(id: string): void {
  const bookmark = getBookmarks().find(item => item.id === id);
  if (!bookmark) return;
  editorDialog?.close();
  const dialog = el("dialog", "bookmark-dialog");
  const content = el("div", "dialog-content bookmark-content");
  const title = el("div", "dialog-title", langText("Zakładka", "Bookmark"));
  title.id = "bookmarkEditorTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  const where = el("div", "bookmark-where", whereText(bookmark));
  where.dataset.tooltip = bookmark.path;
  const name = el("input", "bookmark-input");
  name.type = "text"; name.maxLength = MAX_NAME; name.value = bookmark.name; name.spellcheck = false;
  name.placeholder = titleOf({ ...bookmark, name: "" });
  const note = el("textarea", "bookmark-note");
  note.maxLength = MAX_NOTE; note.value = bookmark.note; note.rows = 6;
  note.placeholder = langText("Dodaj notatkę do tego miejsca (opcjonalnie)", "Add a note about this place (optional)");

  const save = () => { updateBookmark(bookmark.id, { name: name.value, note: note.value }); dialog.close(); };
  const actions = el("div", "dialog-actions bookmark-actions");
  const remove = button("bookmark-delete", "trash", langText("Usuń zakładkę", "Delete bookmark"), () => { void deleteBookmark(bookmark.id, false).then(() => dialog.close()); }, true);
  const go = button("", "arrowRight", langText("Przejdź do zakładki", "Go to bookmark"), () => { dialog.close(); void goToBookmark(bookmark); }, true);
  const cancel = button("", "close", langText("Anuluj", "Cancel"), () => dialog.close(), true);
  const confirm = button("bookmark-confirm", "save", langText("Zapisz", "Save"), save, true);
  actions.append(remove, el("span", "bookmark-actions-gap"), go, cancel, confirm);

  name.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); save(); } });
  note.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } });
  content.append(title, where, field(langText("Nazwa (opcjonalnie)", "Name (optional)"), name), field(langText("Notatka", "Note"), note), actions);
  dialog.append(content);
  dialog.addEventListener("close", () => { if (editorDialog === dialog) editorDialog = null; });
  editorDialog = dialog;
  openDialog(dialog, name);
}

/** Puts a bookmark on the caret's line (if it has none yet) and opens it for a name and a note. */
export function editBookmarkAtCaret(): void {
  const target = bookmarkAtCaret() ?? addBookmarkAt();
  if (target) openBookmarkEditor(target.id);
  else view.focus();
}

