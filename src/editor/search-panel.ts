/** Find and replace panel of the editor: icon buttons, a match counter, option toggles and a collapsible replace row (replaces the stock CodeMirror panel). */
import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, selectMatches, setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { langText } from "../i18n/language";
import { hiddenSectionsInState } from "./hidden-sections";

const REPLACE_KEY = "typenova.searchReplaceOpen";
const COUNT_LIMIT = 5000;

const icon = (paths: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICONS = {
  search: icon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>'),
  up: icon('<path d="m4 10 4-4 4 4"/>'),
  down: icon('<path d="m4 6 4 4 4-4"/>'),
  all: icon('<path d="M3 4h10M3 8h10M3 12h10"/><path d="M3 4h4M3 8h6M3 12h5" stroke-width="2.4"/>'),
  chevron: icon('<path d="m6 4 4 4-4 4"/>'),
  close: icon('<path d="m4 4 8 8M12 4l-8 8"/>'),
  replace: icon('<path d="M3 5h8l-2-2M13 11H5l2 2"/>'),
  replaceAll: icon('<path d="M3 4h8l-2-2M13 9H5l2 2M3 14h10"/>'),
};

function remembered(): boolean { try { return localStorage.getItem(REPLACE_KEY) === "1"; } catch { return false; } }
function remember(open: boolean): void { try { localStorage.setItem(REPLACE_KEY, open ? "1" : "0"); } catch { /* storage unavailable */ } }

/** How many matches the query has (outside hidden sections) and the number of the one that is selected; null when the pattern is invalid. */
export function countMatches(state: EditorState, query: SearchQuery): { total: number; index: number; capped: boolean } | null {
  if (!query.search) return { total: 0, index: 0, capped: false };
  if (!query.valid) return null;
  const hidden = hiddenSectionsInState(state);
  const { from: selFrom, to: selTo } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0, index = 0;
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const { from, to } = step.value;
    if (hidden.length) { const line = state.doc.lineAt(from).number; if (hidden.some(range => line >= range.startLine && line <= range.endLine)) continue; }
    total++;
    if (from === selFrom && to === selTo) index = total;
    if (total >= COUNT_LIMIT) return { total, index, capped: true };
  }
  return { total, index, capped: false };
}

function button(className: string, svg: string, label: string): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.className = `tn-search-btn ${className}`; node.innerHTML = svg;
  node.title = label; node.setAttribute("aria-label", label.replace(/\s*\(.*\)$/, ""));
  return node;
}

function toggle(label: string, text: string, title: string): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.className = "tn-search-toggle"; node.textContent = text;
  node.title = title; node.setAttribute("aria-label", label); node.setAttribute("aria-pressed", "false");
  return node;
}

interface SearchDom {
  dom: HTMLElement; find: HTMLInputElement; replace: HTMLInputElement; count: HTMLElement; second: HTMLElement;
  prev: HTMLButtonElement; next: HTMLButtonElement; every: HTMLButtonElement; matchCase: HTMLButtonElement; wholeWord: HTMLButtonElement; regexp: HTMLButtonElement;
  expand: HTMLButtonElement; close: HTMLButtonElement; replaceOne: HTMLButtonElement; replaceEvery: HTMLButtonElement;
}

function buildSearchDom(initial: SearchQuery): SearchDom {
  const dom = document.createElement("div"); dom.className = "tn-search"; dom.setAttribute("role", "search");

  const field = document.createElement("div"); field.className = "tn-search-field";
  field.insertAdjacentHTML("afterbegin", ICONS.search);
  const find = document.createElement("input"); find.type = "text"; find.className = "tn-search-input"; find.spellcheck = false; find.value = initial.search;
  find.placeholder = langText("Szukaj…", "Find…"); find.setAttribute("aria-label", langText("Szukany tekst", "Text to find")); find.setAttribute("main-field", "true");
  const count = document.createElement("span"); count.className = "tn-search-count"; count.setAttribute("aria-live", "polite");
  field.append(find, count);

  const prev = button("tn-search-prev", ICONS.up, langText("Poprzednie dopasowanie (Shift+Enter)", "Previous match (Shift+Enter)"));
  const next = button("tn-search-next", ICONS.down, langText("Następne dopasowanie (Enter)", "Next match (Enter)"));
  const every = button("tn-search-all", ICONS.all, langText("Zaznacz wszystkie dopasowania (Ctrl+Enter)", "Select all matches (Ctrl+Enter)"));
  const matchCase = toggle(langText("Rozróżniaj wielkość liter", "Match case"), "Aa", langText("Rozróżniaj wielkość liter (Alt+C)", "Match case (Alt+C)"));
  const wholeWord = toggle(langText("Całe wyrazy", "Whole words"), "ab", langText("Tylko całe wyrazy (Alt+W)", "Whole words only (Alt+W)"));
  const regexp = toggle(langText("Wyrażenie regularne", "Regular expression"), ".*", langText("Wyrażenie regularne (Alt+R)", "Regular expression (Alt+R)"));
  const expand = button("tn-search-expand", ICONS.chevron, langText("Pokaż lub ukryj zamianę", "Show or hide replace"));
  const close = button("tn-search-close", ICONS.close, langText("Zamknij (Esc)", "Close (Esc)"));
  const first = document.createElement("div"); first.className = "tn-search-row";
  first.append(expand, field, prev, next, every, matchCase, wholeWord, regexp, close);

  const replace = document.createElement("input"); replace.type = "text"; replace.className = "tn-search-input tn-search-replace"; replace.spellcheck = false; replace.value = initial.replace;
  replace.placeholder = langText("Zamień na…", "Replace with…"); replace.setAttribute("aria-label", langText("Tekst zastępujący", "Replacement text"));
  const replaceOne = button("tn-search-replace-one tn-search-text", ICONS.replace, langText("Zamień bieżące dopasowanie (Enter)", "Replace this match (Enter)"));
  const replaceEvery = button("tn-search-replace-all tn-search-text", ICONS.replaceAll, langText("Zamień wszystkie (Ctrl+Alt+Enter)", "Replace all (Ctrl+Alt+Enter)"));
  for (const [node, text] of [[replaceOne, langText("Zamień", "Replace")], [replaceEvery, langText("Zamień wszystko", "Replace all")]] as const) {
    const label = document.createElement("span"); label.textContent = text; node.append(label);
  }
  const second = document.createElement("div"); second.className = "tn-search-row tn-search-replace-row";
  second.append(replace, replaceOne, replaceEvery);
  dom.append(first, second);
  return { dom, find, replace, count, second, prev, next, every, matchCase, wholeWord, regexp, expand, close, replaceOne, replaceEvery };
}

export function createSearchPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state);
  const { dom, find, replace, count, second, prev, next, every, matchCase, wholeWord, regexp, expand, close, replaceOne, replaceEvery } = buildSearchDom(initial);
  dom.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); closeSearchPanel(view); view.focus(); } });

  const setPressed = (node: HTMLElement, on: boolean) => { node.setAttribute("aria-pressed", String(on)); node.classList.toggle("selected", on); };
  const showReplace = (open: boolean) => {
    second.hidden = !open; expand.setAttribute("aria-expanded", String(open)); expand.classList.toggle("open", open); remember(open);
  };
  showReplace(remembered() || !!initial.replace);

  const commit = () => {
    const query = new SearchQuery({ search: find.value, replace: replace.value, caseSensitive: matchCase.getAttribute("aria-pressed") === "true", wholeWord: wholeWord.getAttribute("aria-pressed") === "true", regexp: regexp.getAttribute("aria-pressed") === "true" });
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    return query;
  };
  const refreshCount = () => {
    const query = getSearchQuery(view.state), result = countMatches(view.state, query);
    find.classList.toggle("invalid", result === null);
    count.classList.toggle("none", !!query.search && !!result && result.total === 0);
    if (!query.search) count.textContent = "";
    else if (result === null) count.textContent = langText("Błędny wzorzec", "Invalid pattern");
    else if (result.total === 0) count.textContent = langText("Brak wyników", "No results");
    else count.textContent = `${result.index || "?"} ${langText("z", "of")} ${result.total}${result.capped ? "+" : ""}`;
    for (const node of [prev, next, every, replaceOne, replaceEvery]) node.disabled = !query.search || result === null || result.total === 0;
  };
  const syncFromQuery = () => {
    const query = getSearchQuery(view.state);
    if (find.value !== query.search) find.value = query.search;
    if (replace.value !== query.replace) replace.value = query.replace;
    setPressed(matchCase, query.caseSensitive); setPressed(wholeWord, query.wholeWord); setPressed(regexp, query.regexp);
    refreshCount();
  };
  syncFromQuery();

  find.addEventListener("input", () => { commit(); if (find.value && getSearchQuery(view.state).valid) findNext(view); refreshCount(); });
  replace.addEventListener("input", commit);
  for (const node of [matchCase, wholeWord, regexp]) node.addEventListener("click", () => { setPressed(node, node.getAttribute("aria-pressed") !== "true"); commit(); refreshCount(); find.focus(); });
  find.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); commit();
    if (event.ctrlKey || event.metaKey) selectMatches(view); else if (event.shiftKey) findPrevious(view); else findNext(view);
  });
  replace.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); commit();
    if (event.ctrlKey && event.altKey) replaceAll(view); else replaceNext(view);
  });
  dom.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const target = ({ c: matchCase, w: wholeWord, r: regexp } as Record<string, HTMLElement>)[event.key.toLowerCase()];
    if (target) { event.preventDefault(); target.click(); }
  });
  prev.addEventListener("click", () => { commit(); findPrevious(view); });
  next.addEventListener("click", () => { commit(); findNext(view); });
  every.addEventListener("click", () => { commit(); selectMatches(view); });
  replaceOne.addEventListener("click", () => { commit(); replaceNext(view); });
  replaceEvery.addEventListener("click", () => { commit(); replaceAll(view); });
  expand.addEventListener("click", () => { showReplace(second.hidden); if (!second.hidden) replace.focus(); });
  close.addEventListener("click", () => { closeSearchPanel(view); view.focus(); });

  let pending = 0;
  return {
    dom,
    top: false,
    mount() { find.focus(); find.select(); },
    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)));
      if (queryChanged) syncFromQuery();
      else if ((update.docChanged || update.selectionSet) && !pending) {
        pending = window.requestAnimationFrame(() => { pending = 0; refreshCount(); });
      }
    },
  };
}
