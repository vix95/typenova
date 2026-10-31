/** Keeps the project tree in step with the disk: files added, renamed or removed outside TypeNova show up without reopening the folder. */
import { readDir } from "@tauri-apps/plugin-fs";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { markProjectTreeSelection } from "../documents/file-actions";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { markTreeClipboardState, projectTreeState } from "./project-tree-ops";
import { renderProjectTree } from "./project-tree-view";

const POLL_INTERVAL_MS = 2500;

/** What each watched folder contained at the last check (names and kinds, not contents). */
const signatures = new Map<string, string>();
let checking = false;

/** Open folders and expanded sub-folders: everything whose content the tree currently shows. */
function watchedDirectories(): string[] {
  const seen = new Set<string>();
  return [...documentState.projectRoots, ...projectTreeState.expandedFolders].filter(directory => {
    const key = normalizedFsPath(directory);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Records what the watched folders contain right now; called after every tree rebuild so only later changes count. */
export async function captureTreeBaseline(): Promise<void> {
  const fresh = new Map<string, string>();
  for (const directory of watchedDirectories()) {
    const signature = await signatureOf(directory);
    if (signature !== null) fresh.set(normalizedFsPath(directory), signature);
  }
  signatures.clear();
  for (const [key, signature] of fresh) signatures.set(key, signature);
}

/** Rebuilds the tree from the disk, keeping the expanded folders, the scroll position and the selection. */
export async function refreshProjectTree(): Promise<void> {
  const files = $("projectFiles");
  const scrollTop = files.scrollTop;
  await renderProjectTree();
  files.scrollTop = scrollTop;
  markTreeClipboardState();
  markProjectTreeSelection(documentState.currentPath);
}

async function signatureOf(directory: string): Promise<string | null> {
  try {
    const entries = await readDir(directory);
    return entries.map(entry => `${entry.isDirectory ? "d" : "f"}:${entry.name}`).sort().join("|");
  } catch { return null; }
}

/** Compares the open folders and the expanded sub-folders with their last known content; refreshes the tree if any changed. */
async function checkForExternalChanges(): Promise<void> {
  if (checking || !documentState.projectRoots.length || document.visibilityState !== "visible") return;
  // Rebuilding the tree under a drag in progress would drop the dragged row.
  if (document.body.classList.contains("tree-pointer-dragging")) return;
  checking = true;
  try {
    let changed = false;
    for (const directory of watchedDirectories()) {
      const key = normalizedFsPath(directory);
      const signature = await signatureOf(directory);
      if (signature === null) continue;
      const previous = signatures.get(key);
      signatures.set(key, signature);
      if (previous !== undefined && previous !== signature) changed = true;
    }
    if (changed) await refreshProjectTree();
  } finally { checking = false; }
}

export function initProjectTreeSync(): void {
  window.setInterval(() => void checkForExternalChanges(), POLL_INTERVAL_MS);
  // Coming back from the file explorer: look right away instead of waiting for the next tick.
  window.addEventListener("focus", () => void checkForExternalChanges());
  document.addEventListener("visibilitychange", () => void checkForExternalChanges());
}
