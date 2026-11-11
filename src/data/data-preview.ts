/** The Preview pane of a CSV, TSV or TXT file: two tabs, Data (the rows as a table) and Charts (statistics and a fixed set of charts chosen from the columns). The text of the open document is analysed in a worker. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { previewState } from "../preview/preview-state";
import { sentenceOf } from "./chart-wizard-model";
import { renderChartSvg } from "./chart-svg";
import type { JobResult } from "./data-job";
import { openInDataViewer } from "./data-open";
import { DataRunAborted, runDataJobOnText } from "./data-source";
import { chartNotes, chartTexts, el, fmtInt, iconButton, sentenceText } from "./data-view-dom";
import { buildProfile, statsLine } from "./data-view-profile";
import { buildTable } from "./data-view-table";

type TabId = "data" | "charts";
type Overview = Extract<JobResult, { kind: "overview" }>;
const TAB_KEY = "typenova.data.previewTab", REFRESH_DELAY = 400;

let root: HTMLElement | null = null;
let tabs: Map<TabId, HTMLButtonElement>, panels: Map<TabId, HTMLElement>, status: HTMLElement, fullView: HTMLButtonElement;
let timer = 0, controller: AbortController | null = null, shownText: string | null = null, shownPath = "";
let current: TabId = "data";

const filePath = (): string => documentState.currentPath || documentState.untitledLabel;
export const dataPreviewActive = (): boolean => documentMode(filePath()) === "table";

function select(id: TabId): void {
  current = id;
  try { localStorage.setItem(TAB_KEY, id); } catch { /* storage unavailable */ }
  for (const [tab, button] of tabs) { const on = tab === id; button.classList.toggle("active", on); button.setAttribute("aria-selected", String(on)); button.tabIndex = on ? 0 : -1; }
  for (const [tab, panel] of panels) panel.hidden = tab !== id;
}

/** The fixed set of charts: each with a sentence that says what it shows. */
function chartGrid(result: Overview): HTMLElement {
  const grid = el("div", "data-chart-grid");
  for (const { spec, data } of result.charts) {
    const card = el("figure", "data-chart-card");
    card.append(el("figcaption", "data-chart-caption", sentenceText(sentenceOf(spec))));
    card.insertAdjacentHTML("beforeend", renderChartSvg(data, chartTexts(), 440));
    const column = result.profile.columns.find(candidate => candidate.name === spec.x);
    if (column) card.append(el("p", "data-note", statsLine(column, result.profile.rows)));
    for (const note of chartNotes(data)) card.append(el("p", "data-note", note));
    grid.append(card);
  }
  return grid;
}

function show(result: Overview): void {
  const profile = result.profile;
  const delimiter = result.delimiter === "\u0001" ? langText("bez separatora", "no delimiter") : `${langText("separator", "delimiter")}: ${result.delimiter === "\t" ? langText("tabulator", "tab") : result.delimiter}`;
  status.textContent = `${fmtInt(profile.rows)} ${langText("wierszy", "rows")} · ${fmtInt(profile.columns.length)} ${langText("kolumn", "columns")} · ${delimiter}`;
  const charted = new Set(result.charts.map(chart => chart.spec.x));
  const charts = buildProfile(profile, null, column => !charted.has(column.name));
  if (result.charts.length) charts.querySelector(".data-tiles")?.after(chartGrid(result));
  charts.hidden = current !== "charts";
  const table = buildTable(profile);
  table.hidden = current !== "data";
  panels.get("data")?.replaceWith(table); panels.get("charts")?.replaceWith(charts);
  panels.set("data", table); panels.set("charts", charts);
}

async function rebuild(): Promise<void> {
  const text = view.state.doc.toString(), path = filePath();
  if (text === shownText && path === shownPath) return;
  controller?.abort();
  const mine = controller = new AbortController();
  status.textContent = langText("Analiza danych…", "Analysing the data…");
  try {
    const result = await runDataJobOnText(text, path.split(".").pop()?.toLowerCase() ?? "", { kind: "overview" }, { signal: mine.signal });
    if (mine.signal.aborted || result.kind !== "overview") return;
    shownText = text; shownPath = path;
    show(result);
  } catch (error) {
    if (error instanceof DataRunAborted || mine.signal.aborted) return;
    status.textContent = langText(`Nie udało się przeanalizować danych: ${String((error as Error)?.message ?? error)}`, `Could not analyse the data: ${String((error as Error)?.message ?? error)}`);
  }
}

/** Shows or hides the pane for the active document and analyses its text again after it changed. */
/** The words on the tabs follow the language of the interface (it can change after the pane was built). */
function labelTabs(): void {
  const words: Array<[TabId, string]> = [["data", langText("Dane", "Data")], ["charts", langText("Wykresy", "Charts")]];
  for (const [id, label] of words) tabs.get(id)!.textContent = label;
  fullView.dataset.tooltip = langText("Otwórz pełny podgląd danych: cały plik z dysku, wykresy do wstawienia w notatkę", "Open the full data view: the whole file from disk, charts to put into a note");
  fullView.setAttribute("aria-label", fullView.dataset.tooltip);
}

export function refreshDataPreview(immediate = false): void {
  if (!root) return;
  labelTabs();
  const active = dataPreviewActive();
  $("previewPane").classList.toggle("data-mode", active);
  root.hidden = !active;
  window.clearTimeout(timer);
  if (!active) { controller?.abort(); shownText = null; return; }
  fullView.hidden = !documentState.currentPath;
  if (!previewState.previewVisible) return;
  if (immediate) void rebuild(); else timer = window.setTimeout(() => { void rebuild(); }, REFRESH_DELAY);
}

export function initDataPreview(): void {
  try { const saved = localStorage.getItem(TAB_KEY); if (saved === "data" || saved === "charts") current = saved; } catch { /* storage unavailable */ }
  root = el("section", "data-preview"); root.hidden = true;
  const bar = el("div", "data-preview-bar");
  const list = el("div", "preview-view-tabs"); list.setAttribute("role", "tablist"); list.setAttribute("aria-label", langText("Widok danych", "Data view"));
  tabs = new Map(); panels = new Map();
  for (const [id, label] of [["data", langText("Dane", "Data")], ["charts", langText("Wykresy", "Charts")]] as const) {
    const button = el("button", "preview-view-tab", label); button.type = "button"; button.setAttribute("role", "tab");
    button.addEventListener("click", () => select(id));
    tabs.set(id, button); list.append(button);
    const panel = el("div", "data-panel-body"); panels.set(id, panel);
  }
  status = el("span", "data-preview-status"); status.setAttribute("role", "status");
  fullView = iconButton("table", langText("Otwórz pełny podgląd danych: cały plik z dysku, wykresy do wstawienia w notatkę", "Open the full data view: the whole file from disk, charts to put into a note"), () => { if (documentState.currentPath) void openInDataViewer(documentState.currentPath); });
  bar.append(list, status, fullView);
  root.append(bar, ...panels.values());
  select(current);
  $("preview").after(root);
}
