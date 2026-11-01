/** Dialog for a pasted image: description, file name and a small explorer limited to the open project folders. */
import { exists, mkdir, readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { slugifyForFileName } from "../filesystem/file-names";
import { basename } from "../filesystem/path-utils";
import { isProjectRoot, rootContaining } from "../filesystem/project-roots";
import { normalizedFsPath, pathIsInside } from "../filesystem/project-tree-operations";
import { langText } from "../i18n/language";
import { appConfirm } from "../ui/dialogs";

export interface ImagePasteRequest {
  image: Blob;
  extension: string;
  roots: readonly string[];
  /** Folder that is selected when the dialog opens (inside one of the roots). */
  startFolder: string;
  suggestedName: string;
}

export interface ImagePasteChoice { folder: string; fileName: string; alt: string }

const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 3.5 4.5 4.5-4.5 4.5"/></svg>';
const FOLDER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 4.25a1.25 1.25 0 0 1 1.25-1.25h3l1.5 1.5h5a1.25 1.25 0 0 1 1.25 1.25v5.75A1.25 1.25 0 0 1 12.5 12.75h-9.5a1.25 1.25 0 0 1-1.25-1.25z"/></svg>';
const IMAGE_FILE = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Message for a file name that cannot be used, or null when it is fine. */
export function fileNameProblem(name: string): string | null {
  if (!name.trim()) return langText("Podaj nazwę pliku.", "Enter a file name.");
  if (INVALID_NAME.test(name) || name.endsWith(".") || name.endsWith(" ")) return langText("Nazwa zawiera niedozwolone znaki.", "The name contains characters that are not allowed.");
  if (RESERVED_NAME.test(name)) return langText("Ta nazwa jest zarezerwowana przez system.", "This name is reserved by the system.");
  return null;
}

type Tree = { host: HTMLElement; select(path: string): void; reveal(path: string): Promise<void>; reload(path: string): Promise<void> };

function folderRow(name: string, path: string, depth: number): { row: HTMLButtonElement; disclosure: HTMLElement } {
  const row = document.createElement("button");
  row.type = "button"; row.className = "image-paste-row"; row.setAttribute("role", "treeitem");
  row.setAttribute("aria-expanded", "false"); row.setAttribute("aria-selected", "false"); row.tabIndex = -1;
  row.dataset.path = path; row.style.paddingLeft = `${8 + depth * 16}px`; row.title = path;
  const disclosure = document.createElement("span"); disclosure.className = "image-paste-disclosure"; disclosure.innerHTML = CHEVRON;
  const icon = document.createElement("span"); icon.className = "image-paste-icon"; icon.innerHTML = FOLDER;
  const label = document.createElement("span"); label.className = "image-paste-label"; label.textContent = name;
  row.append(disclosure, icon, label);
  return { row, disclosure };
}

/** Lists a folder: sub-folders (selectable) first, then the image files already there (shown muted, for orientation). */
async function listFolder(path: string): Promise<{ folders: string[]; images: string[] } | null> {
  try {
    const entries = await readDir(path);
    const collator = new Intl.Collator(document.documentElement.lang || "pl", { sensitivity: "base", numeric: true });
    return {
      folders: entries.filter(entry => entry.isDirectory).map(entry => entry.name).sort(collator.compare),
      images: entries.filter(entry => !entry.isDirectory && IMAGE_FILE.test(entry.name)).map(entry => entry.name).sort(collator.compare),
    };
  } catch { return null; }
}

function createFolderTree(roots: readonly string[], onSelect: (path: string) => void): Tree {
  const host = document.createElement("div");
  host.className = "image-paste-tree"; host.setAttribute("role", "tree");
  host.setAttribute("aria-label", langText("Foldery projektu", "Project folders"));
  const loaded = new Set<string>();
  let selected: HTMLElement | null = null;

  const rows = () => Array.from(host.querySelectorAll<HTMLElement>(".image-paste-row")).filter(row => !row.closest("[hidden]"));
  const select = (row: HTMLElement) => {
    selected?.setAttribute("aria-selected", "false"); if (selected) selected.tabIndex = -1;
    selected = row; row.setAttribute("aria-selected", "true"); row.tabIndex = 0;
    row.scrollIntoView({ block: "nearest" });
    onSelect(row.dataset.path || "");
  };
  const children = (row: HTMLElement) => row.nextElementSibling as HTMLElement;

  async function expand(row: HTMLElement, depth: number): Promise<void> {
    const container = children(row), path = row.dataset.path || "";
    if (!loaded.has(path)) {
      loaded.add(path);
      const listing = await listFolder(path);
      if (!listing) { const note = document.createElement("div"); note.className = "image-paste-note"; note.textContent = langText("Nie można odczytać folderu.", "Cannot read this folder."); container.append(note); }
      else {
        for (const name of listing.folders) addFolder(container, name, await join(path, name), depth + 1);
        for (const name of listing.images) { const file = document.createElement("div"); file.className = "image-paste-file"; file.style.paddingLeft = `${8 + (depth + 1) * 16 + 20}px`; file.textContent = name; container.append(file); }
      }
    }
    container.hidden = false; row.setAttribute("aria-expanded", "true");
  }
  const collapse = (row: HTMLElement) => { children(row).hidden = true; row.setAttribute("aria-expanded", "false"); };
  const toggle = (row: HTMLElement, depth: number) => (row.getAttribute("aria-expanded") === "true" ? Promise.resolve(collapse(row)) : expand(row, depth));

  function addFolder(parent: HTMLElement, name: string, path: string, depth: number) {
    const { row, disclosure } = folderRow(name, path, depth);
    const container = document.createElement("div"); container.setAttribute("role", "group"); container.hidden = true;
    parent.append(row, container);
    row.addEventListener("click", event => { select(row); if (event.target instanceof Element && disclosure.contains(event.target)) void toggle(row, depth); });
    row.addEventListener("dblclick", () => void toggle(row, depth));
    row.dataset.depth = String(depth);
  }

  host.addEventListener("keydown", event => {
    const row = (event.target as Element).closest<HTMLElement>(".image-paste-row"); if (!row) return;
    const list = rows(), index = list.indexOf(row), depth = Number(row.dataset.depth || 0);
    const go = (target: HTMLElement | undefined) => { if (target) { event.preventDefault(); target.focus(); select(target); } };
    if (event.key === "ArrowDown") go(list[index + 1]);
    else if (event.key === "ArrowUp") go(list[index - 1]);
    else if (event.key === "Home") go(list[0]);
    else if (event.key === "End") go(list[list.length - 1]);
    else if (event.key === "ArrowRight") { event.preventDefault(); if (row.getAttribute("aria-expanded") === "true") go(list[index + 1]); else void expand(row, depth); }
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.getAttribute("aria-expanded") === "true") collapse(row);
      else go(list.slice(0, index).reverse().find(candidate => Number(candidate.dataset.depth || 0) < depth));
    }
  });

  roots.forEach(root => addFolder(host, basename(root) || root, root, 0));

  return {
    host,
    async reload(path) {
      const row = Array.from(host.querySelectorAll<HTMLElement>(".image-paste-row")).find(candidate => normalizedFsPath(candidate.dataset.path || "") === normalizedFsPath(path));
      if (!row) return;
      loaded.delete(row.dataset.path || "");
      children(row).replaceChildren();
      await expand(row, Number(row.dataset.depth || 0));
    },
    select: path => { const row = Array.from(host.querySelectorAll<HTMLElement>(".image-paste-row")).find(candidate => normalizedFsPath(candidate.dataset.path || "") === normalizedFsPath(path)); if (row) select(row); },
    async reveal(target) {
      // Open every folder on the way from the project folder down to the target, then select it.
      let row = Array.from(host.querySelectorAll<HTMLElement>(":scope > .image-paste-row")).find(candidate => isProjectRoot([candidate.dataset.path || ""], target) || pathIsInside(candidate.dataset.path || "", target));
      while (row) {
        await expand(row, Number(row.dataset.depth || 0));
        if (normalizedFsPath(row.dataset.path || "") === normalizedFsPath(target)) break;
        const next: HTMLElement | undefined = Array.from(children(row).querySelectorAll<HTMLElement>(":scope > .image-paste-row")).find(candidate => pathIsInside(candidate.dataset.path || "", target));
        if (!next) break;
        row = next;
      }
      if (row) select(row);
    },
  };
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement("label"); wrapper.className = "image-paste-field";
  const text = document.createElement("span"); text.textContent = label;
  wrapper.append(text, control); return wrapper;
}

/** Keeps the file name in step with the description until the name is edited by hand. */
function followDescription(alt: HTMLInputElement, name: HTMLInputElement, request: ImagePasteRequest, onChange: () => void): void {
  let manual = false;
  name.addEventListener("input", () => { manual = true; });
  alt.addEventListener("input", () => {
    if (manual) return;
    const stem = slugifyForFileName(alt.value);
    name.value = stem ? `${stem}.${request.extension}` : request.suggestedName;
    onChange();
  });
}

/** Shows the dialog and resolves with the user's choice, or null when it is cancelled. */
export function askImagePasteDestination(request: ImagePasteRequest): Promise<ImagePasteChoice | null> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "image-paste-dialog"; dialog.setAttribute("aria-labelledby", "imagePasteTitle");
    const content = document.createElement("div"); content.className = "dialog-content image-paste-content";
    const title = document.createElement("div"); title.className = "dialog-title"; title.id = "imagePasteTitle";
    title.textContent = langText("Wklej obraz ze schowka", "Paste image from the clipboard");

    const previewUrl = URL.createObjectURL(request.image);
    const preview = document.createElement("img"); preview.className = "image-paste-preview"; preview.src = previewUrl; preview.alt = "";
    const alt = document.createElement("input"); alt.type = "text"; alt.className = "image-paste-input"; alt.placeholder = langText("np. Schemat architektury", "e.g. Architecture diagram");
    const name = document.createElement("input"); name.type = "text"; name.className = "image-paste-input"; name.value = request.suggestedName; name.spellcheck = false;
    const target = document.createElement("div"); target.className = "image-paste-target";
    const error = document.createElement("div"); error.className = "image-paste-error"; error.setAttribute("role", "alert"); error.hidden = true;

    followDescription(alt, name, request, () => { error.hidden = true; });

    let folder = request.startFolder;
    const tree = createFolderTree(request.roots, path => { folder = path; target.textContent = path; target.title = path; });
    const treeBox = document.createElement("div"); treeBox.className = "image-paste-treebox";
    const treeLabel = document.createElement("div"); treeLabel.className = "image-paste-sub"; treeLabel.textContent = langText("Folder docelowy w projekcie", "Destination folder in the project");
    const newFolderButton = document.createElement("button"); newFolderButton.type = "button"; newFolderButton.className = "image-paste-newfolder";
    newFolderButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 4.25a1.25 1.25 0 0 1 1.25-1.25h3l1.5 1.5h5a1.25 1.25 0 0 1 1.25 1.25v5.75A1.25 1.25 0 0 1 12.5 12.75h-9.5a1.25 1.25 0 0 1-1.25-1.25z"/><path d="M8 6.5v4M6 8.5h4"/></svg>';
    const newFolderLabel = document.createElement("span"); newFolderLabel.textContent = langText("Nowy folder", "New folder"); newFolderButton.append(newFolderLabel);
    const header = document.createElement("div"); header.className = "image-paste-treehead"; header.append(treeLabel, newFolderButton);
    const folderForm = document.createElement("div"); folderForm.className = "image-paste-folderform"; folderForm.hidden = true;
    const folderName = document.createElement("input"); folderName.type = "text"; folderName.className = "image-paste-input"; folderName.spellcheck = false;
    folderName.placeholder = langText("Nazwa nowego folderu", "New folder name"); folderName.setAttribute("aria-label", folderName.placeholder);
    const folderCreate = document.createElement("button"); folderCreate.type = "button"; folderCreate.textContent = langText("Utwórz", "Create");
    folderForm.append(folderName, folderCreate);
    treeBox.append(header, folderForm, tree.host);
    const side = document.createElement("div"); side.className = "image-paste-side";
    side.append(preview, field(langText("Opis (tekst alternatywny)", "Description (alt text)"), alt), field(langText("Nazwa pliku", "File name"), name), target, error);
    const columns = document.createElement("div"); columns.className = "image-paste-columns"; columns.append(treeBox, side);

    const actions = document.createElement("div"); actions.className = "dialog-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = langText("Anuluj", "Cancel");
    const insert = document.createElement("button"); insert.type = "button"; insert.className = "primary"; insert.textContent = langText("Wstaw", "Insert");
    actions.append(cancel, insert);
    content.append(title, columns, actions); dialog.append(content); document.body.append(dialog);

    const closeFolderForm = () => { folderForm.hidden = true; folderName.value = ""; newFolderButton.setAttribute("aria-expanded", "false"); };
    const createFolder = async () => {
      error.hidden = true;
      const name = folderName.value.trim();
      const problem = fileNameProblem(name);
      if (problem) { showError(problem); folderName.focus(); return; }
      if (!rootContaining(request.roots, folder)) { showError(langText("Wybierz folder w otwartym projekcie.", "Choose a folder inside the open project.")); return; }
      try {
        const created = await join(folder, name);
        if (await exists(created)) { showError(langText("Folder o tej nazwie już istnieje.", "A folder with this name already exists.")); folderName.focus(); return; }
        await mkdir(created);
        await tree.reload(folder);
        tree.select(created);
        closeFolderForm();
      } catch (cause) { showError(`${langText("Nie udało się utworzyć folderu", "Could not create the folder")}: ${String(cause)}`); }
    };
    newFolderButton.setAttribute("aria-expanded", "false");
    newFolderButton.addEventListener("click", () => {
      const opening = folderForm.hidden;
      if (!opening) { closeFolderForm(); return; }
      folderForm.hidden = false; newFolderButton.setAttribute("aria-expanded", "true"); folderName.focus();
    });
    folderCreate.addEventListener("click", () => void createFolder());
    folderName.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void createFolder(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFolderForm(); newFolderButton.focus(); }
    });

    let settled = false;
    const finish = (choice: ImagePasteChoice | null) => {
      if (settled) return; settled = true;
      URL.revokeObjectURL(previewUrl); dialog.close(); dialog.remove(); resolve(choice);
    };
    const showError = (message: string) => { error.textContent = message; error.hidden = false; };
    const confirm = async () => {
      error.hidden = true;
      const trimmed = name.value.trim();
      const fileName = /\.[A-Za-z0-9]+$/.test(trimmed) ? trimmed : `${trimmed}.${request.extension}`;
      const problem = fileNameProblem(fileName);
      if (problem) { showError(problem); name.focus(); return; }
      if (!rootContaining(request.roots, folder)) { showError(langText("Wybierz folder w otwartym projekcie.", "Choose a folder inside the open project.")); return; }
      if (await exists(await join(folder, fileName))) {
        const replace = await appConfirm(langText(`Plik „${fileName}” już istnieje w tym folderze. Zastąpić go?`, `A file named “${fileName}” already exists in this folder. Replace it?`), { confirmLabel: langText("Zastąp", "Replace"), primaryAction: "cancel" });
        if (!replace) { name.focus(); name.select(); return; }
      }
      finish({ folder, fileName, alt: alt.value.replace(/[\[\]\\\r\n]/g, " ").trim() });
    };
    cancel.addEventListener("click", () => finish(null));
    insert.addEventListener("click", () => void confirm());
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("keydown", event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target !== folderName) { event.preventDefault(); void confirm(); } });

    dialog.showModal();
    void tree.reveal(request.startFolder).then(() => alt.focus());
  });
}
