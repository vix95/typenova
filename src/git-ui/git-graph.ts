/** Pure helpers of the Git panel: lanes of the commit graph, reference labels, short and relative dates, diff lines. */

export interface GraphCommit { hash: string; parents: string[] }

/** What to draw for one commit: its lane, the lanes passing straight by, those ending at it from above and those it continues into below. */
export interface GraphRow { hash: string; lane: number; passes: number[]; joins: number[]; parentLanes: number[]; width: number }

/** Lanes waiting for a commit, from one page of the list to the next (null = free lane). */
export type GraphState = (string | null)[];

const firstFree = (lanes: GraphState): number => { const free = lanes.indexOf(null); return free === -1 ? lanes.length : free; };

/**
 * Assigns lanes to commits listed newest first, parents after their children. A lane holds the hash of the commit it is waiting
 * for; a commit takes the lane that waits for it (or a free one), its first parent keeps that lane and further parents of a merge
 * go to other lanes. `state` carries the open lanes over to the next page of the history.
 */
export function layoutGraph(commits: readonly GraphCommit[], state: GraphState = []): { rows: GraphRow[]; state: GraphState } {
  let active = [...state];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const joins = active.map((hash, index) => (hash === commit.hash ? index : -1)).filter(index => index >= 0);
    const passes = active.map((hash, index) => (hash && hash !== commit.hash ? index : -1)).filter(index => index >= 0);
    const next = [...active];
    for (const index of joins) next[index] = null;
    const lane = joins.length ? joins[0] : firstFree(next);
    const parentLanes: number[] = [];
    commit.parents.forEach((parent, position) => {
      const waiting = next.indexOf(parent);
      if (waiting >= 0) { parentLanes.push(waiting); return; }
      const target = position === 0 ? lane : firstFree(next);
      next[target] = parent; parentLanes.push(target);
    });
    while (next.length && next[next.length - 1] === null) next.pop();
    active = next;
    rows.push({ hash: commit.hash, lane, passes, joins, parentLanes, width: Math.max(lane, ...passes, ...joins, ...parentLanes) + 1 });
  }
  return { rows, state: active };
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
