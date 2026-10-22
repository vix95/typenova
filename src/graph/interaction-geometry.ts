/** Renderer-independent pointer, viewport and hit-test geometry for graph interactions. */
export interface GraphPoint { x: number; y: number }
export interface GraphViewportTransform { zoom: number; panX: number; panY: number }
export interface GraphScreenTransform extends GraphViewportTransform { originLeft: number; originTop: number }
export interface GraphZoomLimits { minZoom: number; maxZoom: number }
export interface GraphZoomResult extends GraphViewportTransform { }

/** Converts browser client coordinates to world coordinates without depending on DOM or Canvas. */
export function screenToGraphPoint(clientX: number, clientY: number, transform: GraphScreenTransform): GraphPoint {
  const zoom = Math.max(0.0001, transform.zoom);
  return {
    x: (clientX - transform.originLeft - transform.panX) / zoom,
    y: (clientY - transform.originTop - transform.panY) / zoom
  };
}

/** Returns squared distance to a node when the pointer is inside its effective hit target. */
export function graphNodeHitDistanceSquared(
  pointX: number,
  pointY: number,
  nodeX: number,
  nodeY: number,
  radius: number,
  padding = 4,
  minimumHitRadius = 10
): number | null {
  const dx = pointX - nodeX;
  const dy = pointY - nodeY;
  const distanceSquared = dx * dx + dy * dy;
  const hitRadius = Math.max(minimumHitRadius, radius + padding);
  return distanceSquared <= hitRadius * hitRadius ? distanceSquared : null;
}

/** Zooms around a viewport-local pointer so the world point beneath it remains stationary. */
export function zoomGraphAtPoint(
  current: GraphViewportTransform,
  factor: number,
  pointX: number,
  pointY: number,
  limits: GraphZoomLimits
): GraphZoomResult {
  const oldZoom = Math.max(0.0001, current.zoom);
  const zoom = Math.max(limits.minZoom, Math.min(limits.maxZoom, oldZoom * factor));
  const ratio = zoom / oldZoom;
  return {
    zoom,
    panX: pointX - (pointX - current.panX) * ratio,
    panY: pointY - (pointY - current.panY) * ratio
  };
}
