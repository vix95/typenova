/** The commit message proposed for "Commit and push": what changed, in the way a person would write it. Pure, no DOM. */
export interface PendingChange { status: string; path: string }

const VERBS: [string, string][] = [["A", "Add"], ["M", "Update"], ["R", "Rename"], ["D", "Remove"]];
/** A message longer than this falls back to counting files instead of naming them. */
const MAX_SUBJECT = 72;
/** Up to this many changes are named; more are counted. */
const MAX_NAMED = 3;

const plural = (count: number): string => `${count} ${count === 1 ? "file" : "files"}`;

export function defaultCommitMessage(changes: readonly PendingChange[]): string {
  if (!changes.length) return "";
  const groups = VERBS.map(([code, verb]) => ({ verb, items: changes.filter(change => change.status === code) })).filter(group => group.items.length);
  const named = groups.map((group, index) => `${index ? group.verb.toLowerCase() : group.verb} ${group.items.map(change => change.path).join(", ")}`).join("; ");
  if (changes.length <= MAX_NAMED && named.length <= MAX_SUBJECT) return named;
  return groups.map((group, index) => `${index ? group.verb.toLowerCase() : group.verb} ${plural(group.items.length)}`).join(", ");
}
