/** The terminal panel under the editor: the tabs (one per terminal), the screens (one, or several side by side), and everything around them (new, rename, restart, close, split, resize, full screen). */
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { view } from "../editor/editor-view";
import { onProjectRootsChanged } from "../project/project-roots";
import { readPreferenceFlag, readPreferenceNumber, writePreferenceFlag } from "../settings/preferences";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";
import { openTerminalDialog } from "./terminal-dialog";
import { installTerminalDrag } from "./terminal-drag";
import { applySideModeLabels, restoreSideMode, setSideMode, sideModeActive } from "./terminal-side-mode";
import { closeTerminalMenu, openTerminalMenu, type MenuEntry } from "./terminal-menu";
import { paneBodyFor, renderPanes } from "./terminal-panes";
import { setupTerminalSettings } from "./terminal-settings";
import {
  activateTerminal, activeTab, closeTerminal, closeTerminals, createTerminal, defaultShellId, duplicateTerminal, loadShells, loadTerminalsOfRoots, onTerminalsChanged, refreshTerminalThemes, renameTerminal,
  hideFromSplit, restartTerminal, setTerminalHostResolver, shellProfiles, splitTerminal, startTab, tabById, terminalState, unsplitTerminals, type TerminalTab,
} from "./terminal-store";

const OPEN_KEY = "typenova.terminal.open";
const HEIGHT_KEY = "typenova.terminal.height";
const MAXIMIZED_KEY = "typenova.terminal.maximized";
const MIN_HEIGHT = 120;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const panel = (): HTMLElement => byId("terminalPanel");
export const terminalPanelVisible = (): boolean => !panel().hidden;

let height = readPreferenceNumber(HEIGHT_KEY, 280, MIN_HEIGHT, 4000);
let maximized = readPreferenceFlag(MAXIMIZED_KEY, false);
/** The panel fills the whole window (not remembered: the program always starts in the normal layout). */
let fullscreen = false;
/** The tab being renamed in place. */
let renaming: string | null = null;

function statusText(tab: TerminalTab): string {
  if (tab.status === "running") return langText("działa", "running");
  if (tab.status === "exited") return tab.exitCode ? langText(`zakończony (kod ${tab.exitCode})`, `ended (code ${tab.exitCode})`) : langText("zakończony", "ended");
  if (tab.status === "failed") return langText("nie uruchomiono", "failed to start");
  return langText("jeszcze nie uruchomiony", "not started yet");
}

function tooltipOf(tab: TerminalTab): string {
  const shell = shellProfiles().find(profile => profile.id === tab.setup.shell)?.label ?? tab.setup.shell;
  const where = tab.root ? `${tab.root}${tab.setup.cwd ? `/${tab.setup.cwd}` : ""}` : langText("bez projektu (folder domowy)", "no project (home folder)");
  return `${tab.setup.name} · ${shell || langText("domyślna powłoka", "default shell")} · ${statusText(tab)}\n${where}`;
}

// ---- Labels (every button has an icon, a tooltip and an accessible name, in both languages) ----
function labelButton(id: string, icon: keyof typeof ICONS, text: string, pressed?: boolean): void {
  const control = byId<HTMLButtonElement>(id);
  control.querySelector("svg")?.remove();
  control.insertAdjacentHTML("afterbegin", ICONS[icon]);
  control.dataset.tooltip = text;
  control.setAttribute("aria-label", text);
  if (pressed !== undefined) { control.setAttribute("aria-pressed", String(pressed)); control.classList.toggle("is-active", pressed); }
}

function applyLabels(): void {
  const visible = terminalPanelVisible();
  panel().setAttribute("aria-label", langText("Terminal", "Terminal"));
  byId("terminalTabs").setAttribute("aria-label", langText("Terminale", "Terminals"));
  labelButton("terminalNew", "plus", langText("Nowy terminal (Ctrl+Shift+`)", "New terminal (Ctrl+Shift+`)"));
  labelButton("terminalNewMenu", "chevronDown", langText("Wybierz powłokę nowego terminala", "Choose the shell of a new terminal"));
  labelButton("terminalMaximize", maximized ? "chevronDown" : "chevronUp", maximized ? langText("Zmniejsz panel terminala", "Make the terminal panel smaller") : langText("Powiększ panel terminala", "Make the terminal panel larger"), maximized);
  if (sideModeActive()) labelButton("terminalSplit", "splitDown", langText("Podziel: nowy terminal poniżej (Ctrl+Shift+6)", "Split: a new terminal below this one (Ctrl+Shift+6)"));
  else labelButton("terminalSplit", "splitRight", langText("Podziel: nowy terminal obok (Ctrl+Shift+5)", "Split: a new terminal beside this one (Ctrl+Shift+5)"));
  labelButton("terminalSideMode", "terminalSide", sideModeActive() ? langText("Wyjdź z trybu terminal + podgląd (wróć do edytora)", "Leave the terminal + preview mode (back to the editor)") : langText("Terminal po lewej, podgląd po prawej (50/50)", "Terminal on the left, preview on the right (50/50)"), sideModeActive());
  applySideModeLabels();
  labelButton("terminalSplitMenu", "chevronDown", langText("Więcej opcji podziału", "More split options"));
  labelButton("terminalFullscreen", fullscreen ? "exitFullscreen" : "fullscreen", fullscreen ? langText("Wyjdź z trybu pełnoekranowego (F11)", "Leave full screen (F11)") : langText("Terminal na cały ekran (F11)", "Terminal full screen (F11)"), fullscreen);
  labelButton("terminalHide", "close", langText("Ukryj panel terminala (terminale nadal działają)", "Hide the terminal panel (terminals keep running)"));
  labelButton("terminalToggle", "terminal", visible ? langText("Ukryj terminal (Ctrl+`)", "Hide the terminal (Ctrl+`)") : langText("Pokaż terminal (Ctrl+`)", "Show the terminal (Ctrl+`)"), visible);
  const resizer = byId("terminalResizer");
  resizer.setAttribute("aria-label", langText("Zmień wysokość terminala", "Resize the terminal"));
  resizer.dataset.tooltip = langText("Przeciągnij, aby zmienić wysokość terminala", "Drag to resize the terminal");
  byId("menuViewTerminal").setAttribute("aria-pressed", String(visible));
}

// ---- Height ----
function applyHeight(): void {
  const limit = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.75));
  const value = maximized ? limit : Math.max(MIN_HEIGHT, Math.min(limit, height));
  panel().style.setProperty("--terminal-height", `${value}px`);
  panel().classList.toggle("is-maximized", maximized);
  byId("terminalResizer").setAttribute("aria-valuenow", String(value));
}

function setupResizer(): void {
  const resizer = byId("terminalResizer");
  resizer.addEventListener("pointerdown", event => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    const startY = event.clientY, startHeight = panel().getBoundingClientRect().height;
    document.body.classList.add("resizing-terminal");
    const move = (e: PointerEvent) => { height = Math.round(startHeight + (startY - e.clientY)); maximized = false; applyHeight(); };
    const done = () => {
      resizer.removeEventListener("pointermove", move); resizer.removeEventListener("pointerup", done); resizer.removeEventListener("pointercancel", done);
      document.body.classList.remove("resizing-terminal");
      try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch { /* storage unavailable */ }
      writePreferenceFlag(MAXIMIZED_KEY, maximized);
      applyLabels();
    };
    resizer.addEventListener("pointermove", move); resizer.addEventListener("pointerup", done); resizer.addEventListener("pointercancel", done);
  });
  resizer.addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    height = Math.round(panel().getBoundingClientRect().height + (event.key === "ArrowUp" ? 24 : -24));
    maximized = false;
    applyHeight();
    try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch { /* storage unavailable */ }
  });
}

// ---- Tabs ----
function startRename(tab: TerminalTab): void {
  renaming = tab.setup.id;
  render();
  const input = byId("terminalTabs").querySelector<HTMLInputElement>("input.terminal-tab-rename");
  input?.focus(); input?.select();
}

function tabMenu(tab: TerminalTab, at: { x: number; y: number } | HTMLElement): void {
  const alive = tab.session.isAlive;
  const entries: MenuEntry[] = [
    { label: langText("Zmień nazwę", "Rename"), icon: "edit", hint: "F2", run: () => startRename(tab) },
    { label: langText("Właściwości…", "Properties…"), icon: "settings", run: () => openTerminalDialog(tab) },
    { label: langText("Pokaż obok", "Show beside"), icon: "splitRight", run: () => splitTerminal(tab.setup.id, "columns") },
    { label: langText("Pokaż poniżej", "Show below"), icon: "splitDown", run: () => splitTerminal(tab.setup.id, "rows") },
    { label: langText("Duplikuj", "Duplicate"), icon: "copy", run: () => { duplicateTerminal(tab); } },
    { label: alive ? langText("Uruchom ponownie", "Restart") : langText("Uruchom powłokę", "Start the shell"), icon: "restart", separator: true, run: () => { void (alive ? restartTerminal(tab) : startTab(tab)); } },
    { label: langText("Zakończ proces", "Stop the process"), icon: "stop", disabled: !alive, run: () => { void tab.session.stop().then(() => render()); } },
    { label: langText("Zamknij terminal", "Close the terminal"), icon: "close", separator: true, hint: "Del", run: () => { void closeTerminal(tab); } },
    { label: langText("Zamknij pozostałe", "Close the others"), icon: "close", disabled: terminalState.tabs.length < 2, run: () => { void closeTerminals(terminalState.tabs.filter(other => other !== tab)); } },
    { label: langText("Zamknij wszystkie", "Close all"), icon: "close", run: () => { void closeTerminals(terminalState.tabs); } },
  ];
  openTerminalMenu(entries, at, langText("Menu terminala", "Terminal menu"));
}

function tabElement(tab: TerminalTab, active: boolean): HTMLElement {
  const item = document.createElement("div");
  item.className = "terminal-tab";
  item.setAttribute("role", "tab");
  item.dataset.id = tab.setup.id;
  item.tabIndex = active ? 0 : -1;
  item.setAttribute("aria-selected", String(active));
  item.classList.toggle("is-active", active);
  item.setAttribute("aria-label", `${tab.setup.name}, ${statusText(tab)}`);
  item.dataset.tooltip = tooltipOf(tab);
  item.insertAdjacentHTML("beforeend", ICONS.terminal);
  const dot = document.createElement("span");
  dot.className = "terminal-status"; dot.dataset.status = tab.status; dot.setAttribute("aria-hidden", "true");
  item.append(dot);
  if (renaming === tab.setup.id) {
    const input = document.createElement("input");
    input.className = "terminal-tab-rename"; input.type = "text"; input.value = tab.setup.name; input.maxLength = 60; input.spellcheck = false;
    input.setAttribute("aria-label", langText("Nazwa terminala", "Terminal name"));
    const finish = (save: boolean) => { if (renaming !== tab.setup.id) return; renaming = null; if (save) renameTerminal(tab, input.value); render(); focusActive(); };
    input.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); finish(true); } else if (event.key === "Escape") { event.preventDefault(); finish(false); } });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", event => event.stopPropagation());
    item.append(input);
  } else {
    const name = document.createElement("span");
    name.className = "terminal-tab-name"; name.textContent = tab.setup.name;
    item.append(name);
    const close = document.createElement("button");
    close.type = "button"; close.className = "terminal-tab-close"; close.tabIndex = -1;
    close.insertAdjacentHTML("afterbegin", ICONS.close);
    const closeLabel = langText(`Zamknij terminal „${tab.setup.name}”`, `Close the terminal “${tab.setup.name}”`);
    close.dataset.tooltip = closeLabel; close.setAttribute("aria-label", closeLabel);
    close.addEventListener("click", event => { event.stopPropagation(); void closeTerminal(tab); });
    item.append(close);
  }
  return item;
}

function focusActive(): void { activeTab()?.session.focus(); }

/** Draws the tabs, shows the screen of the active terminal (starting its shell the first time) and the empty state when there is none. */
function render(): void {
  const tabs = byId("terminalTabs");
  tabs.replaceChildren(...terminalState.tabs.map(tab => tabElement(tab, tab.setup.id === terminalState.activeId)));
  for (const item of tabs.querySelectorAll<HTMLElement>(".terminal-tab")) item.classList.toggle("is-beside", terminalState.panes.length > 1 && terminalState.panes.includes(item.dataset.id ?? ""));
  // The strip scrolls when the tabs do not fit (a narrow panel): the active one is kept in view.
  tabs.querySelector<HTMLElement>(".terminal-tab.is-active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  byId("terminalToggle").dataset.count = String(terminalState.tabs.length);
  const rebuilt = renderPanes(byId("terminalBody"), byId("terminalEmpty"), { onFocus: id => { if (id !== terminalState.activeId) activateTerminal(id); }, onHide: hideFromSplit });
  const shown = new Set(terminalState.panes);
  for (const tab of terminalState.tabs) if (!shown.has(tab.setup.id)) tab.session.show(false);
  if (terminalPanelVisible()) {
    for (const id of terminalState.panes) {
      const tab = tabById(id), body = paneBodyFor(id);
      if (!tab || !body) continue;
      tab.session.show(true);
      if (rebuilt || tab.status === "idle") tab.session.mount(body);
      if (tab.status === "idle") void startTab(tab).then(() => tab.session.fitNow()); else tab.session.fitNow();
    }
  }
  applyLabels();
}

function onTabsKey(event: KeyboardEvent): void {
  const item = (event.target as HTMLElement).closest<HTMLElement>(".terminal-tab");
  const tab = item?.dataset.id ? tabById(item.dataset.id) : undefined;
  if (!item || !tab || (event.target as HTMLElement).tagName === "INPUT") return;
  const index = terminalState.tabs.indexOf(tab);
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const next = terminalState.tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + terminalState.tabs.length) % terminalState.tabs.length];
    activateTerminal(next.setup.id);
    byId("terminalTabs").querySelector<HTMLElement>(`[data-id="${next.setup.id}"]`)?.focus();
  } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateTerminal(tab.setup.id); focusActive(); }
  else if (event.key === "F2") { event.preventDefault(); startRename(tab); }
  else if (event.key === "Delete") { event.preventDefault(); void closeTerminal(tab); }
  else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) { event.preventDefault(); tabMenu(tab, item); }
}

function setupTabs(): void {
  const tabs = byId("terminalTabs");
  const tabOf = (event: Event): TerminalTab | undefined => { const id = (event.target as HTMLElement).closest<HTMLElement>(".terminal-tab")?.dataset.id; return id ? tabById(id) : undefined; };
  tabs.addEventListener("click", event => { const tab = tabOf(event); if (tab && renaming !== tab.setup.id) { activateTerminal(tab.setup.id); focusActive(); } });
  tabs.addEventListener("dblclick", event => { const tab = tabOf(event); if (tab) startRename(tab); });
  tabs.addEventListener("auxclick", event => { const tab = tabOf(event); if (tab && (event as MouseEvent).button === 1) { event.preventDefault(); void closeTerminal(tab); } });
  tabs.addEventListener("contextmenu", event => { const tab = tabOf(event); if (tab) { event.preventDefault(); tabMenu(tab, { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }); } });
  tabs.addEventListener("keydown", onTabsKey);
  // Right click on the screen: copy, paste, select all, clear.
  byId("terminalBody").addEventListener("contextmenu", event => {
    const active = activeTab();
    if (!active) return;
    event.preventDefault();
    openTerminalMenu([
      { label: langText("Kopiuj", "Copy"), icon: "copy", hint: "Ctrl+Shift+C", disabled: !active.session.hasSelection, run: () => active.session.copySelection() },
      { label: langText("Wklej", "Paste"), icon: "insertText", hint: "Ctrl+V", run: () => { active.session.pasteClipboard(); active.session.focus(); } },
      { label: langText("Zaznacz wszystko", "Select all"), icon: "check", run: () => active.session.selectAll() },
      { label: langText("Wyczyść ekran", "Clear the screen"), icon: "trash", separator: true, run: () => { active.session.clear(); active.session.focus(); } },
    ], { x: event.clientX, y: event.clientY }, langText("Menu ekranu terminala", "Terminal screen menu"));
  });
}

// ---- Actions ----
/** The shells a new terminal can use, as a menu (and the way to the dialog and the settings). */
function openNewMenu(anchor: HTMLElement): void {
  const fallback = defaultShellId();
  const shells: MenuEntry[] = shellProfiles().map(profile => ({ label: profile.label, icon: "terminal", hint: profile.id === fallback ? langText("domyślna", "default") : undefined, run: () => { createTerminal({ shell: profile.id }); showTerminalPanel(true); } }));
  openTerminalMenu([
    ...(shells.length ? shells : [{ label: langText("Nie znaleziono powłok", "No shells were found"), disabled: true }]),
    { label: langText("Nowy terminal z opcjami…", "New terminal with options…"), icon: "plus", separator: true, run: () => openTerminalDialog() },
    { label: langText("Ustawienia terminala…", "Terminal settings…"), icon: "settings", run: () => openTerminalSettings() },
  ], anchor, langText("Nowy terminal", "New terminal"));
}

/** The split options in one place: split right or down (the focused terminal is split, so a right and then a down split give a grid) and going back to one. */
function openSplitMenu(anchor: HTMLElement): void {
  const split = terminalState.panes.length > 1;
  const entries: MenuEntry[] = [
    { label: langText("Podziel w prawo", "Split right"), icon: "splitRight", hint: "Ctrl+Shift+5", run: () => splitActiveTerminal("columns") },
    { label: langText("Podziel w dół", "Split down"), icon: "splitDown", hint: "Ctrl+Shift+6", run: () => splitActiveTerminal("rows") },
  ];
  if (split) entries.push({ label: langText("Pokaż tylko aktywny terminal", "Show only the active terminal"), icon: "unsplit", separator: true, run: () => unsplitTerminals() });
  openTerminalMenu(entries, anchor, langText("Podział terminali", "Split terminals"));
}

/** Terminal on the left and the preview on the right, or back to the editor. */
export function toggleSideMode(): void {
  setSideMode(!sideModeActive(), show => showTerminalPanel(show, { focus: false }));
  applyLabels();
}

export function openTerminalSettings(): void {
  const dialog = byId<HTMLDialogElement>("terminalSettingsDialog");
  if (!dialog.open) dialog.showModal();
}

/** Opens a terminal with the default shell (the panel opens with it). */
export function newTerminal(): void {
  if (!createTerminal()) return;
  showTerminalPanel(true);
}

/** Shows or hides the panel (the terminals keep running while it is hidden). Opening it with no terminals starts one. */
export function showTerminalPanel(show: boolean, options: { createIfEmpty?: boolean; focus?: boolean } = {}): void {
  closeTerminalMenu();
  // Hiding the panel while the keyboard is in it gives the keyboard back to the editor.
  if (!show && panel().contains(document.activeElement)) view.focus();
  if (!show && fullscreen) { fullscreen = false; panel().classList.remove("is-fullscreen"); document.body.classList.remove("terminal-fullscreen"); }
  // Hiding the panel ends the mode that put it beside the preview.
  if (!show && sideModeActive()) setSideMode(false, () => undefined);
  panel().hidden = !show;
  writePreferenceFlag(OPEN_KEY, show);
  document.body.classList.toggle("terminal-open", show);
  if (show) {
    applyHeight();
    if (!terminalState.tabs.length && options.createIfEmpty !== false) createTerminal(); else render();
    if (options.focus !== false) window.setTimeout(focusActive, 30);
  }
  applyLabels();
}

/** Makes the panel fill the whole window, or brings it back. */
export function toggleTerminalFullscreen(): void {
  if (panel().hidden) showTerminalPanel(true);
  fullscreen = !fullscreen;
  panel().classList.toggle("is-fullscreen", fullscreen);
  document.body.classList.toggle("terminal-fullscreen", fullscreen);
  applyLabels();
  window.setTimeout(() => { for (const id of terminalState.panes) tabById(id)?.session.fitNow(); focusActive(); }, 30);
}

export function splitActiveTerminal(orientation?: "columns" | "rows"): void { showTerminalPanel(true, { createIfEmpty: false, focus: false }); splitTerminal(undefined, orientation); }

/** The shortcut for the panel hides it; from full screen it first returns to the normal size. */
export const toggleTerminalPanel = (): void => { if (fullscreen) toggleTerminalFullscreen(); else showTerminalPanel(panel().hidden); };

export function renameActiveTerminal(): void {
  const tab = activeTab();
  if (!tab) { showToast(langText("Nie ma otwartego terminala.", "No terminal is open.")); return; }
  showTerminalPanel(true, { focus: false });
  startRename(tab);
}

export function restartActiveTerminal(): void { const tab = activeTab(); if (tab) void restartTerminal(tab); }
export function closeActiveTerminal(): void { const tab = activeTab(); if (tab) void closeTerminal(tab); }

/** Wires the panel, the status bar button, the shortcuts and the saved terminals of the open project folders. */
export function initTerminals(): void {
  setTerminalHostResolver(paneBodyFor);
  installTerminalDrag();
  byId("terminalNew").addEventListener("click", newTerminal);
  byId("terminalNewMenu").addEventListener("click", event => openNewMenu(event.currentTarget as HTMLElement));
  byId("terminalMaximize").addEventListener("click", () => { maximized = !maximized; writePreferenceFlag(MAXIMIZED_KEY, maximized); applyHeight(); applyLabels(); });
  byId("terminalHide").addEventListener("click", () => showTerminalPanel(false));
  byId("terminalSplit").addEventListener("click", () => splitActiveTerminal(sideModeActive() ? "rows" : "columns"));
  byId("terminalSideMode").addEventListener("click", toggleSideMode);
  byId("menuViewTerminalSide").addEventListener("click", toggleSideMode);
  byId("terminalSplitMenu").addEventListener("click", event => openSplitMenu(event.currentTarget as HTMLElement));
  byId("terminalFullscreen").addEventListener("click", toggleTerminalFullscreen);
  byId("terminalToggle").addEventListener("click", toggleTerminalPanel);
  byId("menuViewTerminal").addEventListener("click", toggleTerminalPanel);
  byId("terminalEmptyNew").addEventListener("click", newTerminal);
  setupResizer();
  setupTabs();
  setupTerminalSettings();
  document.addEventListener("keydown", event => {
    const inPanel = !!(event.target as HTMLElement | null)?.closest?.("#terminalPanel");
    if (event.key === "F11" && inPanel) { event.preventDefault(); toggleTerminalFullscreen(); return; }
    // Escape leaves full screen from the tabs and buttons; inside a screen it belongs to the shell.
    if (event.key === "Escape" && fullscreen && inPanel && !(event.target as HTMLElement).closest(".terminal-pane-body")) { event.preventDefault(); toggleTerminalFullscreen(); return; }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === "Digit5") { event.preventDefault(); event.stopPropagation(); splitActiveTerminal("columns"); return; }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === "Digit6") { event.preventDefault(); event.stopPropagation(); splitActiveTerminal("rows"); return; }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.key !== "`" && event.code !== "Backquote")) return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey) newTerminal(); else toggleTerminalPanel();
  }, true);
  document.addEventListener("typenova:language-changed", () => render());
  window.addEventListener("resize", applyHeight);
  new MutationObserver(refreshTerminalThemes).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  onTerminalsChanged(render);
  onProjectRootsChanged(loadTerminalsOfRoots);
  loadTerminalsOfRoots(documentState.projectRoots);
  applyHeight();
  applyLabels();
  void loadShells().then(() => {
    if (readPreferenceFlag(OPEN_KEY, false)) showTerminalPanel(true, { createIfEmpty: false, focus: false });
    restoreSideMode(show => showTerminalPanel(show, { focus: false }));
    applyLabels();
  });
}
