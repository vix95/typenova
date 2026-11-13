/** Which outline sections are folded, remembered for every document separately (pure): a document comes back with its sections folded as they were left. */

/** Folded heading keys by document (the path, or `tab:<id>` for a document that is not saved yet). */
export type CollapseStore = Record<string, string[]>;

/** Documents remembered; the least recently changed are forgotten first. */
export const MAX_REMEMBERED_DOCUMENTS = 300;

export function isCollapseStore(value: unknown): value is CollapseStore {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every(keys => Array.isArray(keys) && keys.every(key => typeof key === "string"));
}

/** The folded keys of a document (empty for one that was never folded). */
export const collapsedFor = (store: CollapseStore, documentKey: string): Set<string> => new Set(store[documentKey] ?? []);

/** The store with the folded keys of one document replaced; a document with nothing folded is not stored, and the one just changed becomes the newest. */
export function withCollapsed(store: CollapseStore, documentKey: string, keys: Iterable<string>): CollapseStore {
  const next: CollapseStore = {};
  for (const [key, value] of Object.entries(store)) if (key !== documentKey) next[key] = value;
  const folded = [...keys];
  if (folded.length) next[documentKey] = folded;
  const names = Object.keys(next);
  for (const name of names.slice(0, Math.max(0, names.length - MAX_REMEMBERED_DOCUMENTS))) delete next[name];
  return next;
}

/** Keys that still exist among the headings. With no headings at all (the text is still being read) nothing is dropped, so that an empty moment never wipes what was remembered. */
export function liveKeys(keys: ReadonlySet<string>, headingKeys: ReadonlySet<string>): Set<string> {
  return headingKeys.size ? new Set([...keys].filter(key => headingKeys.has(key))) : new Set(keys);
}
