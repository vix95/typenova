/** Open, save, save-as, auto-save and recent-files handling. */
import { basename } from "../filesystem/path-utils";
import { writeRecoverySnapshot as recoveryWrite, saveDocumentVersion as saveVersion } from "./recovery-store";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { readPreferenceJson, isStringArray } from "../settings/storage";
import { $ } from "../app/dom";
import { previousSidebarTab, setSidebarTab } from "../app/sidebar";
import { setClean, setDirty, updateDirtyUi } from "./dirty-state";
import { documentState, type DocumentTab } from "./document-state";
import { updateStats } from "./document-stats";
import { activeTab, configureLanguageForTab, createEditorState, persistOpenSession, renderTabs, switchToTab } from "./tabs";
import { view } from "../editor/editor-view";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { langText } from "../i18n/language";
import { clearPreviewCache, schedulePreview, syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { isFilesystemScopeError } from "../project/project-tree-ops";
import { appAlert } from "../ui/dialogs";
import { showToast } from "../ui/toast";

export let autoSaveTimer = 0;
let autoSaveInFlight = false;
let autoSaveQueued = false;
export function markProjectTreeSelection(path: string | null) {
  const selected = path ? path.replace(/\\/g, "/").toLowerCase() : "";
  document.querySelectorAll<HTMLButtonElement>("#projectFiles .tree-file[data-file-path]").forEach(row => row.classList.toggle("active", !!selected && (row.dataset.filePath || "").replace(/\\/g, "/").toLowerCase() === selected));
}
export function openTextInTab(path: string, text: string) {
  if (graphPreviewOwnsPreview && document.body.classList.contains("graph-mode")) setSidebarTab(previousSidebarTab);
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const existing = documentState.tabs.find(tab => tab.path && tab.path.replace(/\\/g, "/").toLowerCase() === normalizedPath);
  if (existing) {
    // Re-open already-open files without replacing an unsaved in-memory version.
    switchToTab(existing.id);
  } else {
    const tab: DocumentTab = {
      id: `tab-${documentState.tabSequence++}`, path, label: basename(path),
      state: createEditorState(text), savedText: text, dirty: false
    };
    documentState.tabs.push(tab);
    switchToTab(tab.id);
  }
  documentState.currentPath = path;
  markProjectTreeSelection(path);
  const active = activeTab();
  if (active) { active.path = path; active.label = basename(path); }
  documentState.savedText = active?.savedText ?? text;
  documentState.dirty = active?.dirty ?? false;
  rememberRecentFile(path);
  updateDirtyUi();
  updateStats();
  syncPreviewForActiveDocument();
  void recoveryWrite({ text: "", path, updated: Date.now() }).catch(() => { });
  localStorage.removeItem("typenova.recoveryHandled");
  $("statusText").textContent = `${langText("Otwarto", "Opened")}: ${basename(path)}`;
  void configureLanguageForTab(activeTab()!);
  schedulePreview();
  view.focus();
}
export async function openDocument() {
  try {
    // No extension filter: this is a text editor and must open code/text files too.
    const chosen = await open({ multiple: false });
    if (typeof chosen !== "string") return;
    const text = await readTextFile(chosen);
    openTextInTab(chosen, text);
  } catch (error) { await appAlert(`${langText("Nie udało się otworzyć pliku", "Could not open file")}:\n${String(error)}`); }
}
export async function saveDocument() {
  try {
    let target = documentState.currentPath;
    if (!target) {
      const chosen = await save({ defaultPath: documentState.untitledLabel });
      if (!chosen) return;
      target = chosen;
    }
    const targetPath = target as string;
    const text = view.state.doc.toString();
    if (documentState.savedText && documentState.savedText !== text) void saveVersion(documentState.savedText, documentState.currentPath);
    const saveRevision = documentState.docRevision;
    await writeTextFile(targetPath, text);
    const pathChanged = documentState.currentPath !== targetPath;
    documentState.currentPath = targetPath;
    documentState.untitledLabel = basename(targetPath);
    rememberRecentFile(targetPath);
    documentState.savedText = text;
    const tab = activeTab();
    if (tab) { tab.path = targetPath; tab.label = basename(targetPath); tab.savedText = text; tab.state = view.state; }
    persistOpenSession();
    if (documentState.docRevision === saveRevision) setClean(); else setDirty();
    updateStats();
    syncPreviewForActiveDocument();
    if (pathChanged) { clearPreviewCache(); void configureLanguageForTab(tab!); schedulePreview(); }
    localStorage.removeItem("typenova.recoveryHandled");
    void recoveryWrite({ text: "", path: documentState.currentPath, updated: Date.now() }).catch(() => { });
    $("statusText").textContent = `${langText("Zapisano", "Saved")}: ${basename(targetPath)}`;
  } catch (error) { await appAlert(`${langText("Nie udało się zapisać pliku", "Could not save file")}:\n${String(error)}`); }
}
export function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  if ((localStorage.getItem("typenova.autoSave") || "false") !== "true") return;
  // A new document has no destination yet; recovery remains active until the first manual save.
  if (!documentState.currentPath) { $("statusText").textContent = langText("Automatyczny zapis: najpierw zapisz dokument, aby wybrać lokalizację", "Auto-save: save the document once to choose a location"); return; }
  autoSaveTimer = window.setTimeout(() => { void runAutoSave(); }, 650);
}
async function runAutoSave() {
  if ((localStorage.getItem("typenova.autoSave") || "false") !== "true" || !documentState.currentPath || !documentState.dirty) return;
  if (autoSaveInFlight) { autoSaveQueued = true; return; }
  autoSaveInFlight = true; autoSaveQueued = false;
  const path = documentState.currentPath, revision = documentState.docRevision, text = view.state.doc.toString();
  try {
    await writeTextFile(path, text);
    if (documentState.currentPath === path) { documentState.savedText = text; rememberRecentFile(path); persistOpenSession(); if (documentState.docRevision === revision) setClean(); else { setDirty(); autoSaveQueued = true; } }
    if (documentState.currentPath === path) $("statusText").textContent = `${langText("Zapisano automatycznie", "Auto-saved")}: ${basename(path)}`;
    if (documentState.docRevision === revision) void recoveryWrite({ text: "", path, updated: Date.now() }).catch(() => { });
  } catch (error) { $("statusText").textContent = langText("Błąd automatycznego zapisu", "Auto-save error"); showToast(`${langText("Automatyczny zapis nie powiódł się", "Auto-save failed")}: ${String(error)}`); }
  finally { autoSaveInFlight = false; if (autoSaveQueued) { autoSaveQueued = false; scheduleAutoSave(); } }
}
export function recentFiles(): string[] { return readPreferenceJson("typenova.recentFiles", isStringArray, []).slice(0, 8); }
export function renderRecentFiles() { const root = $("recentFiles"); if (!root) return; root.replaceChildren(); const title = document.createElement("span"); title.className = "recent-files-title"; title.textContent = langText("Ostatnie pliki", "Recent files"); root.append(title); const paths = recentFiles(); if (!paths.length) { const empty = document.createElement("span"); empty.className = "recent-empty"; empty.textContent = langText("Brak ostatnich plików", "No recent files"); root.append(empty); return; } for (const path of paths) { const b = document.createElement("button"); b.type = "button"; b.className = "recent-file-button"; b.textContent = basename(path); b.title = path; b.addEventListener("click", () => void openRecentFile(path)); root.append(b); } }
export function rememberRecentFile(path: string) { const paths = [path, ...recentFiles().filter(x => x !== path)].slice(0, 8); localStorage.setItem("typenova.recentFiles", JSON.stringify(paths)); renderRecentFiles(); }
async function openRecentFile(path: string) { try { const existing = documentState.tabs.find(tab => tab.path && tab.path.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase()); if (existing) { switchToTab(existing.id); return; } const text = await readTextFile(path); openTextInTab(path, text); } catch (error) { if (isFilesystemScopeError(error)) { showToast(langText("Dostęp do tego pliku wygasł. Otwórz go ponownie przez wybór pliku lub folderu projektu.", "Access to this file has expired. Reopen it using the file picker or project folder picker.")); return; } const paths = recentFiles().filter(x => x !== path); localStorage.setItem("typenova.recentFiles", JSON.stringify(paths)); renderRecentFiles(); showToast(`${langText("Nie można otworzyć pliku. Mógł zostać przeniesiony lub usunięty", "Could not open file. It may have been moved or deleted")}: ${String(error)}`); } }
export async function saveDocumentAs() {
  const chosen = await save({ defaultPath: documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel });
  if (!chosen) return;
  try {
    const text = view.state.doc.toString(); if (documentState.savedText && documentState.savedText !== text) void saveVersion(documentState.savedText, documentState.currentPath);
    const saveRevision = documentState.docRevision; await writeTextFile(chosen, text); const pathChanged = documentState.currentPath !== chosen;
    documentState.currentPath = chosen; documentState.untitledLabel = basename(chosen); rememberRecentFile(chosen); documentState.savedText = text;
    const tab = activeTab(); if (tab) { tab.path = chosen; tab.label = basename(chosen); tab.savedText = text; tab.state = view.state; }
    if (documentState.docRevision === saveRevision) setClean(); else setDirty(); updateStats();
    syncPreviewForActiveDocument();
    if (pathChanged) { clearPreviewCache(); if (tab) void configureLanguageForTab(tab); schedulePreview(); }
    localStorage.removeItem("typenova.recoveryHandled"); void recoveryWrite({ text: "", path: documentState.currentPath, updated: Date.now() }).catch(() => { });
    $("statusText").textContent = `${langText("Zapisano", "Saved")}: ${basename(chosen)}`; renderTabs();
  } catch (e) { await appAlert(String(e)); }
}
