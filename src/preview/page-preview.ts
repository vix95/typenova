/** Page preview for HTML files: the saved page is shown in a sandboxed frame, served so that the style sheets, scripts and images it links to load. */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { $ } from "../app/dom";
import { onDirtyUiUpdate } from "../documents/dirty-state";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { saveDocument } from "../documents/file-actions";
import { rootContaining } from "../filesystem/project-roots";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";

/** Scripts of a previewed page run only after the user turns them on, and only in a frame without access to the app. */
let scriptsEnabled = false;
let shownKey = "", loadToken = 0, version = 0;
let root: HTMLElement | null = null, frame: HTMLIFrameElement, notice: HTMLElement, runButton: HTMLButtonElement, saveButton: HTMLButtonElement;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const iconButton = (className: string, icon: string, onClick: () => void) => {
  const node = el("button", className); node.type = "button"; node.innerHTML = icon; node.addEventListener("click", onClick); return node;
};

export const pagePreviewActive = (): boolean => documentMode(documentState.currentPath || documentState.untitledLabel) === "page";

/** Loads the saved page from the `tnpage` scheme, which resolves its relative links (CSS, scripts, images) inside the project folder. */
async function loadFrame(path: string): Promise<void> {
  const token = ++loadToken;
  let urlPath: string;
  try { urlPath = await invoke<string>("open_page", { path, root: rootContaining(documentState.projectRoots, path) }); } catch { return; }
  if (token !== loadToken) return;
  frame.setAttribute("sandbox", scriptsEnabled ? "allow-scripts" : "");
  // `convertFileSrc` would encode the slashes of the path; only the scheme's base URL is taken from it.
  frame.src = `${convertFileSrc("", "tnpage")}${urlPath}?v=${++version}`;
}

function updateNotice(): void {
  const path = documentState.currentPath;
  const hasScripts = /<script\b/i.test(documentState.savedText);
  let text = "";
  if (!path) text = langText("Zapisz plik, aby zobaczyć podgląd strony.", "Save the file to see the page preview.");
  else if (documentState.dirty) text = langText("Podgląd pokazuje zapisaną wersję pliku. Zapisz zmiany, aby go odświeżyć.", "The preview shows the saved version of the file. Save your changes to refresh it.");
  else if (hasScripts && !scriptsEnabled) text = langText("Skrypty strony są wyłączone. Włącz je przyciskiem uruchamiania.", "Page scripts are off. Turn them on with the run button.");
  notice.textContent = text; notice.hidden = !text;
  saveButton.hidden = !path || !documentState.dirty;
  runButton.setAttribute("aria-pressed", String(scriptsEnabled)); runButton.classList.toggle("selected", scriptsEnabled);
  const runLabel = scriptsEnabled ? langText("Wyłącz skrypty strony", "Turn page scripts off") : langText("Uruchom skrypty strony (w izolowanej ramce)", "Run page scripts (in an isolated frame)");
  runButton.title = runLabel; runButton.setAttribute("aria-label", runLabel);
  const saveLabel = langText("Zapisz plik", "Save file"); saveButton.title = saveLabel; saveButton.setAttribute("aria-label", saveLabel);
}

/** Shows or hides the page frame for the active document and reloads it when the saved file changed (or when `force` is set). */
export function refreshPagePreview(force = false): void {
  if (!root) return;
  const active = pagePreviewActive();
  $("previewPane").classList.toggle("page-mode", active);
  root.hidden = !active;
  if (!active) { shownKey = ""; loadToken++; frame.removeAttribute("src"); return; }
  updateNotice();
  const path = documentState.currentPath;
  if (!path) { shownKey = ""; frame.removeAttribute("src"); return; }
  const key = `${path}\n${documentState.savedText}\n${scriptsEnabled}`;
  if (!force && key === shownKey) return;
  shownKey = key;
  void loadFrame(path);
}

export function initPagePreview(): void {
  root = el("section", "page-preview"); root.hidden = true;
  const bar = el("div", "page-preview-bar");
  notice = el("span", "page-preview-notice"); notice.setAttribute("role", "status");
  runButton = iconButton("page-preview-tool", ICONS.play, () => { scriptsEnabled = !scriptsEnabled; refreshPagePreview(true); });
  saveButton = iconButton("page-preview-tool", ICONS.save, () => { void saveDocument(); });
  bar.append(notice, runButton, saveButton);
  frame = el("iframe", "page-preview-frame"); frame.title = langText("Podgląd strony", "Page preview");
  frame.setAttribute("sandbox", ""); frame.referrerPolicy = "no-referrer";
  root.append(bar, frame);
  $("preview").after(root);
  onDirtyUiUpdate(() => refreshPagePreview(false));
}
