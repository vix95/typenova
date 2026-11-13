/** Status bar items for the encoding and line endings of the active document, with menus to change how it is saved or to reopen it in another encoding. */
import { ICONS } from "../ui/icons";
import { $ } from "../app/dom";
import { view } from "../editor/editor-view";
import { ENCODINGS, LINE_ENDING_TEXT, type LineEnding, type TextEncodingName, type TextFormat } from "../filesystem/text-codec";
import { loadTextFile } from "../filesystem/text-io";
import { langText } from "../i18n/language";
import { syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { setClean, setDirty } from "./dirty-state";
import { documentState } from "./document-state";
import { updateStats } from "./document-stats";
import { activeFormat, LINE_ENDING_LABELS, updateFormatStatus } from "./format-display";
import { activeTab, configureLanguageForTab, createEditorState, loadTabIntoView, renderTabs } from "./tabs";
import { refreshDocumentMarks } from "../editor/document-marks";

let menu: HTMLDivElement | null = null;
function hideMenu(): void { if (menu) menu.hidden = true; }

type Entry = { label: string; checked?: boolean; heading?: boolean; run?: () => void };

function showMenu(anchor: HTMLElement, entries: Entry[]): void {
  if (!menu) {
    menu = document.createElement("div"); menu.className = "context-menu format-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
    document.body.append(menu);
    document.addEventListener("pointerdown", event => { if (menu && !menu.hidden && !(event.target instanceof Node && menu.contains(event.target))) hideMenu(); }, true);
    document.addEventListener("keydown", event => { if (event.key === "Escape") hideMenu(); }, true);
    window.addEventListener("blur", hideMenu);
  }
  menu.replaceChildren(...entries.map(entry => {
    if (entry.heading) { const heading = document.createElement("div"); heading.className = "context-menu-hint"; heading.textContent = entry.label; return heading; }
    const item = document.createElement("button"); item.type = "button"; item.role = "menuitemradio"; item.setAttribute("aria-checked", String(!!entry.checked));
    const mark = document.createElement("span"); mark.className = "format-menu-mark"; mark.innerHTML = entry.checked ? ICONS.check : ICONS.blank;
    const label = document.createElement("span"); label.textContent = entry.label;
    item.append(mark, label);
    item.addEventListener("click", () => { hideMenu(); entry.run?.(); });
    return item;
  }));
  menu.hidden = false; menu.style.visibility = "hidden";
  const rect = menu.getBoundingClientRect(), at = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, at.top - rect.height - 6)}px`;
  menu.style.visibility = "visible";
  (menu.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

/** Changes how the active document will be saved; the document counts as modified until it is saved. */
function setSaveFormat(patch: Partial<TextFormat>): void {
  const tab = activeTab();
  if (!tab) return;
  tab.format = { ...activeFormat(), ...patch };
  setDirty(); updateFormatStatus(); renderTabs();
}

/** Re-reads the file from disk in another encoding (unsaved changes are discarded after a confirmation). */
async function reopenWithEncoding(encoding: TextEncodingName): Promise<void> {
  const tab = activeTab(), path = documentState.currentPath;
  if (!tab || !path) return;
  if (documentState.dirty && !await appConfirm(langText("Niezapisane zmiany zostaną utracone. Otworzyć plik ponownie w innym kodowaniu?", "Unsaved changes will be lost. Reopen the file in another encoding?"), { confirmLabel: langText("Otwórz ponownie", "Reopen"), primaryAction: "cancel" })) return;
  try {
    const loaded = await loadTextFile(path, encoding);
    tab.format = loaded; tab.state = createEditorState(loaded.text); tab.savedText = loaded.text;
    loadTabIntoView(view, tab);
    refreshDocumentMarks();
    documentState.savedText = loaded.text; documentState.docRevision++;
    setClean(); updateStats(); updateFormatStatus(); renderTabs(); syncPreviewForActiveDocument(); void configureLanguageForTab(tab);
  } catch (error) { showToast(`${langText("Nie udało się otworzyć pliku", "Could not open the file")}: ${String(error)}`); }
}

function openEncodingMenu(anchor: HTMLElement): void {
  const format = activeFormat(), entries: Entry[] = [{ label: langText("Zapisuj w kodowaniu", "Save with encoding"), heading: true }];
  for (const item of ENCODINGS) entries.push({ label: item.label, checked: item.name === format.encoding, run: () => setSaveFormat({ encoding: item.name, bom: item.name.startsWith("utf-16") ? true : item.name === "utf-8" ? format.bom : false }) });
  if (format.encoding === "utf-8") entries.push({ label: langText("UTF-8 z BOM", "UTF-8 with BOM"), checked: format.bom, run: () => setSaveFormat({ bom: !format.bom }) });
  if (documentState.currentPath) {
    entries.push({ label: langText("Otwórz ponownie w kodowaniu", "Reopen with encoding"), heading: true });
    for (const item of ENCODINGS) entries.push({ label: item.label, checked: false, run: () => void reopenWithEncoding(item.name) });
  }
  showMenu(anchor, entries);
}

function openLineEndingMenu(anchor: HTMLElement): void {
  const format = activeFormat();
  showMenu(anchor, [
    { label: langText("Końce linii przy zapisie", "Line endings when saving"), heading: true },
    ...(Object.keys(LINE_ENDING_TEXT) as LineEnding[]).map(kind => ({
      label: `${LINE_ENDING_LABELS[kind]} (${kind === "lf" ? "Unix, macOS" : kind === "crlf" ? "Windows" : "Mac Classic"})`,
      checked: kind === format.lineEnding, run: () => setSaveFormat({ lineEnding: kind }),
    })),
  ]);
}

export function initFormatStatus(): void {
  $("encodingStatus").addEventListener("click", event => openEncodingMenu(event.currentTarget as HTMLElement));
  $("eolStatus").addEventListener("click", event => openLineEndingMenu(event.currentTarget as HTMLElement));
  updateFormatStatus();
}
