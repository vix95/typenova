/** Project tree context menu and its file operations (open, new file, delete, copy, cut, paste). */
import { normalizedFsPath, pathIsInside, parentPath } from "../filesystem/project-tree-operations";
import { basename, isEditableTextFile, isViewableImageFile } from "../filesystem/path-utils";
import { openImageFile } from "../preview/media-viewer";
import { exists, mkdir, rename, writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { askForName } from "../ui/name-dialog";
import { fileNameProblem } from "../editor/image-paste-dialog";
import { join } from "@tauri-apps/api/path";
import { $ } from "../app/dom";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { openTextInTab } from "../documents/file-actions";
import { activeTab, createNewTab, renderTabs, switchToTab } from "../documents/tabs";
import { view } from "../editor/editor-view";
import { buildGraph } from "../graph-ui/indexing";
import { langText } from "../i18n/language";
import { isFilesystemScopeError, markTreeClipboardState, performTreeMoveOrCopy, performTreeRename, projectTreeController, projectTreeState, setTreeClipboard } from "./project-tree-ops";
import { openProject, removeProjectFolder, renderProjectTree } from "./project-tree-view";
import { isOpenProjectRoot, projectRootFor } from "./project-roots";
import { refreshProjectTree } from "./project-tree-sync";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";

export function treeContextMenuElement() {
  let menu = document.getElementById("treeContextMenu") as HTMLDivElement | null;
  if (menu) return menu;
  menu = document.createElement("div"); menu.id = "treeContextMenu"; menu.className = "context-menu tree-context-menu"; menu.hidden = true; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", langText("Operacje na plikach", "File operations"));
  document.body.append(menu);
  return menu;
}
export function showTreeContextMenu(event: MouseEvent, row: HTMLElement | null, isRoot = false) {
  event.preventDefault(); event.stopPropagation();
  const menu = treeContextMenuElement();
  // A top-level folder of a multi-folder tree is a normal directory row flagged as a project root.
  const rootRow = row?.dataset.projectRoot === "true";
  isRoot = isRoot || rootRow;
  // Blank area of a tree with several folders: no single folder is meant, so the menu only offers the refresh.
  const refreshOnly = !row && isRoot && documentState.projectRoots.length > 1;
  const path = refreshOnly ? "" : (row?.dataset.filePath || (isRoot ? (documentState.projectRoot || "") : ""));
  const isDirectory = isRoot || row?.dataset.entryType === "directory";
  if (!path && !refreshOnly) return;
  projectTreeState.contextTarget = path ? { path, isDirectory, isRoot } : null;
  menu.replaceChildren();
  const add = (label: string, action: string, opts: { disabled?: boolean; danger?: boolean; shortcut?: string } = {}) => {
    const b = document.createElement("button"); b.type = "button"; b.role = "menuitem"; b.dataset.treeContext = action; b.textContent = label; b.disabled = !!opts.disabled; if (opts.danger) b.classList.add("danger-action"); if (action === "delete") b.dataset.tooltipDisabled = "true";
    if (opts.shortcut) { const k = document.createElement("kbd"); k.textContent = opts.shortcut; b.append(k); }
    menu.append(b); return b;
  };
  if (!refreshOnly) {
    if (!isRoot) add(langText("Otwórz", "Open"), "open");
    add(langText("Nowy plik…", "New file…"), "new-file");
  add(langText("Nowy folder…", "New folder…"), "new-folder");
    {
      const hr = document.createElement("hr"); menu.append(hr);
    }
    if (!isRoot) {
      add(langText("Kopiuj", "Copy"), "copy", { shortcut: "Ctrl+C" });
      add(langText("Wytnij", "Cut"), "cut", { shortcut: "Ctrl+X" });
      add(langText("Duplikuj", "Duplicate"), "duplicate");
      add(langText("Zmień nazwę…", "Rename…"), "rename", { shortcut: "F2" });
      const hr = document.createElement("hr"); menu.append(hr);
    }
    add(langText("Wklej", "Paste"), "paste", { disabled: !projectTreeState.clipboard, shortcut: "Ctrl+V" });
    if (!isRoot) { const hr = document.createElement("hr"); menu.append(hr); add(langText("Usuń", "Delete"), "delete", { danger: true, shortcut: "Delete" }); }
    if (rootRow) { const hr = document.createElement("hr"); menu.append(hr); add(langText("Usuń folder z drzewa", "Remove folder from tree"), "remove-root"); }
    { const hr = document.createElement("hr"); menu.append(hr); add(langText("Pokaż w eksploratorze", "Show in file explorer"), "reveal"); }
  }
  { if (!refreshOnly) { const hr = document.createElement("hr"); menu.append(hr); } add(langText("Odśwież", "Refresh"), "refresh", { shortcut: "F5" }); }
  menu.hidden = false; menu.style.visibility = "hidden"; menu.style.left = "0px"; menu.style.top = "0px";
  requestAnimationFrame(() => {
    const rect = menu!.getBoundingClientRect();
    menu!.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
    menu!.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
    menu!.style.visibility = "visible";
    (menu!.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  });
}
async function deleteProjectEntry(path: string, isDirectory: boolean) {
  if (!documentState.projectRoots.length || !path || isOpenProjectRoot(path)) return;
  const active = activeTab();
  if (active) { active.state = view.state; active.path = documentState.currentPath; active.savedText = documentState.savedText; active.dirty = documentState.dirty; active.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; }
  const affected = documentState.tabs.filter(tab => !!tab.path && (normalizedFsPath(tab.path) === normalizedFsPath(path) || (isDirectory && pathIsInside(path, tab.path))));
  const unsaved = affected.filter(tab => tab.id === documentState.activeTabId ? documentState.dirty : tab.dirty);
  const itemName = basename(path);
  const itemDescription = isDirectory ? langText("folder wraz z całą zawartością", "folder and all of its contents") : langText("plik", "file");
  const warning = unsaved.length ? `

${langText(`Zamknięte zostaną też otwarte dokumenty (${unsaved.length}) z niezapisanymi zmianami.`, `This will also close ${unsaved.length} open document(s) with unsaved changes.`)}` : "";
  if (!await appConfirm(langText(`Czy na pewno usunąć ${itemDescription} „${itemName}”? Tej operacji nie można cofnąć.`, `Delete ${itemDescription} “${itemName}”? This action cannot be undone.`) + warning, { confirmLabel: langText("Usuń", "Delete"), primaryAction: "cancel" })) return;
  const activeIndex = documentState.tabs.findIndex(tab => tab.id === documentState.activeTabId);
  await projectTreeController.remove(path, isDirectory);
  const affectedIds = new Set(affected.map(tab => tab.id));
  documentState.tabs = documentState.tabs.filter(tab => !affectedIds.has(tab.id));
  if (affectedIds.has(documentState.activeTabId)) {
    documentState.activeTabId = "";
    if (documentState.tabs.length) switchToTab(documentState.tabs[Math.min(Math.max(0, activeIndex), documentState.tabs.length - 1)].id);
    else createNewTab("", "Untitled.md");
  } else renderTabs();
  await renderProjectTree(); markTreeClipboardState();
  if (activeSidebarTab === "brain") void buildGraph();
  showToast(`${langText("Usunięto", "Deleted")}: ${itemName}`);
}
/** Asks for a name and creates a folder inside `directoryPath` (which must be inside an open project folder). */
/** Asks for a new name and renames the entry; a Markdown file takes its hidden-sections config file along. */
async function promptAndRenameProjectEntry(path: string, isDirectory: boolean): Promise<void> {
  const current = basename(path);
  const name = await askForName({
    title: langText("Zmień nazwę", "Rename"),
    label: langText(`Nowa nazwa dla „${current}”`, `New name for “${current}”`),
    initialValue: current,
    confirmLabel: langText("Zmień", "Rename"),
    validate: async candidate => {
      const problem = fileNameProblem(candidate);
      if (problem) return problem;
      if (candidate === current) return null;
      const target = await join(parentPath(path), candidate);
      const caseOnly = candidate.toLowerCase() === current.toLowerCase();
      return !caseOnly && await exists(target) ? langText("Element o tej nazwie już istnieje.", "An item with this name already exists.") : null;
    },
  });
  if (!name || name === current) return;
  const oldConfig = `${path}.config.json`;
  const hadConfig = !isDirectory && await exists(oldConfig);
  const renamed = await performTreeRename(path, name);
  if (hadConfig) { try { await rename(oldConfig, `${renamed}.config.json`); } catch { /* the sidecar stays under the old name */ } }
}

async function promptAndCreateProjectFolder(directoryPath: string): Promise<void> {
  if (!directoryPath || !projectRootFor(directoryPath)) {
    showToast(langText("Folder docelowy musi znajdować się w otwartym projekcie.", "The destination folder must be inside the open project."));
    return;
  }
  const name = await askForName({
    title: langText("Nowy folder", "New folder"),
    label: langText(`Nazwa folderu w „${basename(directoryPath)}”`, `Folder name in “${basename(directoryPath)}”`),
    validate: async candidate => fileNameProblem(candidate) ?? (await exists(await join(directoryPath, candidate)) ? langText("Element o tej nazwie już istnieje.", "An item with this name already exists.") : null),
  });
  if (!name) return;
  const created = await join(directoryPath, name);
  if (!projectRootFor(created)) throw new Error(langText("Ścieżka folderu wychodzi poza projekt.", "The folder path escapes the project folder."));
  await mkdir(created);
  projectTreeState.expandedFolders.add(directoryPath);
  await refreshProjectTree();
  showToast(`${langText("Utworzono folder", "Created folder")}: ${name}`);
}
async function promptAndCreateProjectFile(directoryPath: string): Promise<string | null> {
  if (!directoryPath || !projectRootFor(directoryPath)) {
    showToast(langText("Folder docelowy musi znajdować się w otwartym projekcie.", "The destination folder must be inside the open project."));
    return null;
  }
  const dialog = $("newProjectFileDialog") as HTMLDialogElement;
  const form = $("newProjectFileForm") as HTMLFormElement;
  const input = $("newProjectFileName") as HTMLInputElement;
  const location = $("newProjectFileLocation") as HTMLElement;
  const errorMessage = $("newProjectFileError") as HTMLElement;
  const cancel = $("newProjectFileCancel") as HTMLButtonElement;
  const createButton = $("newProjectFileCreate") as HTMLButtonElement;
  input.value = "Untitled.md";
  input.removeAttribute("aria-invalid");
  errorMessage.hidden = true;
  errorMessage.textContent = "";
  location.textContent = `${langText("Folder docelowy:", "Destination folder:")} ${directoryPath}`;
  createButton.disabled = false;
  let createdPath: string | null = null;

  return await new Promise<string | null>(resolve => {
    let busy = false;
    const showValidation = (message: string) => {
      errorMessage.textContent = message;
      errorMessage.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus(); input.select();
    };
    const cleanup = () => {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
    };
    const onClose = () => { cleanup(); resolve(createdPath); };
    const onCancel = () => dialog.close("cancel");
    const onSubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      if (busy) return;
      const name = input.value.trim();
      const invalidWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);
      if (!name || name === "." || name === ".." || name.length > 255 || /[<>:"\/\\|?*\u0000-\u001f]/.test(name) || /[ .]$/.test(name) || invalidWindowsName) {
        showValidation(langText("Podaj prawidłową nazwę pliku. Nie używaj separatorów ścieżki ani znaków <> : \" / \\ | ? *. ", "Enter a valid filename. Do not use path separators or the characters <> : \" / \\ | ? *. "));
        return;
      }
      if (!isEditableTextFile(name)) {
        showValidation(langText("Podaj rozszerzenie pliku tekstowego obsługiwane przez TypeNova (np. .md, .txt, .ts).", "Use a text-file extension supported by TypeNova (for example .md, .txt, .ts)."));
        return;
      }
      busy = true; createButton.disabled = true; input.removeAttribute("aria-invalid"); errorMessage.hidden = true;
      try {
        if (!projectRootFor(directoryPath)) throw new Error(langText("Folder docelowy znajduje się poza projektem.", "The destination folder is outside the project."));
        if (!await exists(directoryPath)) throw new Error(langText("Folder docelowy już nie istnieje.", "The destination folder no longer exists."));
        const candidate = await join(directoryPath, name);
        if (!projectRootFor(candidate)) throw new Error(langText("Ścieżka pliku wychodzi poza projekt.", "The file path escapes the project folder."));
        if (await exists(candidate)) {
          showValidation(langText("Plik o tej nazwie już istnieje. Wybierz inną nazwę.", "A file with that name already exists. Choose another name."));
          return;
        }
        await writeTextFile(candidate, "");
        createdPath = candidate;
        dialog.close("created");
      } catch (cause) {
        const message = isFilesystemScopeError(cause)
          ? langText("Brak dostępu do folderu projektu. Otwórz folder projektu ponownie, aby przywrócić uprawnienia.", "Project folder access is unavailable. Reopen the project folder to restore permissions.")
          : `${langText("Nie udało się utworzyć pliku", "Could not create file")}: ${String(cause)}`;
        showValidation(message);
      } finally {
        busy = false;
        if (dialog.open) createButton.disabled = false;
      }
    };
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
export async function openProjectTreeEntry(path: string, isDirectory: boolean) {
  if (isDirectory) {
    const row = Array.from(document.querySelectorAll<HTMLElement>("#projectFiles .tree-entry"))
      .find(candidate => normalizedFsPath(candidate.dataset.filePath || "") === normalizedFsPath(path));
    if (!row) { showToast(langText("Nie znaleziono folderu w drzewie projektu.", "Could not find the folder in the project tree.")); return; }
    const child = row.nextElementSibling as HTMLElement | null;
    // Opening a folder means ensuring it is expanded; do not collapse an already-open folder.
    if (child?.hidden) row.click();
    row.focus({ preventScroll: true });
    return;
  }
  if (isViewableImageFile(basename(path))) { await openImageFile(path); return; }
  if (!isEditableTextFile(basename(path))) {
    showToast(langText("TypeNova nie może otworzyć tego pliku.", "TypeNova cannot open this file."));
    return;
  }
  try {
    const text = await readTextFile(path);
    openTextInTab(path, text);
  } catch (error) {
    if (isFilesystemScopeError(error)) {
      await appAlert(langText("TypeNova nie ma aktualnego dostępu do folderu projektu. Wybierz folder projektu ponownie, aby przywrócić dostęp.", "TypeNova no longer has access to the project folder. Choose the project folder again to restore access."));
      await openProject();
    } else {
      await appAlert(`${langText("Nie udało się otworzyć pliku", "Could not open file")}: ${String(error)}`);
    }
  }
}
export async function handleTreeContextAction(action: string) {
  const target = projectTreeState.contextTarget;
  const menu = treeContextMenuElement(); menu.hidden = true;
  if (action === "refresh") { await refreshProjectTree(); return; }
  if (!target) return;
  const { path, isDirectory, isRoot } = target;
  const destinationFolder = isRoot ? path : (isDirectory ? path : parentPath(path));
  try {
    if (action === "remove-root") await removeProjectFolder(path);
    else if (action === "open" && !isRoot) await openProjectTreeEntry(path, isDirectory);
    else if (action === "new-file") {
      const createdPath = await promptAndCreateProjectFile(destinationFolder);
      if (!createdPath) return;
      projectTreeState.expandedFolders.add(destinationFolder);
      try { await renderProjectTree(); }
      catch (error) { showToast(`${langText("Plik utworzono, ale nie udało się odświeżyć drzewa", "File created, but the project tree could not refresh")}: ${String(error)}`); }
      openTextInTab(createdPath, "");
      if (activeSidebarTab === "brain") void buildGraph();
      showToast(`${langText("Utworzono plik", "Created file")}: ${basename(createdPath)}`);
    }
    else if (action === "new-folder") await promptAndCreateProjectFolder(destinationFolder);
    else if (action === "copy" || action === "cut") setTreeClipboard(path, action, isDirectory);
    else if (action === "duplicate") await performTreeMoveOrCopy(path, parentPath(path), "copy", isDirectory, true);
    else if (action === "delete" && !isRoot) await deleteProjectEntry(path, isDirectory);
    else if (action === "rename" && !isRoot) await promptAndRenameProjectEntry(path, isDirectory);
    else if (action === "reveal") await revealItemInDir(path);
    else if (action === "paste" && projectTreeState.clipboard) {
      const clipboard = { ...projectTreeState.clipboard };
      await performTreeMoveOrCopy(clipboard.path, destinationFolder, clipboard.operation, clipboard.isDirectory, false);
      if (clipboard.operation === "cut") projectTreeController.clearClipboard();
      markTreeClipboardState();
    }
  } catch (error) {
    const raw = String(error);
    const friendly = isFilesystemScopeError(error)
      ? langText("Brak dostępu do folderu. Wybierz ponownie folder projektu, aby przywrócić uprawnienia.", "Folder access is no longer available. Choose the project folder again to restore permissions.")
      : raw.includes("already exists") || raw.includes("już istnieje")
        ? langText("Element o tej nazwie już istnieje.", "An item with this name already exists.")
        : raw.includes("descendants") || raw.includes("podfolderu")
          ? langText("Nie można przenieść folderu do jego własnego podfolderu.", "A folder cannot be moved into one of its descendants.")
          : `${langText("Nie udało się wykonać operacji na pliku", "File operation failed")}: ${raw}`;
    showToast(friendly);
  }
}
