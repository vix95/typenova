/** Project scan, section-index worker orchestration and indexing progress. */
import { type MarkdownSourceFile, type SectionGraphModel, buildSectionGraphModel } from "../graph/section-model";
import { scanMarkdownProject } from "../filesystem/markdown-project";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { persistGraphFileSelection, renderGraphFilterTree } from "./filter-panel";
import { renderGraph } from "./graph-renderer";
import { graphWorkspaceController, graphUi, type GraphSection } from "./graph-state";
import { renderGraphTree } from "./tree-renderer";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

let graphIndexProgressHideTimer = 0;
function setGraphIndexProgress(value: number | null, label?: string, indeterminate = false) {
  const progress = $("brainIndexProgress") as HTMLElement | null;
  const fill = progress?.querySelector<HTMLElement>(".brain-index-progress-fill");
  if (label !== undefined) { const status = $("brainStatus") as HTMLElement | null; if (status) status.textContent = label; }
  if (!progress) return;
  if (value === null) { progress.hidden = true; progress.classList.remove("is-indeterminate"); progress.removeAttribute("aria-valuenow"); return; }
  progress.hidden = false;
  progress.setAttribute("aria-label", langText("Indeksowanie nagłówków Markdown", "Indexing Markdown headings"));
  progress.classList.toggle("is-indeterminate", indeterminate);
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  if (indeterminate) progress.removeAttribute("aria-valuenow"); else progress.setAttribute("aria-valuenow", String(percent));
  progress.setAttribute("aria-valuetext", label || langText(`Indeksowanie nagłówków Markdown: ${percent}%`, `Indexing Markdown headings: ${percent}%`));
  if (fill) fill.style.width = `${indeterminate ? 34 : percent}%`;
}
function yieldGraphIndexToUI() { return new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
/** Stops any running layout/animation of the previous graph before a new build starts. */
function stopRunningGraphMotion(): void {
  if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout(); graphUi.stopGraphLayout = null; }
  if (graphUi.graphAnimationFrame) { cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; }
  if (graphUi.graphAmbientMotionStop) { const stop = graphUi.graphAmbientMotionStop; graphUi.graphAmbientMotionStop = null; stop(); }
}

function showNoProjectState(status: HTMLElement, graph: HTMLElement): void {
  status.textContent = langText("Otwórz folder projektu, aby zaindeksować sekcje Markdown.", "Open a project folder to index Markdown sections.");
  graph.innerHTML = `<div class="brain-empty"><span class="brain-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg></span><strong>${langText("Nie wybrano projektu", "No project selected")}</strong><span>${langText("Wybierz folder, aby zobaczyć sekcje Markdown i ich powiązania.", "Choose a folder to see Markdown sections and their relationships.")}</span></div>`;
}

function showTreeIndexingPlaceholder(tree: HTMLElement): void {
  const loading = document.createElement("div"); loading.className = "brain-empty"; loading.setAttribute("role", "status");
  const title = document.createElement("strong"); title.textContent = langText("Indeksowanie dokumentów…", "Indexing documents…");
  const detail = document.createElement("span"); detail.textContent = langText("Drzewo zostanie zaktualizowane po zakończeniu indeksowania.", "The tree will update when indexing completes.");
  loading.append(title, detail); tree.append(loading);
}

/** Scans the project for Markdown files and reports skipped entries. Returns null when the build was superseded meanwhile. */
async function scanProjectForIndexing(projectRoot: string, token: number, status: HTMLElement): Promise<MarkdownSourceFile[] | null> {
  const scanIssues: Array<{ path: string; operation: "read-directory" | "read-file"; message: string }> = [];
  const files: MarkdownSourceFile[] = await scanMarkdownProject(projectRoot, {
    isCancelled: () => !graphWorkspaceController.isCurrent(token),
    yieldControl: yieldGraphIndexToUI,
    onProgress: visited => setGraphIndexProgress(0, langText(`Skanowanie plików Markdown… (${visited})`, `Scanning Markdown files… (${visited})`), true),
    onError: issue => scanIssues.push(issue)
  });
  if (!graphWorkspaceController.isCurrent(token)) return null;
  if (scanIssues.length) {
    const warning = langText(
      `Indeks jest niepełny: pominięto ${scanIssues.length} plików lub katalogów z powodu błędów dostępu.`,
      `Index is incomplete: skipped ${scanIssues.length} files or folders due to access errors.`
    );
    status.textContent = warning;
    showToast(warning);
  }
  return files;
}

type IndexProgress = { stage: string; percent: number; fileIndex: number; fileCount: number };

function describeIndexProgress(progress: IndexProgress): string {
  const counts = `${progress.fileIndex}/${progress.fileCount}`;
  switch (progress.stage) {
    case "headings": return langText(`Indeksowanie nagłówków Markdown… (${counts} plików)`, `Indexing Markdown headings… (${counts} files)`);
    case "content": return langText(`Przygotowywanie zawartości sekcji… (${counts} plików)`, `Preparing section content… (${counts} files)`);
    case "links": return langText(`Analizowanie powiązań między sekcjami… (${counts} plików)`, `Resolving section links… (${counts} files)`);
    default: return langText("Budowanie wspólnego modelu grafu…", "Building the shared graph model…");
  }
}

type IndexWorkerMessage = { type?: string; requestId?: number; progress?: IndexProgress; sections?: GraphSection[]; model?: SectionGraphModel; message?: string };

/**
 * Sends the files to the indexing worker and resolves with its result. `registerCancel` receives a
 * function that rejects the pending request (used when the build is superseded) and `null` once settled.
 */
async function requestSectionIndex(
  token: number, indexWorker: Worker, requestId: number, files: MarkdownSourceFile[],
  registerCancel: (cancel: (() => void) | null) => void
): Promise<{ sections: GraphSection[]; model: SectionGraphModel | null }> {
  let model: SectionGraphModel | null = null;
  const sections = await new Promise<GraphSection[]>((resolve, reject) => {
    registerCancel(() => reject(new Error("Graph indexing cancelled")));
    indexWorker.onmessage = (event: MessageEvent) => {
      if (!graphWorkspaceController.isCurrent(token)) { indexWorker.terminate(); resolve([]); return; }
      const message = event.data as IndexWorkerMessage;
      if (message.requestId !== requestId) return;
      if (message.type === "progress" && message.progress) {
        setGraphIndexProgress(message.progress.percent, describeIndexProgress(message.progress));
        return;
      }
      if (message.type === "done") {
        if (!message.model) { reject(new Error("Section index worker returned no graph model")); return; }
        model = message.model;
        resolve(message.model.sections || message.sections || []);
        return;
      }
      if (message.type === "error") reject(new Error(message.message || "Section indexing failed"));
    };
    indexWorker.onerror = (event: ErrorEvent) => reject(new Error(event.message || "Section indexing worker failed"));
    indexWorker.postMessage({ type: "index", requestId, files });
    // postMessage structured-clones the payload synchronously. The main thread only
    // needs path/name metadata after dispatch, so release large Markdown strings now.
    for (const file of files) file.text = "";
  }).finally(() => {
    registerCancel(null);
    graphWorkspaceController.releaseIndexWorker(indexWorker);
    indexWorker.terminate();
  });
  return { sections, model };
}

/** Updates the list of indexable files and keeps the user's file selection consistent with it. */
function updateAvailableFiles(files: readonly MarkdownSourceFile[], sections: readonly GraphSection[]): void {
  const previousAvailableCount = graphUi.graphAvailableFiles.length;
  const previousWasAll = graphUi.graphSelectedFiles === null || (previousAvailableCount > 0 && graphUi.graphAvailableFiles.every(f => graphUi.graphSelectedFiles!.has(f.path)));
  const indexedPaths = new Set(sections.map(section => section.path));
  graphUi.graphAvailableFiles = files.filter(f => indexedPaths.has(f.path)).map(f => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang === "en" ? "en" : "pl") || a.path.localeCompare(b.path));
  if (previousWasAll) graphUi.graphSelectedFiles = null; else if (graphUi.graphSelectedFiles !== null) graphUi.graphSelectedFiles = new Set([...graphUi.graphSelectedFiles].filter(path => graphUi.graphAvailableFiles.some(f => f.path === path)));
}

export async function buildGraph() {
  const token = graphWorkspaceController.beginBuild();
  graphUi.graphSectionGraphModel = null;
  window.clearTimeout(graphIndexProgressHideTimer);
  setGraphIndexProgress(null);
  stopRunningGraphMotion();
  const status = $("brainStatus") as HTMLElement, graph = $("brainGraph") as HTMLElement;
  if (!documentState.projectRoot) { showNoProjectState(status, graph); if (graphUi.graphVisualMode === "tree") renderGraphTree(); return; }
  const tree = $("brainTree") as HTMLElement;
  graph.replaceChildren(); tree.replaceChildren();
  setGraphIndexProgress(0, langText("Skanowanie plików Markdown…", "Scanning Markdown files…"), true);
  if (graphUi.graphVisualMode === "tree") showTreeIndexingPlaceholder(tree);
  const files = await scanProjectForIndexing(documentState.projectRoot, token, status);
  if (!files) return;
  let indexWorker: Worker;
  try { indexWorker = new Worker(new URL("../graph/section-index.worker.ts", import.meta.url), { type: "module" }); }
  catch (error) {
    if (!graphWorkspaceController.isCurrent(token)) return;
    const message = langText("Nie można uruchomić workera indeksującego sekcje.", "Could not start the section indexing worker.");
    status.textContent = message; setGraphIndexProgress(null); showToast(`${message} ${String(error)}`); return;
  }
  let cancelPendingIndex: (() => void) | null = null;
  if (!graphWorkspaceController.attachIndexWorker(token, indexWorker, () => cancelPendingIndex?.())) return;
  const requestId = ++graphUi.graphSectionIndexRequestId;
  let sections: GraphSection[] = [];
  let indexedGraphModel: SectionGraphModel | null = null;
  try {
    ({ sections, model: indexedGraphModel } = await requestSectionIndex(token, indexWorker, requestId, files, cancel => { cancelPendingIndex = cancel; }));
  } catch (error) {
    if (!graphWorkspaceController.isCurrent(token)) return;
    const message = langText("Nie udało się zaindeksować dokumentów Markdown.", "Could not index Markdown documents.");
    status.textContent = message; setGraphIndexProgress(null);
    showToast(`${message} ${String(error)}`);
    return;
  }
  if (!graphWorkspaceController.isCurrent(token)) return;
  updateAvailableFiles(files, sections);
  renderGraphFilterTree(); persistGraphFileSelection();
  graphUi.graphSections = sections; graphUi.graphSectionGraphModel = indexedGraphModel || buildSectionGraphModel(sections); graphUi.graphZoom = 1; graphUi.graphPanX = 28; graphUi.graphPanY = 26; graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = true;
  setGraphIndexProgress(96, langText(`Rozmieszczanie ${sections.length} nagłówków…`, `Laying out ${sections.length} headings…`)); await yieldGraphIndexToUI(); if (!graphWorkspaceController.isCurrent(token)) return;
  renderGraph();
  if (!graphWorkspaceController.isCurrent(token)) return;
  const summary = langText(`${sections.length} sekcji · ${files.length} plików Markdown`, `${sections.length} sections · ${files.length} Markdown files`);
  status.textContent = summary; setGraphIndexProgress(100, summary);
  graphIndexProgressHideTimer = window.setTimeout(() => { if (graphWorkspaceController.isCurrent(token)) setGraphIndexProgress(null); }, 650);
}
