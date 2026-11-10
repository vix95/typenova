/** Notices when a heading is renamed in the editor and, once the edit has settled, has the `[[links]]` to it rewritten (`documents/link-rename-apply.ts`). A rename "settles" when the caret leaves the heading, the editor loses the focus, the document is saved or switched, or the typing pauses for two seconds. */
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import { applyHeadingRename, autoRenameLinksEnabled } from "../documents/link-rename-apply";
import { warmProject } from "../documents/project-index";
import { tabIdInView } from "../documents/groups-state";
import { headingTitleOfLine } from "../graph/link-rename";
import { consumeFenceLine, type FenceState } from "../graph/section-model";
import { annotationOfRename } from "./heading-rename-annotation";

/** The typing pauses this long: the rename is taken as finished. */
const IDLE_MS = 2000;
/** A heading marker with no title (yet). */
const EMPTY_HEADING = /^ {0,3}#{1,6}[ 	]*$/;

/** A heading being edited: where its line starts now, and its title before the first change and now. */
interface Session { view: EditorView; tabId: string; from: number; original: string; timer: number }

let session: Session | null = null;

/** Whether a line of a document is inside a fenced code block (a heading there is code, not a section). */
function insideFence(doc: Text, lineNumber: number): boolean {
  const fence: FenceState = { marker: null, length: 0 };
  for (let number = 1; number < lineNumber; number++) consumeFenceLine(fence, doc.line(number).text);
  return fence.marker !== null;
}

function clear(): Session | null {
  const old = session;
  session = null;
  if (old) window.clearTimeout(old.timer);
  return old;
}

/** The edit is finished: if the title really changed, the links are updated. Safe to call at any time. */
export function flushHeadingRename(): void {
  const done = clear();
  if (!done || !done.view.dom.isConnected) return;
  const doc = done.view.state.doc;
  const line = doc.lineAt(Math.min(done.from, doc.length));
  const title = headingTitleOfLine(line.text);
  if (title === null || title === "" || title === done.original) return;
  void applyHeadingRename({ tabId: done.tabId, line: line.number, oldTitle: done.original, newTitle: title });
}

/** A change inside one line: the line of the new document, or null when the change spans lines. */
function singleChangedLine(update: ViewUpdate): { numberB: number; fromA: number } | null {
  let found: { numberB: number; fromA: number } | null = null;
  let single = true;
  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const lineB = update.state.doc.lineAt(fromB);
    if (inserted.lines > 1 || update.startState.doc.lineAt(fromA).number !== update.startState.doc.lineAt(toA).number || toB > lineB.to) single = false;
    if (found && found.numberB !== lineB.number) single = false;
    found = { numberB: lineB.number, fromA };
  });
  return single ? found : null;
}

function onDocChanged(update: ViewUpdate): void {
  if (session && session.view === update.view) session.from = update.changes.mapPos(session.from, -1);
  const changed = singleChangedLine(update);
  const doc = update.state.doc;
  if (changed) {
    const lineB = doc.line(changed.numberB);
    const now = headingTitleOfLine(lineB.text);
    // The title was erased to type a new one: the line is still a heading, only without a title for the moment.
    const untitled = now === null && EMPTY_HEADING.test(lineB.text);
    if (session && session.view === update.view && session.from === lineB.from) {
      // Still the same heading: if it stopped being one (its # were deleted) there is nothing to rename.
      if (now === null && !untitled) clear();
    } else if (now !== null || untitled) {
      const before = headingTitleOfLine(update.startState.doc.lineAt(changed.fromA).text);
      if (before !== null && before !== "" && before !== now && !insideFence(update.startState.doc, update.startState.doc.lineAt(changed.fromA).number)) {
        flushHeadingRename();
        session = { view: update.view, tabId: tabIdInView(update.view), from: lineB.from, original: before, timer: 0 };
        // The project is read while the new title is being typed, so that the links can be updated the moment it is done.
        if (autoRenameLinksEnabled()) warmProject();
      }
    }
  }
  if (session) {
    window.clearTimeout(session.timer);
    session.timer = window.setTimeout(flushHeadingRename, IDLE_MS);
  }
}

/** The editor extension: follows the edits of headings in every editor. */
export const headingRenameTracking = [
  EditorView.updateListener.of((update: ViewUpdate) => {
    // The link update edits documents itself; those edits are not renames.
    if (update.transactions.some(transaction => transaction.annotation(annotationOfRename))) {
      if (session && session.view === update.view) session.from = update.changes.mapPos(session.from, -1);
      return;
    }
    if (update.docChanged) onDocChanged(update);
    if (session && session.view === update.view && (update.docChanged || update.selectionSet)) {
      const doc = update.state.doc;
      const line = doc.lineAt(Math.min(session.from, doc.length));
      const head = update.state.selection.main.head;
      if (head < line.from || head > line.to) flushHeadingRename();
    }
  }),
  EditorView.domEventHandlers({ blur: () => { flushHeadingRename(); return false; } }),
];
