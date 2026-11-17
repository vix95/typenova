/** After a file or a folder was moved or renamed in the project tree: the links and images of the open Markdown documents that point at it are rewritten (as edits that can be undone), and so are the relative links of an open document that was moved itself. The rule is in `filesystem/reference-move.ts`. */
import { isMarkdownPath, basename } from "../filesystem/path-utils";
import { planReferenceMove, type PathMove } from "../filesystem/reference-move";
import { langText } from "../i18n/language";
import { showActionToast, showToast } from "../ui/toast";
import { documentState, type DocumentTab } from "./document-state";
import { autoRenameLinksEnabled, editOpenTab, textOfTab, type Undo } from "./link-rename-apply";
import { renderTabs } from "./tabs";

/** An open document and the path it had before the move (the tabs get their new paths first, so this is noted before). */
export interface OpenAt { tab: DocumentTab; path: string }

export function openDocumentPaths(): OpenAt[] {
  return documentState.tabs.flatMap(tab => (tab.path ? [{ tab, path: tab.path }] : []));
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** What to tell about the last rewrite. The tree says "Moved" itself, and that must not cover this message: the tree calls `announceReferenceUpdate` after its own, and if nobody does, it is said after a moment. */
let announcement: (() => void) | null = null;
let announceTimer = 0;

export function announceReferenceUpdate(): void {
  window.clearTimeout(announceTimer);
  const say = announcement;
  announcement = null;
  say?.();
}

/** Rewrites the references of the open documents after `move`, and says what was done, with a way back. Only when the setting that keeps links up to date is on. */
export function updateReferencesAfterMove(before: readonly OpenAt[], move: PathMove): void {
  if (!autoRenameLinksEnabled()) return;
  const undos: Undo[] = [];
  let links = 0;
  for (const { tab, path } of before) {
    if (!isMarkdownPath(path)) continue;
    const doc = textOfTab(tab);
    const edits = planReferenceMove(doc.toString(), path, tab.path ?? path, move);
    if (!edits.length) continue;
    const undo = editOpenTab(tab, doc, edits);
    if (undo) { undos.push(undo); links += edits.length; }
  }
  if (!undos.length) return;
  renderTabs();
  const name = basename(move.to);
  announcement = () => tell(undos, links, name);
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(announceReferenceUpdate, 1500);
}

function tell(undos: readonly Undo[], links: number, name: string): void {
  const pl = `Zaktualizowano ${links} ${plural(links, "odnośnik", "odnośników")} w ${undos.length} ${plural(undos.length, "dokumencie", "dokumentach")} po przeniesieniu „${name}”.`;
  const en = `Updated ${links} ${plural(links, "reference", "references")} in ${undos.length} ${plural(undos.length, "document", "documents")} after moving “${name}”.`;
  showActionToast(langText(pl, en), langText("Cofnij", "Undo"), () => {
    void (async () => {
      let restored = true;
      for (const undo of undos) restored = (await undo.run().catch(() => false)) && restored;
      showToast(restored ? langText("Odnośniki przywrócone.", "References restored.") : langText("Nie wszystkie odnośniki dało się przywrócić: te dokumenty zmieniły się w międzyczasie.", "Not every reference could be restored: those documents changed meanwhile."));
      renderTabs();
    })();
  });
}
