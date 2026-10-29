/** Hierarchical Tree renderer. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { graphUi, type GraphSection } from "./graph-state";
import { selectGraphSection } from "./selection";
import { GRAPH_TREE_CANVAS_PADDING, graphTreeCollapsed, graphTreeZoom, clearGraphTreeMinimap, panGraphTreeNodeIntoView, renderGraphTreeMinimap, syncGraphTreeZoomControls } from "./tree-navigation";
import { langText } from "../i18n/language";
import { hideAppTooltip, showAppTooltip } from "../ui/tooltip";
import { basename } from "../filesystem/path-utils";
import { projectRootFor } from "../project/project-roots";

type TreeLayoutNode = { section: GraphSection; depth: number; parentId: string | null; children: TreeLayoutNode[]; hasChildren: boolean; expanded: boolean; siblingIndex: number; siblingCount: number; x: number; y: number; subtreeHeight: number };

const NODE_WIDTH = 252, NODE_HEIGHT = 82, LEVEL_GAP = 78, SIBLING_GAP = 24, ROOT_GAP = 48;

function stopGraphMotionForTreeView(): void {
  graphUi.graphEmphasisHandler = null;
  if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout(); graphUi.stopGraphLayout = null; }
  if (graphUi.graphAnimationFrame) { cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; }
  if (graphUi.graphAmbientMotionStop) { graphUi.graphAmbientMotionStop(); graphUi.graphAmbientMotionStop = null; }
  graphUi.graphAmbientMotionStart = null;
}

const TREE_EMPTY_FILE_ICON = '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 4h9l5 5v11H5zM14 4v5h5"/></svg>';
const TREE_EMPTY_SEARCH_ICON = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg>';

const treeNoProjectHtml = () => `<div class="brain-empty"><span class="brain-empty-icon" aria-hidden="true">${TREE_EMPTY_FILE_ICON}</span><strong>${langText("Nie wybrano projektu", "No project selected")}</strong><span>${langText("Wybierz folder projektu, aby zobaczyć hierarchię węzłów sekcji.", "Choose a project folder to view the section-node hierarchy.")}</span></div>`;

const treeNoResultsHtml = (allDocumentsHidden: boolean) => allDocumentsHidden
  ? `<div class="brain-empty brain-empty-no-selection" role="status"><span class="brain-empty-icon" aria-hidden="true">${TREE_EMPTY_FILE_ICON}</span><strong>${langText("Wszystkie dokumenty są ukryte", "All documents are hidden")}</strong><span>${langText("Włącz dokument lub katalog w panelu Filtry, aby ponownie wyświetlić węzły.", "Enable a document or folder in Filters to show section nodes again.")}</span></div>`
  : `<div class="brain-empty"><span class="brain-empty-icon" aria-hidden="true">${TREE_EMPTY_SEARCH_ICON}</span><strong>${langText("Nie znaleziono sekcji", "No sections found")}</strong><span>${langText("Zmień filtr lub wybór dokumentów, albo otwórz projekt zawierający nagłówki Markdown.", "Change the filter or document selection, or open a project containing Markdown headings.")}</span></div>`;

/**
 * Ids of the sections to show: every match of the filter plus its ancestors within the same file
 * (kept as context). While filtering, matching branches are expanded as a side effect.
 */
function collectVisibleSectionIds(files: readonly { path: string; name: string }[], filter: string, sectionById: Map<string, GraphSection>): { allowedIds: Set<string>; count: number } {
  const byFile = new Map<string, GraphSection[]>();
  for (const section of graphUi.graphSections) { const group = byFile.get(section.path) || []; group.push(section); byFile.set(section.path, group); }
  const allowedIds = new Set<string>();
  let count = 0;
  for (const file of files) {
    const sections = byFile.get(file.path) || [];
    const fileMatch = !!filter && (file.name.toLocaleLowerCase().includes(filter) || file.path.toLocaleLowerCase().includes(filter));
    const matches = sections.filter(section => !filter || fileMatch || section.title.toLocaleLowerCase().includes(filter) || section.file.toLocaleLowerCase().includes(filter) || section.path.toLocaleLowerCase().includes(filter));
    if (!matches.length) continue;
    count += matches.length;
    for (const match of matches) {
      let cursor: GraphSection | undefined = match; let guard = 0;
      while (cursor && guard++ < 64) {
        allowedIds.add(cursor.id);
        if (filter) graphTreeCollapsed.delete(cursor.id);
        const currentSection: GraphSection = cursor;
        const parentId: string | null = currentSection.parent;
        const parent: GraphSection | undefined = parentId ? sectionById.get(parentId) : undefined;
        cursor = parent && parent.path === currentSection.path ? parent : undefined;
      }
    }
  }
  return { allowedIds, count };
}

/** Lays the visible sections out as a left-to-right forest; returns the positioned nodes and the next free vertical offset. */
function layoutGraphTree(allowedIds: ReadonlySet<string>, sectionById: Map<string, GraphSection>): { positionedNodes: TreeLayoutNode[]; nextTop: number } {
  const childSectionsByParent = new Map<string, GraphSection[]>();
  for (const section of graphUi.graphSections) {
    if (!allowedIds.has(section.id) || !section.parent) continue;
    const parent = sectionById.get(section.parent);
    if (!parent || parent.path !== section.path || !allowedIds.has(parent.id)) continue;
    const children = childSectionsByParent.get(parent.id) || []; children.push(section); childSectionsByParent.set(parent.id, children);
  }
  for (const children of childSectionsByParent.values()) children.sort((a, b) => a.line - b.line);
  const roots = graphUi.graphSections.filter(section => {
    if (!allowedIds.has(section.id)) return false;
    if (!section.parent) return true;
    const parent = sectionById.get(section.parent);
    return !parent || parent.path !== section.path || !allowedIds.has(parent.id);
  }).sort((a, b) => a.path.localeCompare(b.path, document.documentElement.lang || "pl") || a.line - b.line);

  const buildNode = (section: GraphSection, depth: number, parentId: string | null, siblingIndex: number, siblingCount: number): TreeLayoutNode => {
    const allChildren = childSectionsByParent.get(section.id) || [];
    const hasChildren = allChildren.length > 0;
    const expanded = hasChildren && !graphTreeCollapsed.has(section.id);
    const children = expanded ? allChildren.map((child, index) => buildNode(child, depth + 1, section.id, index + 1, allChildren.length)) : [];
    const childrenHeight = children.reduce((sum, child) => sum + child.subtreeHeight, 0) + Math.max(0, children.length - 1) * SIBLING_GAP;
    return { section, depth, parentId, children, hasChildren, expanded, siblingIndex, siblingCount, x: 0, y: 0, subtreeHeight: Math.max(NODE_HEIGHT, childrenHeight) };
  };
  const rootNodes = roots.map((section, index) => buildNode(section, 1, null, index + 1, roots.length));
  const positionedNodes: TreeLayoutNode[] = [];
  const placeNode = (node: TreeLayoutNode, top: number) => {
    node.x = GRAPH_TREE_CANVAS_PADDING + (node.depth - 1) * (NODE_WIDTH + LEVEL_GAP);
    node.y = top + (node.subtreeHeight - NODE_HEIGHT) / 2;
    positionedNodes.push(node);
    if (!node.children.length) return;
    const childrenHeight = node.children.reduce((sum, child) => sum + child.subtreeHeight, 0) + Math.max(0, node.children.length - 1) * SIBLING_GAP;
    let childTop = top + (node.subtreeHeight - childrenHeight) / 2;
    for (const child of node.children) { placeNode(child, childTop); childTop += child.subtreeHeight + SIBLING_GAP; }
  };
  let nextTop = GRAPH_TREE_CANVAS_PADDING;
  for (const rootNode of rootNodes) { placeNode(rootNode, nextTop); nextTop += rootNode.subtreeHeight + ROOT_GAP; }
  return { positionedNodes, nextTop };
}

/** SVG layer with the orthogonal parent/child connectors. */
function buildTreeConnectors(positionedNodes: readonly TreeLayoutNode[], canvasWidth: number, canvasHeight: number): SVGSVGElement {
  const connectors = document.createElementNS("http://www.w3.org/2000/svg", "svg"); connectors.classList.add("brain-tree-connectors"); connectors.setAttribute("aria-hidden", "true"); connectors.setAttribute("focusable", "false"); connectors.setAttribute("width", String(canvasWidth)); connectors.setAttribute("height", String(canvasHeight)); connectors.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
  for (const node of positionedNodes) {
    if (!node.children.length) continue;
    const parentX = node.x + NODE_WIDTH, parentY = node.y + NODE_HEIGHT / 2, branchX = parentX + LEVEL_GAP / 2;
    const childCenters = node.children.map(child => child.y + NODE_HEIGHT / 2);
    const branchTop = Math.min(parentY, ...childCenters), branchBottom = Math.max(parentY, ...childCenters);
    const trunk = document.createElementNS("http://www.w3.org/2000/svg", "path"); trunk.classList.add("brain-tree-edge", "brain-tree-edge-trunk"); trunk.setAttribute("d", `M ${parentX} ${parentY} H ${branchX} M ${branchX} ${branchTop} V ${branchBottom}`); trunk.dataset.parentId = node.section.id; connectors.append(trunk);
    for (const child of node.children) {
      const edge = document.createElementNS("http://www.w3.org/2000/svg", "path"); edge.classList.add("brain-tree-edge"); edge.setAttribute("d", `M ${branchX} ${child.y + NODE_HEIGHT / 2} H ${child.x}`); edge.dataset.parentId = node.section.id; edge.dataset.childId = child.section.id; connectors.append(edge);
    }
  }
  return connectors;
}

const makeTreeIcon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
const TREE_MINUS_ICON = makeTreeIcon('<path d="M6 12h12"/>');
const TREE_PLUS_ICON = makeTreeIcon('<path d="M6 12h12M12 6v12"/>');

function toggleGraphTreeNode(tree: HTMLElement, sectionId: string): void {
  if (graphTreeCollapsed.has(sectionId)) graphTreeCollapsed.delete(sectionId); else graphTreeCollapsed.add(sectionId);
  renderGraphTree();
  const replacement = Array.from(tree.querySelectorAll<HTMLElement>(".brain-tree-node")).find(node => node.dataset.sectionId === sectionId);
  const replacementExpander = replacement?.querySelector<HTMLButtonElement>(".brain-tree-node-expander");
  replacementExpander?.focus({ preventScroll: true });
  panGraphTreeNodeIntoView(replacementExpander || replacement?.querySelector<HTMLElement>(".brain-tree-node-card") || null);
}

/** One positioned, interactive node card (selection, expand/collapse and connector hover highlighting). */
function createTreeNodeElement(node: TreeLayoutNode, tree: HTMLElement, connectors: SVGSVGElement, relativePath: (path: string) => string): HTMLElement {
  const section = node.section;
  const item = document.createElement("div"); item.className = `brain-tree-node level-${Math.min(6, section.level)}`; item.style.left = `${node.x}px`; item.style.top = `${node.y}px`; item.setAttribute("role", "treeitem"); item.setAttribute("aria-level", String(node.depth)); item.setAttribute("aria-posinset", String(node.siblingIndex)); item.setAttribute("aria-setsize", String(node.siblingCount)); item.setAttribute("aria-selected", String(graphUi.selectedGraphSection?.id === section.id)); item.dataset.sectionId = section.id; item.dataset.sectionPath = section.path;
  if (node.parentId) item.dataset.parentId = node.parentId;
  if (node.hasChildren) item.setAttribute("aria-expanded", String(node.expanded));
  if (graphUi.selectedGraphSection?.id === section.id) item.classList.add("is-selected");
  const card = document.createElement("button"); card.type = "button"; card.className = "brain-tree-node-card"; card.dataset.treeSectionId = section.id; card.dataset.tooltip = `${section.title} · ${relativePath(section.path)} · H${section.level} · ${langText("linia", "line")} ${section.line}`; card.removeAttribute("title");
  card.setAttribute("aria-label", langText(`${section.title}, plik ${relativePath(section.path)}, nagłówek H${section.level}, linia ${section.line}`, `${section.title}, file ${relativePath(section.path)}, heading H${section.level}, line ${section.line}`)); card.setAttribute("aria-pressed", String(graphUi.selectedGraphSection?.id === section.id));
  const level = document.createElement("span"); level.className = "brain-tree-node-level"; level.textContent = `H${section.level}`; level.setAttribute("aria-hidden", "true");
  const title = document.createElement("span"); title.className = "brain-tree-node-title"; title.textContent = section.title;
  const meta = document.createElement("span"); meta.className = "brain-tree-node-meta"; meta.textContent = `${relativePath(section.path)} · ${langText("linia", "line")} ${section.line}`;
  card.append(level, title, meta); card.addEventListener("click", () => selectGraphSection(section)); item.append(card);
  if (node.hasChildren) {
    const expander = document.createElement("button"); expander.type = "button"; expander.className = "brain-tree-node-expander"; expander.innerHTML = node.expanded ? TREE_MINUS_ICON : TREE_PLUS_ICON;
    const toggleLabel = langText(`${node.expanded ? "Zwiń" : "Rozwiń"} gałąź: ${section.title}`, `${node.expanded ? "Collapse" : "Expand"} branch: ${section.title}`);
    expander.setAttribute("aria-label", toggleLabel); expander.dataset.tooltip = toggleLabel; expander.removeAttribute("title"); expander.setAttribute("aria-expanded", String(node.expanded));
    expander.addEventListener("click", event => { event.stopPropagation(); toggleGraphTreeNode(tree, section.id); }); item.append(expander);
  }
  item.addEventListener("pointerenter", () => {
    item.classList.add("is-hovered");
    connectors.querySelectorAll<SVGPathElement>(".brain-tree-edge").forEach(edge => edge.classList.toggle("is-hovered", edge.dataset.parentId === section.id || edge.dataset.childId === section.id));
  });
  item.addEventListener("pointerleave", () => { item.classList.remove("is-hovered"); connectors.querySelectorAll<SVGPathElement>(".brain-tree-edge.is-hovered").forEach(edge => edge.classList.remove("is-hovered")); });
  return item;
}

/** Highlights a section (e.g. hovered in the related panel), expanding collapsed ancestors first. */
function createTreeEmphasisHandler(tree: HTMLElement, sectionById: Map<string, GraphSection>): (sectionId: string | null) => void {
  return (sectionId) => {
    if (sectionId) {
      let cursor = sectionById.get(sectionId); let changed = false; let guard = 0;
      while (cursor?.parent && guard++ < 64) { const parent = sectionById.get(cursor.parent); if (!parent || parent.path !== cursor.path) break; if (graphTreeCollapsed.delete(parent.id)) changed = true; cursor = parent; }
      if (changed) { renderGraphTree(); return; }
    }
    tree.querySelectorAll<HTMLElement>(".brain-tree-node").forEach(node => node.classList.toggle("is-related-hover", node.dataset.sectionId === sectionId));
    tree.querySelectorAll<SVGPathElement>(".brain-tree-edge").forEach(edge => edge.classList.toggle("is-related-hover", !!sectionId && (edge.dataset.parentId === sectionId || edge.dataset.childId === sectionId)));
    const node = sectionId ? Array.from(tree.querySelectorAll<HTMLElement>(".brain-tree-node")).find(item => item.dataset.sectionId === sectionId) || null : null;
    const target = node?.querySelector<HTMLElement>(".brain-tree-node-card") || null;
    if (target) { panGraphTreeNodeIntoView(target); showAppTooltip(target, 0, "right"); } else hideAppTooltip();
  };
}

/** Arrow-key navigation between nodes; Left/Right collapse, expand or jump to parent/first child. */
function createTreeKeyboardHandler(tree: HTMLElement): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const item = target?.closest<HTMLElement>(".brain-tree-node"); if (!target || !item) return;
    const visibleNodes = Array.from(tree.querySelectorAll<HTMLElement>(".brain-tree-node"));
    const currentIndex = visibleNodes.indexOf(item);
    const focusNode = (node: HTMLElement | undefined) => {
      const card = node?.querySelector<HTMLButtonElement>(".brain-tree-node-card");
      if (!card) return;
      card.focus({ preventScroll: true }); panGraphTreeNodeIntoView(card);
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const nextIndex = Math.max(0, Math.min(visibleNodes.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      focusNode(visibleNodes[nextIndex]); event.preventDefault(); return;
    }
    const expander = item.querySelector<HTMLButtonElement>(".brain-tree-node-expander");
    if (event.key === "ArrowRight") {
      if (expander?.getAttribute("aria-expanded") === "false") expander.click();
      else if (item.dataset.sectionId) focusNode(visibleNodes.find(candidate => candidate.dataset.parentId === item.dataset.sectionId));
      event.preventDefault(); return;
    }
    if (expander?.getAttribute("aria-expanded") === "true") expander.click();
    else if (item.dataset.parentId) focusNode(visibleNodes.find(candidate => candidate.dataset.sectionId === item.dataset.parentId));
    event.preventDefault();
  };
}

export function renderGraphTree() {
  const tree = $("brainTree") as HTMLElement;
  const status = $("brainStatus") as HTMLElement;
  const treeZoomOut = $("brainTreeZoomOut") as HTMLButtonElement | null;
  const treeZoomIn = $("brainTreeZoomIn") as HTMLButtonElement | null;
  if (treeZoomOut) treeZoomOut.disabled = true;
  if (treeZoomIn) treeZoomIn.disabled = true;
  stopGraphMotionForTreeView();
  const filter = (($("brainFilter") as HTMLInputElement).value || "").trim().toLocaleLowerCase();
  const files = graphUi.graphAvailableFiles.filter(file => graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(file.path));
  if (!documentState.projectRoot) {
    clearGraphTreeMinimap();
    tree.innerHTML = treeNoProjectHtml();
    return;
  }

  const sectionById = new Map<string, GraphSection>(graphUi.graphSections.map(section => [section.id, section] as const));
  const { allowedIds, count } = collectVisibleSectionIds(files, filter, sectionById);
  const selectedZero = graphUi.graphSelectedFiles !== null && graphUi.graphSelectedFiles.size === 0;
  if (!allowedIds.size) {
    clearGraphTreeMinimap();
    tree.innerHTML = treeNoResultsHtml(selectedZero);
    status.textContent = langText(`${graphUi.graphSections.length} sekcji · widoczne: 0`, `${graphUi.graphSections.length} sections · visible: 0`);
    return;
  }

  status.textContent = langText(`${graphUi.graphSections.length} sekcji · pasujące: ${count} · węzły z kontekstem: ${allowedIds.size}`, `${graphUi.graphSections.length} sections · matching: ${count} · nodes including context: ${allowedIds.size}`);

  const { positionedNodes, nextTop } = layoutGraphTree(allowedIds, sectionById);
  const maxRight = positionedNodes.reduce((max, node) => Math.max(max, node.x + NODE_WIDTH), 0);
  const canvasWidth = Math.max(tree.clientWidth, maxRight + GRAPH_TREE_CANVAS_PADDING);
  const canvasHeight = Math.max(tree.clientHeight, Math.max(GRAPH_TREE_CANVAS_PADDING * 2, nextTop - ROOT_GAP + GRAPH_TREE_CANVAS_PADDING));

  const scaledWidth = canvasWidth * graphTreeZoom, scaledHeight = canvasHeight * graphTreeZoom;
  graphUi.graphTreePanX = Math.max(GRAPH_TREE_CANVAS_PADDING - scaledWidth, Math.min(tree.clientWidth - GRAPH_TREE_CANVAS_PADDING, graphUi.graphTreePanX));
  graphUi.graphTreePanY = Math.max(GRAPH_TREE_CANVAS_PADDING - scaledHeight, Math.min(tree.clientHeight - GRAPH_TREE_CANVAS_PADDING, graphUi.graphTreePanY));
  const canvas = document.createElement("div"); canvas.className = "brain-tree-canvas"; canvas.setAttribute("role", "none"); canvas.style.width = `${Math.max(tree.clientWidth, scaledWidth)}px`; canvas.style.height = `${Math.max(tree.clientHeight, scaledHeight)}px`;
  const layer = document.createElement("div"); layer.className = "brain-tree-layer"; layer.style.width = `${canvasWidth}px`; layer.style.height = `${canvasHeight}px`; layer.style.transform = `translate(${graphUi.graphTreePanX}px, ${graphUi.graphTreePanY}px) scale(${graphTreeZoom})`;
  const connectors = buildTreeConnectors(positionedNodes, canvasWidth, canvasHeight);
  layer.append(connectors);
  const multipleRoots = documentState.projectRoots.length > 1;
  const relativePath = (path: string) => {
    const owner = projectRootFor(path);
    if (!owner) return path;
    const relative = path.slice(owner.length).replace(/^[\\/]+/, "");
    return multipleRoots ? `${basename(owner)}/${relative}` : relative;
  };
  for (const node of positionedNodes) layer.append(createTreeNodeElement(node, tree, connectors, relativePath));
  canvas.append(layer);
  tree.replaceChildren(canvas);
  renderGraphTreeMinimap(canvasWidth, canvasHeight, positionedNodes.map(node => ({ id: node.section.id, x: node.x, y: node.y, parentId: node.parentId, selected: graphUi.selectedGraphSection?.id === node.section.id, level: node.section.level })), NODE_WIDTH, NODE_HEIGHT);
  syncGraphTreeZoomControls();

  graphUi.graphEmphasisHandler = createTreeEmphasisHandler(tree, sectionById);
  if (graphUi.hoveredRelatedSectionId) graphUi.graphEmphasisHandler(graphUi.hoveredRelatedSectionId);
  tree.onkeydown = createTreeKeyboardHandler(tree);
}
