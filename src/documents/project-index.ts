/** The project's link index of this program: the engine (`graph/project-index-engine.ts`) joined to the real file system and to the open folders. */
import { tauriFiles } from "../filesystem/project-index-store";
import { rootContaining } from "../filesystem/project-roots";
import { createProjectIndex } from "../graph/project-index-engine";
import { documentState } from "./document-state";
import { sameSessionPath } from "./session";

/** The folders the index covers: the project's folders, else the folder of the document in use. */
export function indexRoots(): string[] {
  if (documentState.projectRoots.length) return [...documentState.projectRoots];
  if (documentState.projectRoot) return [documentState.projectRoot];
  const path = documentState.tabs.find(tab => tab.id === documentState.activeTabId)?.path;
  const cut = path ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) : -1;
  return path && cut > 0 ? [path.slice(0, cut)] : [];
}

const index = createProjectIndex({
  ...tauriFiles,
  roots: indexRoots,
  isInside: (roots, path) => !!rootContaining(roots, path),
  samePath: sameSessionPath,
  now: () => Date.now(),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: handle => window.clearTimeout(handle as number | undefined),
  warn: (...parts) => console.warn(...parts),
});

export const { warmProject, indexedFiles, indexedNow, indexReady, indexUsable, indexedFilesNow, recheckIndex, noteFileSaved, flush: flushIndex } = index;

// A changed index is stored when the program closes, not only after the usual delay.
window.addEventListener("beforeunload", () => flushIndex());
