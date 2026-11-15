/** Which lines of a document differ from the committed text: the markers of the margin. Pure, no DOM. */
import { lineDiff } from "../ai/ai-model.js";

export type ChangeKind = "added" | "modified" | "deleted";
/** `line` counts from 1. A `deleted` marker sits on the line that now follows the removed lines (the last line when they were at the end). */
export interface LineChange { line: number; kind: ChangeKind }

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");
const linesOf = (text: string): string[] => { const lines = normalize(text).split("\n"); if (lines.length && lines[lines.length - 1] === "") lines.pop(); return lines; };

export function changedLines(base: string, current: string): LineChange[] {
  const before = linesOf(base), after = linesOf(current);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  if (start === endBefore && start === endAfter) return [];
  const diff = lineDiff(before.slice(start, endBefore).join("\n"), after.slice(start, endAfter).join("\n"));
  // `lineDiff` treats an empty text as no lines at all, so a middle that is empty on one side is handled by the same loop.
  const changes: LineChange[] = [];
  let line = start + 1;
  let removed = 0, added: number[] = [];
  const flush = (): void => {
    if (!removed && !added.length) return;
    if (!added.length) changes.push({ line: Math.max(1, Math.min(line, Math.max(1, after.length))), kind: "deleted" });
    else added.forEach((number, index) => changes.push({ line: number, kind: index < removed ? "modified" : "added" }));
    removed = 0; added = [];
  };
  for (const entry of diff) {
    if (entry.kind === "same") { flush(); line++; }
    else if (entry.kind === "del") removed++;
    else { added.push(line); line++; }
  }
  flush();
  return changes;
}
