/** Shared deterministic level-of-detail policy for Flat Canvas and Globe renderers. */
export const GRAPH_LOD_THRESHOLD = 200;
export const GRAPH_LOD_OVERVIEW_RATIO = 0.2;

export interface GraphLodCandidate {
  level: number;
  degree: number;
  key: string;
}

export interface GraphLodBudgetOptions {
  total: number;
  zoom: number;
  baseZoom: number;
  fullDetailZoomFactor: number;
  threshold?: number;
  overviewRatio?: number;
}

/** Sorts H1 before H2, and so forth; connectivity and stable key only break same-level ties. */
export function orderGraphLodNodes<T>(
  nodes: readonly T[],
  candidate: (node: T) => GraphLodCandidate,
  enabled: boolean
): T[] {
  if (!enabled) return [...nodes];
  return [...nodes].sort((left, right) => {
    const a = candidate(left), b = candidate(right);
    return a.level - b.level || b.degree - a.degree || a.key.localeCompare(b.key);
  });
}

/** Returns the number of graph vertices to render at the current zoom, never changing the model. */
export function getGraphLodBudget(options: GraphLodBudgetOptions): number {
  const {
    total,
    zoom,
    baseZoom,
    fullDetailZoomFactor,
    threshold = GRAPH_LOD_THRESHOLD,
    overviewRatio = GRAPH_LOD_OVERVIEW_RATIO
  } = options;
  if (total <= 0) return 0;
  if (total < threshold) return total;
  const overviewBudget = Math.max(1, Math.ceil(total * Math.max(0.01, Math.min(1, overviewRatio))));
  const relativeZoom = zoom / Math.max(0.001, baseZoom);
  const progress = Math.max(0, Math.min(1, (relativeZoom - 1) / Math.max(0.001, fullDetailZoomFactor - 1)));
  const easedProgress = Math.pow(progress, 1.55);
  return Math.min(total, Math.max(overviewBudget, Math.round(overviewBudget + (total - overviewBudget) * easedProgress)));
}
