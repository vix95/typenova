/** Changes made to the files from outside the program (a pull, an agent, another editor): which of the file system events matter, what a batch of them amounts to, and the smallest edit that turns the text of a document into the text now on disk. Pure, no DOM, no files. */

export type ChangeKind = "create" | "modify" | "remove" | "rename" | "access";
export interface FsEvent { kind: ChangeKind; paths: readonly string[] }

/** Of the shapes of the file system watcher's event type (a word, or an object with the kind of change as its only key), the kind of change. Anything unknown counts as a modification. */
export function kindOf(type: unknown): ChangeKind {
  if (typeof type !== "object" || type === null) return "modify";
  const [name, detail] = Object.entries(type)[0] ?? [];
  if (name === "create" || name === "remove" || name === "access") return name;
  if (name === "modify") return (detail as { kind?: string } | undefined)?.kind === "rename" ? "rename" : "modify";
  return "modify";
}

export type PathClass = "ignore" | "content" | "git-state";

/** What inside `.git` says that the repository changed: the branch in use, the index, the references, an operation in progress. The rest of it (objects, logs, hooks, lock files) is noise. */
const GIT_STATE = new Set(["HEAD", "index", "refs", "packed-refs", "MERGE_HEAD", "ORIG_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]);
/** Folders whose files are never the user's documents and change by the thousand. */
const IGNORED_FOLDERS = new Set(["node_modules", "__pycache__", "site-packages", ".venv", "venv"]);

export function classifyPath(path: string): PathClass {
  const segments = path.split(/[\\/]+/);
  if (segments.some(segment => IGNORED_FOLDERS.has(segment))) return "ignore";
  const git = segments.lastIndexOf(".git");
  if (git < 0) return "content";
  return GIT_STATE.has(segments[git + 1] ?? "HEAD") ? "git-state" : "ignore";
}

export interface ChangeBatch {
  /** Files and folders whose content or existence changed. */
  paths: Set<string>;
  /** Something was created, removed or renamed: the tree of files has another shape. */
  structure: boolean;
  /** The repository's state changed (another branch, a commit, a pull). */
  gitState: boolean;
}

export function summarize(events: readonly FsEvent[]): ChangeBatch {
  const batch: ChangeBatch = { paths: new Set(), structure: false, gitState: false };
  for (const event of events) {
    if (event.kind === "access") continue;
    for (const path of event.paths) {
      const kind = classifyPath(path);
      if (kind === "git-state") batch.gitState = true;
      if (kind !== "content") continue;
      batch.paths.add(path);
      if (event.kind !== "modify") batch.structure = true;
    }
  }
  return batch;
}

export interface TextChange { from: number; to: number; insert: string }

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** The smallest single edit that turns `before` into `after` (what differs between the common start and the common end), or null when they are equal. Never splits a character that takes two code units. */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < shortest - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
