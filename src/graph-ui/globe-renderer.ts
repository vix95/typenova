/** Globe (SVG) renderer: nodes projected on a sphere, edges, labels, drag/pan/zoom and level of detail. */
import { projectSectionGraphModel, buildSectionGraphModel, preferredSectionRelationKind } from "../graph/section-model";
import { readPreferenceJson, isRecord } from "../settings/storage";
import { GRAPH_LOD_THRESHOLD, orderGraphLodNodes, getGraphLodBudget } from "../graph/lod-policy";
import { startForceLayoutWorker } from "../graph/layout-client";
import { $ } from "../app/dom";
import { closeGraphPreview } from "./filter-panel";
import { graphPositionsStorageKey } from "./graph-controls";
import { graphUi, type GraphSection } from "./graph-state";
import { graphSectionTooltipExcerpt } from "./related-panel";
import { selectGraphSection } from "./selection";
import { langText } from "../i18n/language";
import { hideAppTooltip, showAppTooltip } from "../ui/tooltip";
import type { GraphNode, GraphEdge, GlobeScene } from "./globe-scene";


/** Creates the nodes: colour, seed position and the saved layout. */
function buildGlobeNodes(globeScene: GlobeScene): void {
  globeScene.drawPositions = function () {
    const globe = graphUi.graphGlobeMode;
    for (const n of globeScene.lodVisibleNodes) {
      const depthProgress = Math.max(0, Math.min(1, (n.depth + 1) / 2));
      const transform = globe ? `translate(${n.x} ${n.y}) scale(${.62 + depthProgress * .58})` : `translate(${n.x} ${n.y})`;
      if (n.el && n.el.getAttribute("transform") !== transform) n.el.setAttribute("transform", transform);
      if (n.el && globe) {
        const opacity = String(.2 + depthProgress * .8);
        if (n.el.style.opacity !== opacity) n.el.style.opacity = opacity;
        const back = n.depth < -.2; if (n.el.classList.contains("globe-back") !== back) n.el.classList.toggle("globe-back", back);
      }
    }
    globeScene.updateEdges(); globeScene.scheduleLabelScaleUpdate();
  };
  globeScene.add = (tag: string, attrs: Record<string, string>, parent: Element = globeScene.scene) => { const el = document.createElementNS(globeScene.ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); parent.append(el); return el; };
  globeScene.sphereRadius = Math.max(105, Math.min(globeScene.viewportWidth, globeScene.viewportHeight) * .34);
  globeScene.palette = ["#69a9ff", "#79cba6", "#c49bff", "#eac36c", "#f18fa7", "#64c5ce", "#9caeff", "#e5a0d0", "#a7c878", "#eea16b", "#7bb8d4", "#c2a4e8"];
  globeScene.hashFor = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++)h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0; };
  globeScene.sectionsById = new Map(graphUi.graphSections.map(section => [section.id, section] as const));
  globeScene.headingLevelColor = (hex: string, level: number, hueOffset = 0) => {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const max = Math.max(...rgb), min = Math.min(...rgb), lightness = (max + min) / 2, delta = max - min;
    let hue = 0, saturation = 0;
    if (delta) { saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min); if (max === rgb[0]) hue = (rgb[1] - rgb[2]) / delta + (rgb[1] < rgb[2] ? 6 : 0); else if (max === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2; else hue = (rgb[0] - rgb[1]) / delta + 4; hue *= 60; }
    // H1 anchors the branch. Each H2 child receives a stable color variant
    // based on its root and title; deeper headings retain that branch identity.
    hue = (hue + Math.max(0, level - 1) * 31 + hueOffset) % 360;
    const levelLightness = level === 1 ? 0 : (level % 2 === 0 ? .045 : -.025 * Math.floor(level / 2));
    const l = Math.max(.42, Math.min(.76, lightness + levelLightness));
    const chroma = (1 - Math.abs(2 * l - 1)) * saturation;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - chroma / 2;
    let channels: [number, number, number];
    if (hue < 60) channels = [chroma, x, 0]; else if (hue < 120) channels = [x, chroma, 0]; else if (hue < 180) channels = [0, chroma, x]; else if (hue < 240) channels = [0, x, chroma]; else if (hue < 300) channels = [x, 0, chroma]; else channels = [chroma, 0, x];
    return `#${channels.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  globeScene.colorFor = (section: GraphSection) => {
    const ancestry: GraphSection[] = [section]; let parentId = section.parent, guard = 0;
    while (parentId && guard++ < 64) { const parent = globeScene.sectionsById.get(parentId); if (!parent) break; ancestry.push(parent); parentId = parent.parent; }
    const stablePath = section.path.replace(/\\/g, "/").toLocaleLowerCase();
    const topHeading = [...ancestry].reverse().find(item => item.level === 1) ?? ancestry[ancestry.length - 1];
    const rootSeed = `${stablePath}::${topHeading.title.toLocaleLowerCase()}::${topHeading.line}`;
    const rootColor = globeScene.palette[globeScene.hashFor(rootSeed) % globeScene.palette.length];
    if (section.level <= 1) return globeScene.headingLevelColor(rootColor, 1);
    const childHeading = ancestry.find(item => item.level === 2) ?? section;
    const childSeed = `${rootSeed}::h2::${childHeading.title.toLocaleLowerCase()}::${childHeading.line}`;
    const childHueOffset = 24 + (globeScene.hashFor(childSeed) % 49);
    const childColor = globeScene.headingLevelColor(rootColor, 2, childHueOffset);
    if (section.level === 2) return childColor;
    return globeScene.headingLevelColor(childColor, section.level - 1);
  };
  // Keep relationship lines tied to their endpoint colors: same-file links
  // exactly match their vertices; cross-file Markdown links use a midpoint blend.
  globeScene.blendNodeColors = (a: string, b: string) => {
    const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
    const mixed = [1, 3, 5].map(offset => Math.round((channel(a, offset) + channel(b, offset)) / 2));
    return `#${mixed.map(value => value.toString(16).padStart(2, "0")).join("")}`;
  };
  globeScene.nodes = globeScene.visible.map((s, i) => {
    const key = `${s.path.replace(/\\/g, "/")}::${s.line}::${s.title.toLocaleLowerCase()}`;
    const angle = (globeScene.hashFor(key) % 100000) / 100000 * Math.PI * 2 + i * 2.399963229728653;
    const spread = 24 + Math.sqrt(i + 1) * 15;
    const sphereZ = 1 - 2 * (i + .5) / Math.max(1, globeScene.visible.length); const sphereR = Math.sqrt(Math.max(0, 1 - sphereZ * sphereZ)); const sphereTheta = i * Math.PI * (3 - Math.sqrt(5)); const gx = Math.cos(sphereTheta) * sphereR, gy = Math.sin(sphereTheta) * sphereR;
    return { s, key, lodRank: i, x: graphUi.graphGlobeMode ? gx * globeScene.sphereRadius : Math.cos(angle) * spread, y: graphUi.graphGlobeMode ? gy * globeScene.sphereRadius : Math.sin(angle) * spread, gx, gy, gz: sphereZ, depth: sphereZ, vx: 0, vy: 0, radius: 4.2, color: globeScene.colorFor(s), dragging: false, suppressClick: false, el: null };
  });
  globeScene.byId = new Map(globeScene.nodes.map(n => [n.s.id, n]));
  globeScene.sectionGraphModel = graphUi.graphSectionGraphModel ? projectSectionGraphModel(graphUi.graphSectionGraphModel, globeScene.visible) : buildSectionGraphModel(globeScene.visible);
  globeScene.saved = {};
  globeScene.positionsKey = graphPositionsStorageKey;
  globeScene.storedPositions = readPreferenceJson(globeScene.positionsKey, isRecord, {});
  for (const [key, value] of Object.entries(globeScene.storedPositions)) { if (isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y)) globeScene.saved[key] = { x: value.x, y: value.y }; }
  globeScene.needsLayout = false;
  if (!graphUi.graphGlobeMode) { for (const n of globeScene.nodes) { const pos = globeScene.saved[n.key]; if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) { n.x = pos.x; n.y = pos.y; } else globeScene.needsLayout = true; } }
}

/** Deduplicated edges, degrees, node radii and the level-of-detail ordering. */
function buildGlobeEdges(globeScene: GlobeScene): void {
  globeScene.edgeList = [];
  globeScene.edgeByPair = new Map<string, GraphEdge>();
  globeScene.nodeIndex = new Map<GraphNode, number>();
  globeScene.nodes.forEach((node, index) => globeScene.nodeIndex.set(node, index));
  globeScene.addEdge = (a: GraphNode, b: GraphNode, kind: "tree" | "section" | "link") => {
    if (a === b) return; const pair = [a.s.id, b.s.id].sort().join("|"); const existing = globeScene.edgeByPair.get(pair);
    if (existing) { const preferred = preferredSectionRelationKind(existing.kind, kind); if (preferred !== existing.kind) { existing.kind = preferred; if (existing.el) { existing.el.classList.remove("tree-edge", "section-edge", "link-edge"); existing.el.classList.add(`${preferred}-edge`); existing.el.dataset.edgeKind = preferred; } } return; }
    const edge: GraphEdge = { a, b, kind, el: null }; globeScene.edgeList.push(edge); globeScene.edgeByPair.set(pair, edge);
  };
  for (const relation of globeScene.sectionGraphModel.relations) {
    const source = globeScene.byId.get(relation.sourceId), target = globeScene.byId.get(relation.targetId);
    if (source && target) globeScene.addEdge(source, target, relation.kind);
  }
  globeScene.degree = new Map<GraphNode, number>();
  for (const n of globeScene.nodes) globeScene.degree.set(n, 0);
  for (const e of globeScene.edgeList) { globeScene.degree.set(e.a, (globeScene.degree.get(e.a) || 0) + 1); globeScene.degree.set(e.b, (globeScene.degree.get(e.b) || 0) + 1); }
  for (const n of globeScene.nodes) n.radius = graphUi.graphGlobeMode ? Math.min(2.75, 1.35 + Math.sqrt(globeScene.degree.get(n) || 0) * 0.18) : Math.min(8.2, 4 + Math.sqrt(globeScene.degree.get(n) || 0) * 0.92);
  // Large SVG Globe graphs use progressive detail too. Every node and edge remains
  // in the data model, but at the fit view only a deterministic 20% tier is attached
  // to the live SVG tree. Zoom adds nodes and the edges between currently visible nodes.
  globeScene.lodEnabled = globeScene.nodes.length >= GRAPH_LOD_THRESHOLD;
  // Shared LOD policy: H1 first, then H2, H3, etc. Degree only breaks same-level ties.
  globeScene.lodOrder = orderGraphLodNodes(globeScene.nodes, node => ({ level: node.s.level, degree: globeScene.degree.get(node) || 0, key: node.key }), globeScene.lodEnabled);
  globeScene.lodOrder.forEach((node, index) => { node.lodRank = index; });
  globeScene.lodZoomBase = Math.max(.06, Math.min(2.2, (Math.min(globeScene.viewportWidth, globeScene.viewportHeight) - 72) / (globeScene.sphereRadius * 2)));
  globeScene.initialLodBudget = globeScene.lodEnabled ? Math.max(1, Math.ceil(globeScene.nodes.length * .2)) : globeScene.nodes.length;
  globeScene.lodBudget = -1;
  globeScene.lodTierSet = globeScene.lodEnabled ? new Set(globeScene.lodOrder.slice(0, globeScene.initialLodBudget)) : null;
  globeScene.lodFullZoomFactor = Math.min(2.15, 1.42 + Math.sqrt(globeScene.nodes.length / 200) * .12);
  globeScene.baseGlobeStatusText = globeScene.status.textContent || "";
  globeScene.lodStatusText = "";
}

/** Hover/emphasis state, drag-update scheduling, related-section tooltip and LOD-visible collections. */
function initGlobeState(globeScene: GlobeScene): void {
  // Graph focus is intentionally independent from the editor cursor. Entering
  // this view must not look like a node was selected just because the editor
  // caret happens to be inside that heading.
  globeScene.nodeEls = new Map<string, SVGGElement>();
  globeScene.nodeTitle = (n: GraphNode) => `${n.s.title} · ${n.s.file} · ${langText("linia", "line")} ${n.s.line}`;
  globeScene.hoveredGraphNode = null;
  globeScene.edgesByNode = new Map<GraphNode, GraphEdge[]>();
  for (const node of globeScene.nodes) globeScene.edgesByNode.set(node, []);
  for (const edge of globeScene.edgeList) { globeScene.edgesByNode.get(edge.a)?.push(edge); globeScene.edgesByNode.get(edge.b)?.push(edge); }
  globeScene.emphasizedNodes = new Set<GraphNode>();
  globeScene.emphasizedEdges = new Set<GraphEdge>();
  globeScene.applyGraphEmphasis = () => {
    const relatedPanelNode = !globeScene.hoveredGraphNode && graphUi.hoveredRelatedSectionId ? globeScene.byId.get(graphUi.hoveredRelatedSectionId) || null : null;
    const focus = globeScene.hoveredGraphNode || relatedPanelNode || (graphUi.selectedGraphSection ? globeScene.byId.get(graphUi.selectedGraphSection.id) || null : null);
    const fromRelatedPanel = !!relatedPanelNode && !globeScene.hoveredGraphNode;
    globeScene.scene.classList.toggle("has-emphasis", !!focus);
    const nextNodes = new Set<GraphNode>(), nextEdges = new Set<GraphEdge>();
    if (focus) {
      nextNodes.add(focus);
      for (const edge of globeScene.edgesByNode.get(focus) || []) { nextEdges.add(edge); nextNodes.add(edge.a === focus ? edge.b : edge.a); }
    }
    // Diff only the old/new focus neighborhood. The former implementation walked
    // every vertex and edge on each pointer-enter/leave, making large graphs stutter.
    for (const node of globeScene.emphasizedNodes) node.el?.classList.remove("focused", "related", "panel-hover");
    for (const edge of globeScene.emphasizedEdges) edge.el?.classList.remove("related-edge", "panel-hover-edge");
    if (focus) {
      focus.el?.classList.add("focused");
      if (fromRelatedPanel) focus.el?.classList.add("panel-hover");
      for (const node of nextNodes) if (node !== focus) node.el?.classList.add("related");
      for (const edge of nextEdges) { edge.el?.classList.add("related-edge"); if (fromRelatedPanel) edge.el?.classList.add("panel-hover-edge"); }
    }
    globeScene.emphasizedNodes = nextNodes; globeScene.emphasizedEdges = nextEdges;
  };
  globeScene.relatedTooltipNode = null;
  globeScene.dragEdgeUpdateFrame = 0;
  globeScene.scheduleDragEdgeUpdate = () => {
    if (globeScene.dragEdgeUpdateFrame) return;
    globeScene.dragEdgeUpdateFrame = requestAnimationFrame(() => { globeScene.dragEdgeUpdateFrame = 0; if (globeScene.renderToken === graphUi.graphRenderToken) globeScene.updateEdges(); });
  };
  globeScene.restoreRelatedTooltip = (node: GraphNode) => {
    if (!node.el) return;
    node.el.dataset.tooltip = globeScene.nodeTitle(node);
    delete node.el.dataset.tooltipKind;
  };
  globeScene.lodVisibleNodes = [];
  globeScene.lodVisibleEdges = [];
  globeScene.nodeTitleForAria = (n: GraphNode) => globeScene.nodeTitle(n);
}

/** SVG element creation for nodes and edges, LOD visibility, edge updates, globe projection and position persistence. */
function defineGlobeElementRendering(globeScene: GlobeScene): void {
  globeScene.ensureNodeElement = function (n: GraphNode): SVGGElement {
    if (n.el) return n.el;
    const index = globeScene.nodeIndex.get(n) ?? 0;
    const classes = ["brain-node", graphUi.selectedGraphSection?.id === n.s.id ? "selected" : ""].filter(Boolean).join(" ");
    const g = globeScene.add("g", { class: classes, tabindex: "0", role: "button", "aria-label": globeScene.nodeTitleForAria(n), "data-section-id": n.s.id }, globeScene.nodeLayer) as SVGGElement;
    g.setAttribute("transform", `translate(${n.x} ${n.y})`); g.style.setProperty("--brain-node-color", n.color); g.style.animationDelay = `${Math.min(index, 36) * 5}ms`;
    g.setAttribute("data-tooltip", globeScene.nodeTitle(n));
    if (graphUi.graphGlobeMode) globeScene.add("circle", { cx: "0", cy: "0", r: "6.5", class: "brain-node-hit" }, g);
    globeScene.add("circle", { cx: "0", cy: "0", r: String(n.radius + 3), class: "brain-node-halo" }, g);
    globeScene.add("circle", { cx: "0", cy: "0", r: String(n.radius), class: "brain-node-dot" }, g);
    const label = globeScene.add("text", { x: String(n.radius + 7), y: "4", "text-anchor": "start", class: "brain-node-label" }, g); label.textContent = n.s.title;
    g.addEventListener("click", () => { if (!n.suppressClick) selectGraphSection(n.s); n.suppressClick = false; });
    g.addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") { e.preventDefault(); selectGraphSection(n.s); } });
    g.addEventListener("pointerenter", () => { globeScene.hoveredGraphNode = n; globeScene.applyGraphEmphasis(); });
    g.addEventListener("pointerleave", () => { if (globeScene.hoveredGraphNode === n) { globeScene.hoveredGraphNode = null; globeScene.applyGraphEmphasis(); } });
    g.addEventListener("pointerdown", e => {
      if ((e as PointerEvent).button !== 0) return; if (graphUi.graphGlobeMode) { e.stopPropagation(); return; } e.stopPropagation(); const ev = e as PointerEvent;
      const startX = ev.clientX, startY = ev.clientY, origX = n.x, origY = n.y; let moved = false; n.dragging = true; g.classList.add("dragging");
      try { g.setPointerCapture(ev.pointerId); } catch { }
      const dragCellSize = 64, dragBuckets = globeScene.nodes.length > 800 ? new Map<string, GraphNode[]>() : null;
      if (dragBuckets) for (const other of globeScene.nodes) { if (other === n) continue; const key = `${Math.floor(other.x / dragCellSize)},${Math.floor(other.y / dragCellSize)}`; let bucket = dragBuckets.get(key); if (!bucket) { bucket = []; dragBuckets.set(key, bucket); } bucket.push(other); }
      const collidesAt = (x: number, y: number) => {
        if (!dragBuckets) return globeScene.nodes.some(other => other !== n && Math.hypot(x - other.x, y - other.y) < n.radius + other.radius + 5);
        const cx = Math.floor(x / dragCellSize), cy = Math.floor(y / dragCellSize);
        for (let gx = cx - 1; gx <= cx + 1; gx++)for (let gy = cy - 1; gy <= cy + 1; gy++)for (const other of dragBuckets.get(`${gx},${gy}`) || []) { if (Math.hypot(x - other.x, y - other.y) < n.radius + other.radius + 5) return true; }
        return false;
      };
      const move = (pe: PointerEvent) => { const dx = (pe.clientX - startX) / Math.max(.025, graphUi.graphZoom), dy = (pe.clientY - startY) / Math.max(.025, graphUi.graphZoom); if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; const candidateX = origX + dx, candidateY = origY + dy; if (!collidesAt(candidateX, candidateY)) { n.x = candidateX; n.y = candidateY; n.vx = 0; n.vy = 0; g.setAttribute("transform", `translate(${n.x} ${n.y})`); globeScene.scheduleDragEdgeUpdate(); globeScene.scheduleLabelScaleUpdate(); } };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); g.classList.remove("dragging"); n.dragging = false; n.suppressClick = moved; if (moved) globeScene.savePositions(); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); window.addEventListener("pointercancel", up, { once: true });
    });
    n.el = g; globeScene.nodeEls.set(n.s.id, g); return g;
  };
  globeScene.ensureEdgeElement = function (edge: GraphEdge): SVGLineElement {
    if (edge.el) return edge.el;
    const el = document.createElementNS(globeScene.ns, "line");
    el.setAttribute("x1", "0"); el.setAttribute("y1", "0"); el.setAttribute("x2", "0"); el.setAttribute("y2", "0");
    el.setAttribute("class", `brain-edge ${edge.kind}-edge`); el.setAttribute("data-edge-kind", edge.kind); el.setAttribute("aria-hidden", "true");
    el.style.setProperty("--brain-edge-color", globeScene.blendNodeColors(edge.a.color, edge.b.color)); edge.el = el; return el;
  };
  globeScene.isGraphNodeInLod = (node: GraphNode) => !globeScene.lodTierSet || globeScene.lodTierSet.has(node) || node.s.id === graphUi.selectedGraphSection?.id || node.s.id === graphUi.hoveredRelatedSectionId;
  globeScene.syncGlobeLodVisibility = function () {
    globeScene.lodVisibleNodes.length = 0; globeScene.lodVisibleEdges.length = 0;
    for (const node of globeScene.nodes) {
      if (globeScene.isGraphNodeInLod(node)) {
        const el = globeScene.ensureNodeElement(node); if (el.parentNode !== globeScene.nodeLayer) globeScene.nodeLayer.append(el);
        if (graphUi.graphGlobeMode) globeScene.projectNodeGlobe(node);
        globeScene.lodVisibleNodes.push(node);
      } else if (node.el?.parentNode) node.el.remove();
    }
    for (const edge of globeScene.edgeList) {
      if (globeScene.isGraphNodeInLod(edge.a) && globeScene.isGraphNodeInLod(edge.b)) {
        const el = globeScene.ensureEdgeElement(edge); if (el.parentNode !== globeScene.edgeLayer) globeScene.edgeLayer.append(el); globeScene.lodVisibleEdges.push(edge);
      } else if (edge.el?.parentNode) edge.el.remove();
    }
    if (graphUi.graphGlobeMode) { for (const node of [...globeScene.lodVisibleNodes].sort((a, b) => a.depth - b.depth)) if (node.el) globeScene.nodeLayer.append(node.el); }
    globeScene.drawPositions();
  };
  globeScene.updateGlobeLod = function () {
    const nextBudget = getGraphLodBudget({ total: globeScene.nodes.length, zoom: graphUi.graphZoom, baseZoom: globeScene.lodZoomBase, fullDetailZoomFactor: globeScene.lodFullZoomFactor, threshold: GRAPH_LOD_THRESHOLD });
    if (nextBudget === globeScene.lodBudget) return;
    globeScene.lodBudget = nextBudget; globeScene.lodTierSet = globeScene.lodEnabled && globeScene.lodBudget < globeScene.nodes.length ? new Set(globeScene.lodOrder.slice(0, globeScene.lodBudget)) : null;
    const nextStatus = globeScene.lodBudget < globeScene.nodes.length ? `${globeScene.baseGlobeStatusText} · ${langText("uproszczony podgląd", "overview detail")} ≈${globeScene.lodBudget.toLocaleString()} / ${globeScene.nodes.length.toLocaleString()}` : globeScene.baseGlobeStatusText;
    if (nextStatus !== globeScene.lodStatusText) { globeScene.status.textContent = nextStatus; globeScene.lodStatusText = nextStatus; }
    globeScene.syncGlobeLodVisibility(); globeScene.applyGraphEmphasis();
  };
  graphUi.graphEmphasisHandler = (sectionId) => {
    graphUi.hoveredRelatedSectionId = sectionId; globeScene.syncGlobeLodVisibility(); globeScene.applyGraphEmphasis();
    const hovered = sectionId ? globeScene.byId.get(sectionId) : undefined;
    if (globeScene.relatedTooltipNode && globeScene.relatedTooltipNode !== hovered) globeScene.restoreRelatedTooltip(globeScene.relatedTooltipNode);
    if (hovered?.el) { globeScene.relatedTooltipNode = hovered; const excerpt = graphSectionTooltipExcerpt(hovered.s, 100); hovered.el.dataset.tooltip = excerpt ? `${globeScene.nodeTitle(hovered)} — ${excerpt}` : globeScene.nodeTitle(hovered); if (excerpt) hovered.el.dataset.tooltipKind = "section-preview"; else delete hovered.el.dataset.tooltipKind; showAppTooltip(hovered.el as unknown as HTMLElement, 0, "right"); }
    else { if (globeScene.relatedTooltipNode) globeScene.restoreRelatedTooltip(globeScene.relatedTooltipNode); globeScene.relatedTooltipNode = null; hideAppTooltip(); }
  };
  globeScene.updateEdges = function () {
    for (const e of globeScene.lodVisibleEdges) {
      if (!e.el) continue;
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dist = Math.max(0.001, Math.hypot(dx, dy)), ux = dx / dist, uy = dy / dist;
      e.el.setAttribute("x1", String(e.a.x + ux * e.a.radius)); e.el.setAttribute("y1", String(e.a.y + uy * e.a.radius));
      e.el.setAttribute("x2", String(e.b.x - ux * e.b.radius)); e.el.setAttribute("y2", String(e.b.y - uy * e.b.radius));
      if (graphUi.graphGlobeMode) { const nextOpacity = .18 + ((Math.max(e.a.depth, e.b.depth) + 1) / 2) * .42; const previousOpacity = Number(e.el.style.getPropertyValue("--globe-edge-opacity")); if (!Number.isFinite(previousOpacity) || Math.abs(nextOpacity - previousOpacity) > .035) e.el.style.setProperty("--globe-edge-opacity", String(nextOpacity)); }
      else if (e.el.style.getPropertyValue("--globe-edge-opacity")) e.el.style.removeProperty("--globe-edge-opacity");
    }
  };
  globeScene.projectNodeGlobe = function (n: GraphNode) {
    const cy = Math.cos(graphUi.graphGlobeRotationY), sy = Math.sin(graphUi.graphGlobeRotationY), cx = Math.cos(graphUi.graphGlobeRotationX), sx = Math.sin(graphUi.graphGlobeRotationX);
    const x = n.gx * cy + n.gz * sy, z = -n.gx * sy + n.gz * cy, y = n.gy * cx - z * sx, depth = n.gy * sx + z * cx; n.x = x * globeScene.sphereRadius; n.y = y * globeScene.sphereRadius; n.depth = depth;
  };
  globeScene.projectGlobe = function () { for (const n of globeScene.lodVisibleNodes) globeScene.projectNodeGlobe(n); };
  globeScene.savePositions = function () {
    if (graphUi.graphGlobeMode) return;
    const all: Record<string, { x: number; y: number }> = {}; for (const n of globeScene.nodes) all[n.key] = { x: n.x, y: n.y };
    try { localStorage.setItem(globeScene.positionsKey, JSON.stringify({ ...globeScene.saved, ...all })); globeScene.saved = { ...globeScene.saved, ...all }; } catch { }
  };
}

/** Label scaling, view transform, fit, selection hook and the interaction redraw. */
function defineGlobeViewOperations(globeScene: GlobeScene): void {
  globeScene.updateLabelScale = function () {
    const scaleThreshold = globeScene.nodes.length <= 28 ? 0.48 : globeScene.nodes.length <= 100 ? 0.72 : globeScene.nodes.length <= 200 ? 1.0 : 1.25;
    const scaleAllowsLabels = graphUi.graphZoom >= scaleThreshold;
    globeScene.scene.classList.toggle("labels-hidden", !graphUi.graphShowLabels); globeScene.scene.classList.toggle("labels-enabled", graphUi.graphShowLabels);
    globeScene.scene.classList.toggle("labels-visible", graphUi.graphShowLabels && scaleAllowsLabels);
    if (!graphUi.graphShowLabels || !scaleAllowsLabels) return;
    // Only layout labels intersecting the viewport. Nodes remain rendered and interactive
    // regardless of whether their optional text label is currently visible.
    const candidates = globeScene.lodVisibleNodes.map((n, index) => ({
      n, index, important: !!n.el?.matches(":hover,:focus-visible,.current,.selected"), degree: globeScene.degree.get(n) || 0,
      left: graphUi.graphPanX + (n.x + n.radius + 7) * graphUi.graphZoom, top: graphUi.graphPanY + n.y * graphUi.graphZoom - 8 * graphUi.graphZoom,
      width: Math.min(Math.max(12, n.s.title.length * 6.5), 240) * graphUi.graphZoom, height: 16 * graphUi.graphZoom
    }))
      .filter(candidate => candidate.left + candidate.width > 0 && candidate.left < globeScene.viewportWidth && candidate.top + candidate.height > 0 && candidate.top < globeScene.viewportHeight);
    candidates.sort((a, b) => Number(b.important) - Number(a.important) || b.degree - a.degree || a.index - b.index);
    type LabelBox = { left: number; top: number; right: number; bottom: number };
    const labelBuckets = new Map<string, LabelBox[]>(); const labelCellSize = 128;
    const bucketRange = (box: LabelBox) => ({ left: Math.floor(box.left / labelCellSize), right: Math.floor(box.right / labelCellSize), top: Math.floor(box.top / labelCellSize), bottom: Math.floor(box.bottom / labelCellSize) });
    const hasLabelCollision = (box: LabelBox) => {
      const range = bucketRange(box);
      for (let x = range.left; x <= range.right; x++)for (let y = range.top; y <= range.bottom; y++)for (const other of labelBuckets.get(`${x},${y}`) || []) {
        if (box.left < other.right + 9 && box.right + 9 > other.left && box.top < other.bottom + 5 && box.bottom + 5 > other.top) return true;
      }
      return false;
    };
    const storeLabelBox = (box: LabelBox) => { const range = bucketRange(box); for (let x = range.left; x <= range.right; x++)for (let y = range.top; y <= range.bottom; y++) { const key = `${x},${y}`, items = labelBuckets.get(key) || []; items.push(box); labelBuckets.set(key, items); } };
    for (const candidate of candidates) {
      const { n } = candidate; const box = { left: candidate.left, top: candidate.top, right: candidate.left + candidate.width, bottom: candidate.top + candidate.height };
      const collides = hasLabelCollision(box);
      const suppress = !candidate.important && collides;
      n.el?.classList.toggle("label-suppressed", suppress);
      if (!suppress) storeLabelBox(box);
    }
  };
  globeScene.scheduleLabelScaleUpdate = () => {
    if (globeScene.labelLayoutTimer !== undefined) return;
    globeScene.labelLayoutTimer = window.setTimeout(() => { globeScene.labelLayoutTimer = undefined; if (globeScene.renderToken === graphUi.graphRenderToken) globeScene.updateLabelScale(); }, 95);
  };
  (globeScene.svg as SVGSVGElement & { __typenovaUpdateLabels?: () => void }).__typenovaUpdateLabels = globeScene.updateLabelScale;
  globeScene.applyView = function () { globeScene.scene.setAttribute("transform", `translate(${graphUi.graphPanX} ${graphUi.graphPanY}) scale(${graphUi.graphZoom})`); globeScene.updateGlobeLod(); globeScene.scheduleLabelScaleUpdate(); };
  globeScene.fit = function () {
    if (!globeScene.nodes.length) return; if (graphUi.graphGlobeMode) { graphUi.graphZoom = Math.max(.06, Math.min(2.2, (Math.min(globeScene.viewportWidth, globeScene.viewportHeight) - 72) / (globeScene.sphereRadius * 2))); globeScene.lodZoomBase = graphUi.graphZoom; graphUi.graphPanX = globeScene.viewportWidth / 2; graphUi.graphPanY = globeScene.viewportHeight / 2; globeScene.updateGlobeLod(); globeScene.applyView(); return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of globeScene.nodes) { minX = Math.min(minX, node.x - node.radius - 3); maxX = Math.max(maxX, node.x + node.radius + 3); minY = Math.min(minY, node.y - node.radius - 3); maxY = Math.max(maxY, node.y + node.radius + 3); }
    const contentW = Math.max(1, maxX - minX), contentH = Math.max(1, maxY - minY), pad = 64;
    graphUi.graphZoom = Math.max(.045, Math.min(2.2, (globeScene.viewportWidth - pad * 2) / contentW, (globeScene.viewportHeight - pad * 2) / contentH));
    graphUi.graphPanX = (globeScene.viewportWidth - contentW * graphUi.graphZoom) / 2 - minX * graphUi.graphZoom; graphUi.graphPanY = (globeScene.viewportHeight - contentH * graphUi.graphZoom) / 2 - minY * graphUi.graphZoom; globeScene.applyView();
  };
  (globeScene.svg as SVGSVGElement & { __typenovaSelectSection?: (sectionId: string, fitToViewport: boolean) => void }).__typenovaSelectSection = (sectionId, fitToViewport) => {
    const previous = globeScene.scene.querySelector<SVGGElement>(".brain-node.selected");
    if (previous && previous.dataset.sectionId !== sectionId) previous.classList.remove("selected");
    globeScene.syncGlobeLodVisibility();
    globeScene.nodeEls.get(sectionId)?.classList.add("selected");
    globeScene.hoveredGraphNode = null; hideAppTooltip(); globeScene.applyGraphEmphasis();
    const nextWidth = Math.max(320, globeScene.graph.clientWidth || window.innerWidth - 32);
    const nextHeight = Math.max(260, globeScene.graph.clientHeight || window.innerHeight - 170);
    if (nextWidth !== globeScene.viewportWidth || nextHeight !== globeScene.viewportHeight) {
      globeScene.viewportWidth = nextWidth; globeScene.viewportHeight = nextHeight; globeScene.sphereRadius = Math.max(105, Math.min(globeScene.viewportWidth, globeScene.viewportHeight) * .34);
      globeScene.svg.setAttribute("viewBox", `0 0 ${globeScene.viewportWidth} ${globeScene.viewportHeight}`); globeScene.svg.setAttribute("width", String(globeScene.viewportWidth)); globeScene.svg.setAttribute("height", String(globeScene.viewportHeight));
      if (graphUi.graphGlobeMode) globeScene.projectGlobe(); globeScene.drawPositions();
    }
    if (fitToViewport) { globeScene.fit(); graphUi.graphAutoFitNextRender = false; } else globeScene.applyView();
    graphUi.graphAnimateNextRender = false;
  };
  globeScene.panStart = null;
  globeScene.globeInteractionFrame = 0;
  globeScene.lastGlobeInteractionDraw = 0;
  globeScene.drawGlobeInteraction = (time: number) => {
    if (globeScene.renderToken !== graphUi.graphRenderToken) { globeScene.globeInteractionFrame = 0; return; }
    if (time - globeScene.lastGlobeInteractionDraw < 33) { globeScene.globeInteractionFrame = requestAnimationFrame(globeScene.drawGlobeInteraction); return; }
    globeScene.globeInteractionFrame = 0; globeScene.lastGlobeInteractionDraw = time; globeScene.projectGlobe(); globeScene.drawPositions();
  };
}

/** Pointer and wheel handling, first projection and emphasis. */
function bindGlobeEvents(globeScene: GlobeScene): void {
  globeScene.svg.addEventListener("pointerdown", e => { const target = e.target as Element; if (target.closest?.(".brain-node")) return; const pe = e as PointerEvent; if (pe.button !== 0) return; globeScene.panStart = { x: pe.clientX, y: pe.clientY, px: graphUi.graphGlobeMode ? graphUi.graphGlobeRotationY : graphUi.graphPanX, py: graphUi.graphGlobeMode ? graphUi.graphGlobeRotationX : graphUi.graphPanY, pointerId: pe.pointerId, moved: false, canDeselect: target === globeScene.svg || target === globeScene.scene }; try { globeScene.svg.setPointerCapture(pe.pointerId); } catch { } });
  globeScene.svg.addEventListener("pointermove", e => {
    if (!globeScene.panStart || (e as PointerEvent).pointerId !== globeScene.panStart.pointerId) return;
    const pe = e as PointerEvent, dx = pe.clientX - globeScene.panStart.x, dy = pe.clientY - globeScene.panStart.y;
    if (!globeScene.panStart.moved && Math.hypot(dx, dy) < 4) return; globeScene.panStart.moved = true;
    if (graphUi.graphGlobeMode) {
      graphUi.graphGlobeRotationY = globeScene.panStart.px + dx * .008; graphUi.graphGlobeRotationX = Math.max(-1.5, Math.min(1.5, globeScene.panStart.py + dy * .008));
      if (!globeScene.globeInteractionFrame) globeScene.globeInteractionFrame = requestAnimationFrame(globeScene.drawGlobeInteraction);
    } else { graphUi.graphPanX = globeScene.panStart.px + dx; graphUi.graphPanY = globeScene.panStart.py + dy; globeScene.applyView(); }
  });
  globeScene.endPan = (event: Event) => { const pe = event as PointerEvent; const start = globeScene.panStart; if (!start || pe.pointerId !== start.pointerId) return; if (event.type === "pointerup" && !start.moved && start.canDeselect && graphUi.selectedGraphSection) closeGraphPreview(true); if (event.type === "pointerup" && start.moved && graphUi.graphGlobeMode) { try { localStorage.setItem("typenova.brain.globeRotationX", String(graphUi.graphGlobeRotationX)); localStorage.setItem("typenova.brain.globeRotationY", String(graphUi.graphGlobeRotationY)); } catch { } } globeScene.panStart = null; };
  globeScene.svg.addEventListener("pointerup", globeScene.endPan);
  globeScene.svg.addEventListener("pointercancel", globeScene.endPan);
  globeScene.svg.addEventListener("wheel", e => { e.preventDefault(); const old = graphUi.graphZoom, factor = (e as WheelEvent).deltaY < 0 ? 1.12 : 1 / 1.12, rect = globeScene.svg.getBoundingClientRect(); const mx = (e as WheelEvent).clientX - rect.left, my = (e as WheelEvent).clientY - rect.top; graphUi.graphZoom = Math.max(.025, Math.min(2.8, graphUi.graphZoom * factor)); graphUi.graphPanX = mx - (mx - graphUi.graphPanX) * graphUi.graphZoom / old; graphUi.graphPanY = my - (my - graphUi.graphPanY) * graphUi.graphZoom / old; globeScene.applyView(); }, { passive: false });
  globeScene.graph.replaceChildren(globeScene.svg);
  globeScene.syncGlobeLodVisibility();
  if (graphUi.graphGlobeMode) { globeScene.projectGlobe(); for (const node of [...globeScene.lodVisibleNodes].sort((a, b) => a.depth - b.depth)) if (node.el) globeScene.nodeLayer.append(node.el); globeScene.drawPositions(); }
  globeScene.applyGraphEmphasis();
}

/** Force-layout tick and the position redraw. */
function setupGlobeLayout(globeScene: GlobeScene): void {
  globeScene.forceX = new Float64Array(globeScene.nodes.length);
  globeScene.forceY = new Float64Array(globeScene.nodes.length);
  globeScene.cellX = new Int32Array(globeScene.nodes.length);
  globeScene.cellY = new Int32Array(globeScene.nodes.length);
  globeScene.spatialBuckets = new Map<string, number[]>();
  globeScene.reusableSpatialBuckets = [];
  globeScene.tick = (time = 0, floating = false, elapsedMs = 32) => {
    if (graphUi.graphGlobeMode) { if (floating && graphUi.graphMotion) { graphUi.graphGlobeRotationY += Math.min(48, Math.max(0, elapsedMs)) * .00019; globeScene.projectGlobe(); } return; }
    globeScene.forceX.fill(0); globeScene.forceY.fill(0); const fx = globeScene.forceX, fy = globeScene.forceY;
    const repelPair = (i: number, j: number) => {
      const a = globeScene.nodes[i], b = globeScene.nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
      if (d2 < 1) { const angle = ((i * 31 + j * 17) % 360) * Math.PI / 180; dx = Math.cos(angle); dy = Math.sin(angle); d2 = 1; }
      const distance = Math.sqrt(d2), ux = dx / distance, uy = dy / distance;
      const repulsion = Math.min(1.6, 1500 / d2); fx[i] -= ux * repulsion; fy[i] -= uy * repulsion; fx[j] += ux * repulsion; fy[j] += uy * repulsion;
      const minDistance = a.radius + b.radius + 18;
      if (distance < minDistance) { const push = (minDistance - distance) * 0.075; fx[i] -= ux * push; fy[i] -= uy * push; fx[j] += ux * push; fy[j] += uy * push; }
    };
    if (globeScene.nodes.length <= 400) {
      for (let i = 0; i < globeScene.nodes.length; i++)for (let j = i + 1; j < globeScene.nodes.length; j++)repelPair(i, j);
    } else {
      // A spatial hash bounds the per-tick repulsion work for large projects while retaining every node.
      // Long-range interactions are negligible compared with local repulsion and the explicit edge springs.
      const cellSize = 180, cutoff = 230, cutoffSquared = cutoff * cutoff;
      for (const bucket of globeScene.spatialBuckets.values()) { bucket.length = 0; globeScene.reusableSpatialBuckets.push(bucket); }
      globeScene.spatialBuckets.clear();
      for (let i = 0; i < globeScene.nodes.length; i++) {
        const x = Math.floor(globeScene.nodes[i].x / cellSize), y = Math.floor(globeScene.nodes[i].y / cellSize); globeScene.cellX[i] = x; globeScene.cellY[i] = y;
        const key = `${x},${y}`; let bucket = globeScene.spatialBuckets.get(key);
        if (!bucket) { bucket = globeScene.reusableSpatialBuckets.pop() || []; globeScene.spatialBuckets.set(key, bucket); }
        bucket.push(i);
      }
      for (let i = 0; i < globeScene.nodes.length; i++) {
        for (let x = globeScene.cellX[i] - 2; x <= globeScene.cellX[i] + 2; x++)for (let y = globeScene.cellY[i] - 2; y <= globeScene.cellY[i] + 2; y++) {
          for (const j of globeScene.spatialBuckets.get(`${x},${y}`) || []) { if (j <= i) continue; const dx = globeScene.nodes[j].x - globeScene.nodes[i].x, dy = globeScene.nodes[j].y - globeScene.nodes[i].y; if (dx * dx + dy * dy <= cutoffSquared) repelPair(i, j); }
        }
      }
    }
    for (const e of globeScene.edgeList) { const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dist = Math.max(0.001, Math.hypot(dx, dy)); const desired = e.kind === "tree" ? 82 : e.kind === "section" ? 100 : 142; const strength = e.kind === "tree" ? 0.013 : e.kind === "section" ? 0.011 : 0.008; const pull = (dist - desired) * strength; const px = dx / dist * pull, py = dy / dist * pull; const ai = globeScene.nodeIndex.get(e.a), bi = globeScene.nodeIndex.get(e.b); if (ai !== undefined) { fx[ai] += px; fy[ai] += py; } if (bi !== undefined) { fx[bi] -= px; fy[bi] -= py; } }
    for (let i = 0; i < globeScene.nodes.length; i++) {
      const n = globeScene.nodes[i]; if (n.dragging) continue;
      if (floating) { fx[i] += Math.sin(time * .00091 + i * 1.731) * .085; fy[i] += Math.cos(time * .00073 + i * 2.417) * .085; }
      n.vx = (n.vx + fx[i] - n.x * 0.001) * 0.82; n.vy = (n.vy + fy[i] - n.y * 0.001) * 0.82; n.x += n.vx; n.y += n.vy;
    }
  };
  globeScene.drawPositions = function () {
    const globe = graphUi.graphGlobeMode;
    for (const n of globeScene.lodVisibleNodes) {
      const depthProgress = Math.max(0, Math.min(1, (n.depth + 1) / 2));
      const transform = globe ? `translate(${n.x} ${n.y}) scale(${.62 + depthProgress * .58})` : `translate(${n.x} ${n.y})`;
      if (n.el && n.el.getAttribute("transform") !== transform) n.el.setAttribute("transform", transform);
      if (n.el && globe) {
        const opacity = String(.2 + depthProgress * .8);
        if (n.el.style.opacity !== opacity) n.el.style.opacity = opacity;
        const back = n.depth < -.2; if (n.el.classList.contains("globe-back") !== back) n.el.classList.toggle("globe-back", back);
      }
    }
    globeScene.updateEdges(); globeScene.scheduleLabelScaleUpdate();
  };
}

/** Zoom/fit buttons, ambient motion and the initial fit or layout. */
function startGlobeRender(globeScene: GlobeScene): void {
  globeScene.zoom = (factor: number) => { const old = graphUi.graphZoom; graphUi.graphZoom = Math.max(.025, Math.min(2.8, graphUi.graphZoom * factor)); graphUi.graphPanX = globeScene.viewportWidth / 2 - (globeScene.viewportWidth / 2 - graphUi.graphPanX) * graphUi.graphZoom / old; graphUi.graphPanY = globeScene.viewportHeight / 2 - (globeScene.viewportHeight / 2 - graphUi.graphPanY) * graphUi.graphZoom / old; globeScene.applyView(); };
  $("brainZoomIn").onclick = () => globeScene.zoom(1.18);
  $("brainZoomOut").onclick = () => globeScene.zoom(1 / 1.18);
  $("brainFit").onclick = globeScene.fit;
  globeScene.scene.style.transition = graphUi.graphMotion ? "transform 150ms cubic-bezier(.2,.7,.2,1)" : "none";
  globeScene.updateEdges();
  globeScene.startAmbientMotion = () => {
    if (!graphUi.graphMotion || globeScene.renderToken !== graphUi.graphRenderToken || graphUi.graphAmbientMotionStop || graphUi.stopGraphLayout) return;
    let frame = 0, cancelled = false, lastDraw = 0, lastMotionTime = 0;
    const stop = () => { cancelled = true; if (frame) cancelAnimationFrame(frame); frame = 0; if (graphUi.graphAmbientMotionStop === stop) graphUi.graphAmbientMotionStop = null; globeScene.savePositions(); if (graphUi.graphGlobeMode) { try { localStorage.setItem("typenova.brain.globeRotationX", String(graphUi.graphGlobeRotationX)); localStorage.setItem("typenova.brain.globeRotationY", String(graphUi.graphGlobeRotationY)); } catch { } } globeScene.drawPositions(); };
    graphUi.graphAmbientMotionStop = stop; graphUi.graphAmbientMotionStart = globeScene.startAmbientMotion;
    const animate = (time: number) => {
      if (cancelled || globeScene.renderToken !== graphUi.graphRenderToken || !graphUi.graphMotion) { stop(); return; }
      const frameInterval = graphUi.graphGlobeMode ? 33 : 40;
      if (time - lastDraw >= frameInterval) { const elapsed = lastMotionTime ? Math.min(48, Math.max(0, time - lastMotionTime)) : frameInterval; globeScene.tick(time, true, elapsed); globeScene.drawPositions(); lastDraw = time; lastMotionTime = time; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
  };
  graphUi.graphAmbientMotionStart = globeScene.startAmbientMotion;
  globeScene.enableAmbientAfterLayout = () => { if (graphUi.graphMotion) globeScene.startAmbientMotion(); };
  if (globeScene.needsLayout) {
    graphUi.graphPanX = globeScene.viewportWidth / 2; graphUi.graphPanY = globeScene.viewportHeight / 2; graphUi.graphZoom = 1; globeScene.applyView();
    let finished = false;
    const maxIterations = globeScene.visible.length > 2200 ? 36 : globeScene.visible.length > 1200 ? 52 : globeScene.visible.length > 600 ? 72 : 108;
    const finalizeLayout = () => { if (finished) return; finished = true; graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; globeScene.drawPositions(); globeScene.savePositions(); if (graphUi.graphAutoFitNextRender) { globeScene.fit(); graphUi.graphAutoFitNextRender = false; } else globeScene.applyView(); graphUi.graphAnimateNextRender = false; globeScene.enableAmbientAfterLayout(); };
    const applyWorkerPositions = (positions: Float32Array) => { for (let i = 0; i < globeScene.nodes.length; i++) { globeScene.nodes[i].x = positions[i * 2]; globeScene.nodes[i].y = positions[i * 2 + 1]; } };
    const runFallbackLayout = () => { let iterations = 0; const ticksPerFrame = globeScene.visible.length > 1800 ? 1 : globeScene.visible.length > 700 ? 2 : 3; const drawEveryFrames = globeScene.visible.length > 1200 ? 3 : globeScene.visible.length > 600 ? 2 : 1; let layoutFrameCount = 0; const animateLayout = () => { if (finished || globeScene.renderToken !== graphUi.graphRenderToken) return; for (let j = 0; j < ticksPerFrame && iterations < maxIterations; j++) { globeScene.tick(); iterations++; } layoutFrameCount++; if (layoutFrameCount % drawEveryFrames === 0 || iterations >= maxIterations) globeScene.drawPositions(); if (iterations < maxIterations) { graphUi.graphAnimationFrame = requestAnimationFrame(animateLayout); return; } finalizeLayout(); }; graphUi.stopGraphLayout = () => { if (finished) return; finished = true; if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; }; graphUi.graphAnimationFrame = requestAnimationFrame(animateLayout); };
    const cancelWorker = startForceLayoutWorker(
      globeScene.nodes.map(node => ({ x: node.x, y: node.y, radius: node.radius })),
      globeScene.edgeList.map(edge => ({ a: globeScene.nodeIndex.get(edge.a) ?? -1, b: globeScene.nodeIndex.get(edge.b) ?? -1, kind: edge.kind })),
      maxIterations,
      {
        onFrame: result => { if (finished || globeScene.renderToken !== graphUi.graphRenderToken) return; applyWorkerPositions(result.positions); if (result.iteration % 4 === 0) globeScene.drawPositions(); },
        onDone: result => { if (finished || globeScene.renderToken !== graphUi.graphRenderToken) return; applyWorkerPositions(result.positions); finalizeLayout(); },
        onError: () => { if (!finished && globeScene.renderToken === graphUi.graphRenderToken) runFallbackLayout(); }
      }
    );
    graphUi.stopGraphLayout = () => { if (finished) return; finished = true; cancelWorker(); if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; graphUi.stopGraphLayout = null; };
  } else {
    globeScene.drawPositions(); if (graphUi.graphAutoFitNextRender) { globeScene.fit(); graphUi.graphAutoFitNextRender = false; } else globeScene.applyView(); graphUi.graphAnimateNextRender = false; globeScene.enableAmbientAfterLayout();
  }
}

export function renderGlobe() {
  const globeScene = {} as GlobeScene;
  graphUi.graphFlatMinimapReady = false;
  ($("brainGraphMinimap") as HTMLElement).hidden = true;
  if (graphUi.graphCanvasCleanup) { const cleanup = graphUi.graphCanvasCleanup; graphUi.graphCanvasCleanup = null; cleanup(); }
  if (graphUi.graphCanvasThemeObserver) { graphUi.graphCanvasThemeObserver.disconnect(); graphUi.graphCanvasThemeObserver = null; }
  graphUi.graphEmphasisHandler = null;
  if (graphUi.graphAmbientMotionStop) { graphUi.graphAmbientMotionStop(); graphUi.graphAmbientMotionStop = null; }
  graphUi.graphAmbientMotionStart = null;
  globeScene.graph = $("brainGraph") as HTMLElement;
  globeScene.filter = (($("brainFilter") as HTMLInputElement).value || "").trim().toLocaleLowerCase();
  globeScene.visible = graphUi.graphSections.filter(s => (graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(s.path)) && (!globeScene.filter || s.title.toLocaleLowerCase().includes(globeScene.filter) || s.file.toLocaleLowerCase().includes(globeScene.filter) || s.path.toLocaleLowerCase().includes(globeScene.filter)));
  globeScene.total = globeScene.visible.length;
  globeScene.status = $("brainStatus") as HTMLElement;
  if (graphUi.graphSections.length) globeScene.status.textContent = langText(`${graphUi.graphSections.length} sekcji · widoczne: ${globeScene.total}`, `${graphUi.graphSections.length} sections · visible: ${globeScene.total}`);
  if (!globeScene.visible.length) {
    graphUi.hoveredRelatedSectionId = null;
    if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame); graphUi.graphAnimationFrame = 0; graphUi.graphRenderToken++; graphUi.stopGraphLayout = null;
    const noneSelected = graphUi.graphSelectedFiles !== null && graphUi.graphSelectedFiles.size === 0;
    if (noneSelected) {
      globeScene.graph.innerHTML = `<div class="brain-empty brain-empty-no-selection"><span class="brain-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg></span><strong>${langText("Wszystkie dokumenty są ukryte", "All documents are hidden")}</strong><span>${langText("Włącz dokument lub katalog w panelu Filtry, aby ponownie wyświetlić graf.", "Enable a document or folder in the Filters panel to show the graph again.")}</span></div>`;
      globeScene.graph.querySelector<HTMLElement>(".brain-empty-no-selection")?.setAttribute("role", "status");
    } else {
      globeScene.graph.innerHTML = `<div class="brain-empty"><span class="brain-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></svg></span><strong>${langText("Nie znaleziono sekcji", "No sections found")}</strong><span>${langText("Zmień filtr lub wybór plików, albo otwórz projekt zawierający nagłówki Markdown.", "Change the filter or file selection, or open a project containing Markdown headings.")}</span></div>`;
    }
    return;
  }
  if (graphUi.graphAnimationFrame) cancelAnimationFrame(graphUi.graphAnimationFrame);
  graphUi.graphAnimationFrame = 0;
  graphUi.stopGraphLayout = null;
  globeScene.renderToken = ++graphUi.graphRenderToken;
  globeScene.viewportWidth = Math.max(320, globeScene.graph.clientWidth || window.innerWidth - 32);
  globeScene.viewportHeight = Math.max(260, globeScene.graph.clientHeight || window.innerHeight - 170);
  globeScene.ns = "http://www.w3.org/2000/svg";
  globeScene.svg = document.createElementNS(globeScene.ns, "svg");
  globeScene.svg.setAttribute("viewBox", `0 0 ${globeScene.viewportWidth} ${globeScene.viewportHeight}`);
  globeScene.svg.setAttribute("width", String(globeScene.viewportWidth));
  globeScene.svg.setAttribute("height", String(globeScene.viewportHeight));
  globeScene.svg.setAttribute("preserveAspectRatio", "none");
  globeScene.svg.classList.add("brain-svg");
  globeScene.svg.setAttribute("aria-label", langText("Interaktywny graf sekcji. Przeciągnij tło, aby przesunąć; użyj kółka myszy, aby przybliżyć.", "Interactive section graph. Drag the background to pan; use the mouse wheel to zoom."));
  globeScene.animateEntry = graphUi.graphMotion && graphUi.graphAnimateNextRender;
  globeScene.svg.classList.toggle("no-node-enter", !globeScene.animateEntry);
  globeScene.svg.classList.toggle("no-motion", !graphUi.graphMotion);
  globeScene.scene = document.createElementNS(globeScene.ns, "g");
  globeScene.scene.classList.add("brain-scene");
  globeScene.scene.classList.toggle("labels-hidden", !graphUi.graphShowLabels);
  globeScene.scene.classList.toggle("labels-enabled", graphUi.graphShowLabels);
  globeScene.scene.classList.toggle("brain-globe-mode", graphUi.graphGlobeMode);
  globeScene.svg.append(globeScene.scene);
  globeScene.edgeLayer = document.createElementNS(globeScene.ns, "g");
  globeScene.edgeLayer.classList.add("brain-edge-layer");
  globeScene.scene.append(globeScene.edgeLayer);
  globeScene.nodeLayer = document.createElementNS(globeScene.ns, "g");
  globeScene.nodeLayer.classList.add("brain-node-layer");
  globeScene.scene.append(globeScene.nodeLayer);
  buildGlobeNodes(globeScene);
  buildGlobeEdges(globeScene);
  initGlobeState(globeScene);
  defineGlobeElementRendering(globeScene);
  defineGlobeViewOperations(globeScene);
  bindGlobeEvents(globeScene);
  setupGlobeLayout(globeScene);
  startGlobeRender(globeScene);
}
