/** Files and folders dragged from the system file explorer onto the window: files open in tabs, folders join the project tree. */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readDir } from "@tauri-apps/plugin-fs";
import { BinaryFileError, loadTextFile, type LoadedText } from "../filesystem/text-io";
import { openTextInTab } from "../documents/file-actions";
import { basename, isEditableTextFile, isViewerFile } from "../filesystem/path-utils";
import { openViewerFile } from "../preview/open-media";
import { langText } from "../i18n/language";
import { addProjectFolderPath } from "../project/project-tree-view";
import { showToast } from "../ui/toast";

let overlay: HTMLElement | null = null;

function showOverlay(): void {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "file-drop-overlay"; overlay.setAttribute("aria-hidden", "true");
    document.body.append(overlay);
  }
  overlay.textContent = langText("Upuść pliki, aby je otworzyć (foldery trafią do drzewa projektu)", "Drop files to open them (folders are added to the project tree)");
  overlay.hidden = false;
}

function hideOverlay(): void { if (overlay) overlay.hidden = true; }

async function isDirectory(path: string): Promise<boolean> {
  try { await readDir(path); return true; } catch { return false; }
}

/** The fs plugin adds dropped paths to its scope when the drop reaches the backend; reading may race with that, so retry once. */
async function readTextFileAfterGrant(path: string): Promise<LoadedText> {
  try { return await loadTextFile(path); }
  catch (error) { if (error instanceof BinaryFileError) throw error; await new Promise(resolve => window.setTimeout(resolve, 200)); return loadTextFile(path); }
}

/** Opens the dropped files in tabs (the last one becomes active) and adds dropped folders to the tree. */
export async function openDroppedPaths(paths: readonly string[]): Promise<void> {
  let opened = 0, unsupported = 0, failed = 0, folders = 0;
  for (const path of paths) {
    if (await isDirectory(path)) { await addProjectFolderPath(path); folders++; continue; }
    if (isViewerFile(basename(path))) { await openViewerFile(path); opened++; continue; }
    if (!isEditableTextFile(basename(path))) { unsupported++; continue; }
    try { const loaded = await readTextFileAfterGrant(path); openTextInTab(path, loaded.text, loaded); opened++; }
    catch (error) { if (error instanceof BinaryFileError) unsupported++; else failed++; }
  }
  const parts: string[] = [];
  if (opened) parts.push(langText(`Otwarto plików: ${opened}`, `Opened files: ${opened}`));
  if (folders) parts.push(langText(`Dodano folderów: ${folders}`, `Added folders: ${folders}`));
  if (unsupported) parts.push(langText(`Nieobsługiwane pliki: ${unsupported}`, `Unsupported files: ${unsupported}`));
  if (failed) parts.push(langText(`Nie udało się odczytać: ${failed}`, `Could not read: ${failed}`));
  if (parts.length && (unsupported || failed || folders)) showToast(parts.join(" · "));
}

export function initExternalDrop(): void {
  try {
    void getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") { showOverlay(); return; }
      hideOverlay();
      if (payload.type === "drop" && payload.paths.length) void openDroppedPaths(payload.paths);
    }).catch(() => { /* drag and drop events are unavailable outside the desktop app */ });
  } catch { /* no desktop webview (plain browser) */ }
}
