/** Find and replace panel of the editor: icon buttons, a match counter, option toggles and a collapsible replace row (replaces the stock CodeMirror panel). */
import { ICONS as SHARED_ICONS } from "../ui/icons";
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

const CHUNK_CHARS = 250_000;

/**
 * Adds the start positions of the matches between `from` and the end of the line holding `to` to `starts` (matches inside hidden
 * sections are left out; scanning stops at `cap` matches) and returns where the next chunk begins. A document is scanned in
 * chunks so that a search on a very large text never blocks the interface for long.
 */
export function scanChunk(state: EditorState, query: SearchQuery, from: number, starts: number[], cap: number): number {
  const doc = state.doc;
  const to = query.search.includes("\n") ? doc.length : doc.lineAt(Math.min(doc.length, from + CHUNK_CHARS)).to;
  const hidden = hiddenSectionsInState(state);
  const cursor = query.getCursor(state, from, to);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const start = step.value.from;
    if (hidden.length) { const line = doc.lineAt(start).number; if (hidden.some(range => line >= range.startLine && line <= range.endLine)) continue; }
    starts.push(start);
    if (starts.length >= cap) return doc.length + 1;
  }
  return to + 1;
}

/** Number (1-based) of the match that starts at `position`, or 0 when none does (binary search). */
export function matchIndexAt(starts: readonly number[], position: number): number {
  let low = 0, high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] === position) return middle + 1;
    if (starts[middle] < position) low = middle + 1; else high = middle - 1;
  }
  return 0;
}

function button(className: string, svg: string, label: string): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.className = `tn-search-btn ${className}`; node.innerHTML = svg;
  node.title = label; node.setAttribute("aria-label", label.replace(/\s*\(.*\)$/, ""));
  return node;
}

function toggle(label: string, svgIcon: string, title: string): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.className = "tn-search-toggle"; node.innerHTML = svgIcon;
  node.title = title; node.setAttribute("aria-label", label); node.setAttribute("aria-pressed", "false");
  return node;
}

interface SearchDom {
  dom: HTMLElement; go: HTMLButtonElement; find: HTMLInputElement; replace: HTMLInputElement; count: HTMLElement; second: HTMLElement;
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

  const go = document.createElement("button"); go.type = "button"; go.className = "tn-search-btn tn-search-go"; go.textContent = langText("Szukaj", "Search");
  go.title = langText("Szukaj (Enter)", "Search (Enter)");
  const prev = button("tn-search-prev", ICONS.up, langText("Poprzednie dopasowanie (Shift+Enter)", "Previous match (Shift+Enter)"));
  const next = button("tn-search-next", ICONS.down, langText("Następne dopasowanie (Enter)", "Next match (Enter)"));
  const every = button("tn-search-all", ICONS.all, langText("Zaznacz wszystkie dopasowania (Ctrl+Enter)", "Select all matches (Ctrl+Enter)"));
  const matchCase = toggle(langText("Rozróżniaj wielkość liter", "Match case"), SHARED_ICONS.matchCase, langText("Rozróżniaj wielkość liter (Alt+C)", "Match case (Alt+C)"));
  const wholeWord = toggle(langText("Całe wyrazy", "Whole words"), SHARED_ICONS.wholeWord, langText("Tylko całe wyrazy (Alt+W)", "Whole words only (Alt+W)"));
  const regexp = toggle(langText("Wyrażenie regularne", "Regular expression"), SHARED_ICONS.regex, langText("Wyrażenie regularne (Alt+R)", "Regular expression (Alt+R)"));
  const expand = button("tn-search-expand", ICONS.chevron, langText("Pokaż lub ukryj zamianę", "Show or hide replace"));
  const close = button("tn-search-close", ICONS.close, langText("Zamknij (Esc)", "Close (Esc)"));
  const first = document.createElement("div"); first.className = "tn-search-row";
  first.append(expand, field, go, prev, next, every, matchCase, wholeWord, regexp, close);

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
  return { dom, go, find, replace, count, second, prev, next, every, matchCase, wholeWord, regexp, expand, close, replaceOne, replaceEvery };
}

interface CounterUi { find: HTMLInputElement; count: HTMLElement; buttons: HTMLButtonElement[] }

/** Counts the matches of the active query chunk by chunk (the interface stays free in between) and shows "3 of 90" in the field. */
function createMatchCounter(view: EditorView, ui: CounterUi) {
  let found: { starts: number[]; capped: boolean } | null = { starts: [], capped: false };
  let counting = false, counted = false, job = 0, afterFirst: (() => void) | null = null;

  const show = () => {
    const query = getSearchQuery(view.state);
    ui.find.classList.toggle("invalid", found === null);
    ui.count.classList.toggle("none", !!query.search && !counting && !!found && found.starts.length === 0);
    if (!query.search) ui.count.textContent = "";
    else if (!found) ui.count.textContent = langText("Błędny wzorzec", "Invalid pattern");
    else if (!found.starts.length) ui.count.textContent = counting ? langText("Szukanie…", "Searching…") : langText("Brak wyników", "No results");
    else ui.count.textContent = `${matchIndexAt(found.starts, view.state.selection.main.from) || "?"} ${langText("z", "of")} ${found.starts.length}${found.capped ? "+" : ""}${counting ? "…" : ""}`;
    const none = !query.search || !found || !found.starts.length;
    for (const node of ui.buttons) node.disabled = none;
  };

  /** Starts counting for the active query; `afterFirst` (if set) runs once the first match is known. */
  const start = () => {
    const mine = ++job, state = view.state, query = getSearchQuery(state);
    counted = false; counting = false;
    if (!query.search || !query.valid) { found = query.search ? null : { starts: [], capped: false }; counted = true; afterFirst = null; show(); return; }
    const starts: number[] = [];
    found = { starts, capped: false }; counting = true;
    let position = 0;
    const step = () => {
      if (mine !== job) return;
      position = scanChunk(state, query, position, starts, COUNT_LIMIT);
      found = { starts, capped: starts.length >= COUNT_LIMIT };
      if (starts.length && afterFirst) { const action = afterFirst; afterFirst = null; action(); }
      if (position > state.doc.length) { counting = false; counted = true; afterFirst = null; show(); return; }
      show(); window.setTimeout(step, 0);
    };
    step();
  };

  return {
    show, start,
    get found() { return found; }, get counting() { return counting; }, get counted() { return counted; },
    afterFirst(action: (() => void) | null) { afterFirst = action; },
    cancel() { job++; },
  };
}

export function createSearchPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state);
  const { dom, go, find, replace, count, second, prev, next, every, matchCase, wholeWord, regexp, expand, close, replaceOne, replaceEvery } = buildSearchDom(initial);
  dom.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); closeSearchPanel(view); view.focus(); } });

  const setPressed = (node: HTMLElement, on: boolean) => { node.setAttribute("aria-pressed", String(on)); node.classList.toggle("selected", on); };
  const showReplace = (open: boolean) => {
    second.hidden = !open; expand.setAttribute("aria-expanded", String(open)); expand.classList.toggle("open", open); remember(open);
  };
  showReplace(remembered() || !!initial.replace);

  // The query runs only on "Search" or Enter: typing does not search, highlight or count anything. Counting is done in chunks
  // between which the interface stays free, and the jump to a match happens as soon as the first match is known.
  let applied = initial.search;
  const counter = createMatchCounter(view, { find, count, buttons: [prev, next, every, replaceOne, replaceEvery] });
  const flag = (node: HTMLElement) => node.getAttribute("aria-pressed") === "true";
  /** Makes the typed text the active query; returns true when the editor's query had to change. */
  const apply = (text: string) => {
    applied = text;
    const query = new SearchQuery({ search: text, replace: replace.value, caseSensitive: flag(matchCase), wholeWord: flag(wholeWord), regexp: flag(regexp) });
    if (query.eq(getSearchQuery(view.state))) return false;
    view.dispatch({ effects: setSearchQuery.of(query) });
    return true;
  };
  const syncFromQuery = () => {
    const query = getSearchQuery(view.state);
    applied = query.search;
    if (find.value !== query.search) find.value = query.search;
    if (replace.value !== query.replace) replace.value = query.replace;
    setPressed(matchCase, query.caseSensitive); setPressed(wholeWord, query.wholeWord); setPressed(regexp, query.regexp);
    counter.start();
  };
  syncFromQuery();

  /** Runs the typed query and moves to the next (or previous) match, or selects them all. */
  const search = (direction: "next" | "previous" | "all" = "next") => {
    const act = () => {
      if (direction === "all") selectMatches(view); else if (direction === "previous") findPrevious(view); else findNext(view);
    };
    counter.afterFirst(null);
    const changed = apply(find.value); // a changed query restarts the counting through the panel update below
    if (!find.value || !getSearchQuery(view.state).valid) return;
    if (!changed && !counter.counting && !counter.counted) counter.start();
    if (counter.found && counter.found.starts.length) act(); else counter.afterFirst(act);
  };
  // Typing only blanks the counter, which no longer belongs to the text in the field.
  find.addEventListener("input", () => { if (find.value !== applied) { count.textContent = ""; find.classList.remove("invalid"); } });
  // The options change an already running query, not the text being typed.
  for (const node of [matchCase, wholeWord, regexp]) node.addEventListener("click", () => { setPressed(node, !flag(node)); if (applied) apply(applied); find.focus(); });
  find.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    search(event.ctrlKey || event.metaKey ? "all" : event.shiftKey ? "previous" : "next");
  });
  go.addEventListener("click", () => search());
  replace.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); apply(applied);
    if (event.ctrlKey && event.altKey) replaceAll(view); else replaceNext(view);
  });
  dom.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const target = ({ c: matchCase, w: wholeWord, r: regexp } as Record<string, HTMLElement>)[event.key.toLowerCase()];
    if (target) { event.preventDefault(); target.click(); }
  });
  prev.addEventListener("click", () => search("previous"));
  next.addEventListener("click", () => search("next"));
  every.addEventListener("click", () => search("all"));
  replaceOne.addEventListener("click", () => { apply(applied); replaceNext(view); });
  replaceEvery.addEventListener("click", () => { apply(applied); replaceAll(view); });
  expand.addEventListener("click", () => { showReplace(second.hidden); if (!second.hidden) replace.focus(); });
  close.addEventListener("click", () => { closeSearchPanel(view); view.focus(); });

  let timer = 0;
  return {
    dom,
    top: false,
    mount() { find.focus(); find.select(); },
    destroy() { window.clearTimeout(timer); counter.cancel(); },
    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)));
      if (queryChanged) syncFromQuery();
      else if (update.docChanged) { window.clearTimeout(timer); timer = window.setTimeout(counter.start, 500); }
      else if (update.selectionSet) counter.show();
    },
  };
}
