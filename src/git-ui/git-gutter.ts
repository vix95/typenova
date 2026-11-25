/** Change markers in the margin of the editor: green for added lines, blue for modified lines and a red mark where lines were removed, compared with the committed text (HEAD) of the file in its Git repository. The markers follow the text as it is typed and are computed again shortly after each change. */
import { gutter, GutterMarker, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { documentState } from "../documents/document-state";
import { groupsState } from "../documents/groups-state";
import { allEditorViews } from "../editor/editor-view";
import { normalizedFsPath, parentPath } from "../filesystem/project-tree-operations";
import { gitHeadText, gitRepoRoot } from "./git-api";
import { changedLines, type ChangeKind } from "./git-gutter-model";

/** A document longer than this gets no markers (the comparison is made on the main thread; it is fast, its cost follows the lines that differ). */
const MAX_DOCUMENT_CHARS = 20_000_000;
const AFTER_CHANGE_MS = 350;
const AFTER_LOAD_MS = 80;

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: ChangeKind) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof ChangeMarker && other.kind === this.kind; }
  toDOM(): HTMLElement { const mark = document.createElement("div"); mark.className = `cm-git-marker cm-git-${this.kind}`; return mark; }
}
const MARKERS: Record<ChangeKind, ChangeMarker> = { added: new ChangeMarker("added"), modified: new ChangeMarker("modified"), deleted: new ChangeMarker("deleted") };

const setMarkers = StateEffect.define<RangeSet<GutterMarker>>();
const markerField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setMarkers)) return effect.value;
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
});

/** The committed text of a file for the margin: null when there is nothing to compare with (not in a repository, ignored, binary, too big). */
const bases = new Map<string, Promise<string | null>>();
const repoRoots = new Map<string, Promise<string | null>>();

async function loadBase(path: string): Promise<string | null> {
  const dir = parentPath(path);
  if (!repoRoots.has(dir)) repoRoots.set(dir, gitRepoRoot(dir).catch(() => null));
  const repo = await repoRoots.get(dir)!;
  if (!repo) return null;
  const root = normalizedFsPath(repo).replace(/\/+$/, "");
  const full = normalizedFsPath(path);
  if (!full.startsWith(`${root}/`)) return null;
  // The path as git knows it: relative to the repository, with forward slashes (the case of the real path is kept).
  const forward = path.replace(/\\/g, "/");
  const relative = forward.slice(forward.length - (full.length - root.length - 1));
  try {
    const head = await gitHeadText(repo, relative);
    return head.kind === "none" ? null : head.text;
  } catch { return null; }
}

function baseOf(path: string): Promise<string | null> {
  if (!bases.has(path)) bases.set(path, loadBase(path));
  return bases.get(path)!;
}

/** What the committed texts are compared with has changed (a commit, a staged change, another branch): they are read again. */
export function invalidateGitBases(): void {
  bases.clear();
  for (const view of allEditorViews()) scheduleRefresh(view, AFTER_LOAD_MS);
}

/** The file an editor shows now. */
function pathOfView(target: EditorView): string | null {
  const group = groupsState.groups.find(item => item.view === target);
  if (group) return documentState.tabs.find(tab => tab.id === group.activeTabId)?.path ?? null;
  return documentState.currentPath;
}

function toSet(target: EditorView, changes: ReturnType<typeof changedLines>): RangeSet<GutterMarker> {
  const doc = target.state.doc;
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const change of [...changes].sort((a, b) => a.line - b.line)) {
    if (change.line < 1 || change.line > doc.lines) continue;
    builder.add(doc.line(change.line).from, doc.line(change.line).from, MARKERS[change.kind]);
  }
  return builder.finish();
}

async function refresh(target: EditorView): Promise<void> {
  const path = pathOfView(target);
  const base = path ? await baseOf(path) : null;
  // The editor may have been given another file while the committed text was being read.
  if (pathOfView(target) !== path) return;
  const doc = target.state.doc;
  const markers = base === null || doc.length > MAX_DOCUMENT_CHARS ? RangeSet.empty : toSet(target, changedLines(base, doc.toString()));
  if (markers.size || target.state.field(markerField).size) target.dispatch({ effects: setMarkers.of(markers) });
}

const timers = new WeakMap<EditorView, number>();
function scheduleRefresh(target: EditorView, delay: number): void {
  window.clearTimeout(timers.get(target));
  timers.set(target, window.setTimeout(() => { void refresh(target); }, delay));
}

const refresher = ViewPlugin.fromClass(class {
  constructor(private readonly target: EditorView) { scheduleRefresh(target, AFTER_LOAD_MS); }
  update(update: ViewUpdate): void { if (update.docChanged) scheduleRefresh(this.target, AFTER_CHANGE_MS); }
  destroy(): void { window.clearTimeout(timers.get(this.target)); }
});

const spacer = new (class extends GutterMarker { toDOM(): HTMLElement { const mark = document.createElement("div"); mark.className = "cm-git-marker"; return mark; } })();

/** The extension for every editor: put into `editorExtensions`. */
export const gitGutterExtension = [markerField, gutter({ class: "cm-git-gutter", markers: target => target.state.field(markerField), initialSpacer: () => spacer }), refresher];

/** Reads the committed texts again when the window gets the focus (something may have been committed elsewhere) and when asked to. */
export function installGitGutter(): void {
  let last = 0;
  window.addEventListener("focus", () => { if (Date.now() - last > 2000) { last = Date.now(); invalidateGitBases(); } });
  document.addEventListener("typenova:git-changed", () => invalidateGitBases());
}
