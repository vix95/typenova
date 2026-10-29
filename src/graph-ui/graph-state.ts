/** Shared state of the Section Graph workspace: selection, indexed sections, view transform and render flags. */
import { type SectionNode, type SectionGraphModel } from "../graph/section-model";
import { createGraphWorkspaceController } from "../graph/workspace-controller";
import { readPreferenceFlag } from "../settings/preferences";
import type { GraphVisualMode } from "../graph/renderers";
import { projectRootsKey, rememberedProjectRoots } from "../project/project-roots";

export type GraphSection = SectionNode;
export const graphWorkspaceController = createGraphWorkspaceController();
export const graphUi = {
  selectedGraphSection: null as GraphSection | null,
  graphSections: [] as GraphSection[],
  graphSectionGraphModel: null as SectionGraphModel | null,
  graphAvailableFiles: [] as Array<{ path: string; name: string }>,
  graphSelectedFiles: null as Set<string> | null,
  graphSectionIndexRequestId: 0 as number,
  graphRelatedPanelDismissed: false as boolean,
  hoveredRelatedSectionId: null as string | null,
  graphEmphasisHandler: null as ((sectionId: string | null) => void) | null,
  graphZoom: 1 as number,
  graphPanX: 28 as number,
  graphPanY: 26 as number,
  graphMotion: readPreferenceFlag("typenova.brain.motion") as boolean,
  graphShowLabels: readPreferenceFlag("typenova.brain.labels", true) as boolean,
  graphGlobeMode: readPreferenceFlag("typenova.brain.globe3d") as boolean,
  graphGlobeRotationX: (Number(localStorage.getItem("typenova.brain.globeRotationX")) || 0) as number,
  graphGlobeRotationY: (Number(localStorage.getItem("typenova.brain.globeRotationY")) || 0) as number,
  graphPreviewWidth: Math.max(280, Math.min(760, Number(localStorage.getItem("typenova.brain.previewWidth")) || 380)) as number,
  graphAutoFitNextRender: true as boolean,
  graphAnimateNextRender: true as boolean,
  graphAnimationFrame: 0 as number,
  graphRenderToken: 0 as number,
  stopGraphLayout: null as (() => void) | null,
  graphAmbientMotionStop: null as (() => void) | null,
  graphAmbientMotionStart: null as (() => void) | null,
  graphVisualMode: (localStorage.getItem("typenova.brain.visualMode") === "tree" ? "tree" : "graph") as GraphVisualMode,
  graphTreePanX: 0 as number,
  graphTreePanY: 0 as number,
  graphTreeMinimapPointerId: null as number | null,
  graphFlatMinimapReady: false as boolean,
  graphCanvasThemeObserver: null as MutationObserver | null,
  graphCanvasCleanup: null as (() => void) | null,
};

export function initGraphState(): void {
  try {
    const savedProject = localStorage.getItem("typenova.brain.selectedProjectRoot");
    const savedFiles = localStorage.getItem("typenova.brain.selectedFiles");
    if (savedProject && savedProject === projectRootsKey(rememberedProjectRoots()) && savedFiles !== null) { const parsed = JSON.parse(savedFiles); if (Array.isArray(parsed)) graphUi.graphSelectedFiles = new Set(parsed.filter((item): item is string => typeof item === "string")); }
  } catch { graphUi.graphSelectedFiles = null; }
}
