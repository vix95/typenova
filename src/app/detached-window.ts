/** Hand-off of a document torn off a tab into its own window (the window is told which entry to read by a URL token). */
import type { ViewPosition } from "../documents/session";

/** Token in the window URL (`?detach=...`), or null for the main window. */
export const detachToken: string | null = new URLSearchParams(window.location.search).get("detach");
/** True in a window created for a torn-off document: it must not touch the main window's saved session or recovery copy. */
export const isDetachedWindow = !!detachToken;

export interface DetachedDocument {
  path: string | null;
  label: string;
  text: string;
  savedText: string;
  dirty: boolean;
  position: ViewPosition | null;
}

const STORAGE_PREFIX = "typenova.detach.";
const STALE_AFTER_MS = 10 * 60 * 1000;

/** Entries left behind (for example when the new window could not open) are dropped after a while. */
function pruneStaleHandoffs(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      const created = Number(JSON.parse(localStorage.getItem(key) || "{}").created);
      if (!Number.isFinite(created) || Date.now() - created > STALE_AFTER_MS) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

/** Stores the document for the new window and returns the token that names it. */
export function stageDetachedDocument(document: DetachedDocument): string {
  pruneStaleHandoffs();
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(STORAGE_PREFIX + token, JSON.stringify({ created: Date.now(), document }));
  return token;
}

export function discardDetachedDocument(token: string): void {
  try { localStorage.removeItem(STORAGE_PREFIX + token); } catch { /* storage unavailable */ }
}

/** Reads and removes the staged document; null when it is missing or malformed. */
export function takeDetachedDocument(token: string): DetachedDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + token);
    localStorage.removeItem(STORAGE_PREFIX + token);
    const entry = raw ? JSON.parse(raw) : null;
    const doc = entry?.document;
    if (!doc || typeof doc.text !== "string" || typeof doc.label !== "string") return null;
    return {
      path: typeof doc.path === "string" && doc.path ? doc.path : null,
      label: doc.label,
      text: doc.text,
      savedText: typeof doc.savedText === "string" ? doc.savedText : doc.text,
      dirty: !!doc.dirty,
      position: doc.position && typeof doc.position === "object" ? doc.position : null,
    };
  } catch { return null; }
}
