/** The searchable list of all bookmarks, grouped by file. It is shown in the Bookmarks window and in the sidebar. */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { ICONS, type IconName } from "../ui/icons";
import { filterBookmarks, type Bookmark } from "./bookmarks-model";
import { deleteBookmark, generatedBookmarkLabel, getBookmarks, goToBookmark, onBookmarksChanged, titleOf } from "./bookmarks";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A button with an SVG icon and, optionally, a visible label; the tooltip and the accessible name are set explicitly. */
export function button(className: string, icon: IconName | null, label: string, onClick: () => void, showLabel = false): HTMLButtonElement {
  const control = el("button", className);
  control.type = "button";
  if (icon) control.insertAdjacentHTML("afterbegin", ICONS[icon]);
  if (showLabel) control.append(el("span", "", label));
  control.dataset.tooltip = label;
  control.setAttribute("aria-label", label);
  control.addEventListener("click", onClick);
  return control;
}

export interface BookmarkBrowserOptions {
  /** Opens the editor for a bookmark's name and note. */
  onEdit: (id: string) => void;
  /** Called after a bookmark was chosen (the window closes itself here). */
  afterGo?: () => void;
  /** Called with the number of all bookmarks whenever the list is drawn. */
  onCount?: (count: number) => void;
}

export interface BookmarkBrowser { element: HTMLElement; refresh: () => void; focusSearch: () => void; dispose: () => void }

function groupByFile(bookmarks: readonly Bookmark[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const key = bookmark.path.replace(/\\/g, "/").toLowerCase();
    const group = groups.get(key);
    if (group) group.push(bookmark); else groups.set(key, [bookmark]);
  }
  return groups;
}

function bookmarkRow(bookmark: Bookmark, options: BookmarkBrowserOptions): HTMLElement {
  const row = el("div", "bookmark-row");
  row.setAttribute("role", "listitem");
  const go = el("button", "bookmark-go");
  go.type = "button";
  go.insertAdjacentHTML("afterbegin", ICONS.bookmarkFilled);
  const text = el("span", "bookmark-text");
  text.append(el("span", "bookmark-title", titleOf(bookmark)), el("span", "bookmark-meta", `${langText("wiersz", "line")} ${bookmark.line}${bookmark.excerpt ? ` · ${bookmark.excerpt}` : ""}`));
  if (bookmark.note) text.append(el("span", "bookmark-note-preview", bookmark.note.replace(/\s+/g, " ").trim()));
  go.append(text);
  const goLabel = langText("Przejdź do zakładki", "Go to bookmark");
  go.dataset.tooltip = goLabel;
  go.setAttribute("aria-label", `${goLabel}: ${titleOf(bookmark)}, ${langText("wiersz", "line")} ${bookmark.line}`);
  go.addEventListener("click", () => { options.afterGo?.(); void goToBookmark(bookmark); });
  const actions = el("div", "bookmark-row-actions");
  actions.append(
    button("bookmark-icon-button", "edit", langText("Edytuj nazwę i notatkę", "Edit name and note"), () => options.onEdit(bookmark.id)),
    button("bookmark-icon-button", "trash", langText("Usuń zakładkę", "Delete bookmark"), () => { void deleteBookmark(bookmark.id); }),
  );
  row.append(go, actions);
  return row;
}

function renderList(list: HTMLElement, query: string, options: BookmarkBrowserOptions): void {
  const all = getBookmarks();
  options.onCount?.(all.length);
  const shown = filterBookmarks(all, query, generatedBookmarkLabel());
  list.replaceChildren();
  if (!shown.length) {
    list.append(el("p", "bookmark-empty", all.length ? langText("Brak zakładek pasujących do wyszukiwania.", "No bookmarks match the search.") : langText("Nie ma jeszcze zakładek. Kliknij kolumnę po lewej stronie wiersza w edytorze albo naciśnij Ctrl+F2.", "There are no bookmarks yet. Click the column left of a line in the editor or press Ctrl+F2.")));
    return;
  }
  const sorted = [...shown].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }) || a.line - b.line);
  for (const group of groupByFile(sorted).values()) {
    const heading = el("div", "bookmark-group", basename(group[0].path));
    heading.dataset.tooltip = group[0].path;
    list.append(heading);
    for (const bookmark of group) list.append(bookmarkRow(bookmark, options));
  }
}

/** Arrow keys move between the bookmarks of the list. */
function listKeys(list: HTMLElement, search: HTMLInputElement): (event: KeyboardEvent) => void {
  return event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>(".bookmark-go"));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    if (event.key === "ArrowDown") (items[index + 1] ?? items[0]).focus();
    else if (index <= 0) search.focus();
    else items[index - 1].focus();
  };
}

/** Builds the search box and the list; it redraws itself whenever the bookmarks or the language change. */
export function createBookmarkBrowser(options: BookmarkBrowserOptions): BookmarkBrowser {
  const element = el("div", "bookmark-browser");
  const searchBox = el("div", "bookmark-search");
  searchBox.insertAdjacentHTML("afterbegin", ICONS.search);
  const search = el("input", "bookmark-input");
  search.type = "search"; search.spellcheck = false;
  const list = el("div", "bookmark-list");
  list.setAttribute("role", "list");
  searchBox.append(search);
  element.append(searchBox, list);
  const refresh = () => {
    search.placeholder = langText("Szukaj zakładek…", "Search bookmarks…");
    search.setAttribute("aria-label", search.placeholder);
    search.dataset.tooltip = search.placeholder;
    list.setAttribute("aria-label", langText("Lista zakładek", "Bookmark list"));
    renderList(list, search.value, options);
  };
  search.addEventListener("input", refresh);
  search.addEventListener("keydown", event => { if (event.key === "ArrowDown") { event.preventDefault(); list.querySelector<HTMLButtonElement>(".bookmark-go")?.focus(); } });
  list.addEventListener("keydown", listKeys(list, search));
  const stop = onBookmarksChanged(() => { if (element.isConnected) refresh(); });
  refresh();
  return { element, refresh, focusSearch: () => search.focus(), dispose: stop };
}
