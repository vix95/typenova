/** The project's link index in memory: which Markdown files there are, what sections they have and what their links name. It is read in the background (only files that changed since the last session are read again), kept on disk, refreshed when a file is saved, and consulted by renames, followed links and link completion. Everything it needs from the outside (files, clock, storage) comes through an `IndexPort`, so that it runs, and is tested, without Tauri. */
import { basename, isMarkdownPath } from "../filesystem/path-utils.js";
import { indexFile, type IndexedFile } from "./project-index-model.js";

export interface IndexPort {
  /** The folders the index covers now. */
  roots(): string[];
  /** What the last session stored for these folders (empty when nothing). */
  load(key: string): Promise<IndexedFile[]>;
  save(key: string, files: readonly IndexedFile[]): Promise<void>;
  /** Changes whenever the file does; "?" when the system does not say (such a file is read every time). */
  stamp(path: string): Promise<string>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
  /** The text of a file, null for a binary one. */
  readText(path: string): Promise<string | null>;
  join(folder: string, name: string): Promise<string>;
  isInside(roots: readonly string[], path: string): boolean;
  samePath(a: string, b: string): boolean;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  warn(...parts: unknown[]): void;
}

export interface IndexOptions {
  /** Beyond this the project is too large to index. */
  maxFiles?: number;
  /** An index checked against the disk less than this long ago is trusted (files saved from the editor renew it anyway). */
  freshMs?: number;
  /** The wait before a changed index is stored (a burst of saves is stored once). */
  persistDelayMs?: number;
  /** During a read, the index is stored after this many files, so that closing the program half way keeps what was read. */
  checkpointEvery?: number;
}

export interface IndexSnapshot { files: IndexedFile[]; tooLarge: boolean; problem: string | undefined }

const SKIPPED_DIRECTORIES = new Set(["node_modules", "target", "dist", "build", "vendor"]);
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A short key of the folders an index belongs to (its file name in storage). */
export function indexKeyOf(roots: readonly string[]): string {
  let hash = 5381;
  for (const char of JSON.stringify([...roots].sort())) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

interface State {
  key: string;
  roots: string[];
  files: Map<string, IndexedFile>;
  running: Promise<void> | null;
  /** Resolves when what the last session stored has been put in (a moment, no scan). */
  loaded: Promise<void>;
  /** Whether the files were checked against the disk at least once in this session. */
  checked: boolean;
  checkedAt: number;
  /** Changed since it was last stored. */
  dirty: boolean;
  tooLarge: boolean;
  problem: string | undefined;
}

interface WalkContext { port: IndexPort; maxFiles: number; checkpointEvery: number; store: (state: State) => void }

/** Walks a folder; a file whose stamp is the one already known is not read. */
async function walk(ctx: WalkContext, current: State, previous: ReadonlyMap<string, IndexedFile>, seen: Set<string>, directory: string): Promise<void> {
  const { port, maxFiles, checkpointEvery, store } = ctx;
  if (current.tooLarge) return;
  let entries: { name: string; isDirectory: boolean }[] = [];
  try { entries = await port.readDir(directory); } catch (error) { current.problem ??= `${directory}: ${String(error)}`; port.warn("Project index", directory, error); return; }
  for (const entry of entries) {
    if (current.tooLarge) return;
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = await port.join(directory, entry.name);
    if (entry.isDirectory) { await walk(ctx, current, previous, seen, path); continue; }
    if (!isMarkdownPath(entry.name)) continue;
    try {
      const stamp = await port.stamp(path);
      const known = previous.get(path);
      let file: IndexedFile | null = known && stamp !== "?" && known.stamp === stamp ? known : null;
      if (!file) {
        const text = await port.readText(path);
        if (text === null) continue;
        file = indexFile(path, entry.name, stamp, text);
      }
      if (seen.size >= maxFiles) { current.tooLarge = true; return; }
      seen.add(path);
      if (previous.get(path) !== file) current.dirty = true;
      current.files.set(path, file);
      if (seen.size % checkpointEvery === 0) store(current);
    } catch (error) { current.problem ??= `${path}: ${String(error)}`; port.warn("Project index", path, error); }
    if (seen.size % 25 === 0) await yieldTask();
  }
}

/**
 * `indexedNow`: the files indexed so far. `indexReady`: checked against the disk, no read going on. `indexUsable`: a map exists to work from. `indexedFilesNow`: the map as it is now, at once (what the last session stored and every save since); only a project never read waits for its first read, and the check against the disk goes on in the background. `recheckIndex`: after a new check. `flush`: stores a changed index now.
 */
export function createProjectIndex(port: IndexPort, options: IndexOptions = {}) {
  const maxFiles = options.maxFiles ?? 20000;
  const freshMs = options.freshMs ?? 120_000;
  const persistDelayMs = options.persistDelayMs ?? 3000;
  const checkpointEvery = options.checkpointEvery ?? 500;
  let state: State | null = null;
  let persistTimer: unknown;

  const store = (current: State): void => {
    if (!current.dirty) return;
    current.dirty = false;
    void port.save(current.key, [...current.files.values()]).catch(error => port.warn("Project index: not stored", error));
  };
  const storeSoon = (current: State): void => {
    port.clearTimer(persistTimer);
    persistTimer = port.setTimer(() => store(current), persistDelayMs);
  };

  async function refresh(current: State): Promise<void> {
    const previous = new Map(current.files);
    const seen = new Set<string>();
    current.tooLarge = false;
    current.problem = undefined;
    for (const root of current.roots) {
      await walk({ port, maxFiles, checkpointEvery, store }, current, previous, seen, root);
      if (current.tooLarge) break;
    }
    if (!current.tooLarge) for (const path of [...current.files.keys()]) if (!seen.has(path)) { current.files.delete(path); current.dirty = true; }
    current.checked = true;
    current.checkedAt = port.now();
    if (current.dirty) storeSoon(current);
  }

  const run = (current: State, work: () => Promise<void>): void => {
    current.running = work().catch(error => port.warn("Project index", error)).finally(() => { current.running = null; });
  };

  /** Makes sure the index of the current folders is being read (a no-op when it is current). With `force` the files are checked against the disk again. */
  function warmProject(force = false): void {
    const roots = port.roots();
    if (!roots.length) return;
    const key = indexKeyOf(roots);
    if (!state || state.key !== key) {
      const fresh: State = { key, roots, files: new Map(), running: null, loaded: Promise.resolve(), checked: false, checkedAt: 0, dirty: false, tooLarge: false, problem: undefined };
      state = fresh;
      // What the last session stored is usable at once, and is checked against the disk right after.
      fresh.loaded = port.load(key).then(stored => {
        if (state === fresh) for (const file of stored) if (!fresh.files.has(file.path)) fresh.files.set(file.path, file);
      }).catch(() => undefined);
      run(fresh, () => fresh.loaded.then(() => refresh(fresh)));
      return;
    }
    if (state.running || (!force && state.checked && port.now() - state.checkedAt < freshMs)) return;
    const current = state;
    run(current, () => refresh(current));
  }

  const usable = (): boolean => !!state && (state.files.size > 0 || state.checked);
  const snapshot = (): IndexSnapshot => ({ files: state ? [...state.files.values()] : [], tooLarge: state?.tooLarge ?? false, problem: state?.problem });

  /** The whole index, once the current read is over (reads first when that is not done). */
  async function indexedFiles(): Promise<IndexSnapshot> {
    warmProject();
    while (state?.running) await state.running;
    return snapshot();
  }

  return {
    warmProject,
    indexedFiles,
    indexedNow: (): IndexedFile[] => (state ? [...state.files.values()] : []),
    indexReady: (): boolean => !!state && state.checked && !state.running && state.key === indexKeyOf(port.roots()),
    indexUsable: (): boolean => !!state && state.key === indexKeyOf(port.roots()) && usable(),
    async indexedFilesNow(): Promise<IndexSnapshot> {
      warmProject();
      await state?.loaded;
      return usable() ? snapshot() : indexedFiles();
    },
    recheckIndex(): Promise<IndexSnapshot> {
      warmProject(true);
      return indexedFiles();
    },
    /** A file saved from the editor: its entry is renewed (or added when it is new to the project). */
    noteFileSaved(path: string, text: string): void {
      const current = state;
      if (!current || !isMarkdownPath(path) || !port.isInside(current.roots, path)) return;
      void port.stamp(path).then(stamp => {
        if (state !== current) return;
        const known = [...current.files.keys()].find(item => port.samePath(item, path)) ?? path;
        current.files.set(known, indexFile(known, basename(path), stamp, text));
        current.dirty = true;
        storeSoon(current);
      });
    },
    flush(): void { if (state) { port.clearTimer(persistTimer); store(state); } },
  };
}

export type ProjectIndex = ReturnType<typeof createProjectIndex>;
