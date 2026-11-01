/** Inserting references to local images (relative or absolute path resolution). */
import { basename } from "../filesystem/path-utils";
import { open } from "@tauri-apps/plugin-dialog";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { insertAtCursor } from "./editing-commands";
import { langText } from "../i18n/language";
import { appAlert } from "../ui/dialogs";
import { showToast } from "../ui/toast";

export function parentDirectoryPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  if (slash === 2 && /^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}
type ParsedLocalPath = { root: string; parts: string[]; caseInsensitive: boolean };
function parseLocalPath(path: string): ParsedLocalPath {
  const normalized = path.replace(/\\/g, "/");
  const unc = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (unc) return { root: `//${unc[1]}/${unc[2]}`.toLowerCase(), parts: (unc[3] || "").split("/").filter(Boolean), caseInsensitive: true };
  const drive = normalized.match(/^([A-Za-z]):(?:\/(.*))?$/);
  if (drive) return { root: `${drive[1].toLowerCase()}:`, parts: (drive[2] || "").split("/").filter(Boolean), caseInsensitive: true };
  if (normalized.startsWith("/")) return { root: "/", parts: normalized.slice(1).split("/").filter(Boolean), caseInsensitive: false };
  return { root: "", parts: normalized.split("/").filter(Boolean), caseInsensitive: false };
}
export function relativeImagePath(documentPath: string, imagePath: string): string {
  const from = parseLocalPath(parentDirectoryPath(documentPath));
  const to = parseLocalPath(imagePath);
  if (from.root !== to.root) return imagePath.replace(/\\/g, "/");
  let common = 0;
  while (common < from.parts.length && common < to.parts.length) {
    const a = from.parts[common]; const b = to.parts[common];
    if (from.caseInsensitive ? a.toLowerCase() !== b.toLowerCase() : a !== b) break;
    common++;
  }
  const relative = [...Array(from.parts.length - common).fill(".."), ...to.parts.slice(common)].join("/");
  return relative || basename(imagePath);
}
export function encodeMarkdownImagePath(path: string): string {
  return path.split("/").map((part, index) => {
    if (!part || part === "." || part === ".." || (index === 0 && /^[A-Za-z]:$/.test(part))) return part;
    return encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }).join("/");
}
async function insertImageReference() {
  if (!documentState.currentPath) {
    showToast(langText("Najpierw zapisz dokument, aby wstawić odwołanie do grafiki.", "Save the document first to insert an image reference."));
    return;
  }
  const defaultPath = parentDirectoryPath(documentState.currentPath);
  try {
    const chosen = await open({
      multiple: false,
      defaultPath,
      filters: [{ name: langText("Pliki graficzne", "Image files"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff"] }]
    });
    if (typeof chosen !== "string" || !chosen) return;
    const fileName = basename(chosen);
    const alt = fileName.replace(/\.[^.]+$/, "").replace(/[\[\]\\\r\n]/g, " ").trim() || langText("Obraz", "Image");
    const destination = encodeMarkdownImagePath(relativeImagePath(documentState.currentPath, chosen));
    insertAtCursor(`![${alt}](<${destination}>)`);
    $("statusText").textContent = langText(`Dodano odwołanie do grafiki: ${fileName}`, `Inserted image reference: ${fileName}`);
  } catch (err) {
    await appAlert(langText(`Nie udało się wstawić odwołania do grafiki.\n${String(err)}`, `Could not insert the image reference.\n${String(err)}`));
  }
}

export function initImageInsert(): void {
  $("insertImage").addEventListener("click", () => void insertImageReference());
}
