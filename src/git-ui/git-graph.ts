/** Pure helpers of the Git panel: lanes of the commit graph, reference labels, short and relative dates, diff lines. */

/** `branch`: the commit carries a branch (local or remote). `trunk`: it is the tip of the main line (main, master), where the lanes of the other branches end. */
export interface GraphCommit { hash: string; parents: string[]; branch?: boolean; trunk?: boolean }

/** What to draw for one commit: its lane, the lanes passing straight by, those ending at it from above and those it continues into below. */
export interface GraphRow { hash: string; lane: number; passes: number[]; joins: number[]; parentLanes: number[]; width: number }

/**
 * A lane waiting for a commit. `seq` is 0 for an ordinary lane; a lane of a branch that keeps running beside the branches below it
 * has a number, the newer the branch the higher. `trunk` marks the lane of the main line.
 */
export interface Lane { hash: string; seq: number; trunk: boolean }

/** Lanes waiting for a commit, from one page of the list to the next (null = free lane). */
export type GraphState = (Lane | null)[];

const firstFree = (lanes: GraphState): number => { const free = lanes.indexOf(null); return free === -1 ? lanes.length : free; };
const indexesWhere = (lanes: GraphState, test: (lane: Lane, index: number) => boolean): number[] => lanes.flatMap((lane, index) => (lane && test(lane, index) ? [index] : []));

/**
 * Assigns lanes to commits listed newest first, parents after their children. A lane holds the hash of the commit it is waiting
 * for; a commit takes the lane that waits for it (or a free one), its first parent keeps that lane and further parents of a merge
 * go to other lanes. `state` carries the open lanes over to the next page of the history.
 *
 * Branches stacked on one another (a branch that contains the commits of the branch below it) keep a line each: when a commit that
 * carries a branch is reached by a lane, that lane goes on beside the new lane of the branch, and the lines run side by side down to
 * the main line (the tip of `trunk`), where they all end. So every branch is a coloured line from its tip to the place it left the
 * main line, and its commits sit on it.
 */
export function layoutGraph(commits: readonly GraphCommit[], state: GraphState = []): { rows: GraphRow[]; state: GraphState } {
  let active: GraphState = state.map(lane => (lane ? { ...lane } : null));
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const waiting = indexesWhere(active, lane => lane.hash === commit.hash);
    const trunkHere = !!commit.trunk || waiting.some(index => active[index]!.trunk);
    const forks = !trunkHere && !!commit.branch && waiting.length > 0;
    const persistent = trunkHere ? [] : forks ? waiting : waiting.filter(index => active[index]!.seq > 0);
    const next = [...active];
    const highest = Math.max(0, ...active.map(lane => lane?.seq ?? 0));
    let joins = waiting.filter(index => !persistent.includes(index));
    for (const index of joins) next[index] = null;
    const first = commit.parents[0];
    for (const index of persistent) { const lane = active[index]!; next[index] = first ? { hash: first, seq: lane.seq || 1, trunk: false } : null; }
    let lane: number, seq = 0;
    const trunk = trunkHere;
    if (forks) { lane = firstFree(next); seq = Math.max(highest, 1) + 1; }
    else if (persistent.length) { lane = persistent.reduce((best, index) => (active[index]!.seq >= active[best]!.seq ? index : best)); next[lane] = null; seq = active[lane]!.seq; }
    else if (trunkHere && waiting.length) { lane = waiting.find(index => active[index]!.trunk) ?? waiting[0]; }
    else lane = joins.length ? joins[0] : firstFree(next);
    const passes = indexesWhere(active, (_, index) => !waiting.includes(index) || persistent.includes(index)).filter(index => index !== lane);
    if (!forks && persistent.length) joins = [...joins, lane];
    const parentLanes: number[] = [];
    commit.parents.forEach((parent, position) => {
      const target = next.findIndex(candidate => candidate?.hash === parent);
      if (target >= 0 && !(position === 0 && (forks || persistent.length))) { parentLanes.push(target); return; }
      const slot = position === 0 ? lane : firstFree(next);
      next[slot] = { hash: parent, seq: position === 0 ? seq : 0, trunk: position === 0 && trunk };
      parentLanes.push(slot);
    });
    while (next.length && next[next.length - 1] === null) next.pop();
    active = next;
    rows.push({ hash: commit.hash, lane, passes, joins, parentLanes, width: Math.max(lane, ...passes, ...joins, ...parentLanes) + 1 });
  }
  return { rows, state: active };
}

const TRUNK_NAMES = new Set(["main", "master", "HEAD -> main", "HEAD -> master", "origin/main", "origin/master", "upstream/main", "upstream/master"]);

/** The commit of the list as the layout wants it: whether it carries a branch, and whether it is the tip of the main line. */
export function graphCommit(commit: { hash: string; parents: string[]; refs: string[] }): GraphCommit {
  const branch = commit.refs.some(ref => !ref.startsWith("tag: ") && ref !== "HEAD" && ref !== "refs/stash");
  return { hash: commit.hash, parents: commit.parents, branch, trunk: commit.refs.some(ref => TRUNK_NAMES.has(ref)) };
}

export type RefKind = "head" | "branch" | "remote" | "tag";
export interface RefLabel { kind: RefKind; label: string; current: boolean }

/** Turns the `%D` decorations of a commit (`HEAD -> main`, `origin/main`, `tag: v1`) into labels. */
export function classifyRefs(refs: readonly string[], remoteNames: ReadonlySet<string>): RefLabel[] {
  const labels: RefLabel[] = [];
  for (const raw of refs) {
    if (raw.startsWith("HEAD -> ")) labels.push({ kind: "branch", label: raw.slice(8), current: true });
    else if (raw === "HEAD") labels.push({ kind: "head", label: "HEAD", current: true });
    else if (raw.startsWith("tag: ")) labels.push({ kind: "tag", label: raw.slice(5), current: false });
    else labels.push({ kind: remoteNames.has(raw) ? "remote" : "branch", label: raw, current: false });
  }
  return labels;
}

export const shortHash = (hash: string): string => hash.slice(0, 7);

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

/** "3 days ago" / "3 dni temu" for an ISO date, in the given language. */
export function relativeTime(iso: string, now: number, language: string): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(seconds)) return iso;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "second");
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

/** Splits a unified diff into typed lines for colouring (the header lines before the first hunk are "meta"). */
export function diffLines(diff: string): Array<{ kind: DiffLineKind; text: string }> {
  const lines = diff.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let inHunk = false;
  return lines.map(text => {
    if (text.startsWith("@@")) { inHunk = true; return { kind: "hunk" as const, text }; }
    if (!inHunk) return { kind: "meta" as const, text };
    if (text.startsWith("+")) return { kind: "add" as const, text };
    if (text.startsWith("-")) return { kind: "del" as const, text };
    return { kind: "context" as const, text };
  });
}
