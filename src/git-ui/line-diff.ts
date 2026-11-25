/** A line by line comparison that stays fast for large files: Myers' algorithm, whose cost grows with the number of lines that differ, not with the product of the lengths of the two texts. Pure, no DOM. */

export const SAME = 0, DELETED = 1, ADDED = 2;

/** More differing lines than this and the comparison is given up (the caller then treats the whole stretch as changed). */
export const MAX_EDIT_DISTANCE = 4000;

/**
 * The edit script that turns `before` into `after`, as one entry per step: SAME (a line both have), DELETED (a line only `before` has) or ADDED (a line only
 * `after` has), in document order. Null when the texts differ in more than `maxEdits` lines.
 */
export function diffKinds(before: readonly string[], after: readonly string[], maxEdits = MAX_EDIT_DISTANCE): Uint8Array | null {
  // Lines become numbers, so that comparing two lines is one comparison of integers.
  const ids = new Map<string, number>();
  const idOf = (line: string): number => { let id = ids.get(line); if (id === undefined) { id = ids.size; ids.set(line, id); } return id; };
  const a = Int32Array.from(before, idOf), b = Int32Array.from(after, idOf);
  const n = a.length, m = b.length;
  const limit = Math.min(maxEdits, n + m);
  const offset = limit + 1;
  let v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let finished = -1;
  for (let d = 0; d <= limit && finished < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { finished = d; break; }
    }
  }
  if (finished < 0) return null;
  // Walk back from the end to the start: every step of the path is a diagonal (same), a downward step (added) or a rightward one (deleted).
  const reversed: number[] = [];
  let x = n, y = m;
  for (let d = finished; d > 0; d--) {
    const snapshot = trace[d];
    const at = (k: number): number => snapshot[k + d + 1];
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK), previousY = previousX - previousK;
    while (x > previousX && y > previousY) { reversed.push(SAME); x--; y--; }
    reversed.push(x === previousX ? ADDED : DELETED);
    x = previousX; y = previousY;
  }
  while (x > 0 && y > 0) { reversed.push(SAME); x--; y--; }
  const kinds = new Uint8Array(reversed.length);
  for (let index = 0; index < reversed.length; index++) kinds[index] = reversed[reversed.length - 1 - index];
  return kinds;
}
