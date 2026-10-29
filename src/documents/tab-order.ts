/** Pure helpers for reordering editor tabs. */

/**
 * Returns a copy of `items` with the element for which `isMoving` is true removed and re-inserted so that exactly
 * `insertIndex` of the other elements stay before it. `insertIndex` counts only the remaining elements and is clamped.
 */
export function moveItem<T>(items: readonly T[], isMoving: (item: T) => boolean, insertIndex: number): T[] {
  const from = items.findIndex(isMoving);
  if (from < 0) return [...items];
  const rest = items.filter((_, index) => index !== from);
  const at = Math.max(0, Math.min(rest.length, Math.trunc(insertIndex) || 0));
  rest.splice(at, 0, items[from]);
  return rest;
}

/** Number of other tabs whose horizontal middle lies left of `pointerX`: the slot a dragged tab would take. */
export function insertionIndex(otherTabMiddles: readonly number[], pointerX: number): number {
  let index = 0;
  for (const middle of otherTabMiddles) if (middle < pointerX) index++;
  return index;
}
