/** Showing a file for "go to" commands (bookmarks, highlights): switches to its tab, or opens it. */
import { BinaryFileError, loadTextFile } from "../filesystem/text-io";
import { isFilesystemScopeError } from "../project/project-tree-ops";
import { documentState } from "./document-state";
import { openTextInTab } from "./file-actions";
import { normalizeSessionPath } from "./session";
import { switchToTab } from "./tabs";

/** "shown": the file is now the open document. The other results say why it could not be opened. */
export type ShowFileResult = "shown" | "scope" | "binary" | "failed";

export async function showFileTab(path: string): Promise<ShowFileResult> {
  const key = normalizeSessionPath(path);
  const open = documentState.tabs.find(tab => tab.path && normalizeSessionPath(tab.path) === key);
  if (open) { if (open.id !== documentState.activeTabId) switchToTab(open.id); return "shown"; }
  try {
    const loaded = await loadTextFile(path);
    openTextInTab(path, loaded.text, loaded);
    return "shown";
  } catch (error) {
    if (isFilesystemScopeError(error)) return "scope";
    if (error instanceof BinaryFileError) return "binary";
    return "failed";
  }
}
