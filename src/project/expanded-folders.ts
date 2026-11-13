/** The open folders of the Project tree are remembered between restarts and between projects, so that the tree comes back as it was left. */
import { documentState } from "../documents/document-state";
import { openUnder, parseExpanded, replaceUnder } from "../filesystem/expanded-folders-model";
import { projectTreeState } from "./project-tree-ops";

const STORAGE_KEY = "typenova.project.expandedFolders";
let restoredFor = "";

function readStored(): string[] {
  try { return parseExpanded(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { return []; }
}

/** Opens the folders that were open the last time these project folders were shown (once for each set of project folders). */
export function restoreExpandedFolders(): void {
  const roots = documentState.projectRoots, key = roots.join("|");
  if (!roots.length || key === restoredFor) return;
  restoredFor = key;
  for (const path of openUnder(readStored(), roots)) projectTreeState.expandedFolders.add(path);
}

/** Remembers which folders are open now (the other projects' entries are left alone). */
export function saveExpandedFolders(): void {
  const roots = documentState.projectRoots;
  if (!roots.length) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(replaceUnder(readStored(), roots, projectTreeState.expandedFolders))); } catch { /* storage unavailable */ }
}
