/** The "Backlinks" section under the table of contents: which notes link to the note in use, with the line of each link; a click opens it there. */
import { $ } from "../app/dom";
import { activeNoteTab, backlinksOfActive, type BacklinkResult } from "../documents/backlinks";
import { documentState } from "../documents/document-state";
import { view } from "../editor/editor-view";
import { sectionTitles } from "../graph/link-rename";
import { openGraphSection } from "../graph-ui/selection";
import { langText } from "../i18n/language";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";

const OPEN_KEY = "typenova.backlinks.open", DELAY = 350, MAX_SHOWN = 200, CONTEXT_BEFORE = 24, CONTEXT_AFTER = 40;
let timer = 0, run = 0, signature = "";
let last: BacklinkResult | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

/** The line with the link set off from the rest (the text is put in with textContent: a note can hold anything). */
function lineWithLink(text: string, inner: string): HTMLElement {
  const line = el("span", "backlink-line");
  const at = text.indexOf(`[[${inner}`);
  if (at < 0) { line.textContent = text; return line; }
  const end = text.indexOf("]]", at);
  const stop = end < 0 ? text.length : end + 2;
  // A long line is shown around the link, not from its start (the link may be far to the right and would be cut off).
  const from = Math.max(0, at - CONTEXT_BEFORE), to = Math.min(text.length, stop + CONTEXT_AFTER);
  line.append(document.createTextNode(`${from > 0 ? "…" : ""}${text.slice(from, at)}`), el("mark", "backlink-link", text.slice(at, stop)), document.createTextNode(`${text.slice(stop, to)}${to < text.length ? "…" : ""}`));
  return line;
}

function hitRow(path: string, hit: BacklinkResult["hits"][number]): HTMLElement {
  const row = el("button", "backlink-hit");
  row.type = "button";
  row.append(el("span", "backlink-number", String(hit.line)), lineWithLink(hit.text, hit.inner));
  const label = langText(`Otwórz „${hit.name}” w linii ${hit.line}`, `Open “${hit.name}” at line ${hit.line}`);
  row.dataset.tooltip = label; row.setAttribute("aria-label", `${label}: ${hit.text}`);
  row.addEventListener("click", () => { void openGraphSection({ path, line: hit.line }); });
  return row;
}

function render(result: BacklinkResult | null): void {
  const section = $("backlinks"), body = $("backlinksBody");
  section.hidden = !result;
  if (!result) return;
  $("backlinksCount").textContent = String(result.hits.length);
  const files = new Map<string, BacklinkResult["hits"]>();
  for (const hit of result.hits.slice(0, MAX_SHOWN)) files.set(hit.path, [...(files.get(hit.path) ?? []), hit]);
  if (result.tooLarge) { body.replaceChildren(el("p", "muted", langText("Projekt jest za duży, żeby szukać linków zwrotnych.", "The project is too large to search for backlinks."))); return; }
  if (!files.size) { body.replaceChildren(el("p", "muted", langText("Żadna notatka nie linkuje tutaj. Link do tej notatki ma postać [[nazwa]] albo [[nazwa#sekcja]].", "No note links here. A link to this note looks like [[name]] or [[name#section]]."))); return; }
  const list = el("div", "backlink-files");
  for (const [path, hits] of files) {
    const group = el("div", "backlink-file");
    group.append(el("div", "backlink-file-name", hits[0].name.replace(/\.[a-z0-9]{1,8}$/i, "")), ...hits.map(hit => hitRow(path, hit)));
    list.append(group);
  }
  body.replaceChildren(list);
  if (result.hits.length > MAX_SHOWN) body.append(el("p", "muted", langText(`Pokazano ${MAX_SHOWN} z ${result.hits.length} linków.`, `Showing ${MAX_SHOWN} of ${result.hits.length} links.`)));
}

function labelHeading(): void {
  const open = readPreferenceFlag(OPEN_KEY, true);
  const button = $("backlinksToggle");
  button.setAttribute("aria-expanded", String(open));
  $("backlinksBody").hidden = !open;
  $("backlinksTitle").textContent = langText("Linki zwrotne", "Backlinks");
  const label = open ? langText("Zwiń linki zwrotne", "Collapse the backlinks") : langText("Rozwiń linki zwrotne", "Expand the backlinks");
  button.dataset.tooltip = label; button.setAttribute("aria-label", `${langText("Linki zwrotne", "Backlinks")}: ${label}`);
}

/** What the answer depends on: the note and its section titles (the files that link to it are looked at again only when these change). */
function signatureOfActive(): string {
  const tab = activeNoteTab();
  return tab ? `${tab.path}|${sectionTitles(view.state.doc.toString()).map(section => section.title).join("\u0000")}|${documentState.projectRoots.join("|")}` : "";
}

async function refresh(force: boolean): Promise<void> {
  const mine = ++run;
  const next = signatureOfActive();
  if (!force && next === signature) return;
  signature = next;
  if (!next) { last = null; render(null); return; }
  try {
    const result = await backlinksOfActive();
    if (mine === run) { last = result; render(result); }
  } catch (error) {
    if (mine === run) { render(null); console.warn("Could not look for backlinks", error); }
  }
}

/** Looks again, a moment after the last call (the outline is rebuilt on every edit; only a change of what matters starts a search). */
export function scheduleBacklinks(force = false): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void refresh(force); }, DELAY);
}

export function installBacklinks(): void {
  labelHeading();
  $("backlinksToggle").addEventListener("click", () => { writePreferenceFlag(OPEN_KEY, !readPreferenceFlag(OPEN_KEY, true)); labelHeading(); });
  document.addEventListener("typenova:language-changed", () => { labelHeading(); render(last); });
}
