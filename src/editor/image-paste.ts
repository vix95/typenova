/** Ctrl+V with an image on the clipboard: choose a description and a file inside the open project, save the image and insert its Markdown reference at the caret. */
import { writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { documentState } from "../documents/document-state";
import { rootContaining } from "../filesystem/project-roots";
import { langText } from "../i18n/language";
import { refreshProjectTree } from "../project/project-tree-sync";
import { showToast } from "../ui/toast";
import { view } from "./editor-view";
import { encodeMarkdownImagePath, parentDirectoryPath, relativeImagePath } from "./image-insert";
import { askImagePasteDestination } from "./image-paste-dialog";

const LAST_FOLDER_KEY = "typenova.imagePaste.lastFolder";
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg", "image/avif": "avif", "image/tiff": "tiff" };

/** The pasted image, or null when the clipboard has no image or has text as well (text is what the user wants then). */
function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data || data.getData("text/plain").trim()) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) { const file = item.getAsFile(); if (file) return file; }
  }
  return null;
}

function timestampName(extension: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const now = new Date();
  return `image-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${extension}`;
}

/** The folder offered first: the one used last time, else the folder of the current document, else the first project folder. */
function startFolder(roots: readonly string[], documentPath: string): string {
  const remembered = localStorage.getItem(LAST_FOLDER_KEY);
  if (remembered && rootContaining(roots, remembered)) return remembered;
  const own = parentDirectoryPath(documentPath);
  return rootContaining(roots, own) ? own : roots[0];
}

async function handlePastedImage(file: File): Promise<void> {
  const roots = documentState.projectRoots;
  const documentPath = documentState.currentPath;
  if (!roots.length) { showToast(langText("Otwórz folder projektu, aby wkleić obraz.", "Open a project folder to paste an image.")); return; }
  if (!documentPath) { showToast(langText("Najpierw zapisz dokument, aby wkleić obraz.", "Save the document first to paste an image.")); return; }
  const extension = EXTENSIONS[file.type] ?? "png";
  const { from, to } = view.state.selection.main;
  const choice = await askImagePasteDestination({ image: file, extension, roots, startFolder: startFolder(roots, documentPath), suggestedName: timestampName(extension) });
  if (!choice) { view.focus(); return; }
  try {
    const savedPath = await join(choice.folder, choice.fileName);
    await writeFile(savedPath, new Uint8Array(await file.arrayBuffer()));
    const alt = choice.alt || choice.fileName.replace(/\.[^.]+$/, "");
    const markdown = `![${alt}](<${encodeMarkdownImagePath(relativeImagePath(documentPath, savedPath))}>)`;
    const position = Math.min(from, view.state.doc.length), end = Math.min(to, view.state.doc.length);
    view.dispatch({ changes: { from: position, to: end, insert: markdown }, selection: { anchor: position + markdown.length }, scrollIntoView: true });
    localStorage.setItem(LAST_FOLDER_KEY, choice.folder);
    showToast(`${langText("Zapisano obraz", "Saved image")}: ${choice.fileName}`);
    void refreshProjectTree();
  } catch (error) {
    showToast(`${langText("Nie udało się zapisać obrazu", "Could not save the image")}: ${String(error)}`);
  }
  view.focus();
}

export function initImagePaste(): void {
  // In the capture phase so it runs before the editor's own paste handling.
  view.contentDOM.addEventListener("paste", event => {
    const file = imageFromClipboard(event.clipboardData);
    if (!file) return;
    event.preventDefault(); event.stopPropagation();
    void handlePastedImage(file);
  }, true);
}
