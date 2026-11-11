/** The data viewer: a dialog with the Table, Profile and Charts tabs for a CSV or text file of any size. Read only; the file is read in pieces by a worker. */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { suggestSpec, specForColumn } from "./chart-suggest";
import type { ChartSpec } from "./chart-spec";
import type { ColumnProfile } from "./column-stats";
import type { DataProfile } from "./data-profile";
import { DataRunAborted, fileStamp, grantFileAccess, isScopeError, runDataJob } from "./data-source";
import { buildCharts, type ChartsTab } from "./data-view-charts";
import { el, fmtInt, iconButton, labelButton } from "./data-view-dom";
import { buildProfile } from "./data-view-profile";
import { buildTable } from "./data-view-table";
import { insertChartBlock } from "./chart-embed";

type TabId = "table" | "profile" | "charts";
const TAB_KEY = "typenova.data.tab";

const TABS: ReadonlyArray<{ id: TabId; label: () => string }> = [
  { id: "table", label: () => langText("Dane", "Data") },
  { id: "profile", label: () => langText("Podsumowanie", "Summary") },
  { id: "charts", label: () => langText("Wykresy", "Charts") },
];

function rememberedTab(): TabId {
  try { const value = localStorage.getItem(TAB_KEY); if (value === "table" || value === "profile" || value === "charts") return value; } catch { /* storage unavailable */ }
  return "profile";
}

const megabytes = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString(langText("pl-PL", "en-US"), { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export interface ViewerOptions {
  /** The tab to start on (the last one used by default). */
  tab?: TabId;
  /** Opens the file in the text editor (offered by the viewer). */
  openInEditor?: (path: string) => void;
}

export async function openDataViewer(path: string, options: ViewerOptions = {}): Promise<void> {
  const name = basename(path);
  const dialog = el("dialog", "data-dialog");
  dialog.setAttribute("aria-label", langText(`Podgląd danych: ${name}`, `Data view: ${name}`));
  const title = el("span", "data-title", name); title.title = path;
  const meta = el("span", "data-meta");
  const header = el("div", "data-header");
  const tablist = el("div", "preview-view-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", langText("Widok danych", "Data view"));
  const tools = el("div", "data-header-tools");
  const body = el("div", "data-body");
  const loading = el("div", "data-loading");
  const bar = el("progress", "data-progress"); bar.max = 100; bar.value = 0;
  const loadingText = el("p", "", langText("Czytanie pliku…", "Reading the file…"));
  loading.append(loadingText, bar);
  body.append(loading);
  const close = iconButton("close", langText("Zamknij podgląd danych", "Close the data view"), () => dialog.close());
  if (options.openInEditor) tools.append(labelButton("edit", langText("Edytor", "Editor"), langText("Otwórz ten plik w edytorze tekstu", "Open this file in the text editor"), () => { dialog.close(); options.openInEditor!(path); }));
  tools.append(close);
  header.append(title, meta, tablist, tools);
  dialog.append(header, body);
  document.body.append(dialog);

  const controller = new AbortController();
  let charts: ChartsTab | null = null;
  const panels = new Map<TabId, HTMLElement>();
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  let profile: DataProfile | null = null;
  let current: TabId = options.tab ?? rememberedTab();

  function select(id: TabId): void {
    current = id;
    try { localStorage.setItem(TAB_KEY, id); } catch { /* storage unavailable */ }
    for (const [tab, button] of tabButtons) { const on = tab === id; button.classList.toggle("active", on); button.setAttribute("aria-selected", String(on)); button.tabIndex = on ? 0 : -1; }
    for (const [tab, panel] of panels) panel.hidden = tab !== id;
  }

  function buildTabs(loaded: DataProfile): void {
    const initial = suggestSpec(loaded, path);
    charts = buildCharts(loaded, path, initial, { insertIntoNote: (spec, noteId) => { if (insertChartBlock(path, spec, noteId)) dialog.close(); } });
    panels.set("table", buildTable(loaded));
    panels.set("profile", buildProfile(loaded, (column: ColumnProfile) => { charts?.setSpec(specForColumn(column, path) as ChartSpec); select("charts"); }));
    panels.set("charts", charts.element);
    for (const tab of TABS) {
      const button = el("button", "preview-view-tab", tab.label());
      button.type = "button"; button.setAttribute("role", "tab");
      button.addEventListener("click", () => select(tab.id));
      button.addEventListener("keydown", event => {
        const index = TABS.findIndex(candidate => candidate.id === current);
        const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        const target = TABS[(next + TABS.length) % TABS.length].id;
        select(target); tabButtons.get(target)?.focus();
      });
      tabButtons.set(tab.id, button); tablist.append(button);
    }
    body.replaceChildren(...panels.values());
    select(current);
  }

  dialog.addEventListener("close", () => { controller.abort(); charts?.dispose(); dialog.remove(); });
  dialog.addEventListener("cancel", () => controller.abort());
  dialog.showModal();

  try {
    const info = await fileStamp(path);
    meta.textContent = megabytes(info.size);
    const result = await runDataJob(path, { kind: "profile" }, { signal: controller.signal, onProgress: (read, size, rows) => {
      bar.value = Math.round((read / Math.max(1, size)) * 100);
      loadingText.textContent = langText(`Czytanie pliku… ${bar.value}% · ${fmtInt(rows)} wierszy`, `Reading the file… ${bar.value}% · ${fmtInt(rows)} rows`);
    } });
    if (result.kind !== "profile") {
      loading.replaceChildren(el("p", "data-error", result.kind === "error" && result.reason === "binary"
        ? langText("To nie jest plik tekstowy, więc nie można pokazać jego danych.", "This is not a text file, so its data cannot be shown.")
        : langText("Nie udało się odczytać pliku jako tekstu.", "The file could not be read as text.")));
      return;
    }
    profile = result.profile;
    const delimiter = result.delimiter === "\u0001" ? langText("bez separatora", "no delimiter")
      : `${langText("separator", "delimiter")}: ${result.delimiter === "\t" ? langText("tabulator", "tab") : result.delimiter}`;
    meta.textContent = `${megabytes(info.size)} · ${fmtInt(profile.rows)} ${langText("wierszy", "rows")} · ${fmtInt(profile.columns.length)} ${langText("kolumn", "columns")} · ${delimiter} · ${result.encoding.toUpperCase()}`;
    buildTabs(profile);
  } catch (error) {
    if (error instanceof DataRunAborted) return;
    if (isScopeError(error)) {
      // A file outside the opened folders: choosing it in the dialog grants access, then the view opens again.
      const again = labelButton("folder", langText("Wybierz plik, aby go udostępnić", "Choose the file to allow access"), langText("Wybierz ten plik w oknie, aby TypeNova mógł go czytać", "Choose this file in the dialog so that TypeNova can read it"), () => {
        void grantFileAccess(path).then(ok => { if (ok) { dialog.close(); void openDataViewer(path, options); } else showToast(langText("Wybrano inny plik — dostęp nie został nadany.", "A different file was chosen — access was not granted.")); });
      });
      loading.replaceChildren(el("p", "data-error", langText(`TypeNova nie ma dostępu do pliku „${name}”: leży poza otwartymi folderami projektu.`, `TypeNova has no access to “${name}”: it lies outside the opened project folders.`)), again);
      return;
    }
    loading.replaceChildren(el("p", "data-error", langText(`Nie udało się otworzyć pliku: ${String((error as Error)?.message ?? error)}`, `Could not open the file: ${String((error as Error)?.message ?? error)}`)));
    showToast(langText("Nie udało się otworzyć pliku danych", "Could not open the data file"));
  }
}

