/** The list of all highlights in the left panel: search, sections per file or per group, go to, edit, delete and copy as Markdown. */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import { button, el } from "./bookmark-browser";
import { copyHighlightsAsMarkdown, deleteHighlight, getHighlights, goToHighlight, highlightExcerpt, isHighlightMissing, onHighlightsChanged } from "./highlights";
import { filterHighlights, groupHighlights, type Highlight } from "./highlights-model";

export interface HighlightBrowserOptions {
  /** Opens the editor for a highlight's colour, group and note. */
  onEdit: (id: string) => void;
  /** Called with the number of all highlights whenever the list is drawn. */
  onCount?: (count: number) => void;
}

export interface HighlightBrowser { element: HTMLElement; refresh: () => void; dispose: () => void }

function row(item: Highlight, options: HighlightBrowserOptions): HTMLElement {
  const wrapper = el("div", `highlight-row${isHighlightMissing(item.id) ? " is-missing" : ""}`);
  wrapper.setAttribute("role", "listitem");
  const go = el("button", "highlight-go");
  go.type = "button";
  go.append(el("span", `highlight-dot tn-hl-${item.color}`));
  const text = el("span", "highlight-text");
  text.append(el("span", "highlight-quote", highlightExcerpt(item)));
  if (item.note) text.append(el("span", "highlight-note-preview", item.note.replace(/\s+/g, " ").trim()));
  const meta = [basename(item.path), item.group ? `${langText("grupa", "group")}: ${item.group}` : "", isHighlightMissing(item.id) ? langText("nie znaleziono tekstu", "text not found") : ""].filter(Boolean).join(" · ");
  text.append(el("span", "highlight-meta", meta));
  go.append(text);
  const goLabel = langText("Przejdź do wyróżnienia", "Go to the highlight");
  go.dataset.tooltip = goLabel;
  go.setAttribute("aria-label", `${goLabel}: ${highlightExcerpt(item, 80)}`);
  go.addEventListener("click", () => { void goToHighlight(item); });
  const actions = el("div", "highlight-row-actions");
  actions.append(
    button("bookmark-icon-button", "edit", langText("Edytuj kolor, grupę i notatkę", "Edit colour, group and note"), () => options.onEdit(item.id)),
    button("bookmark-icon-button", "trash", langText("Usuń wyróżnienie", "Delete highlight"), () => { void deleteHighlight(item.id); }),
  );
  wrapper.append(go, actions);
  return wrapper;
}

function emptyText(all: number): string {
  return all
    ? langText("Brak wyróżnień pasujących do wyszukiwania.", "No highlights match the search.")
    : langText("Nie ma jeszcze wyróżnień. Zaznacz fragment tekstu i naciśnij Ctrl+Shift+H albo przycisk markera w pasku formatowania.", "There are no highlights yet. Select some text and press Ctrl+Shift+H or the marker button in the formatting toolbar.");
}

function renderList(list: HTMLElement, query: string, by: "file" | "group", options: HighlightBrowserOptions): void {
  const all = getHighlights();
  options.onCount?.(all.length);
  const shown = filterHighlights(all, query);
  list.replaceChildren();
  if (!shown.length) { list.append(el("p", "bookmark-empty", emptyText(all.length))); return; }
  for (const section of groupHighlights(shown, by, { noGroup: langText("Bez grupy", "No group"), fileName: basename })) {
    const heading = el("div", "bookmark-group", `${section.label} · ${section.items.length}`);
    list.append(heading);
    for (const item of section.items) list.append(row(item, options));
  }
}

/** Builds the search box, the file/group switch, the list and the copy button; it redraws itself whenever the highlights or the language change. */
export function createHighlightBrowser(options: HighlightBrowserOptions): HighlightBrowser {
  const element = el("div", "bookmark-browser highlight-browser");
  let by: "file" | "group" = "file";
  const searchBox = el("div", "bookmark-search");
  searchBox.insertAdjacentHTML("afterbegin", ICONS.search);
  const search = el("input", "bookmark-input");
  search.type = "search"; search.spellcheck = false;
  searchBox.append(search);
  const switcher = el("div", "highlight-switch");
  switcher.setAttribute("role", "group");
  const byFile = el("button", "ai-chip"); byFile.type = "button";
  const byGroup = el("button", "ai-chip"); byGroup.type = "button";
  switcher.append(el("span", "ai-context-label"), byFile, byGroup);
  const list = el("div", "bookmark-list");
  list.setAttribute("role", "list");
  const copy = el("button", "ai-flat-button highlight-copy"); copy.type = "button";
  copy.insertAdjacentHTML("afterbegin", ICONS.copy);
  copy.append(el("span"));
  element.append(searchBox, switcher, list, copy);
  const refresh = () => {
    search.placeholder = langText("Szukaj we wyróżnieniach…", "Search highlights…");
    search.setAttribute("aria-label", search.placeholder);
    search.dataset.tooltip = search.placeholder;
    switcher.setAttribute("aria-label", langText("Podział listy", "How the list is divided"));
    (switcher.firstElementChild as HTMLElement).textContent = langText("Pokaż według:", "Show by:");
    for (const [chip, mode, label] of [[byFile, "file", langText("Plików", "Files")], [byGroup, "group", langText("Grup", "Groups")]] as const) {
      chip.textContent = label;
      chip.setAttribute("aria-pressed", String(by === mode));
      chip.classList.toggle("selected", by === mode);
    }
    list.setAttribute("aria-label", langText("Lista wyróżnień", "Highlight list"));
    const copyLabel = langText("Kopiuj wszystkie jako Markdown", "Copy all as Markdown");
    (copy.lastElementChild as HTMLElement).textContent = copyLabel;
    copy.dataset.tooltip = copyLabel;
    copy.setAttribute("aria-label", copyLabel);
    renderList(list, search.value, by, options);
  };
  search.addEventListener("input", refresh);
  byFile.addEventListener("click", () => { by = "file"; refresh(); });
  byGroup.addEventListener("click", () => { by = "group"; refresh(); });
  copy.addEventListener("click", () => { void copyHighlightsAsMarkdown(filterHighlights(getHighlights(), search.value), by); });
  const stop = onHighlightsChanged(() => { if (element.isConnected) refresh(); });
  refresh();
  return { element, refresh, dispose: stop };
}
