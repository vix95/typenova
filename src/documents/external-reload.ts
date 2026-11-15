/** An open document and its file when the file changes from outside (a pull, an agent, another editor): a document without unsaved changes is brought up to date at once, keeping the caret and the scroll position where the text allows; one with unsaved changes is never overwritten, and the person is told. */
import { Transaction } from "@codemirror/state";
import { loadTextFile, type LoadedText } from "../filesystem/text-io";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { minimalChange } from "../project/external-changes-model";
import { showToast } from "../ui/toast";
import { setClean } from "./dirty-state";
import type { DocumentTab } from "./document-state";
import { documentState } from "./document-state";
import { textOfTab } from "./link-rename-apply";
import { hasUnsavedChanges, isActiveTab, liveViewOf, savedTextOf, tabForPath } from "./open-documents";
import { renderTabs } from "./tabs";

export type SyncOutcome = "unchanged" | "reloaded" | "conflict" | "deleted";

/** What was already said to the person, so that a file that keeps changing (or stays deleted) does not repeat the message. */
const toldAboutConflict = new Map<string, string>();
const toldAboutDeletion = new Set<string>();

async function readFromDisk(path: string): Promise<LoadedText | null> {
  try { return await loadTextFile(path); } catch { return null; }
}

/** Puts the text of the file into the document as one small edit that is not an edit of the person (not in the undo history, not unsaved). */
function adoptDiskText(tab: DocumentTab, disk: LoadedText): void {
  const spec = { changes: minimalChange(textOfTab(tab).toString(), disk.text) ?? [], annotations: Transaction.addToHistory.of(false), userEvent: "external.reload" };
  const view = liveViewOf(tab);
  if (view) view.dispatch(spec); else tab.state = tab.state.update(spec).state;
  tab.savedText = disk.text; tab.format = disk; tab.dirty = false;
  if (isActiveTab(tab)) { documentState.savedText = disk.text; setClean(); } else renderTabs();
}

function noteConflict(tab: DocumentTab, diskText: string): SyncOutcome {
  const path = tab.path!;
  if (toldAboutConflict.get(path) !== diskText) {
    toldAboutConflict.set(path, diskText);
    showToast(langText(`„${basename(path)}” zmieniono na dysku, a masz w nim niezapisane zmiany. Zapis zapyta, czy nadpisać.`, `“${basename(path)}” changed on disk, and you have unsaved changes in it. Saving will ask whether to overwrite.`));
  }
  return "conflict";
}

function noteDeletion(tab: DocumentTab): SyncOutcome {
  if (!toldAboutDeletion.has(tab.path!)) {
    toldAboutDeletion.add(tab.path!);
    showToast(langText(`„${basename(tab.path!)}” został usunięty z dysku. Dokument zostaje otwarty; zapis utworzy plik ponownie.`, `“${basename(tab.path!)}” was deleted from disk. The document stays open; saving will create the file again.`));
  }
  return "deleted";
}

/** Brings the open document of `path` in line with its file. Null when no document of that path is open. */
export async function syncOpenDocument(path: string): Promise<SyncOutcome | null> {
  const tab = tabForPath(path);
  if (!tab?.path) return null;
  const disk = await readFromDisk(tab.path);
  if (!disk) return noteDeletion(tab);
  toldAboutDeletion.delete(tab.path);
  // From here on the document is read again: the person may have typed while the file was being read.
  if (disk.text === savedTextOf(tab)) return "unchanged";
  if (!hasUnsavedChanges(tab)) { adoptDiskText(tab, disk); return "reloaded"; }
  // Somebody saved exactly what the editor holds (or this program's own write is just arriving): nothing is lost.
  if (disk.text === textOfTab(tab).toString()) { adoptDiskText(tab, disk); return "unchanged"; }
  return noteConflict(tab, disk.text);
}
