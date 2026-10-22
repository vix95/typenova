/** Startup session restore, crash-recovery prompt and version history. */
import { listDocumentVersions, writeRecoverySnapshot as recoveryWrite, readRecoverySnapshot as recoveryRead } from "./recovery-store";
import { basename } from "../filesystem/path-utils";
import { parseOpenSession, deduplicateSessionPaths, sameSessionPath } from "./session";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { $ } from "../app/dom";
import { updateDirtyUi } from "./dirty-state";
import { OPEN_SESSION_STORAGE_KEY, documentState, showWelcomeWhenNoSession, type DocumentTab } from "./document-state";
import { updateQuickStats, updateStats } from "./document-stats";
import { recentFiles, rememberRecentFile } from "./file-actions";
import { startText } from "./start-text";
import { activeTab, configureLanguageForTab, createEditorState, createNewTab, persistOpenSession, renderTabs, switchToTab } from "./tabs";
import { performanceCompartment } from "../editor/compartments";
import { performanceExtensions } from "../editor/editor-extensions";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { updateHeadingBreadcrumbs } from "../outline/breadcrumbs";
import { clearPreviewCache, schedulePreview, syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";

export async function showVersionHistory() { const dialog = $("historyDialog") as HTMLDialogElement; const list = $("historyList"); list.replaceChildren(); const en = document.documentElement.lang === "en"; try { const items = await listDocumentVersions(); if (!items.length) { list.textContent = langText("Brak zapisanych wersji. Historia tworzy się przy zapisywaniu kolejnych wersji dokumentu.", "No saved versions yet. History is created as you save subsequent document versions."); } for (const item of items) { const row = document.createElement("div"); row.className = "history-row"; const label = document.createElement("span"); label.textContent = `${item.path ? basename(item.path) : langText("Dokument", "Document")} · ${new Date(item.updated).toLocaleString(en ? "en-US" : "pl-PL")} · ${(new TextEncoder().encode(item.text).length / 1024).toFixed(1)} KB`; const restore = document.createElement("button"); restore.textContent = langText("Przywróć", "Restore"); restore.addEventListener("click", async () => { if (documentState.dirty && !await appConfirm(langText("Zastąpić bieżącą treść wersją historyczną?", "Replace the current content with this historical version?"), { confirmLabel: langText("Zastąp", "Replace"), primaryAction: "cancel" })) return; const path = item.path || null; const recoveredLabel = path ? basename(path) : langText("Odzyskana wersja.md", "Recovered version.md"); createNewTab(item.text, recoveredLabel); documentState.currentPath = path; const tab = activeTab(); if (tab) { tab.path = path; tab.label = recoveredLabel; tab.savedText = ""; tab.dirty = true; } documentState.savedText = ""; documentState.dirty = true; updateDirtyUi(); schedulePreview(); dialog.close(); }); row.append(label, restore); list.append(row); } } catch (e) { list.textContent = `${langText("Nie udało się odczytać historii", "Could not read version history")}: ${String(e)}`; } dialog.showModal(); }
let recoveryTimer = 0;
export function scheduleRecovery() { clearTimeout(recoveryTimer); recoveryTimer = window.setTimeout(() => { if (!documentState.dirty) { localStorage.removeItem("typenova.recoveryHandled"); void recoveryWrite({ text: "", path: documentState.currentPath, updated: Date.now() }).catch(() => { }); return; } void recoveryWrite({ text: view.state.doc.toString(), path: documentState.currentPath, updated: Date.now() }).catch(() => { }); }, 1200); }
type SessionFileResult = { path: string; text: string; error: unknown };

/** Paths to reopen and the tab to activate, derived from the saved session (or the most recent file on first run). */
function resolveSessionCandidates(): { paths: string[]; activePath: string | null } {
  const rawSession = localStorage.getItem(OPEN_SESSION_STORAGE_KEY);
  const savedSession = parseOpenSession(rawSession);
  if (rawSession && !savedSession) localStorage.removeItem(OPEN_SESSION_STORAGE_KEY);
  const sessionWasMissing = rawSession === null;
  const candidates = savedSession?.paths.length
    ? savedSession.paths
    : sessionWasMissing ? recentFiles().slice(0, 1) : [];
  const activePath = savedSession?.activePath ?? (sessionWasMissing ? (recentFiles()[0] || null) : null);
  return { paths: deduplicateSessionPaths(candidates), activePath };
}

async function readSessionFiles(paths: readonly string[]): Promise<SessionFileResult[]> {
  return Promise.all(paths.map(async (path): Promise<SessionFileResult> => {
    try { return { path, text: await readTextFile(path), error: null }; }
    catch (error) { return { path, text: "", error }; }
  }));
}

/** Makes `tab` the document shown in the editor and mirrors its state into the shared document state. */
function activateRestoredTab(tab: DocumentTab): void {
  documentState.activeTabId = tab.id;
  documentState.currentPath = tab.path;
  documentState.untitledLabel = tab.label;
  documentState.savedText = tab.savedText;
  documentState.dirty = false;
  view.setState(tab.state);
  documentState.performanceMode = tab.state.doc.length >= 1_000_000;
  view.dispatch({ effects: [performanceCompartment.reconfigure(performanceExtensions(tab.state.doc.length))] });
}

/** Refreshes every panel after the open documents were replaced during startup. */
function refreshAfterSessionRestore(active: DocumentTab): void {
  documentState.startupSessionReady = true;
  renderTabs();
  clearPreviewCache();
  updateHeadingBreadcrumbs();
  updateDirtyUi();
  updateStats();
  updateQuickStats();
  syncPreviewForActiveDocument();
  void configureLanguageForTab(active);
  schedulePreview();
}

/**
 * No file-backed tabs were open, or none could be reopened. Startup stays a single
 * unsaved document; Welcome is shown only when explicitly enabled in Settings.
 */
function restoreStarterDocument(failedCount: number): void {
  const label = showWelcomeWhenNoSession ? "Welcome.md" : "Untitled.md";
  const text = showWelcomeWhenNoSession ? startText : "";
  const starter = documentState.tabs[0];
  if (starter) {
    starter.path = null;
    starter.label = label;
    starter.state = createEditorState(text);
    starter.savedText = text;
    starter.dirty = false;
    documentState.tabs = [starter];
    activateRestoredTab(starter);
  }
  refreshAfterSessionRestore(activeTab()!);
  if (failedCount) showToast(langText(
    `Nie udało się przywrócić ${failedCount} wcześniej otwart${failedCount === 1 ? "ego pliku" : "ych plików"}. Otworzono ${label}.`,
    `Could not restore ${failedCount} previously open file(s). Opened ${label} instead.`
  ));
}

/** Polish plural of "plik" for the given count. */
function polishFileNoun(count: number): string {
  if (count === 1) return "plik";
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "pliki" : "plików";
}

function restoreFileTabs(restored: readonly { path: string; text: string }[], activePath: string | null, failedCount: number): void {
  // Reuse the initial tab ID for the first restored document and replace the startup
  // placeholder so no extra Welcome.md / Untitled.md appears beside restored files.
  const starter = documentState.tabs[0];
  const restoredTabs: DocumentTab[] = restored.map((entry, index) => {
    const tab = index === 0 && starter ? starter : null;
    return {
      id: tab?.id || `tab-${documentState.tabSequence++}`,
      path: entry.path,
      label: basename(entry.path),
      state: createEditorState(entry.text),
      savedText: entry.text,
      dirty: false
    };
  });
  documentState.tabs = restoredTabs;
  const selected = restoredTabs.find(tab => activePath && sameSessionPath(tab.path, activePath)) || restoredTabs[0];
  activateRestoredTab(selected);
  for (const tab of restoredTabs) {
    if (tab.path) rememberRecentFile(tab.path);
  }
  refreshAfterSessionRestore(selected);
  if (failedCount) {
    const count = restoredTabs.length;
    showToast(langText(
      `Przywrócono ${count} ${polishFileNoun(count)}; ${failedCount} nie udało się otworzyć.`,
      `Restored ${count} file(s); ${failedCount} could not be opened.`
    ));
  }
}

export async function restoreOpenSessionAtStartup(): Promise<void> {
  const { paths, activePath } = resolveSessionCandidates();
  const results = await readSessionFiles(paths);
  const restored = results.filter((item): item is SessionFileResult & { error: null } => item.error === null);
  const failedCount = results.length - restored.length;
  if (!restored.length) restoreStarterDocument(failedCount);
  else restoreFileTabs(restored, activePath, failedCount);
}
export async function offerRecovery() {
  try {
    const recovery = await recoveryRead();
    if (!recovery?.text || recovery.text === documentState.savedText) return;
    const signature = `${recovery.path || ""}:${recovery.updated}:${recovery.text.length}`;
    if (localStorage.getItem("typenova.recoveryHandled") === signature) return;
    const english = document.documentElement.lang === "en";
    const recoveredAt = new Date(recovery.updated).toLocaleString(english ? "en-US" : "pl-PL");
    const message = english
      ? `A recovery copy${recovery.path ? ` for ${basename(recovery.path)}` : ""} from ${recoveredAt} was found. Restore it?`
      : `Znaleziono kopię roboczą${recovery.path ? ` dla pliku ${basename(recovery.path)}` : ""} z ${recoveredAt}. Odzyskać dokument?`;
    const recover = await appConfirm(message, { confirmLabel: langText("Odzyskaj", "Restore") });
    localStorage.setItem("typenova.recoveryHandled", signature);
    if (recover) {
      const path = recovery.path || null;
      const recoveredLabel = path ? basename(path) : langText("Odzyskany dokument.md", "Recovered document.md");
      const normalizedRecoveryPath = path ? path.replace(/\\/g, "/").toLowerCase() : "";
      const matchingTab = normalizedRecoveryPath
        ? documentState.tabs.find(tab => tab.path && tab.path.replace(/\\/g, "/").toLowerCase() === normalizedRecoveryPath)
        : undefined;
      let tab: DocumentTab | undefined;
      if (matchingTab) {
        // Restore into the existing tab for this file instead of creating duplicate tabs
        // with the same path after startup session restoration.
        switchToTab(matchingTab.id);
        tab = matchingTab;
        tab.state = createEditorState(recovery.text);
        view.setState(tab.state);
      } else if (documentState.tabs.length === 1 && !documentState.tabs[0].path && !documentState.tabs[0].dirty) {
        // Reuse the clean startup placeholder so recovery does not leave an extra
        // Untitled.md tab next to the recovered document.
        tab = documentState.tabs[0];
        tab.state = createEditorState(recovery.text);
        view.setState(tab.state);
      } else {
        tab = createNewTab(recovery.text, recoveredLabel);
      }
      documentState.activeTabId = tab.id;
      documentState.currentPath = path;
      documentState.untitledLabel = recoveredLabel;
      documentState.savedText = "";
      documentState.dirty = true;
      tab.path = path;
      tab.label = recoveredLabel;
      tab.savedText = "";
      tab.dirty = true;
      tab.state = view.state;
      documentState.performanceMode = view.state.doc.length >= 1_000_000;
      view.dispatch({ effects: [performanceCompartment.reconfigure(performanceExtensions(view.state.doc.length))] });
      clearPreviewCache();
      updateHeadingBreadcrumbs();
      updateStats();
      updateQuickStats();
      updateDirtyUi();
      renderTabs();
      persistOpenSession();
      void configureLanguageForTab(tab);
      syncPreviewForActiveDocument();
      schedulePreview();
    } else {
      void recoveryWrite({ text: "", path: recovery.path || null, updated: Date.now() }).catch(() => { });
    }
  } catch { /* Recovery is best-effort and must never prevent startup. */ }
}
