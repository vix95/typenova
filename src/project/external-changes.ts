/** Watches the project folders (and the folders of open documents outside them) for changes made from outside the program, and brings the interface up to date: the tree of files, the open documents, the Git view and the markers in the margin, the link index. */
import { watchImmediate, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { documentState } from "../documents/document-state";
import { recheckIndex } from "../documents/project-index";
import { syncOpenDocument } from "../documents/external-reload";
import { basename } from "../filesystem/path-utils";
import { normalizedFsPath, parentPath, pathIsInside } from "../filesystem/project-tree-operations";
import { rootContaining } from "../filesystem/project-roots";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { classifyPath, kindOf, summarize, type ChangeBatch, type FsEvent } from "./external-changes-model";
import { refreshProjectTree } from "./project-tree-sync";

/** Events that come close together (a pull writes many files) are handled as one. */
const SETTLE_MS = 200;
/** How often the set of watched folders is compared with the folders that should be watched. */
const RESYNC_MS = 3000;
/** A batch with more files than this is checked against all open documents instead of one by one. */
const MANY_PATHS = 200;

interface Target { path: string; recursive: boolean }

/** The project folders (all of what is in them) and the folders of open documents that lie outside them (only the folder itself). */
function watchTargets(): Target[] {
  const roots = documentState.projectRoots;
  const targets = new Map<string, Target>(roots.map(root => [normalizedFsPath(root), { path: root, recursive: true }]));
  for (const tab of documentState.tabs) {
    if (!tab.path || rootContaining(roots, tab.path)) continue;
    const folder = parentPath(tab.path);
    if (folder) targets.set(normalizedFsPath(folder), { path: folder, recursive: false });
  }
  return [...targets.values()];
}

const signatureOf = (targets: readonly Target[]): string => targets.map(target => `${target.recursive ? "r" : "d"}:${normalizedFsPath(target.path)}`).sort().join("|");

let unwatchers: UnwatchFn[] = [];
let watching = "";
let pending: FsEvent[] = [];
let settleTimer = 0;

function collect(event: { type: unknown; paths: string[] }): void {
  // Raw noise inside .git (objects, logs) is dropped here, before it can keep the timer running.
  const paths = event.paths.filter(path => classifyPath(path) !== "ignore");
  if (!paths.length) return;
  pending.push({ kind: kindOf(event.type), paths });
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => { void handleBatch(summarize(pending.splice(0))); }, SETTLE_MS);
}

/** The open documents a batch touches: the ones whose file is among its paths, or all of them when the batch is huge (a branch switch). */
function affectedPaths(batch: ChangeBatch): string[] {
  const open = documentState.tabs.map(tab => tab.path).filter((path): path is string => !!path);
  if (batch.paths.size > MANY_PATHS) return open;
  const changed = new Set([...batch.paths].map(normalizedFsPath));
  return open.filter(path => changed.has(normalizedFsPath(path)) || [...batch.paths].some(folder => pathIsInside(folder, path) && normalizedFsPath(folder) !== normalizedFsPath(path)));
}

async function reloadOpenDocuments(batch: ChangeBatch): Promise<void> {
  const reloaded: string[] = [];
  for (const path of affectedPaths(batch)) if (await syncOpenDocument(path) === "reloaded") reloaded.push(basename(path));
  if (reloaded.length) showToast(langText(`Odświeżono z dysku: ${reloaded.join(", ")}.`, `Updated from disk: ${reloaded.join(", ")}.`));
}

async function handleBatch(batch: ChangeBatch): Promise<void> {
  if (!batch.paths.size && !batch.gitState) return;
  await reloadOpenDocuments(batch);
  if (batch.structure) await refreshProjectTree();
  void recheckIndex();
  // The Git view, the margin markers and the repository dictionaries read the repository again.
  document.dispatchEvent(new CustomEvent("typenova:git-changed"));
}

async function startWatching(targets: readonly Target[]): Promise<void> {
  for (const unwatch of unwatchers) unwatch();
  unwatchers = [];
  for (const target of targets) {
    // `watchImmediate`, not `watch` (which adds a delay of 2 s by default): with a delay the host builds, on the thread of the window, a cache of the identity of every file under the folder (a walk of the whole tree, minutes for 100,000 files); the batching is done by `collect` below.
    // A folder the program may not watch (outside what the person opened) is simply left to the tree's own polling.
    try { unwatchers.push(await watchImmediate(target.path, collect, { recursive: target.recursive })); } catch { /* not watched */ }
  }
}

/** Makes the watchers match the folders that matter now (called at start and whenever the project or the open documents change). */
async function resync(): Promise<void> {
  const targets = watchTargets();
  const signature = signatureOf(targets);
  if (signature === watching) return;
  watching = signature;
  await startWatching(targets);
}

export function installExternalChanges(): void {
  window.setInterval(() => { void resync(); }, RESYNC_MS);
  document.addEventListener("typenova:document-shown", () => { void resync(); });
  void resync();
}
