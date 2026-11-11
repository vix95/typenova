/** Charts inside Markdown notes: a ```chart block is replaced in the preview by the drawing of the data file it names, and the data viewer can write such a block into the note. */
import { preview } from "../app/workspace-dom";
import { documentState } from "../documents/document-state";
import { switchToTab } from "../documents/tabs";
import { insertAtCursor } from "../editor/editing-commands";
import { view } from "../editor/editor-view";
import { relativeImagePath } from "../editor/image-insert";
import { pathIsInside } from "../filesystem/project-tree-operations";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { projectRootFor } from "../project/project-roots";
import { showToast } from "../ui/toast";
import { parseChartSpec, resolveBesideNote, specToBlock, type ChartSpec } from "./chart-spec";
import { renderChartSvg } from "./chart-svg";
import { DataRunAborted, grantFileAccess, isScopeError, runChart } from "./data-source";
import { chartNotes, chartTexts, el, fmtInt } from "./data-view-dom";

const MARKDOWN_PATH = /.(?:md|markdown|mdown|mkd|mdx|rmd|qmd|mdc)$/i;
let observer: IntersectionObserver | null = null;
/** The last drawing of each block, so that a block the virtual preview mounts again shows at once and is only refreshed when the file changed. */
const drawn = new Map<string, string>();
/** Charts are computed one at a time: each one reads its whole file. */
let queue: Promise<unknown> = Promise.resolve();

export function observeCharts(root: HTMLElement): void {
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { observer?.unobserve(entry.target); void renderChartBlock(entry.target as HTMLElement); }
    }, { root: preview, rootMargin: "600px 0px" });
  }
  for (const code of Array.from(root.querySelectorAll<HTMLElement>("pre code.language-chart"))) {
    const pre = code.closest("pre");
    if (pre && pre.dataset.rendered !== "yes") observer.observe(pre);
  }
}

function message(kind: "error" | "info", text: string): HTMLElement {
  const box = el("div", `chart-message is-${kind}`);
  box.setAttribute("role", kind === "error" ? "alert" : "status");
  box.append(el("p", "", text));
  return box;
}

/** The data file a block names, or why it cannot be read: it has to stay inside the project folder (or beside the note when there is no project). */
function dataPathFor(notePath: string, spec: ChartSpec): { path: string } | { problem: string } {
  const resolved = resolveBesideNote(notePath, spec.file);
  if (!resolved) return { problem: langText("Ścieżka pliku wychodzi poza dysk.", "The file path leaves the drive.") };
  const normalizedNote = notePath.replace(/\\/g, "/");
  const root = projectRootFor(notePath)?.replace(/\\/g, "/") ?? normalizedNote.slice(0, normalizedNote.lastIndexOf("/"));
  if (!pathIsInside(root, resolved)) return { problem: langText("Plik z danymi musi leżeć w folderze projektu notatki.", "The data file must be inside the project folder of the note.") };
  return { path: resolved };
}

export async function renderChartBlock(pre: HTMLElement): Promise<void> {
  if (pre.dataset.rendered === "yes" || !pre.isConnected) return;
  pre.dataset.rendered = "yes";
  const source = pre.querySelector("code")?.textContent ?? "";
  const notePath = documentState.currentPath;
  const parsed = parseChartSpec(source);
  const host = el("div", "chart-container");
  host.dataset.chartSource = source;
  pre.replaceWith(host);
  if (!parsed.ok) { host.replaceChildren(message("error", langText(`Blok „chart”: ${parsed.error}`, `“chart” block: ${parsed.error}`))); return; }
  if (!notePath) { host.replaceChildren(message("info", langText("Zapisz notatkę, aby wykres mógł odczytać plik z danymi.", "Save the note so that the chart can read its data file."))); return; }
  const target = dataPathFor(notePath, parsed.spec);
  if ("problem" in target) { host.replaceChildren(message("error", target.problem)); return; }
  const memo = `${notePath}\u0000${source}`;
  const before = drawn.get(memo);
  if (before) host.innerHTML = before;
  else host.replaceChildren(message("info", langText(`Liczenie wykresu z „${basename(target.path)}”…`, `Computing the chart from “${basename(target.path)}”…`)));
  const job = queue.then(() => compute(host, target.path, parsed.spec, memo, notePath), () => compute(host, target.path, parsed.spec, memo, notePath));
  queue = job.catch(() => undefined);
  await job;
}

async function compute(host: HTMLElement, path: string, spec: ChartSpec, memo: string, notePath: string): Promise<void> {
  if (!host.isConnected) return;
  try {
    const result = await runChart(path, spec, { onProgress: (read, size) => {
      const waiting = host.querySelector<HTMLElement>(".chart-message p");
      if (waiting && !host.querySelector("svg")) waiting.textContent = langText(`Liczenie wykresu z „${basename(path)}”… ${Math.round((read / Math.max(1, size)) * 100)}%`, `Computing the chart from “${basename(path)}”… ${Math.round((read / Math.max(1, size)) * 100)}%`);
    } });
    if (!host.isConnected) return;
    if (result.kind !== "chart") { host.replaceChildren(message("error", langText("Plik z danymi nie jest tekstem.", "The data file is not text."))); return; }
    if (result.error) { host.replaceChildren(message("error", langText(`W pliku „${basename(path)}” nie ma wskazanej kolumny (${result.error}).`, `The file “${basename(path)}” has no such column (${result.error}).`))); return; }
    const caption = langText(`${basename(path)} · ${fmtInt(result.data.rows)} wierszy`, `${basename(path)} · ${fmtInt(result.data.rows)} rows`);
    const notes = chartNotes(result.data).map(note => `<p class="chart-note">${escapeHtml(note)}</p>`).join("");
    const title = spec.title ? `<h4 class="chart-title">${escapeHtml(spec.title)}</h4>` : "";
    let drawnWidth = 0;
    /** Drawn at the width of the preview, so that the text keeps its size in a narrow pane instead of shrinking with the whole drawing. */
    const draw = (): void => {
      drawnWidth = host.clientWidth;
      const width = Math.max(300, Math.min(760, drawnWidth - 26));
      const html = `${title}${renderChartSvg(result.data, chartTexts(), width)}<p class="chart-caption">${escapeHtml(caption)}</p>${notes}`;
      drawn.set(memo, html);
      if (drawn.size > 60) drawn.delete(drawn.keys().next().value as string);
      if (documentState.currentPath === notePath) host.innerHTML = html;
    };
    draw();
    const resize = new ResizeObserver(() => {
      if (!host.isConnected) { resize.disconnect(); return; }
      if (Math.abs(host.clientWidth - drawnWidth) > 24) draw();
    });
    resize.observe(host);
  } catch (error) {
    if (error instanceof DataRunAborted) return;
    if (isScopeError(error)) { host.replaceChildren(noAccessMessage(path, () => { drawn.delete(memo); host.replaceChildren(message("info", langText("Liczenie wykresu…", "Computing the chart…"))); void compute(host, path, spec, memo, notePath); })); return; }
    host.replaceChildren(message("error", langText(`Nie udało się policzyć wykresu: ${String((error as Error)?.message ?? error)}`, `Could not compute the chart: ${String((error as Error)?.message ?? error)}`)));
  }
}

/** TypeNova may read only what the user opened: a file next to a note that was opened alone is outside that. Choosing the file in the dialog grants it, so the message offers exactly that. */
function noAccessMessage(path: string, retry: () => void): HTMLElement {
  const box = message("error", langText(`TypeNova nie ma dostępu do pliku „${basename(path)}”: leży poza otwartymi folderami projektu. Wybierz ten plik jeszcze raz, aby go udostępnić, albo otwórz jego folder jako projekt.`, `TypeNova has no access to “${basename(path)}”: it lies outside the opened project folders. Choose the file once more to allow it, or open its folder as a project.`));
  const button = el("button", "data-tool data-tool-labelled", langText("Wybierz plik, aby go udostępnić", "Choose the file to allow access"));
  button.type = "button";
  button.addEventListener("click", () => { void grantFileAccess(path).then(ok => { if (ok) retry(); else showToast(langText("Wybrano inny plik — dostęp nie został nadany.", "A different file was chosen — access was not granted.")); }); });
  box.append(button);
  return box;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The saved Markdown note being edited, or null. */
export function activeNote(): string | null {
  const path = documentState.currentPath;
  return path && /\.(?:md|markdown|mdown|mkd|mdx|rmd|qmd|mdc)$/i.test(path) ? path : null;
}

/** The text of the block for a data file, with its path relative to the active note (the file name alone when there is no saved note, to be corrected after pasting). */
export function chartBlockFor(dataPath: string, spec: ChartSpec): string {
  const note = activeNote();
  const relative = note ? relativeImagePath(note, dataPath) : basename(dataPath);
  return specToBlock({ ...spec, file: /^[a-z]:|^\//i.test(relative) ? basename(dataPath) : relative });
}

export interface NoteTarget { id: string; name: string; path: string; active: boolean }

/** The saved Markdown notes that are open in tabs: the places "Insert into note" can write to. The active one comes first. */
export function noteTargets(): NoteTarget[] {
  const targets = documentState.tabs.map(tab => {
    const active = tab.id === documentState.activeTabId;
    const path = active ? documentState.currentPath : tab.path;
    return path && MARKDOWN_PATH.test(path) ? { id: tab.id, name: basename(path), path, active } : null;
  }).filter((target): target is NoteTarget => target !== null);
  return targets.sort((a, b) => Number(b.active) - Number(a.active));
}

/**
 * Writes the chart block for \`spec\` into a note and selects it, so that it is plain where it went. \`targetId\` is a tab from \`noteTargets\` (the active note when omitted): that tab is shown and the block goes at its cursor.
 * The data file is named relative to the note. Returns false (with a message) when that is not possible.
 */
export function insertChartBlock(dataPath: string, spec: ChartSpec, targetId?: string): boolean {
  if (targetId && targetId !== documentState.activeTabId) switchToTab(targetId);
  const notePath = documentState.currentPath;
  if (!notePath) { showToast(langText("Zapisz najpierw notatkę — wykres wskazuje plik względem jej położenia.", "Save the note first — a chart names its file relative to the note.")); return false; }
  if (!/\.(?:md|markdown|mdown|mkd|mdx|rmd|qmd|mdc)$/i.test(notePath)) { showToast(langText("Aktywny dokument nie jest notatką Markdown.", "The active document is not a Markdown note.")); return false; }
  const relative = relativeImagePath(notePath, dataPath);
  if (/^[a-z]:|^\//i.test(relative)) { showToast(langText("Plik z danymi leży na innym dysku niż notatka.", "The data file is on another drive than the note.")); return false; }
  if (!pathIsInside(projectRootFor(notePath) ?? notePath.slice(0, Math.max(notePath.lastIndexOf("/"), notePath.lastIndexOf("\\"))), dataPath.replace(/\\/g, "/"))) {
    showToast(langText("Plik z danymi leży poza folderem projektu notatki, więc wykres by go nie odczytał.", "The data file is outside the note's project folder, so the chart could not read it."));
    return false;
  }
  const text = `\n${specToBlock({ ...spec, file: relative })}`;
  const from = view.state.selection.main.from;
  insertAtCursor(text);
  view.dispatch({ selection: { anchor: from + 1, head: from + text.length - 1 }, scrollIntoView: true });
  showToast(langText(`Wstawiono blok wykresu do „${basename(notePath)}” (jest zaznaczony w edytorze).`, `Chart block inserted into “${basename(notePath)}” (it is selected in the editor).`));
  return true;
}
