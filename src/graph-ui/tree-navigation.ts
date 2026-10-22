/** Tree view navigation state: zoom, pan and minimap. */
import { $ } from "../app/dom";
import { graphUi } from "./graph-state";
import { renderGraphTree } from "./tree-renderer";

export const graphTreeCollapsed = new Set<string>();
const GRAPH_TREE_ZOOM_MIN = 0.4;
const GRAPH_TREE_ZOOM_MAX = 2.4;
export const GRAPH_TREE_ZOOM_STEP = 1.15;
const storedGraphTreeZoom = Number(localStorage.getItem("typenova.brain.treeZoom"));
export let graphTreeZoom = Number.isFinite(storedGraphTreeZoom) && storedGraphTreeZoom >= GRAPH_TREE_ZOOM_MIN && storedGraphTreeZoom <= GRAPH_TREE_ZOOM_MAX ? storedGraphTreeZoom : 1;
export const GRAPH_TREE_CANVAS_PADDING = 32;
type GraphTreeMinimapNode = { id: string; x: number; y: number; parentId: string | null; selected: boolean; level: number };
type GraphTreeMinimapModel = { width: number; height: number; mapScale: number; offsetX: number; offsetY: number; plotWidth: number; plotHeight: number };
export let graphTreeMinimapModel: GraphTreeMinimapModel | null = null;
export function syncGraphTreeMinimapViewport() {
  const indicator = $("brainTreeMinimapViewport") as HTMLElement | null;
  const tree = $("brainTree") as HTMLElement | null;
  const model = graphTreeMinimapModel;
  if (!indicator || !tree || !model) return;
  const startX = -graphUi.graphTreePanX / graphTreeZoom, startY = -graphUi.graphTreePanY / graphTreeZoom;
  const endX = startX + tree.clientWidth / graphTreeZoom, endY = startY + tree.clientHeight / graphTreeZoom;
  const visibleLeft = Math.max(0, Math.min(model.width, startX));
  const visibleTop = Math.max(0, Math.min(model.height, startY));
  const visibleRight = Math.max(visibleLeft, Math.min(model.width, endX));
  const visibleBottom = Math.max(visibleTop, Math.min(model.height, endY));
  const visibleWidth = Math.max(3, (visibleRight - visibleLeft) * model.mapScale);
  const visibleHeight = Math.max(3, (visibleBottom - visibleTop) * model.mapScale);
  const mapWidth = model.width * model.mapScale, mapHeight = model.height * model.mapScale;
  const left = Math.max(model.offsetX, Math.min(model.offsetX + mapWidth - visibleWidth, model.offsetX + visibleLeft * model.mapScale));
  const top = Math.max(model.offsetY, Math.min(model.offsetY + mapHeight - visibleHeight, model.offsetY + visibleTop * model.mapScale));
  indicator.style.left = `${left}px`; indicator.style.top = `${top}px`;
  indicator.style.width = `${Math.min(mapWidth, visibleWidth)}px`; indicator.style.height = `${Math.min(mapHeight, visibleHeight)}px`;
}
export function clearGraphTreeMinimap() {
  graphTreeMinimapModel = null;
  const minimap = $("brainTreeMinimap") as HTMLElement | null;
  if (minimap) minimap.hidden = true;
  const indicator = $("brainTreeMinimapViewport") as HTMLElement | null;
  if (indicator) { indicator.style.width = "0"; indicator.style.height = "0"; }
  const canvas = $("brainTreeMinimapCanvas") as HTMLCanvasElement | null;
  const context = canvas?.getContext("2d"); if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
}
export function renderGraphTreeMinimap(width: number, height: number, nodes: GraphTreeMinimapNode[], nodeWidth: number, nodeHeight: number) {
  const minimap = $("brainTreeMinimap") as HTMLElement;
  const plot = $("brainTreeMinimapPlot") as HTMLElement;
  const canvas = $("brainTreeMinimapCanvas") as HTMLCanvasElement;
  if (graphUi.graphVisualMode !== "tree" || !width || !height || !nodes.length) { clearGraphTreeMinimap(); return; }
  const plotWidth = Math.max(1, plot.clientWidth || 188), plotHeight = Math.max(1, plot.clientHeight || 104), inset = 4;
  const mapScale = Math.min((plotWidth - inset * 2) / width, (plotHeight - inset * 2) / height);
  const offsetX = (plotWidth - width * mapScale) / 2, offsetY = (plotHeight - height * mapScale) / 2;
  const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(plotWidth * pixelRatio)), pixelHeight = Math.max(1, Math.round(plotHeight * pixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) { clearGraphTreeMinimap(); return; }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, plotWidth, plotHeight);
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const border = token("--ui-border", "#64748b"), accent = token("--ui-accent", "#60a5fa"), panel = token("--ui-panel", "#1e293b"), muted = token("--ui-muted", "#94a3b8");
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  context.beginPath(); context.strokeStyle = border; context.globalAlpha = .78; context.lineWidth = .65;
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId); if (!parent) continue;
    context.moveTo(offsetX + (parent.x + nodeWidth) * mapScale, offsetY + (parent.y + nodeHeight / 2) * mapScale);
    context.lineTo(offsetX + node.x * mapScale, offsetY + (node.y + nodeHeight / 2) * mapScale);
  }
  context.stroke();
  for (const node of nodes) {
    const x = offsetX + node.x * mapScale, y = offsetY + node.y * mapScale;
    const w = Math.max(.8, nodeWidth * mapScale), h = Math.max(.8, nodeHeight * mapScale);
    context.globalAlpha = node.selected ? 1 : (node.level === 1 ? 0.88 : 0.72);
    context.fillStyle = node.selected ? accent : (node.level === 1 ? muted : panel);
    context.fillRect(x, y, w, h);
    if (w >= 2.5 && h >= 2.5) { context.strokeStyle = node.selected ? accent : border; context.lineWidth = .45; context.strokeRect(x, y, w, h); }
  }
  context.globalAlpha = 1;
  graphTreeMinimapModel = { width, height, mapScale, offsetX, offsetY, plotWidth, plotHeight };
  minimap.hidden = false;
  syncGraphTreeMinimapViewport();
}
export function setGraphTreeViewportCenter(layoutX: number, layoutY: number) {
  const tree = $("brainTree") as HTMLElement | null;
  const model = graphTreeMinimapModel;
  if (!tree || !model) return;
  graphUi.graphTreePanX = tree.clientWidth / 2 - layoutX * graphTreeZoom;
  graphUi.graphTreePanY = tree.clientHeight / 2 - layoutY * graphTreeZoom;
  graphUi.graphTreePanX = Math.max(GRAPH_TREE_CANVAS_PADDING - model.width * graphTreeZoom, Math.min(tree.clientWidth - GRAPH_TREE_CANVAS_PADDING, graphUi.graphTreePanX));
  graphUi.graphTreePanY = Math.max(GRAPH_TREE_CANVAS_PADDING - model.height * graphTreeZoom, Math.min(tree.clientHeight - GRAPH_TREE_CANVAS_PADDING, graphUi.graphTreePanY));
  applyGraphTreeLayerTransform();
}
export function centerGraphTreeOnMinimapPoint(clientX: number, clientY: number) {
  const plot = $("brainTreeMinimapPlot") as HTMLElement | null;
  const model = graphTreeMinimapModel;
  if (!plot || !model) return;
  const rect = plot.getBoundingClientRect();
  const x = Math.max(0, Math.min(model.plotWidth, clientX - rect.left - plot.clientLeft));
  const y = Math.max(0, Math.min(model.plotHeight, clientY - rect.top - plot.clientTop));
  setGraphTreeViewportCenter(Math.max(0, Math.min(model.width, (x - model.offsetX) / model.mapScale)), Math.max(0, Math.min(model.height, (y - model.offsetY) / model.mapScale)));
}
export function applyGraphTreeLayerTransform() {
  const layer = ($("brainTree") as HTMLElement | null)?.querySelector(".brain-tree-layer") as HTMLElement | null;
  if (layer) layer.style.transform = `translate(${graphUi.graphTreePanX}px, ${graphUi.graphTreePanY}px) scale(${graphTreeZoom})`;
  syncGraphTreeMinimapViewport();
}
export function panGraphTreeNodeIntoView(target: HTMLElement | null) {
  const tree = $("brainTree") as HTMLElement | null;
  if (!tree || !target) return;
  const viewport = tree.getBoundingClientRect(), node = target.getBoundingClientRect(), margin = 24;
  let deltaX = 0, deltaY = 0;
  if (node.left < viewport.left + margin) deltaX = viewport.left + margin - node.left;
  else if (node.right > viewport.right - margin) deltaX = viewport.right - margin - node.right;
  if (node.top < viewport.top + margin) deltaY = viewport.top + margin - node.top;
  else if (node.bottom > viewport.bottom - margin) deltaY = viewport.bottom - margin - node.bottom;
  if (deltaX || deltaY) { graphUi.graphTreePanX += deltaX; graphUi.graphTreePanY += deltaY; applyGraphTreeLayerTransform(); }
}
export function syncGraphTreeZoomControls() {
  const tree = $("brainTree") as HTMLElement | null;
  const zoomOut = $("brainTreeZoomOut") as HTMLButtonElement | null;
  const zoomIn = $("brainTreeZoomIn") as HTMLButtonElement | null;
  const hasCanvas = !!tree?.querySelector(".brain-tree-canvas");
  if (zoomOut) zoomOut.disabled = !hasCanvas || graphTreeZoom <= GRAPH_TREE_ZOOM_MIN + 0.001;
  if (zoomIn) zoomIn.disabled = !hasCanvas || graphTreeZoom >= GRAPH_TREE_ZOOM_MAX - 0.001;
}
let graphTreeZoomPersistTimer: number | undefined;
function persistGraphTreeZoom() {
  window.clearTimeout(graphTreeZoomPersistTimer);
  graphTreeZoomPersistTimer = window.setTimeout(() => { try { localStorage.setItem("typenova.brain.treeZoom", String(graphTreeZoom)); } catch { } }, 120);
}
export function changeGraphTreeZoom(factor: number, anchorClientX?: number, anchorClientY?: number, render = true) {
  const tree = $("brainTree") as HTMLElement;
  const canvas = tree.querySelector(".brain-tree-canvas") as HTMLElement | null;
  const layer = tree.querySelector(".brain-tree-layer") as HTMLElement | null;
  if (!canvas || !layer) return;
  const next = Math.round(Math.max(GRAPH_TREE_ZOOM_MIN, Math.min(GRAPH_TREE_ZOOM_MAX, graphTreeZoom * factor)) * 100) / 100;
  if (next === graphTreeZoom) return;
  const rect = tree.getBoundingClientRect();
  const anchorViewX = anchorClientX === undefined ? tree.clientWidth / 2 : anchorClientX - rect.left;
  const anchorViewY = anchorClientY === undefined ? tree.clientHeight / 2 : anchorClientY - rect.top;
  const anchorX = (anchorViewX - graphUi.graphTreePanX) / graphTreeZoom;
  const anchorY = (anchorViewY - graphUi.graphTreePanY) / graphTreeZoom;
  graphTreeZoom = next;
  graphUi.graphTreePanX = anchorViewX - anchorX * graphTreeZoom;
  graphUi.graphTreePanY = anchorViewY - anchorY * graphTreeZoom;
  const layerWidth = Number.parseFloat(layer.style.width) || layer.offsetWidth;
  const layerHeight = Number.parseFloat(layer.style.height) || layer.offsetHeight;
  canvas.style.width = `${Math.max(tree.clientWidth, layerWidth * graphTreeZoom)}px`;
  canvas.style.height = `${Math.max(tree.clientHeight, layerHeight * graphTreeZoom)}px`;
  applyGraphTreeLayerTransform();
  persistGraphTreeZoom();
  if (render) renderGraphTree();
  syncGraphTreeZoomControls();
}
