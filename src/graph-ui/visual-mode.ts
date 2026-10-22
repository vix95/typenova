/** Graph/Tree mode switch and its UI synchronisation. */
import type { GraphVisualMode } from "../graph/renderers";
import { $ } from "../app/dom";
import { syncGraphSearchClear } from "./graph-interactions";
import { renderGraph } from "./graph-renderer";
import { graphUi } from "./graph-state";
import { graphTreeMinimapModel, syncGraphTreeMinimapViewport, syncGraphTreeZoomControls } from "./tree-navigation";

export function syncGraphVisualModeUI() {
  const workspace = $("brainView") as HTMLElement;
  const toolbar = workspace.querySelector<HTMLElement>(".brain-toolbar");
  const graph = $("brainGraph") as HTMLElement;
  const tree = $("brainTree") as HTMLElement;
  const legend = $("brainLegend") as HTMLElement;
  const graphButton = $("brainGraphModeButton") as HTMLButtonElement;
  const treeButton = $("brainTreeModeButton") as HTMLButtonElement;
  const isTree = graphUi.graphVisualMode === "tree";
  workspace.classList.toggle("tree-view-mode", isTree);
  workspace.classList.toggle("graph-flat-view-mode", !isTree && !graphUi.graphGlobeMode);
  workspace.setAttribute("aria-label", isTree ? (document.documentElement.lang === "en" ? "Section hierarchy workspace" : "Obszar hierarchii sekcji") : (document.documentElement.lang === "en" ? "Section graph workspace" : "Obszar grafu sekcji"));
  toolbar?.classList.toggle("tree-view-mode", isTree);
  graph.hidden = isTree;
  tree.hidden = !isTree;
  legend.hidden = isTree;
  graphButton.classList.toggle("is-active", !isTree);
  treeButton.classList.toggle("is-active", isTree);
  graphButton.setAttribute("aria-pressed", String(!isTree));
  treeButton.setAttribute("aria-pressed", String(isTree));
  const en = document.documentElement.lang === "en";
  const title = $("brainWorkspaceTitle") as HTMLElement;
  const description = $("brainWorkspaceDescription") as HTMLElement;
  const icon = $("brainHeaderIcon") as HTMLElement | null;
  if (title) title.textContent = isTree ? (en ? "Section tree" : "Drzewo sekcji") : (en ? "Section graph" : "Graf sekcji");
  if (description) description.textContent = isTree ? (en ? "Explore connected heading nodes arranged by their parent-child hierarchy. Drag the empty canvas to pan." : "Odkrywaj połączone węzły nagłówków według relacji rodzic–dziecko. Przeciągnij puste tło, aby przesunąć planszę.") : (en ? "Explore document structure and relationships between topics." : "Odkrywaj strukturę dokumentów i powiązania między tematami.");
  if (icon) icon.innerHTML = isTree ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14M5 8h6M5 16h6M11 8v8M11 8h8M11 16h8"/><circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="11" cy="16" r="1.5"/><circle cx="19" cy="8" r="1.5"/><circle cx="19" cy="16" r="1.5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="18.5" cy="5" r="2"/><circle cx="18.5" cy="19" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2.5"/><path d="m6.8 7.3 3.3 3.1m4.1-1.2 2.5-2m-3.8 6.4 4.1 4M6.8 16.7l3.2-3"/></svg>';
  const graphModeLabel = en ? "Show graph view" : "Pokaż widok grafu";
  graphButton.setAttribute("aria-label", graphModeLabel); graphButton.dataset.tooltip = graphModeLabel; graphButton.removeAttribute("title");
  const treeModeLabel = en ? "Show tree view" : "Pokaż widok drzewa";
  treeButton.setAttribute("aria-label", treeModeLabel); treeButton.dataset.tooltip = treeModeLabel; treeButton.removeAttribute("title");
  const zoomOut = $("brainZoomOut") as HTMLButtonElement;
  const zoomOutLabel = en ? "Zoom out" : "Pomniejsz"; zoomOut.setAttribute("aria-label", zoomOutLabel); zoomOut.dataset.tooltip = zoomOutLabel; zoomOut.removeAttribute("title");
  const zoomIn = $("brainZoomIn") as HTMLButtonElement;
  const zoomInLabel = en ? "Zoom in" : "Powiększ"; zoomIn.setAttribute("aria-label", zoomInLabel); zoomIn.dataset.tooltip = zoomInLabel; zoomIn.removeAttribute("title");
  const treeZoomOut = $("brainTreeZoomOut") as HTMLButtonElement;
  const treeZoomOutLabel = en ? "Zoom out tree" : "Pomniejsz drzewo"; treeZoomOut.setAttribute("aria-label", treeZoomOutLabel); treeZoomOut.dataset.tooltip = treeZoomOutLabel; treeZoomOut.removeAttribute("title");
  const treeZoomIn = $("brainTreeZoomIn") as HTMLButtonElement;
  const treeZoomInLabel = en ? "Zoom in tree" : "Powiększ drzewo"; treeZoomIn.setAttribute("aria-label", treeZoomInLabel); treeZoomIn.dataset.tooltip = treeZoomInLabel; treeZoomIn.removeAttribute("title");
  const treeZoomControls = $("brainTreeZoomControls") as HTMLElement;
  treeZoomControls.setAttribute("aria-label", en ? "Tree zoom controls" : "Sterowanie powiększeniem drzewa");
  const treeMinimap = $("brainTreeMinimap") as HTMLElement;
  const treeMinimapTitle = $("brainTreeMinimapTitle") as HTMLElement;
  treeMinimapTitle.textContent = en ? "Minimap" : "Mini-mapa";
  treeMinimap.setAttribute("aria-label", en ? "Tree minimap. Click or drag to reposition the view; use arrow keys when focused." : "Mini-mapa drzewa. Kliknij lub przeciągnij, aby przesunąć widok; użyj strzałek, gdy minimapa ma fokus.");
  treeMinimap.hidden = !isTree || !graphTreeMinimapModel;
  const flatMinimap = $("brainGraphMinimap") as HTMLElement;
  const flatMinimapTitle = $("brainGraphMinimapTitle") as HTMLElement;
  flatMinimapTitle.textContent = en ? "Graph minimap" : "Mini-mapa grafu";
  flatMinimap.setAttribute("aria-label", en ? "Graph minimap. Click or drag to reposition the view; use arrow keys when focused." : "Mini-mapa grafu. Kliknij lub przeciągnij, aby przesunąć widok; użyj strzałek, gdy minimapa ma fokus.");
  flatMinimap.hidden = isTree || graphUi.graphGlobeMode || !graphUi.graphFlatMinimapReady;
  syncGraphTreeMinimapViewport();
  syncGraphTreeZoomControls();
  const fitButton = $("brainFit") as HTMLButtonElement;
  const fitLabel = en ? "Fit graph" : "Dopasuj graf"; fitButton.setAttribute("aria-label", fitLabel); fitButton.dataset.tooltip = fitLabel; fitButton.removeAttribute("title");
  const refresh = $("brainRefresh") as HTMLButtonElement;
  const refreshLabel = en ? "Refresh section index" : "Odśwież indeks sekcji";
  refresh.setAttribute("aria-label", refreshLabel); refresh.dataset.tooltip = refreshLabel; refresh.removeAttribute("title");
  const scopeButton = $("brainScopeButton") as HTMLButtonElement;
  const scopeLabel = en ? "Change project folder" : "Zmień folder projektu";
  scopeButton.setAttribute("aria-label", scopeLabel); scopeButton.dataset.tooltip = scopeLabel; scopeButton.removeAttribute("title");
  graph.setAttribute("aria-label", en ? "Interactive graph of Markdown sections" : "Interaktywny graf sekcji Markdown");
  tree.setAttribute("aria-label", en ? "Hierarchical tree of connected Markdown section nodes. Drag the empty canvas to pan; use the mouse wheel to zoom in or out." : "Hierarchiczne drzewo połączonych węzłów sekcji Markdown. Przeciągnij puste tło, aby przesunąć planszę; użyj rolki myszy, aby powiększyć lub pomniejszyć.");
  const searchInput = $("brainFilter") as HTMLInputElement;
  if (searchInput) { const label = en ? (isTree ? "Filter section nodes and file paths" : "Filter graph sections and files") : (isTree ? "Filtruj węzły sekcji i ścieżki plików" : "Filtruj sekcje i pliki w grafie"); searchInput.placeholder = isTree ? (en ? "Filter section nodes and file paths…" : "Filtruj węzły sekcji i ścieżki plików…") : (en ? "Filter sections and files…" : "Filtruj sekcje i pliki w grafie…"); searchInput.setAttribute("aria-label", label); searchInput.dataset.tooltip = label; }
  const searchForm = $("brainSearchForm") as HTMLFormElement;
  if (searchForm) searchForm.setAttribute("aria-label", en ? (isTree ? "Search section tree" : "Search section graph") : (isTree ? "Wyszukaj w drzewie sekcji" : "Wyszukaj w grafie sekcji"));
  const searchClear = $("brainFilterClear") as HTMLButtonElement;
  if (searchClear) { const label = en ? "Clear section search" : "Wyczyść wyszukiwanie sekcji"; searchClear.setAttribute("aria-label", label); searchClear.dataset.tooltip = label; }
  const filterButton = $("brainFilesButton") as HTMLButtonElement;
  if (filterButton) { filterButton.dataset.tooltip = en ? "Open document and folder filters" : "Otwórz filtry dokumentów i katalogów"; filterButton.removeAttribute("title"); }
  const filterPanel = $("brainFilterPanel") as HTMLElement;
  if (filterPanel) filterPanel.setAttribute("aria-label", en ? "Document and folder filters" : "Filtry dokumentów i katalogów");
  const filterPanelTitle = filterPanel?.querySelector<HTMLElement>(".brain-filter-panel-title strong");
  if (filterPanelTitle) filterPanelTitle.textContent = en ? "Document filters" : "Filtry dokumentów";
  graph.parentElement?.setAttribute("aria-label", isTree ? (en ? "Section tree view" : "Widok drzewa sekcji") : (en ? "Interactive graph view" : "Interaktywny widok grafu"));
}
export function setGraphVisualMode(mode: GraphVisualMode) {
  if (graphUi.graphVisualMode === mode) { syncGraphVisualModeUI(); return; }
  graphUi.graphVisualMode = mode;
  try { localStorage.setItem("typenova.brain.visualMode", mode); } catch { }
  if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout(); graphUi.stopGraphLayout = null; }
  if (graphUi.graphAmbientMotionStop) { graphUi.graphAmbientMotionStop(); graphUi.graphAmbientMotionStop = null; }
  graphUi.graphAmbientMotionStart = null;
  syncGraphVisualModeUI();
  syncGraphSearchClear();
  renderGraph();
}
