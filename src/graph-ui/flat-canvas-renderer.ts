/** Flat Canvas 2D graph renderer with viewport culling and level of detail. */
import { projectSectionGraphModel, buildSectionGraphModel, preferredSectionRelationKind } from "../graph/section-model";
import { readPreferenceJson, isRecord } from "../settings/storage";
import { GRAPH_LOD_THRESHOLD, orderGraphLodNodes, getGraphLodBudget } from "../graph/lod-policy";
import { segmentMayIntersectBounds } from "../graph/spatial-query";
import { screenToGraphPoint, graphNodeHitDistanceSquared, zoomGraphAtPoint } from "../graph/interaction-geometry";
import { startForceLayoutWorker } from "../graph/layout-client";
import { $ } from "../app/dom";
import { closeGraphPreview } from "./filter-panel";
import { graphPositionsStorageKey } from "./graph-controls";
import { graphUi, type GraphSection } from "./graph-state";
import { graphSectionTooltipExcerpt } from "./related-panel";
import { selectGraphSection } from "./selection";
import { langText } from "../i18n/language";
import { hideAppTooltip, showAppTooltip } from "../ui/tooltip";
import type { Node, Edge, CanvasScene } from "./canvas-scene";

export type GraphCanvasSurface = HTMLCanvasElement & {
  __typenovaSelectSection?: (sectionId: string, fitToViewport: boolean) => void;
  __typenovaUpdateLabels?: () => void;
  __typenovaSetLabels?: (enabled: boolean) => void;
  __typenovaSetMotion?: (enabled: boolean) => void;
};

/** Creates the nodes (colour, seed position, saved layout), the deduplicated edges, adjacency and the level-of-detail ordering. */
function buildCanvasModel(scene: CanvasScene): void {
  scene.palette = ["#69a9ff", "#79cba6", "#c49bff", "#eac36c", "#f18fa7", "#64c5ce", "#9caeff", "#e5a0d0", "#a7c878", "#eea16b", "#7bb8d4", "#c2a4e8"];
  scene.hashFor = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++)h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0; };
  scene.headingLevelColor = (hex: string, level: number, hueOffset = 0) => {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255); const max = Math.max(...rgb), min = Math.min(...rgb), lightness = (max + min) / 2, delta = max - min; let hue = 0, saturation = 0;
    if (delta) { saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min); if (max === rgb[0]) hue = (rgb[1] - rgb[2]) / delta + (rgb[1] < rgb[2] ? 6 : 0); else if (max === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2; else hue = (rgb[0] - rgb[1]) / delta + 4; hue *= 60; }
    hue = (hue + Math.max(0, level - 1) * 31 + hueOffset) % 360; const levelLightness = level === 1 ? 0 : (level % 2 === 0 ? .045 : -.025 * Math.floor(level / 2)); const l = Math.max(.42, Math.min(.76, lightness + levelLightness)); const chroma = (1 - Math.abs(2 * l - 1)) * saturation; const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)); const m = l - chroma / 2;
    let channels: [number, number, number]; if (hue < 60) channels = [chroma, x, 0]; else if (hue < 120) channels = [x, chroma, 0]; else if (hue < 180) channels = [0, chroma, x]; else if (hue < 240) channels = [0, x, chroma]; else if (hue < 300) channels = [x, 0, chroma]; else channels = [chroma, 0, x];
    return `#${channels.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  scene.sectionsById = new Map(graphUi.graphSections.map(section => [section.id, section] as const));
  scene.colorFor = (section: GraphSection) => {
    const ancestry: GraphSection[] = [section]; let parentId = section.parent, guard = 0; while (parentId && guard++ < 64) { const parent = scene.sectionsById.get(parentId); if (!parent) break; ancestry.push(parent); parentId = parent.parent; }
    const stablePath = section.path.replace(/\\/g, "/").toLocaleLowerCase(); const topHeading = [...ancestry].reverse().find(item => item.level === 1) ?? ancestry[ancestry.length - 1]; const rootSeed = `${stablePath}::${topHeading.title.toLocaleLowerCase()}::${topHeading.line}`; const rootColor = scene.palette[scene.hashFor(rootSeed) % scene.palette.length]; if (section.level <= 1) return scene.headingLevelColor(rootColor, 1);
    const childHeading = ancestry.find(item => item.level === 2) ?? section; const childSeed = `${rootSeed}::h2::${childHeading.title.toLocaleLowerCase()}::${childHeading.line}`; const childColor = scene.headingLevelColor(rootColor, 2, 24 + (scene.hashFor(childSeed) % 49)); if (section.level === 2) return childColor; return scene.headingLevelColor(childColor, section.level - 1);
  };
  scene.nodes = scene.visible.map((s, i) => {
    const key = `${s.path.replace(/\\/g, "/")}::${s.line}::${s.title.toLocaleLowerCase()}`; const angle = (scene.hashFor(key) % 100000) / 100000 * Math.PI * 2 + i * 2.399963229728653; const spread = 24 + Math.sqrt(i + 1) * 15; const sphereZ = 1 - 2 * (i + .5) / Math.max(1, scene.visible.length); const sphereR = Math.sqrt(Math.max(0, 1 - sphereZ * sphereZ)); const sphereTheta = i * Math.PI * (3 - Math.sqrt(5)); const gx = Math.cos(sphereTheta) * sphereR, gy = Math.sin(sphereTheta) * sphereR;
    return { s, key, index: i, lodRank: i, x: Math.cos(angle) * spread, y: Math.sin(angle) * spread, gx, gy, gz: sphereZ, depth: sphereZ, vx: 0, vy: 0, radius: 4.2, color: scene.colorFor(s), dragging: false, suppressClick: false, degree: 0, el: null };
  });
  scene.byId = new Map(scene.nodes.map(n => [n.s.id, n] as const));
  scene.sectionGraphModel = graphUi.graphSectionGraphModel ? projectSectionGraphModel(graphUi.graphSectionGraphModel, scene.visible) : buildSectionGraphModel(scene.visible);
  scene.saved = {};
  scene.storedPositions = readPreferenceJson(graphPositionsStorageKey, isRecord, {});
  for (const [key, value] of Object.entries(scene.storedPositions)) { if (isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y)) scene.saved[key] = { x: value.x, y: value.y }; }
  scene.needsLayout = false;
  for (const n of scene.nodes) { const pos = scene.saved[n.key]; if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) { n.x = pos.x; n.y = pos.y; } else scene.needsLayout = true; }
  scene.edgeList = [];
  scene.edgeByPair = new Map<string, Edge>();
  scene.addEdge = (a: Node, b: Node, kind: Edge["kind"]) => { if (a === b) return; const pair = [a.s.id, b.s.id].sort().join("|"); const existing = scene.edgeByPair.get(pair); if (existing) { const preferred = preferredSectionRelationKind(existing.kind, kind); if (preferred !== existing.kind) { existing.kind = preferred; existing.color = preferred === "link" ? "accent" : "border"; } return; } const edge: Edge = { a, b, kind, color: kind === "link" ? "accent" : "border", drawStamp: 0 }; scene.edgeList.push(edge); scene.edgeByPair.set(pair, edge); };
  for (const relation of scene.sectionGraphModel.relations) {
    const source = scene.byId.get(relation.sourceId), target = scene.byId.get(relation.targetId);
    if (source && target) scene.addEdge(source, target, relation.kind);
  }
  scene.edgesByNode = new Map<Node, Edge[]>();
  for (const node of scene.nodes) scene.edgesByNode.set(node, []);
  for (const edge of scene.edgeList) { edge.a.degree++; edge.b.degree++; scene.edgesByNode.get(edge.a)?.push(edge); scene.edgesByNode.get(edge.b)?.push(edge); }
  for (const node of scene.nodes) node.radius = Math.min(8.2, 4 + Math.sqrt(node.degree) * .92);
  scene.adjByNode = new Map<Node, Set<Node>>();
  for (const node of scene.nodes) scene.adjByNode.set(node, new Set());
  for (const edge of scene.edgeList) { scene.adjByNode.get(edge.a)?.add(edge.b); scene.adjByNode.get(edge.b)?.add(edge.a); }
  // Level-of-detail (LOD): all vertices remain in the graph model. At 200+ nodes,
  // reveal the document hierarchy in strict heading-level order (H1, H2, H3, H4...).
  // Degree prioritizes nodes only within a level; a stable key breaks ties.
  scene.lodEnabled = scene.nodes.length >= GRAPH_LOD_THRESHOLD;
  scene.lodOrder = orderGraphLodNodes(scene.nodes, node => ({ level: node.s.level, degree: node.degree, key: node.key }), scene.lodEnabled);
  scene.lodOrder.forEach((node, index) => { node.lodRank = index; });
  scene.emptyRelatedNodes = new Set<Node>();
  scene.edgeDrawGroups = [[], [], [], [], [], []];
}

/** Interaction state (focus, hover, gestures, LOD tier), frame scratch buffers, theme colours and viewport helpers. */
function initInteractionState(scene: CanvasScene): void {
  scene.focusedNode = scene.nodes.find(node => node.s.id === graphUi.selectedGraphSection?.id) || null;
  scene.keyboardNode = scene.focusedNode;
  scene.hoveredNode = null;
  scene.relatedNode = null;
  scene.labelsVisible = new Set<string>();
  scene.drawFrame = 0;
  scene.labelLayoutDirty = true;
  scene.panGesture = null;
  scene.fastViewportInteraction = false;
  scene.renderedPanX = graphUi.graphPanX;
  scene.renderedPanY = graphUi.graphPanY;
  scene.renderedZoom = graphUi.graphZoom;
  scene.layoutInProgress = false;
  scene.lodZoomBase = Math.max(0.001, graphUi.graphZoom);
  scene.lodBudget = -1;
  scene.lodTierNodes = scene.nodes;
  scene.lodTierSet = null;
  scene.lodStatusText = "";
  scene.isImportantLodNode = (node: Node) => node === scene.hoveredNode || node === scene.relatedNode || node === scene.focusedNode || node === scene.keyboardNode || node.s.id === graphUi.selectedGraphSection?.id;
  scene.isNodeInLod = function (node: Node): boolean {
    if (!scene.lodTierSet || scene.lodTierSet.has(node) || scene.isImportantLodNode(node)) return true;
    // Preserve immediate relationship context around the current focus when the degree is modest.
    const anchor = scene.hoveredNode || scene.relatedNode || scene.focusedNode || (graphUi.selectedGraphSection ? scene.byId.get(graphUi.selectedGraphSection.id) || null : null);
    return !!anchor && anchor.degree <= 28 && (scene.adjByNode.get(anchor)?.has(node) || false);
  };
  scene.updateLodTier = function () {
    const nextBudget = getGraphLodBudget({ total: scene.nodes.length, zoom: graphUi.graphZoom, baseZoom: scene.lodZoomBase, fullDetailZoomFactor: Math.min(5, 1.45 + Math.sqrt(scene.nodes.length / 200) * .55), threshold: GRAPH_LOD_THRESHOLD });
    if (nextBudget === scene.lodBudget) return;
    scene.lodBudget = nextBudget;
    if (scene.lodBudget >= scene.nodes.length) { scene.lodTierNodes = scene.nodes; scene.lodTierSet = null; }
    else { scene.lodTierNodes = scene.lodOrder.slice(0, scene.lodBudget); scene.lodTierSet = new Set(scene.lodTierNodes); }
    scene.labelLayoutDirty = true;
    const nextStatus = scene.lodBudget < scene.nodes.length
      ? `${scene.baseGraphStatusText} · ${langText("uproszczony podgląd", "overview detail")} ≈${scene.lodBudget.toLocaleString()} / ${scene.nodes.length.toLocaleString()}`
      : String(scene.baseGraphStatusText || "");
    if (nextStatus !== scene.lodStatusText) { scene.status.textContent = nextStatus; scene.lodStatusText = nextStatus; }
  };
  scene.applyViewportPreviewTransform = () => { const ratio = graphUi.graphZoom / Math.max(.0001, scene.renderedZoom), tx = graphUi.graphPanX - ratio * scene.renderedPanX, ty = graphUi.graphPanY - ratio * scene.renderedPanY; scene.canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${ratio})`; scene.syncFlatGraphMinimapViewport(); };
  scene.markViewportInteracting = () => { scene.fastViewportInteraction = true; if (scene.viewportInteractionTimer !== undefined) window.clearTimeout(scene.viewportInteractionTimer); scene.viewportInteractionTimer = window.setTimeout(() => { scene.viewportInteractionTimer = undefined; scene.fastViewportInteraction = false; if (!scene.layoutInProgress) { if (scene.nodeSpatialIndexDirty) scene.rebuildSpatialIndex(); if (scene.edgeSpatialIndexDirty && !graphUi.graphMotion) scene.rebuildEdgeSpatialIndex(); } scene.labelLayoutDirty = true; scene.scheduleLabels(); scene.scheduleDraw(); }, 120); };
  scene.cancelled = false;
  scene.cellSize = 84;
  scene.spatialBuckets = new Map<string, Node[]>();
  scene.nodeSpatialIndexDirty = true;
  scene.edgeSpatialIndexDirty = true;
  scene.edgeQueryStamp = 0;
  scene.edgeSpatialBuckets = new Map<string, Edge[]>();
  scene.reusableEdgeBuckets = [];
  scene.longSpatialEdges = [];
  // Reuse hot-path collections between Canvas frames to reduce short-lived allocations
  // and avoid avoidable garbage-collection pressure during pan/zoom and ambient motion.
  scene.visibleNodeScratch = [];
  scene.labelNodeScratch = [];
  scene.renderNodeScratch = [];
  scene.renderedNodeSetScratch = new Set<Node>();
  scene.priorityNodeScratch = [];
  scene.renderEdgeScratch = [];
  scene.edgeSpatialQueryBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  scene.theme = { border: "#718096", accent: "#69a9ff", text: "#e6edf3", editorBg: "#151922", font: "system-ui, sans-serif", focus: "#7bb8ff" };
  scene.refreshTheme = () => { const styles = getComputedStyle(document.documentElement); scene.theme.border = styles.getPropertyValue("--ui-border").trim() || scene.theme.border; scene.theme.accent = styles.getPropertyValue("--ui-accent").trim() || scene.theme.accent; scene.theme.text = styles.getPropertyValue("--ui-text").trim() || scene.theme.text; scene.theme.editorBg = styles.getPropertyValue("--ui-editor-bg").trim() || scene.theme.editorBg; scene.theme.font = styles.getPropertyValue("--tn-font-ui").trim() || "system-ui, sans-serif"; scene.theme.focus = styles.getPropertyValue("--ui-focus-ring").trim() || scene.theme.accent; };
  scene.refreshTheme();
}

/** Minimap overlay: model, drawing, viewport indicator and pointer/keyboard navigation. */
function setupFlatMinimap(scene: CanvasScene): void {
  scene.flatGraphMinimapModel = null;
  scene.flatGraphMinimapBaseDirty = true;
  scene.flatGraphMinimapPointerId = null;
  scene.flatGraphMinimap = $("brainGraphMinimap") as HTMLElement;
  scene.flatGraphMinimapPlot = $("brainGraphMinimapPlot") as HTMLElement;
  scene.flatGraphMinimapCanvas = $("brainGraphMinimapCanvas") as HTMLCanvasElement;
  scene.flatGraphMinimapViewport = $("brainGraphMinimapViewport") as HTMLElement;
  scene.syncFlatGraphMinimapViewport = function () {
    const model = scene.flatGraphMinimapModel; if (!model || scene.flatGraphMinimap.hidden) return;
    const zoom = Math.max(.001, graphUi.graphZoom);
    const leftWorld = -graphUi.graphPanX / zoom, topWorld = -graphUi.graphPanY / zoom;
    const rightWorld = leftWorld + scene.viewportWidth / zoom, bottomWorld = topWorld + scene.viewportHeight / zoom;
    const rawLeft = model.offsetX + (leftWorld - model.minX) * model.scale, rawTop = model.offsetY + (topWorld - model.minY) * model.scale;
    const rawRight = model.offsetX + (rightWorld - model.minX) * model.scale, rawBottom = model.offsetY + (bottomWorld - model.minY) * model.scale;
    const left = Math.max(0, Math.min(model.plotWidth - 3, rawLeft)), top = Math.max(0, Math.min(model.plotHeight - 3, rawTop));
    const right = Math.max(left + 3, Math.min(model.plotWidth, rawRight)), bottom = Math.max(top + 3, Math.min(model.plotHeight, rawBottom));
    scene.flatGraphMinimapViewport.style.left = `${left}px`; scene.flatGraphMinimapViewport.style.top = `${top}px`;
    scene.flatGraphMinimapViewport.style.width = `${Math.max(3, right - left)}px`; scene.flatGraphMinimapViewport.style.height = `${Math.max(3, bottom - top)}px`;
  };
  scene.drawFlatGraphMinimap = function () {
    scene.flatGraphMinimapDrawTimer = undefined;
    if (scene.cancelled || scene.renderToken !== graphUi.graphRenderToken || graphUi.graphVisualMode !== "graph" || graphUi.graphGlobeMode || !scene.nodes.length) { scene.flatGraphMinimap.hidden = true; graphUi.graphFlatMinimapReady = false; scene.flatGraphMinimapModel = null; return; }
    const plotWidth = Math.max(1, scene.flatGraphMinimapPlot.clientWidth || 188), plotHeight = Math.max(1, scene.flatGraphMinimapPlot.clientHeight || 104), inset = 5;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of scene.nodes) { minX = Math.min(minX, node.x - node.radius); maxX = Math.max(maxX, node.x + node.radius); minY = Math.min(minY, node.y - node.radius); maxY = Math.max(maxY, node.y + node.radius); }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) { scene.flatGraphMinimap.hidden = true; return; }
    minX -= 16; minY -= 16; maxX += 16; maxY += 16;
    const worldWidth = Math.max(1, maxX - minX), worldHeight = Math.max(1, maxY - minY);
    const scale = Math.min((plotWidth - inset * 2) / worldWidth, (plotHeight - inset * 2) / worldHeight);
    const offsetX = (plotWidth - worldWidth * scale) / 2, offsetY = (plotHeight - worldHeight * scale) / 2;
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixelWidth = Math.max(1, Math.round(plotWidth * pixelRatio)), pixelHeight = Math.max(1, Math.round(plotHeight * pixelRatio));
    if (scene.flatGraphMinimapCanvas.width !== pixelWidth) scene.flatGraphMinimapCanvas.width = pixelWidth;
    if (scene.flatGraphMinimapCanvas.height !== pixelHeight) scene.flatGraphMinimapCanvas.height = pixelHeight;
    const mapContext = scene.flatGraphMinimapCanvas.getContext("2d"); if (!mapContext) { scene.flatGraphMinimap.hidden = true; return; }
    mapContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); mapContext.clearRect(0, 0, plotWidth, plotHeight);
    mapContext.beginPath(); mapContext.strokeStyle = scene.theme.border; mapContext.globalAlpha = .42; mapContext.lineWidth = .55;
    for (const edge of scene.edgeList) { mapContext.moveTo(offsetX + (edge.a.x - minX) * scale, offsetY + (edge.a.y - minY) * scale); mapContext.lineTo(offsetX + (edge.b.x - minX) * scale, offsetY + (edge.b.y - minY) * scale); }
    mapContext.stroke();
    for (const node of scene.nodes) { mapContext.beginPath(); mapContext.globalAlpha = .82; mapContext.fillStyle = node.color; mapContext.arc(offsetX + (node.x - minX) * scale, offsetY + (node.y - minY) * scale, Math.max(.65, Math.min(2.1, node.radius * scale)), 0, Math.PI * 2); mapContext.fill(); }
    mapContext.globalAlpha = 1;
    scene.flatGraphMinimapModel = { minX, minY, width: worldWidth, height: worldHeight, scale, offsetX, offsetY, plotWidth, plotHeight };
    scene.flatGraphMinimapBaseDirty = false;
    graphUi.graphFlatMinimapReady = true; scene.flatGraphMinimap.hidden = false; scene.syncFlatGraphMinimapViewport();
  };
  scene.scheduleFlatGraphMinimapDraw = function () { if (!scene.flatGraphMinimapBaseDirty || scene.flatGraphMinimapDrawTimer !== undefined || scene.cancelled) return; scene.flatGraphMinimapDrawTimer = window.setTimeout(scene.drawFlatGraphMinimap, scene.layoutInProgress ? 420 : 180); };
  scene.centerFlatGraphOnMinimapPoint = function (clientX: number, clientY: number) {
    const model = scene.flatGraphMinimapModel; if (!model) return;
    const rect = scene.flatGraphMinimapPlot.getBoundingClientRect();
    const px = Math.max(0, Math.min(model.plotWidth, clientX - rect.left - scene.flatGraphMinimapPlot.clientLeft));
    const py = Math.max(0, Math.min(model.plotHeight, clientY - rect.top - scene.flatGraphMinimapPlot.clientTop));
    const worldX = Math.max(model.minX, Math.min(model.minX + model.width, model.minX + (px - model.offsetX) / model.scale));
    const worldY = Math.max(model.minY, Math.min(model.minY + model.height, model.minY + (py - model.offsetY) / model.scale));
    graphUi.graphPanX = scene.viewportWidth / 2 - worldX * graphUi.graphZoom; graphUi.graphPanY = scene.viewportHeight / 2 - worldY * graphUi.graphZoom;
    scene.labelLayoutDirty = true; scene.markViewportInteracting(); scene.applyViewportPreviewTransform(); scene.syncFlatGraphMinimapViewport();
  };
  scene.flatGraphMinimap.onpointerdown = (event: PointerEvent) => {
    if (graphUi.graphVisualMode !== "graph" || graphUi.graphGlobeMode || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest("#brainGraphMinimapPlot")) return;
    scene.flatGraphMinimapPointerId = event.pointerId; event.preventDefault(); try { scene.flatGraphMinimap.setPointerCapture(event.pointerId); } catch { } scene.centerFlatGraphOnMinimapPoint(event.clientX, event.clientY);
  };
  scene.flatGraphMinimap.onpointermove = (event: PointerEvent) => { if (scene.flatGraphMinimapPointerId !== event.pointerId) return; scene.centerFlatGraphOnMinimapPoint(event.clientX, event.clientY); };
  scene.finishFlatGraphMinimapPan = (event: PointerEvent) => { if (scene.flatGraphMinimapPointerId !== event.pointerId) return; scene.flatGraphMinimapPointerId = null; if (scene.flatGraphMinimap.hasPointerCapture(event.pointerId)) scene.flatGraphMinimap.releasePointerCapture(event.pointerId); };
  scene.flatGraphMinimap.onpointerup = scene.finishFlatGraphMinimapPan;
  scene.flatGraphMinimap.onpointercancel = scene.finishFlatGraphMinimapPan;
  scene.flatGraphMinimap.onlostpointercapture = scene.finishFlatGraphMinimapPan;
  scene.flatGraphMinimap.onkeydown = (event: KeyboardEvent) => {
    if (!scene.flatGraphMinimapModel || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault(); if (event.key === "Home") { scene.fit(); return; }
    const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0, dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    graphUi.graphPanX -= dx * scene.viewportWidth * .55; graphUi.graphPanY -= dy * scene.viewportHeight * .55; scene.markViewportInteracting(); scene.applyViewportPreviewTransform(); scene.syncFlatGraphMinimapViewport();
  };
  scene.flatGraphMinimap.hidden = true;
  graphUi.graphFlatMinimapReady = false;
}

/** Spatial indexes, hit testing, label placement, the draw routine, fit, position persistence and related-section emphasis. */
function defineSceneOperations(scene: CanvasScene): void {
  scene.reusableHitBuckets = [];
  scene.rebuildSpatialIndex = function () { if (!scene.nodeSpatialIndexDirty) return; for (const bucket of scene.spatialBuckets.values()) { bucket.length = 0; scene.reusableHitBuckets.push(bucket); } scene.spatialBuckets.clear(); for (const node of scene.nodes) { const x = Math.floor(node.x / scene.cellSize), y = Math.floor(node.y / scene.cellSize), key = `${x},${y}`; let bucket = scene.spatialBuckets.get(key); if (!bucket) { bucket = scene.reusableHitBuckets.pop() || []; scene.spatialBuckets.set(key, bucket); } bucket.push(node); } scene.nodeSpatialIndexDirty = false; };
  scene.rebuildEdgeSpatialIndex = function () { if (!scene.edgeSpatialIndexDirty) return; for (const bucket of scene.edgeSpatialBuckets.values()) { bucket.length = 0; scene.reusableEdgeBuckets.push(bucket); } scene.edgeSpatialBuckets.clear(); scene.longSpatialEdges.length = 0; const add = (x: number, y: number, edge: Edge) => { const key = `${x},${y}`; let bucket = scene.edgeSpatialBuckets.get(key); if (!bucket) { bucket = scene.reusableEdgeBuckets.pop() || []; scene.edgeSpatialBuckets.set(key, bucket); } bucket.push(edge); }; for (const edge of scene.edgeList) { let x = Math.floor(edge.a.x / scene.cellSize), y = Math.floor(edge.a.y / scene.cellSize); const endX = Math.floor(edge.b.x / scene.cellSize), endY = Math.floor(edge.b.y / scene.cellSize), steps = Math.abs(endX - x) + Math.abs(endY - y); if (steps > 32) { scene.longSpatialEdges.push(edge); continue; } add(x, y, edge); const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y, stepX = Math.sign(dx), stepY = Math.sign(dy), deltaX = dx === 0 ? Infinity : scene.cellSize / Math.abs(dx), deltaY = dy === 0 ? Infinity : scene.cellSize / Math.abs(dy); let maxX = dx === 0 ? Infinity : ((stepX > 0 ? (x + 1) * scene.cellSize : x * scene.cellSize) - edge.a.x) / dx, maxY = dy === 0 ? Infinity : ((stepY > 0 ? (y + 1) * scene.cellSize : y * scene.cellSize) - edge.a.y) / dy, guard = 0; while ((x !== endX || y !== endY) && guard++ < 34) { if (maxX < maxY) { x += stepX; maxX += deltaX; add(x, y, edge); } else if (maxY < maxX) { y += stepY; maxY += deltaY; add(x, y, edge); } else { if (stepX) add(x + stepX, y, edge); if (stepY) add(x, y + stepY, edge); x += stepX; y += stepY; maxX += deltaX; maxY += deltaY; add(x, y, edge); } } } scene.edgeSpatialIndexDirty = false; };
  scene.visibleNodesInBounds = function (left: number, right: number, top: number, bottom: number, result: Node[] = []): Node[] { result.length = 0; for (let x = Math.floor(left / scene.cellSize); x <= Math.floor(right / scene.cellSize); x++)for (let y = Math.floor(top / scene.cellSize); y <= Math.floor(bottom / scene.cellSize); y++) { const bucket = scene.spatialBuckets.get(`${x},${y}`); if (bucket) for (const node of bucket) result.push(node); } return result; };
  scene.visibleEdgesInBounds = function (left: number, right: number, top: number, bottom: number, result: Edge[] = []): Edge[] { result.length = 0; scene.edgeSpatialQueryBounds.left = left; scene.edgeSpatialQueryBounds.right = right; scene.edgeSpatialQueryBounds.top = top; scene.edgeSpatialQueryBounds.bottom = bottom; const stamp = ++scene.edgeQueryStamp; const push = (edge: Edge) => { if (edge.drawStamp !== stamp) { edge.drawStamp = stamp; result.push(edge); } }; for (const edge of scene.longSpatialEdges) { if (segmentMayIntersectBounds(edge.a.x, edge.a.y, edge.b.x, edge.b.y, scene.edgeSpatialQueryBounds)) push(edge); } const minX = Math.floor((left - scene.cellSize) / scene.cellSize), maxX = Math.floor((right + scene.cellSize) / scene.cellSize), minY = Math.floor((top - scene.cellSize) / scene.cellSize), maxY = Math.floor((bottom + scene.cellSize) / scene.cellSize); for (let x = minX; x <= maxX; x++)for (let y = minY; y <= maxY; y++) { const bucket = scene.edgeSpatialBuckets.get(`${x},${y}`); if (bucket) for (const edge of bucket) push(edge); } return result; };
  scene.worldAt = function (clientX: number, clientY: number) { const box = scene.graph.getBoundingClientRect(); const point = screenToGraphPoint(clientX, clientY, { originLeft: box.left, originTop: box.top, panX: graphUi.graphPanX, panY: graphUi.graphPanY, zoom: graphUi.graphZoom }); return { ...point, screenX: clientX - box.left, screenY: clientY - box.top }; };
  scene.hitTest = function (clientX: number, clientY: number): Node | null {
    const p = scene.worldAt(clientX, clientY); let hit: Node | null = null, best = Infinity;
    // During the short initial layout, hit-test the same LOD tier that is painted instead
    // of returning null while its spatial index is not yet stable.
    if (scene.layoutInProgress) { for (const node of scene.lodTierSet ? scene.lodTierNodes : scene.nodes) { if (!scene.isNodeInLod(node)) continue; const dist2 = graphNodeHitDistanceSquared(p.x, p.y, node.x, node.y, node.radius); if (dist2 !== null && dist2 < best) { best = dist2; hit = node; } } return hit; }
    scene.rebuildSpatialIndex(); const cx = Math.floor(p.x / scene.cellSize), cy = Math.floor(p.y / scene.cellSize); for (let gx = cx - 1; gx <= cx + 1; gx++)for (let gy = cy - 1; gy <= cy + 1; gy++)for (const node of scene.spatialBuckets.get(`${gx},${gy}`) || []) { if (!scene.isNodeInLod(node)) continue; const dist2 = graphNodeHitDistanceSquared(p.x, p.y, node.x, node.y, node.radius); if (dist2 !== null && dist2 < best) { best = dist2; hit = node; } } return hit;
  };
  scene.positionTooltip = function (node: Node, excerpt = false) { scene.tooltipAnchor.style.left = `${Math.round(graphUi.graphPanX + node.x * graphUi.graphZoom)}px`; scene.tooltipAnchor.style.top = `${Math.round(graphUi.graphPanY + node.y * graphUi.graphZoom)}px`; scene.tooltipAnchor.dataset.tooltip = `${node.s.title} · ${node.s.file} · ${langText("linia", "line")} ${node.s.line}${excerpt ? ` — ${graphSectionTooltipExcerpt(node.s, 100)}` : ""}`; if (excerpt) scene.tooltipAnchor.dataset.tooltipKind = "section-preview"; else delete scene.tooltipAnchor.dataset.tooltipKind; };
  scene.hideNodeTooltip = function () { hideAppTooltip(); scene.tooltipAnchor.removeAttribute("data-tooltip"); delete scene.tooltipAnchor.dataset.tooltipKind; };
  scene.announce = function (node: Node | null) { if (!node) { scene.canvas.setAttribute("aria-label", langText("Interaktywny graf sekcji", "Interactive section graph")); return; } scene.canvas.setAttribute("aria-label", langText(`Graf sekcji. Aktywny węzeł: ${node.s.title}, plik ${node.s.file}, linia ${node.s.line}. Użyj strzałek, aby przejść do innego węzła; Enter otwiera sekcję.`, `Section graph. Active node: ${node.s.title}, file ${node.s.file}, line ${node.s.line}. Use arrow keys to move to another node; Enter opens the section.`)); scene.live.textContent = langText(`${node.s.title}, ${node.s.file}, linia ${node.s.line}`, `${node.s.title}, ${node.s.file}, line ${node.s.line}`); };
  scene.scheduleDraw = function () { if (scene.drawFrame) return; scene.drawFrame = requestAnimationFrame(() => { scene.drawFrame = 0; if (!scene.cancelled && scene.renderToken === graphUi.graphRenderToken) scene.drawNow(); }); };
  scene.recomputeLabels = function () {
    scene.labelTimer = undefined; scene.labelLayoutDirty = false; scene.labelsVisible.clear(); if (!graphUi.graphShowLabels) return; const threshold = scene.nodes.length <= 28 ? .48 : scene.nodes.length <= 100 ? .72 : scene.nodes.length <= 200 ? 1 : 1.25; if (graphUi.graphZoom < threshold) return;
    scene.ctx.font = `560 12px ${scene.theme.font}`; const boxes = new Map<string, { left: number; top: number; right: number; bottom: number }[]>(), size = 128; const candidates: ({ node: Node; left: number; top: number; width: number; height: number; important: boolean })[] = [];
    const leftWorld = -graphUi.graphPanX / graphUi.graphZoom - 320, rightWorld = (scene.viewportWidth - graphUi.graphPanX) / graphUi.graphZoom + 320, topWorld = -graphUi.graphPanY / graphUi.graphZoom - 40, bottomWorld = (scene.viewportHeight - graphUi.graphPanY) / graphUi.graphZoom + 40;
    const labelNodes = !scene.layoutInProgress && !graphUi.graphMotion && !scene.nodeSpatialIndexDirty ? scene.visibleNodesInBounds(leftWorld, rightWorld, topWorld, bottomWorld, scene.labelNodeScratch) : (scene.lodTierSet ? scene.lodTierNodes : scene.nodes);
    for (const node of labelNodes) { if (!scene.isNodeInLod(node) || node.x < leftWorld - node.radius || node.x > rightWorld + node.radius || node.y < topWorld || node.y > bottomWorld) continue; const left = graphUi.graphPanX + (node.x + node.radius + 7) * graphUi.graphZoom, top = graphUi.graphPanY + (node.y - 8) * graphUi.graphZoom, width = Math.min(Math.max(12, scene.ctx.measureText(node.s.title).width), 240) * graphUi.graphZoom, height = 16 * graphUi.graphZoom; candidates.push({ node, left, top, width, height, important: node === scene.hoveredNode || node === scene.focusedNode || node === scene.relatedNode || node.s.id === graphUi.selectedGraphSection?.id }); }
    candidates.sort((a, b) => Number(b.important) - Number(a.important) || b.node.degree - a.node.degree);
    for (const c of candidates) {
      const box = { left: c.left, top: c.top, right: c.left + c.width, bottom: c.top + c.height }; const x0 = Math.floor(box.left / size), x1 = Math.floor(box.right / size), y0 = Math.floor(box.top / size), y1 = Math.floor(box.bottom / size); let collision = false; for (let x = x0; x <= x1 && !collision; x++)for (let y = y0; y <= y1 && !collision; y++)for (const other of boxes.get(`${x},${y}`) || []) { if (box.left < other.right + 9 && box.right + 9 > other.left && box.top < other.bottom + 5 && box.bottom + 5 > other.top) { collision = true; break; } }
      if (!collision || c.important) { scene.labelsVisible.add(c.node.key); for (let x = x0; x <= x1; x++)for (let y = y0; y <= y1; y++) { const key = `${x},${y}`, bucket = boxes.get(key) || []; bucket.push(box); boxes.set(key, bucket); } }
    }
  };
  scene.scheduleLabels = function () { scene.labelLayoutDirty = true; if (scene.labelTimer !== undefined) return; scene.labelTimer = window.setTimeout(() => { if (scene.cancelled || scene.renderToken !== graphUi.graphRenderToken) { scene.labelTimer = undefined; return; } if (scene.fastViewportInteraction) { scene.labelTimer = undefined; return; } scene.recomputeLabels(); scene.scheduleDraw(); }, 110); };
  scene.drawNow = function () {
    if (scene.cancelled || scene.renderToken !== graphUi.graphRenderToken) return;
    scene.updateLodTier();
    scene.canvas.style.transform = "none";
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1); scene.dpr = scene.nodes.length > 12000 ? 1 : scene.nodes.length > 4000 ? Math.min(1.25, devicePixelRatio) : Math.min(2, devicePixelRatio); const desiredWidth = Math.max(1, Math.round(scene.graph.clientWidth || scene.viewportWidth)), desiredHeight = Math.max(1, Math.round(scene.graph.clientHeight || scene.viewportHeight));
    if (desiredWidth !== scene.viewportWidth || desiredHeight !== scene.viewportHeight) { scene.viewportWidth = desiredWidth; scene.viewportHeight = desiredHeight; scene.canvas.width = Math.round(scene.viewportWidth * scene.dpr); scene.canvas.height = Math.round(scene.viewportHeight * scene.dpr); scene.canvas.style.width = `${scene.viewportWidth}px`; scene.canvas.style.height = `${scene.viewportHeight}px`; scene.labelLayoutDirty = true; }
    if (scene.canvas.width !== Math.round(scene.viewportWidth * scene.dpr) || scene.canvas.height !== Math.round(scene.viewportHeight * scene.dpr)) { scene.canvas.width = Math.round(scene.viewportWidth * scene.dpr); scene.canvas.height = Math.round(scene.viewportHeight * scene.dpr); }
    if (!scene.layoutInProgress && scene.nodeSpatialIndexDirty) scene.rebuildSpatialIndex();
    if (!scene.layoutInProgress && !graphUi.graphMotion && !scene.fastViewportInteraction && scene.edgeSpatialIndexDirty) scene.rebuildEdgeSpatialIndex();
    if (scene.labelLayoutDirty && graphUi.graphShowLabels && scene.labelTimer === undefined) scene.scheduleLabels();
    scene.ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0); scene.ctx.clearRect(0, 0, scene.viewportWidth, scene.viewportHeight); scene.ctx.save(); scene.ctx.translate(graphUi.graphPanX, graphUi.graphPanY); scene.ctx.scale(graphUi.graphZoom, graphUi.graphZoom);
    const worldLeft = -graphUi.graphPanX / graphUi.graphZoom - 40, worldRight = (scene.viewportWidth - graphUi.graphPanX) / graphUi.graphZoom + 40, worldTop = -graphUi.graphPanY / graphUi.graphZoom - 30, worldBottom = (scene.viewportHeight - graphUi.graphPanY) / graphUi.graphZoom + 30;
    const focus = scene.hoveredNode || scene.relatedNode || scene.focusedNode || (graphUi.selectedGraphSection ? scene.byId.get(graphUi.selectedGraphSection.id) || null : null); const hasEmphasis = !!focus; const relatedNodes = focus ? (scene.adjByNode.get(focus) || scene.emptyRelatedNodes) : scene.emptyRelatedNodes;
    const useNodeIndex = !scene.layoutInProgress && !scene.nodeSpatialIndexDirty && (!graphUi.graphMotion || scene.fastViewportInteraction);
    const nodeCandidates = useNodeIndex ? scene.visibleNodesInBounds(worldLeft, worldRight, worldTop, worldBottom, scene.visibleNodeScratch) : (scene.lodTierSet ? scene.lodTierNodes : scene.nodes);
    const renderNodes = scene.renderNodeScratch; renderNodes.length = 0;
    const renderedNodeSet = scene.renderedNodeSetScratch; renderedNodeSet.clear();
    for (const node of nodeCandidates) {
      if (!scene.isNodeInLod(node) || node.x + node.radius < worldLeft || node.x - node.radius > worldRight || node.y + node.radius < worldTop || node.y - node.radius > worldBottom) continue;
      renderNodes.push(node); renderedNodeSet.add(node);
    }
    // A selected/hovered vertex remains visible even if it falls outside the sampled LOD tier.
    const priorityNodes = scene.priorityNodeScratch; priorityNodes.length = 0; priorityNodes.push(scene.hoveredNode, scene.relatedNode, scene.focusedNode, scene.keyboardNode, graphUi.selectedGraphSection ? scene.byId.get(graphUi.selectedGraphSection.id) || null : null);
    const appendRenderNode = (node: Node | null) => {
      if (!node || renderedNodeSet.has(node) || !scene.isNodeInLod(node)) return;
      if (node.x + node.radius < worldLeft || node.x - node.radius > worldRight || node.y + node.radius < worldTop || node.y - node.radius > worldBottom) return;
      renderNodes.push(node); renderedNodeSet.add(node);
    };
    for (const node of priorityNodes) appendRenderNode(node);
    // For low-degree selections, keep the immediate neighbourhood visible even when
    // the corresponding vertices are outside the current sampled detail tier.
    for (const anchor of priorityNodes) { if (!anchor || anchor.degree > 28) continue; for (const neighbor of scene.adjByNode.get(anchor) || []) appendRenderNode(neighbor); }
    const useEdgeIndex = !scene.layoutInProgress && !scene.fastViewportInteraction && !graphUi.graphMotion && !scene.edgeSpatialIndexDirty;
    let renderEdges: Edge[];
    if (useEdgeIndex) renderEdges = scene.visibleEdgesInBounds(worldLeft, worldRight, worldTop, worldBottom, scene.renderEdgeScratch);
    else if (scene.lodTierSet) {
      const stamp = ++scene.edgeQueryStamp; renderEdges = scene.renderEdgeScratch; renderEdges.length = 0;
      for (const node of renderNodes) for (const edge of scene.edgesByNode.get(node) || []) { if (edge.drawStamp === stamp) continue; edge.drawStamp = stamp; renderEdges.push(edge); }
    } else renderEdges = scene.edgeList;
    scene.ctx.lineCap = "round"; scene.ctx.lineJoin = "round";
    if (!scene.fastViewportInteraction) { for (const group of scene.edgeDrawGroups) group.length = 0; for (const edge of renderEdges) { const a = edge.a, b = edge.b; if (!scene.isNodeInLod(a) || !scene.isNodeInLod(b)) continue; if (Math.max(a.x, b.x) < worldLeft || Math.min(a.x, b.x) > worldRight || Math.max(a.y, b.y) < worldTop || Math.min(a.y, b.y) > worldBottom) continue; const related = !!focus && (a === focus || b === focus), isLink = edge.kind === "link"; const groupIndex = hasEmphasis && !related ? (isLink ? 5 : 4) : related ? (isLink ? 3 : 2) : (isLink ? 1 : 0); scene.edgeDrawGroups[groupIndex].push(edge); } const edgeStyles: [string, number, number][] = [["#8b9bb4", .58, 1.15], [scene.theme.accent, .84, 1.45], ["#a4b4ce", .78, 1.35], [scene.theme.accent, .94, 1.65], ["#8290a7", .16, .8], [scene.theme.accent, .24, .9]]; for (let i = 0; i < scene.edgeDrawGroups.length; i++) { const group = scene.edgeDrawGroups[i]; if (!group.length) continue; const [color, alpha, width] = edgeStyles[i]; scene.ctx.globalAlpha = alpha; scene.ctx.strokeStyle = color; scene.ctx.lineWidth = width / graphUi.graphZoom; scene.ctx.beginPath(); for (const edge of group) { const a = edge.a, b = edge.b, dx = b.x - a.x, dy = b.y - a.y, dist = Math.max(.001, Math.hypot(dx, dy)), ux = dx / dist, uy = dy / dist; scene.ctx.moveTo(a.x + ux * a.radius, a.y + uy * a.radius); scene.ctx.lineTo(b.x - ux * b.radius, b.y - uy * b.radius); } scene.ctx.stroke(); } }
    for (const node of renderNodes) {
      if (node.x + node.radius < worldLeft || node.x - node.radius > worldRight || node.y + node.radius < worldTop || node.y - node.radius > worldBottom) continue; const isSelected = node.s.id === graphUi.selectedGraphSection?.id || node === scene.focusedNode; const isRelated = node === focus || relatedNodes.has(node); scene.ctx.globalAlpha = hasEmphasis && !isRelated && !isSelected ? .62 : 1;
      if (isSelected || node === scene.hoveredNode || node === scene.relatedNode) { scene.ctx.globalAlpha = isSelected ? .22 : .12; scene.ctx.fillStyle = node.color; scene.ctx.beginPath(); scene.ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2); scene.ctx.fill(); }
      scene.ctx.globalAlpha = hasEmphasis && !isRelated && !isSelected ? .62 : 1; scene.ctx.fillStyle = isSelected ? scene.theme.accent : node.color; scene.ctx.beginPath(); scene.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2); scene.ctx.fill(); scene.ctx.strokeStyle = (isSelected || node === scene.hoveredNode || node === scene.relatedNode) ? scene.theme.text : node.color; scene.ctx.lineWidth = (isSelected ? 1.5 : (node === scene.keyboardNode ? 1 : .8)) / graphUi.graphZoom; scene.ctx.stroke();
      if (node === scene.keyboardNode && scene.canvas === document.activeElement) { scene.ctx.globalAlpha = 1; scene.ctx.strokeStyle = scene.theme.focus; scene.ctx.lineWidth = 2 / graphUi.graphZoom; scene.ctx.beginPath(); scene.ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2); scene.ctx.stroke(); }
    }
    if (graphUi.graphShowLabels) { scene.ctx.font = `560 12px ${scene.theme.font}`; scene.ctx.textBaseline = "alphabetic"; for (const node of renderNodes) { const important = node === focus || node.s.id === graphUi.selectedGraphSection?.id || relatedNodes.has(node); if (!scene.labelsVisible.has(node.key) && !important) continue; if (node.x + node.radius + 7 < worldLeft || node.x > worldRight || node.y < worldTop || node.y > worldBottom) continue; scene.ctx.globalAlpha = hasEmphasis && !important ? 0 : important ? 1 : .88; scene.ctx.lineWidth = 3.5 / graphUi.graphZoom; scene.ctx.strokeStyle = scene.theme.editorBg; scene.ctx.strokeText(node.s.title, node.x + node.radius + 7, node.y + 4); scene.ctx.fillStyle = scene.theme.text; scene.ctx.fillText(node.s.title, node.x + node.radius + 7, node.y + 4); } }
    scene.ctx.restore(); scene.ctx.globalAlpha = 1; scene.renderedPanX = graphUi.graphPanX; scene.renderedPanY = graphUi.graphPanY; scene.renderedZoom = graphUi.graphZoom;
    scene.syncFlatGraphMinimapViewport(); scene.scheduleFlatGraphMinimapDraw();
  };
  scene.applyView = function () { scene.labelLayoutDirty = true; scene.scheduleLabels(); scene.scheduleDraw(); scene.syncFlatGraphMinimapViewport(); };
  scene.fit = function () { if (!scene.nodes.length) return; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (const node of scene.nodes) { minX = Math.min(minX, node.x - node.radius - 4); maxX = Math.max(maxX, node.x + node.radius + 4); minY = Math.min(minY, node.y - node.radius - 4); maxY = Math.max(maxY, node.y + node.radius + 4); } const contentW = Math.max(1, maxX - minX), contentH = Math.max(1, maxY - minY), pad = 64; graphUi.graphZoom = Math.max(.025, Math.min(2.2, (scene.viewportWidth - pad * 2) / contentW, (scene.viewportHeight - pad * 2) / contentH)); scene.lodZoomBase = graphUi.graphZoom; scene.updateLodTier(); graphUi.graphPanX = (scene.viewportWidth - contentW * graphUi.graphZoom) / 2 - minX * graphUi.graphZoom; graphUi.graphPanY = (scene.viewportHeight - contentH * graphUi.graphZoom) / 2 - minY * graphUi.graphZoom; scene.applyView(); };
  scene.savePositions = function () { const all: Record<string, { x: number; y: number }> = {}; for (const node of scene.nodes) all[node.key] = { x: node.x, y: node.y }; try { localStorage.setItem(graphPositionsStorageKey, JSON.stringify({ ...scene.saved, ...all })); scene.saved = { ...scene.saved, ...all }; } catch { } };
  scene.updateTooltip = function (node: Node | null, excerpt = false) { if (!node) { scene.hideNodeTooltip(); return; } scene.positionTooltip(node, excerpt); showAppTooltip(scene.tooltipAnchor, 0, "right"); };
  scene.setRelatedSection = function (sectionId: string | null) { scene.relatedNode = sectionId ? scene.byId.get(sectionId) || null : null; if (scene.relatedNode) { scene.updateTooltip(scene.relatedNode, true); } else if (scene.hoveredNode) scene.updateTooltip(scene.hoveredNode); else if (scene.focusedNode) scene.updateTooltip(scene.focusedNode); else scene.hideNodeTooltip(); scene.scheduleDraw(); };
  graphUi.graphEmphasisHandler = scene.setRelatedSection;
}

/** Selection/label/motion hooks on the surface, the force-layout tick and ambient motion. */
function setupLayoutAndMotion(scene: CanvasScene): void {
  scene.surface = scene.canvas as GraphCanvasSurface;
  scene.surface.__typenovaSelectSection = (sectionId, fitToViewport) => { scene.focusedNode = scene.byId.get(sectionId) || null; scene.hoveredNode = null; scene.hideNodeTooltip(); if (fitToViewport) { scene.fit(); graphUi.graphAutoFitNextRender = false; } else scene.applyView(); graphUi.graphAnimateNextRender = false; scene.announce(scene.focusedNode); scene.drawNow(); };
  scene.surface.__typenovaUpdateLabels = () => { scene.labelLayoutDirty = true; scene.recomputeLabels(); scene.drawNow(); };
  scene.surface.__typenovaSetLabels = (enabled) => { graphUi.graphShowLabels = enabled; scene.labelLayoutDirty = true; scene.recomputeLabels(); scene.drawNow(); };
  scene.layoutCancelled = false;
  scene.rafMotion = 0;
  scene.forceX = new Float64Array(scene.nodes.length);
  scene.forceY = new Float64Array(scene.nodes.length);
  scene.cellX = new Int32Array(scene.nodes.length);
  scene.cellY = new Int32Array(scene.nodes.length);
  scene.layoutBuckets = new Map<string, number[]>();
  scene.reusableLayoutBuckets = [];
  scene.layoutCellSize = 180;
  scene.tick = (time = 0, floating = false, _elapsedMs = 32) => {
    scene.forceX.fill(0); scene.forceY.fill(0);
    const repel = (i: number, j: number) => { const a = scene.nodes[i], b = scene.nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy; if (d2 < 1) { const angle = ((i * 31 + j * 17) % 360) * Math.PI / 180; dx = Math.cos(angle); dy = Math.sin(angle); d2 = 1; } const d = Math.sqrt(d2), ux = dx / d, uy = dy / d, r = Math.min(1.6, 1500 / d2); scene.forceX[i] -= ux * r; scene.forceY[i] -= uy * r; scene.forceX[j] += ux * r; scene.forceY[j] += uy * r; const min = a.radius + b.radius + 18; if (d < min) { const push = (min - d) * .075; scene.forceX[i] -= ux * push; scene.forceY[i] -= uy * push; scene.forceX[j] += ux * push; scene.forceY[j] += uy * push; } };
    if (scene.nodes.length <= 400) { for (let i = 0; i < scene.nodes.length; i++)for (let j = i + 1; j < scene.nodes.length; j++)repel(i, j); } else { for (const bucket of scene.layoutBuckets.values()) { bucket.length = 0; scene.reusableLayoutBuckets.push(bucket); } scene.layoutBuckets.clear(); for (let i = 0; i < scene.nodes.length; i++) { const x = Math.floor(scene.nodes[i].x / scene.layoutCellSize), y = Math.floor(scene.nodes[i].y / scene.layoutCellSize); scene.cellX[i] = x; scene.cellY[i] = y; const key = `${x},${y}`; let group = scene.layoutBuckets.get(key); if (!group) { group = scene.reusableLayoutBuckets.pop() || []; scene.layoutBuckets.set(key, group); } group.push(i); } for (let i = 0; i < scene.nodes.length; i++) { const x = scene.cellX[i], y = scene.cellY[i]; for (let gx = x - 2; gx <= x + 2; gx++)for (let gy = y - 2; gy <= y + 2; gy++)for (const j of scene.layoutBuckets.get(`${gx},${gy}`) || []) { if (j <= i) continue; const dx = scene.nodes[j].x - scene.nodes[i].x, dy = scene.nodes[j].y - scene.nodes[i].y; if (dx * dx + dy * dy <= 230 * 230) repel(i, j); } } }
    for (const edge of scene.edgeList) { const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y, dist = Math.max(.001, Math.hypot(dx, dy)), desired = edge.kind === "tree" ? 82 : edge.kind === "section" ? 100 : 142, strength = edge.kind === "tree" ? .013 : edge.kind === "section" ? .011 : .008, pull = (dist - desired) * strength, px = dx / dist * pull, py = dy / dist * pull; scene.forceX[edge.a.index] += px; scene.forceY[edge.a.index] += py; scene.forceX[edge.b.index] -= px; scene.forceY[edge.b.index] -= py; }
    for (let i = 0; i < scene.nodes.length; i++) { const node = scene.nodes[i]; if (node.dragging) continue; if (floating) { scene.forceX[i] += Math.sin(time * .00091 + i * 1.731) * .085; scene.forceY[i] += Math.cos(time * .00073 + i * 2.417) * .085; } node.vx = (node.vx + scene.forceX[i] - node.x * .001) * .82; node.vy = (node.vy + scene.forceY[i] - node.y * .001) * .82; node.x += node.vx; node.y += node.vy; }
    scene.flatGraphMinimapBaseDirty = true;
  };
  scene.stopAmbient = () => { scene.layoutCancelled = true; if (scene.rafMotion) cancelAnimationFrame(scene.rafMotion); scene.rafMotion = 0; if (graphUi.graphAmbientMotionStop === scene.stopAmbient) graphUi.graphAmbientMotionStop = null; scene.savePositions(); scene.drawNow(); };
  scene.startAmbient = () => { if (!graphUi.graphMotion || scene.cancelled || scene.renderToken !== graphUi.graphRenderToken || graphUi.graphAmbientMotionStop || graphUi.stopGraphLayout) return; let lastDraw = 0, lastTick = 0; scene.layoutCancelled = false; const animate = (time: number) => { if (scene.layoutCancelled || scene.cancelled || scene.renderToken !== graphUi.graphRenderToken || !graphUi.graphMotion) { scene.stopAmbient(); return; } if (time - lastDraw >= 50) { scene.tick(time, true, lastTick ? Math.min(48, time - lastTick) : 40); lastTick = time; scene.drawNow(); lastDraw = time; } scene.rafMotion = requestAnimationFrame(animate); }; graphUi.graphAmbientMotionStop = scene.stopAmbient; graphUi.graphAmbientMotionStart = scene.startAmbient; scene.rafMotion = requestAnimationFrame(animate); };
  graphUi.graphAmbientMotionStart = scene.startAmbient;
  scene.surface.__typenovaSetMotion = (enabled) => { if (enabled) scene.startAmbient(); else if (graphUi.graphAmbientMotionStop) graphUi.graphAmbientMotionStop(); };
}

/** Pointer, wheel and keyboard handlers on the canvas and the zoom/fit buttons. */
function bindCanvasEvents(scene: CanvasScene): void {
  scene.canvas.addEventListener("pointermove", event => {
    const pe = event as PointerEvent;
    if (scene.panGesture && pe.pointerId === scene.panGesture.pointerId) { const dx = pe.clientX - scene.panGesture.startX, dy = pe.clientY - scene.panGesture.startY; if (Math.hypot(dx, dy) > 3) scene.panGesture.moved = true; if (scene.panGesture.node) { if (scene.panGesture.moved) { scene.panGesture.node.dragging = true; scene.panGesture.node.x = scene.panGesture.nodeX + dx / graphUi.graphZoom; scene.panGesture.node.y = scene.panGesture.nodeY + dy / graphUi.graphZoom; scene.panGesture.node.vx = 0; scene.panGesture.node.vy = 0; scene.flatGraphMinimapBaseDirty = true; scene.labelLayoutDirty = true; scene.markViewportInteracting(); scene.scheduleDraw(); } } else { graphUi.graphPanX = scene.panGesture.panX + dx; graphUi.graphPanY = scene.panGesture.panY + dy; scene.labelLayoutDirty = true; scene.markViewportInteracting(); scene.applyViewportPreviewTransform(); } return; }
    const next = scene.hitTest(pe.clientX, pe.clientY); if (next !== scene.hoveredNode) { scene.hoveredNode = next; if (next) { scene.positionTooltip(next); showAppTooltip(scene.tooltipAnchor, 0, "right"); } else { scene.hideNodeTooltip(); } scene.labelLayoutDirty = true; scene.scheduleLabels(); scene.scheduleDraw(); }
  });
  scene.canvas.addEventListener("pointerdown", event => { const pe = event as PointerEvent; if (pe.button !== 0) return; scene.canvas.focus({ preventScroll: true }); const node = scene.hitTest(pe.clientX, pe.clientY); scene.focusedNode = node || scene.focusedNode; if (node) { scene.keyboardNode = node; scene.positionTooltip(node); hideAppTooltip(); } else scene.hideNodeTooltip(); scene.panGesture = { pointerId: pe.pointerId, startX: pe.clientX, startY: pe.clientY, panX: graphUi.graphPanX, panY: graphUi.graphPanY, node, nodeX: node?.x || 0, nodeY: node?.y || 0, moved: false }; try { scene.canvas.setPointerCapture(pe.pointerId); } catch { } pe.preventDefault(); });
  scene.finishPointer = (event: PointerEvent) => { const gesture = scene.panGesture; if (!gesture || gesture.pointerId !== event.pointerId) return; scene.panGesture = null; if (gesture.node) { gesture.node.dragging = false; if (gesture.moved) { scene.nodeSpatialIndexDirty = true; scene.edgeSpatialIndexDirty = true; scene.savePositions(); scene.rebuildSpatialIndex(); scene.scheduleLabels(); } else if (event.type === "pointerup") { selectGraphSection(gesture.node.s); } } else if (event.type === "pointerup" && !gesture.moved && graphUi.selectedGraphSection) closeGraphPreview(true); if (gesture.moved) scene.scheduleDraw(); };
  scene.canvas.addEventListener("pointerup", scene.finishPointer);
  scene.canvas.addEventListener("pointercancel", scene.finishPointer);
  scene.canvas.addEventListener("pointerleave", () => { if (!scene.panGesture && scene.hoveredNode) { scene.hoveredNode = null; if (!scene.relatedNode) scene.hideNodeTooltip(); scene.scheduleDraw(); } });
  scene.canvas.addEventListener("wheel", event => { event.preventDefault(); const pe = event as WheelEvent, box = scene.graph.getBoundingClientRect(), mx = pe.clientX - box.left, my = pe.clientY - box.top, next = zoomGraphAtPoint({ zoom: graphUi.graphZoom, panX: graphUi.graphPanX, panY: graphUi.graphPanY }, pe.deltaY < 0 ? 1.12 : 1 / 1.12, mx, my, { minZoom: .025, maxZoom: 2.8 }); graphUi.graphZoom = next.zoom; graphUi.graphPanX = next.panX; graphUi.graphPanY = next.panY; scene.labelLayoutDirty = true; scene.markViewportInteracting(); scene.applyViewportPreviewTransform(); }, { passive: false });
  scene.navigate = function (direction: string) { const origin = scene.focusedNode || scene.nodes.find(node => node.s.id === graphUi.selectedGraphSection?.id) || scene.nodes[0]; if (!origin) return; let candidate: Node | null = null, best = Infinity; for (const node of scene.nodes) { if (node === origin) continue; const dx = node.x - origin.x, dy = node.y - origin.y; const primary = direction === "ArrowRight" ? dx : direction === "ArrowLeft" ? -dx : direction === "ArrowDown" ? dy : -dy; if (primary <= 0) continue; const secondary = direction.startsWith("ArrowLeft") || direction.startsWith("ArrowRight") ? Math.abs(dy) : Math.abs(dx); const score = primary + secondary * 2.4 + (secondary * secondary) / (primary + 1); if (score < best) { best = score; candidate = node; } } if (!candidate) { const index = scene.nodes.indexOf(origin), step = direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1; candidate = scene.nodes[(index + step + scene.nodes.length) % scene.nodes.length]; } scene.focusedNode = candidate; scene.keyboardNode = candidate; scene.hoveredNode = null; scene.announce(candidate); scene.positionTooltip(candidate); showAppTooltip(scene.tooltipAnchor, 0, "right"); scene.labelLayoutDirty = true; scene.scheduleDraw(); };
  scene.canvas.addEventListener("keydown", event => { const key = (event as KeyboardEvent).key; if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) { event.preventDefault(); scene.navigate(key); } else if (key === "Enter" || key === " ") { event.preventDefault(); const active = scene.focusedNode || scene.hoveredNode; if (active) selectGraphSection(active.s); } else if (key === "Escape") { scene.hideNodeTooltip(); } });
  scene.surface.__typenovaSelectSection = (sectionId, fitToViewport) => { scene.focusedNode = scene.byId.get(sectionId) || null; scene.hoveredNode = null; scene.hideNodeTooltip(); if (fitToViewport) { scene.fit(); graphUi.graphAutoFitNextRender = false; } else scene.applyView(); graphUi.graphAnimateNextRender = false; scene.announce(scene.focusedNode); scene.drawNow(); };
  $("brainZoomIn").onclick = () => { const old = graphUi.graphZoom; graphUi.graphZoom = Math.min(2.8, graphUi.graphZoom * 1.18); graphUi.graphPanX = scene.viewportWidth / 2 - (scene.viewportWidth / 2 - graphUi.graphPanX) * graphUi.graphZoom / old; graphUi.graphPanY = scene.viewportHeight / 2 - (scene.viewportHeight / 2 - graphUi.graphPanY) * graphUi.graphZoom / old; scene.applyView(); };
  $("brainZoomOut").onclick = () => { const old = graphUi.graphZoom; graphUi.graphZoom = Math.max(.025, graphUi.graphZoom / 1.18); graphUi.graphPanX = scene.viewportWidth / 2 - (scene.viewportWidth / 2 - graphUi.graphPanX) * graphUi.graphZoom / old; graphUi.graphPanY = scene.viewportHeight / 2 - (scene.viewportHeight / 2 - graphUi.graphPanY) * graphUi.graphZoom / old; scene.applyView(); };
  $("brainFit").onclick = scene.fit;
  graphUi.graphEmphasisHandler = scene.setRelatedSection;
}

/** Theme observer, initial fit or layout, and the cleanup hook. */
function startCanvasRender(scene: CanvasScene): void {
  // Redraw when the user changes theme; the same node/edge data is kept in memory.
  graphUi.graphCanvasThemeObserver = new MutationObserver(() => { scene.refreshTheme(); scene.flatGraphMinimapBaseDirty = true; scene.labelLayoutDirty = true; scene.scheduleDraw(); });
  graphUi.graphCanvasThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  scene.initialFit = graphUi.graphAutoFitNextRender;
  if (scene.needsLayout) {
    graphUi.graphPanX = scene.viewportWidth / 2; graphUi.graphPanY = scene.viewportHeight / 2; graphUi.graphZoom = 1; scene.applyView();
    let finished = false;
    const maxIterations = scene.nodes.length > 5000 ? 8 : scene.nodes.length > 2200 ? 18 : scene.nodes.length > 1200 ? 32 : scene.nodes.length > 600 ? 48 : 72;
    const drawEvery = scene.nodes.length > 3000 ? 3 : scene.nodes.length > 1000 ? 2 : 1;
    scene.layoutInProgress = true; scene.nodeSpatialIndexDirty = true; scene.edgeSpatialIndexDirty = true;
    const finalize = () => { if (finished) return; finished = true; scene.layoutInProgress = false; scene.nodeSpatialIndexDirty = true; scene.edgeSpatialIndexDirty = true; graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; scene.rebuildSpatialIndex(); scene.rebuildEdgeSpatialIndex(); scene.labelLayoutDirty = true; scene.drawNow(); scene.savePositions(); if (scene.initialFit) { scene.fit(); graphUi.graphAutoFitNextRender = false; } else scene.applyView(); graphUi.graphAnimateNextRender = false; if (graphUi.graphMotion) scene.startAmbient(); };
    const applyWorkerPositions = (positions: Float32Array) => { for (let i = 0; i < scene.nodes.length; i++) { scene.nodes[i].x = positions[i * 2]; scene.nodes[i].y = positions[i * 2 + 1]; } scene.nodeSpatialIndexDirty = true; scene.edgeSpatialIndexDirty = true; scene.flatGraphMinimapBaseDirty = true; };
    const runFallbackLayout = () => { let fallbackIterations = 0; const fallback = () => { if (finished || scene.cancelled || scene.renderToken !== graphUi.graphRenderToken) return; scene.tick(); fallbackIterations++; if (fallbackIterations % drawEvery === 0 || fallbackIterations >= maxIterations) scene.drawNow(); if (fallbackIterations < maxIterations) { graphUi.graphAnimationFrame = requestAnimationFrame(fallback); return; } finalize(); }; graphUi.stopGraphLayout = () => { if (finished) return; finished = true; scene.layoutInProgress = false; scene.layoutCancelled = true; if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; }; graphUi.graphAnimationFrame = requestAnimationFrame(fallback); };
    const cancelWorker = startForceLayoutWorker(
      scene.nodes.map(node => ({ x: node.x, y: node.y, radius: node.radius })),
      scene.edgeList.map(edge => ({ a: edge.a.index, b: edge.b.index, kind: edge.kind })),
      maxIterations,
      {
        onFrame: result => { if (finished || scene.cancelled || scene.renderToken !== graphUi.graphRenderToken) return; applyWorkerPositions(result.positions); if (result.iteration % Math.max(4, drawEvery * 4) === 0) scene.drawNow(); },
        onDone: result => { if (finished || scene.cancelled || scene.renderToken !== graphUi.graphRenderToken) return; applyWorkerPositions(result.positions); finalize(); },
        onError: () => { if (!finished && !scene.cancelled && scene.renderToken === graphUi.graphRenderToken) runFallbackLayout(); }
      }
    );
    graphUi.stopGraphLayout = () => { if (finished) return; finished = true; scene.layoutInProgress = false; scene.layoutCancelled = true; cancelWorker(); if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; };
  } else { scene.layoutInProgress = false; scene.nodeSpatialIndexDirty = true; scene.edgeSpatialIndexDirty = true; scene.rebuildSpatialIndex(); scene.rebuildEdgeSpatialIndex(); scene.drawNow(); if (scene.initialFit) { scene.fit(); graphUi.graphAutoFitNextRender = false; } else scene.applyView(); graphUi.graphAnimateNextRender = false; if (graphUi.graphMotion) scene.startAmbient(); }
  graphUi.graphCanvasCleanup = () => { scene.cancelled = true; if (scene.drawFrame) cancelAnimationFrame(scene.drawFrame); scene.drawFrame = 0; if (scene.labelTimer !== undefined) clearTimeout(scene.labelTimer); scene.labelTimer = undefined; if (scene.viewportInteractionTimer !== undefined) clearTimeout(scene.viewportInteractionTimer); scene.viewportInteractionTimer = undefined; if (scene.flatGraphMinimapDrawTimer !== undefined) clearTimeout(scene.flatGraphMinimapDrawTimer); scene.flatGraphMinimapDrawTimer = undefined; scene.flatGraphMinimap.onpointerdown = null; scene.flatGraphMinimap.onpointermove = null; scene.flatGraphMinimap.onpointerup = null; scene.flatGraphMinimap.onpointercancel = null; scene.flatGraphMinimap.onlostpointercapture = null; scene.flatGraphMinimap.onkeydown = null; scene.flatGraphMinimap.hidden = true; scene.flatGraphMinimapModel = null; graphUi.graphFlatMinimapReady = false; scene.flatGraphMinimapPointerId = null; if (scene.rafMotion) cancelAnimationFrame(scene.rafMotion); scene.rafMotion = 0; if (graphUi.graphCanvasThemeObserver) { graphUi.graphCanvasThemeObserver.disconnect(); graphUi.graphCanvasThemeObserver = null; } if (graphUi.graphAmbientMotionStop === scene.stopAmbient) { graphUi.graphAmbientMotionStop = null; } if (graphUi.graphAnimationFrame) { cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; } if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout = null; } };
}

export function renderGraphCanvas() {
  const scene = {} as CanvasScene;
  if (graphUi.graphCanvasCleanup) { const cleanup = graphUi.graphCanvasCleanup; graphUi.graphCanvasCleanup = null; cleanup(); }
  if (graphUi.graphCanvasThemeObserver) { graphUi.graphCanvasThemeObserver.disconnect(); graphUi.graphCanvasThemeObserver = null; }
  if (graphUi.graphAmbientMotionStop) { graphUi.graphAmbientMotionStop(); graphUi.graphAmbientMotionStop = null; }
  graphUi.graphAmbientMotionStart = null;
  if (graphUi.graphAnimationFrame) { cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; }
  if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout(); graphUi.stopGraphLayout = null; }
  scene.graph = $("brainGraph") as HTMLElement;
  scene.filter = (($("brainFilter") as HTMLInputElement).value || "").trim().toLocaleLowerCase();
  scene.visible = graphUi.graphSections.filter(s => (graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(s.path)) && (!scene.filter || s.title.toLocaleLowerCase().includes(scene.filter) || s.file.toLocaleLowerCase().includes(scene.filter) || s.path.toLocaleLowerCase().includes(scene.filter)));
  scene.status = $("brainStatus") as HTMLElement;
  if (graphUi.graphSections.length) scene.status.textContent = langText(`${graphUi.graphSections.length} sekcji · widoczne: ${scene.visible.length}`, `${graphUi.graphSections.length} sections · visible: ${scene.visible.length}`);
  scene.baseGraphStatusText = scene.status.textContent || "";
  if (!scene.visible.length) {
    graphUi.graphEmphasisHandler = null; graphUi.hoveredRelatedSectionId = null;
    const noneSelected = graphUi.graphSelectedFiles !== null && graphUi.graphSelectedFiles.size === 0;
    scene.graph.innerHTML = noneSelected
      ? `<div class="brain-empty brain-empty-no-selection"><span class="brain-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg></span><strong>${langText("Wszystkie dokumenty są ukryte", "All documents are hidden")}</strong><span>${langText("Włącz dokument lub katalog w panelu Filtry, aby ponownie wyświetlić graf.", "Enable a document or folder in the Filters panel to show the graph again.")}</span></div>`
      : `<div class="brain-empty"><span class="brain-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg></span><strong>${langText("Nie znaleziono sekcji", "No sections found")}</strong><span>${langText("Zmień filtr lub wybór plików, albo otwórz projekt zawierający nagłówki Markdown.", "Change the filter or file selection, or open a project containing Markdown headings.")}</span></div>`;
    scene.graph.querySelector<HTMLElement>(".brain-empty-no-selection")?.setAttribute("role", "status");
    return;
  }
  scene.renderToken = ++graphUi.graphRenderToken;
  scene.rect = scene.graph.getBoundingClientRect();
  scene.viewportWidth = Math.max(320, Math.round(scene.rect.width || scene.graph.clientWidth || window.innerWidth - 32));
  scene.viewportHeight = Math.max(260, Math.round(scene.rect.height || scene.graph.clientHeight || window.innerHeight - 170));
  scene.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  scene.canvas = document.createElement("canvas") as GraphCanvasSurface;
  scene.canvas.className = "brain-canvas";
  scene.canvas.width = Math.round(scene.viewportWidth * scene.dpr);
  scene.canvas.height = Math.round(scene.viewportHeight * scene.dpr);
  scene.canvas.style.width = "100%";
  scene.canvas.style.height = "100%";
  scene.canvas.style.transformOrigin = "0 0";
  scene.canvas.tabIndex = 0;
  scene.canvas.setAttribute("role", "application");
  scene.canvas.setAttribute("aria-label", langText("Interaktywny graf sekcji. Przeciągnij tło, aby przesunąć, przeciągnij węzeł, aby zmienić jego położenie, użyj kółka myszy do powiększania. Strzałki klawiatury przechodzą między węzłami, Enter otwiera sekcję.", "Interactive section graph. Drag the background to pan, drag a node to move it, and use the mouse wheel to zoom. Arrow keys navigate nodes; Enter opens a section."));
  scene.canvas.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space");
  scene.live = document.createElement("span");
  scene.live.className = "brain-canvas-live";
  scene.live.setAttribute("aria-live", "polite");
  scene.live.setAttribute("aria-atomic", "true");
  scene.tooltipAnchor = document.createElement("span");
  scene.tooltipAnchor.className = "brain-canvas-tooltip-anchor";
  scene.tooltipAnchor.setAttribute("aria-hidden", "true");
  scene.graph.replaceChildren(scene.canvas, scene.live, scene.tooltipAnchor);
  scene.context = scene.canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!scene.context) {
    // Canvas is supported by all target WebView2 versions; retain a useful failure state rather than silently losing the graph.
    scene.graph.innerHTML = `<div class="brain-empty"><strong>${langText("Nie można uruchomić renderera grafu", "Could not initialize the graph renderer")}</strong><span>${langText("Uruchom aplikację ponownie lub zaktualizuj WebView2.", "Restart the application or update WebView2.")}</span></div>`; return;
  }
  scene.ctx = scene.context as CanvasRenderingContext2D;
  buildCanvasModel(scene);
  initInteractionState(scene);
  setupFlatMinimap(scene);
  defineSceneOperations(scene);
  setupLayoutAndMotion(scene);
  bindCanvasEvents(scene);
  startCanvasRender(scene);
}
