/** Axis-aligned bounds used by the Canvas graph's coarse spatial index. */
export interface GraphSpatialBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Fast conservative visibility test for a line segment against a viewport.
 * It intentionally uses the segment's bounding box rather than exact clipping:
 * false positives are acceptable for rendering; false negatives are not.
 */
export function segmentMayIntersectBounds(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bounds: GraphSpatialBounds,
): boolean {
  if (
    !Number.isFinite(ax) || !Number.isFinite(ay)
    || !Number.isFinite(bx) || !Number.isFinite(by)
    || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.right)
    || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)
  ) return false;

  const left = Math.min(bounds.left, bounds.right);
  const right = Math.max(bounds.left, bounds.right);
  const top = Math.min(bounds.top, bounds.bottom);
  const bottom = Math.max(bounds.top, bounds.bottom);
  return Math.max(ax, bx) >= left
    && Math.min(ax, bx) <= right
    && Math.max(ay, by) >= top
    && Math.min(ay, by) <= bottom;
}
