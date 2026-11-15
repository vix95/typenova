/** A view of the left panel that lists only the open documents (the strip above the editor, as a list): a click shows one, the cross closes it. A button next to the other views of the panel switches to it and back. */
import { $ } from "../app/dom";
import { activeSidebarTab, setSidebarTab, showSidebar } from "../app/sidebar";
import { outlineState } from "../outline/outline";
import { iconForPath } from "../documents/dirty-state";
import { documentState, type DocumentTab } from "../documents/document-state";
import { closeTab, switchToTab } from "../documents/tabs";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";

/** The folder a document lives in, shown under its name so that two files with the same name can be told apart. */
function folderOf(path: string | null): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function row(tab: DocumentTab): HTMLElement {
  const active = tab.id === documentState.activeTabId;
  const dirty = active ? documentState.dirty : tab.dirty;
  const item = document.createElement("div");
  item.className = `open-document${active ? " active" : ""}${dirty ? " dirty" : ""}`;
  item.dataset.tabId = tab.id;
  const main = document.createElement("button");
  main.type = "button";
  main.className = "open-document-main";
  main.dataset.openDocument = tab.id;
  main.title = tab.path || tab.label;
  main.setAttribute("aria-current", String(active));
  const mark = document.createElement("span");
  mark.className = "tab-mark";
  mark.textContent = iconForPath(tab.path || tab.label);
  const name = document.createElement("span");
  name.className = "open-document-name";
  name.textContent = tab.path ? basename(tab.path) : tab.label;
  const folder = document.createElement("span");
  folder.className = "open-document-folder";
  folder.textContent = folderOf(tab.path);
  const dot = document.createElement("span");
  dot.className = "tab-dirty-mark";
  dot.hidden = !dirty;
  dot.setAttribute("aria-hidden", "true");
  main.setAttribute("aria-label", `${name.textContent}${dirty ? ` — ${langText("niezapisane zmiany", "unsaved changes")}` : ""}`);
  main.append(mark, name, folder, dot);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "open-document-close";
  close.dataset.closeDocument = tab.id;
  const closeLabel = `${langText("Zamknij kartę", "Close tab")}: ${name.textContent}`;
  close.dataset.tooltip = closeLabel;
  close.setAttribute("aria-label", closeLabel);
  close.innerHTML = ICONS.close;
  item.append(main, close);
  return item;
}

function render(): void {
  const host = $("openDocumentsList");
  if ($("openDocumentsView").hidden) return;
  $("openDocumentsCount").textContent = String(documentState.tabs.length);
  host.replaceChildren(...documentState.tabs.map(row));
}

function labels(): void {
  const shown = activeSidebarTab === "open";
  const button = $("sidebarOpenTab");
  const label = shown ? langText("Wróć do plików projektu", "Back to the project files") : langText("Karty: pokaż tylko otwarte dokumenty", "Tabs: show only the open documents");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

export function installOpenDocumentsView(): void {
  document.addEventListener("typenova:sidebar-tab-changed", () => { labels(); render(); });
  $("sidebarOpenTab").addEventListener("click", () => {
    if (!outlineState.outlineVisible) showSidebar();
    setSidebarTab(activeSidebarTab === "open" ? "files" : "open");
  });
  $("openDocumentsList").addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const close = target?.closest<HTMLElement>("[data-close-document]");
    if (close) { void closeTab(close.dataset.closeDocument || ""); return; }
    const open = target?.closest<HTMLElement>("[data-open-document]");
    if (open) switchToTab(open.dataset.openDocument || "");
  });
  document.addEventListener("typenova:tabs-rendered", render);
  document.addEventListener("typenova:language-changed", () => { labels(); render(); });
  labels();
}
