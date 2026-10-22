/** Graph toolbar controls: motion, labels, 3D globe and layout reset. */
import { writePreferenceFlag } from "../settings/preferences";
import { $ } from "../app/dom";
import type { GraphCanvasSurface } from "./flat-canvas-renderer";
import { renderGraph } from "./graph-renderer";
import { graphUi } from "./graph-state";
import { syncGraphVisualModeUI } from "./visual-mode";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

export const graphPositionsStorageKey = "typenova.brain.positions.v3";
const graphMotionButton = $("brainPhysics") as HTMLButtonElement;
const graphLabelsButton = $("brainLabelsButton") as HTMLButtonElement;
const graph3dButton = $("brain3dButton") as HTMLButtonElement;
const graphResetLayoutButton = $("brainResetLayout") as HTMLButtonElement;
export function syncGraphMotionButton() {
  graphMotionButton.setAttribute("aria-pressed", String(graphUi.graphMotion)); graphMotionButton.setAttribute("aria-checked", String(graphUi.graphMotion)); graphMotionButton.classList.toggle("is-on", graphUi.graphMotion);
  graphMotionButton.setAttribute("aria-label", langText(graphUi.graphMotion ? "Ruch węzłów włączony" : "Ruch węzłów wyłączony", graphUi.graphMotion ? "Node motion on" : "Node motion off"));
  graphMotionButton.dataset.tooltip = langText(graphUi.graphMotion ? "Wyłącz ruch węzłów" : "Włącz ruch węzłów", graphUi.graphMotion ? "Turn node motion off" : "Turn node motion on");
  graphMotionButton.removeAttribute("title");
}
export function syncGraphLabelsButton() {
  graphLabelsButton.setAttribute("aria-pressed", String(graphUi.graphShowLabels)); graphLabelsButton.setAttribute("aria-checked", String(graphUi.graphShowLabels)); graphLabelsButton.classList.toggle("is-on", graphUi.graphShowLabels);
  graphLabelsButton.setAttribute("aria-label", langText(graphUi.graphShowLabels ? "Ukryj etykiety węzłów" : "Pokaż etykiety węzłów", graphUi.graphShowLabels ? "Hide node labels" : "Show node labels"));
  graphLabelsButton.dataset.tooltip = langText(graphUi.graphShowLabels ? "Ukryj etykiety węzłów" : "Pokaż etykiety węzłów", graphUi.graphShowLabels ? "Hide node labels" : "Show node labels");
  graphLabelsButton.removeAttribute("title");
}
export function syncGraph3dButton() { graph3dButton.setAttribute("aria-pressed", String(graphUi.graphGlobeMode)); graph3dButton.setAttribute("aria-checked", String(graphUi.graphGlobeMode)); graph3dButton.classList.toggle("is-on", graphUi.graphGlobeMode); graph3dButton.setAttribute("aria-label", langText(graphUi.graphGlobeMode ? "Widok globu 3D włączony" : "Włącz widok globu 3D", graphUi.graphGlobeMode ? "3D globe view on" : "Enable 3D globe view")); graph3dButton.dataset.tooltip = langText("Przełącz widok globu 3D", "Toggle 3D globe view"); graph3dButton.removeAttribute("title"); }
export function syncGraphResetLayoutButton() { const label = langText("Zresetuj układ grafu", "Reset graph layout"); graphResetLayoutButton.dataset.tooltip = label; graphResetLayoutButton.removeAttribute("title"); graphResetLayoutButton.setAttribute("aria-label", label); }

export function initGraphControls(): void {
  syncGraphMotionButton();
  syncGraphLabelsButton();
  syncGraph3dButton();
  graphMotionButton.addEventListener("click", () => {
    graphUi.graphMotion = !graphUi.graphMotion; writePreferenceFlag("typenova.brain.motion", graphUi.graphMotion, "on-off"); syncGraphMotionButton();
    const svg = $("brainGraph").querySelector(".brain-svg") as SVGSVGElement | null;
    const canvasSurface = $("brainGraph").querySelector(".brain-canvas") as GraphCanvasSurface | null;
    if (svg) { svg.classList.toggle("no-motion", !graphUi.graphMotion); svg.classList.toggle("no-node-enter", !graphUi.graphMotion); const scene = svg.querySelector(".brain-scene") as SVGGElement | null; if (scene) scene.style.transition = graphUi.graphMotion ? "transform 150ms cubic-bezier(.2,.7,.2,1)" : "none"; }
    if (canvasSurface) canvasSurface.__typenovaSetMotion?.(graphUi.graphMotion);
    if (!graphUi.graphMotion) { if (graphUi.graphAmbientMotionStop) graphUi.graphAmbientMotionStop(); }
    else if (graphUi.graphAmbientMotionStart) graphUi.graphAmbientMotionStart();
  });
  graphLabelsButton.addEventListener("click", () => {
    graphUi.graphShowLabels = !graphUi.graphShowLabels; writePreferenceFlag("typenova.brain.labels", graphUi.graphShowLabels, "on-off"); syncGraphLabelsButton();
    const scene = $("brainGraph").querySelector(".brain-scene") as SVGGElement | null; if (scene) { scene.classList.toggle("labels-hidden", !graphUi.graphShowLabels); scene.classList.toggle("labels-enabled", graphUi.graphShowLabels); }
    const svg = $("brainGraph").querySelector(".brain-svg") as SVGSVGElement | null; if (svg) { const updater = (svg as SVGSVGElement & { __typenovaUpdateLabels?: () => void }).__typenovaUpdateLabels; updater?.(); }
    const canvasSurface = $("brainGraph").querySelector(".brain-canvas") as GraphCanvasSurface | null; if (canvasSurface) canvasSurface.__typenovaSetLabels?.(graphUi.graphShowLabels);
  });
  graph3dButton.addEventListener("click", () => { graphUi.graphGlobeMode = !graphUi.graphGlobeMode; writePreferenceFlag("typenova.brain.globe3d", graphUi.graphGlobeMode, "on-off"); syncGraph3dButton(); syncGraphVisualModeUI(); graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false; if (graphUi.graphGlobeMode) { graphUi.graphPanX = 0; graphUi.graphPanY = 0; } renderGraph(); });
  syncGraphResetLayoutButton();
  graphResetLayoutButton.addEventListener("click", () => {
    if (graphUi.stopGraphLayout) { graphUi.stopGraphLayout(); graphUi.stopGraphLayout = null; }
    if (graphUi.graphAmbientMotionStop) { const stop = graphUi.graphAmbientMotionStop; stop(); graphUi.graphAmbientMotionStop = null; }
    try { localStorage.removeItem(graphPositionsStorageKey); localStorage.setItem("typenova.brain.globeRotationX", "0"); localStorage.setItem("typenova.brain.globeRotationY", "0"); } catch { }
    graphUi.graphGlobeRotationX = 0; graphUi.graphGlobeRotationY = 0; graphUi.graphZoom = 1; graphUi.graphPanX = 28; graphUi.graphPanY = 26; graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = true;
    renderGraph(); showToast(langText("Układ grafu został zresetowany.", "Graph layout has been reset."));
  });
}
