/** Pure rules of the update check: how often an open program asks again, how far a download is, and the note of a release as one short line. */

/** While the program stays open it asks again this often (it also asks at every start). */
export const RECHECK_MS = 6 * 60 * 60 * 1000;

/** Whole percent of a download, or null when the size is not known. */
export function downloadPercent(downloaded: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)));
}

/** The note of a release as plain text of one short line (the first non-empty line, markup marks removed, cut at 160 characters). */
export function releaseNote(notes: string | null | undefined): string {
  const line = (notes ?? "").split(/\r?\n/).map(part => part.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim()).find(part => part && !part.startsWith("Full Changelog")) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
