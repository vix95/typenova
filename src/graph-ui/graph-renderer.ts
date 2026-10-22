/** Chooses the renderer for the current view (Tree, Flat Canvas or Globe SVG) and delegates to it. */
import { resolveGraphRenderer } from "../graph/renderers";
import { $ } from "../app/dom";
import { renderGraphCanvas } from "./flat-canvas-renderer";
import { renderGlobe } from "./globe-renderer";
import { graphUi } from "./graph-state";
import { renderGraphTree } from "./tree-renderer";

export function renderGraph() {
  const renderer = resolveGraphRenderer(graphUi.graphVisualMode, graphUi.graphGlobeMode);
  if (renderer === "tree-dom") { if (graphUi.graphCanvasCleanup) { const cleanup = graphUi.graphCanvasCleanup; graphUi.graphCanvasCleanup = null; cleanup(); } graphUi.graphFlatMinimapReady = false; ($("brainGraphMinimap") as HTMLElement).hidden = true; if (graphUi.graphCanvasThemeObserver) { graphUi.graphCanvasThemeObserver.disconnect(); graphUi.graphCanvasThemeObserver = null; } renderGraphTree(); return; }
  if (renderer === "flat-canvas") { renderGraphCanvas(); return; }
  renderGlobe();
}
