/** Open documents and Git: before another branch is switched to, documents with unsaved changes inside the repository are a reason to stop (the other branch's files would be written over them); after it, the open documents that did not change are read again from disk, so that none shows (or saves) the text of the branch that was left. */
import { documentState } from "../documents/document-state";
import { textOfTab } from "../documents/link-rename-apply";
import { groupsState } from "../documents/groups-state";
import { hasUnsavedChanges, isActiveTab } from "../documents/open-documents";
import { createEditorState, loadStateIntoView, showTab } from "../documents/tabs";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { loadTextFile } from "../filesystem/text-io";

export const insideRepo = (repo: string, path: string): boolean => normalizedFsPath(path).startsWith(`${normalizedFsPath(repo).replace(/\/+$/, "")}/`);

const tabsInside = (repo: string) => documentState.tabs.filter(tab => tab.path && insideRepo(repo, tab.path));

/** Names of the open documents of the repository that have changes not saved to disk. */
export function unsavedDocumentsInside(repo: string): string[] { return tabsInside(repo).filter(hasUnsavedChanges).map(tab => tab.label); }

export interface ReloadResult { reloaded: number; /** Documents whose file is not there any more (on this branch). */ missing: string[] }

/** Reads the open documents of the repository again from disk when their text differs. Unsaved ones are never touched. */
export async function reloadOpenDocumentsInside(repo: string): Promise<ReloadResult> {
  const result: ReloadResult = { reloaded: 0, missing: [] };
  for (const tab of tabsInside(repo)) {
    if (hasUnsavedChanges(tab)) continue;
    let loaded;
    try { loaded = await loadTextFile(tab.path!); } catch { result.missing.push(tab.label); continue; }
    if (loaded.text === textOfTab(tab).toString()) continue;
    tab.state = createEditorState(loaded.text);
    tab.savedText = loaded.text;
    tab.format = loaded;
    tab.dirty = false;
    const shownIn = groupsState.groups.find(group => group.view && group.activeTabId === tab.id);
    if (isActiveTab(tab)) showTab(tab, true);
    else if (shownIn?.view) loadStateIntoView(shownIn.view, tab);
    result.reloaded++;
  }
  return result;
}
