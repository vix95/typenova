/** The terminals of the program: the list, the shells they can use, the settings, what is saved in the project config and what the user trusts to run. No DOM (the panel draws it). */
import { documentState } from "../documents/document-state";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { projectRootFor } from "../project/project-roots";
import { ProjectConfigUnreadable, readProjectConfig, updateProjectConfig } from "../project/project-config";
import { readPreferenceFlag, readPreferenceNumber, writePreferenceFlag } from "../settings/preferences";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { listShells } from "./terminal-backend";
import {
  absoluteFolder, activeTerminalOfConfig, cleanName, commandHash, leaves, MAX_PANES, MAX_TERMINALS, newTerminalId, normalizeLayout, paneOf, parseCustomProfiles, parseLayout, pickProfile, removeLeaf, replaceLeaf, splitLayout, startupCommands, terminalsOfConfig, uniqueName, untrustedCommands, withTerminals,
  type Layout, type ShellProfile, type SplitDir, type TerminalSetup,
} from "./terminal-model";
import { TerminalSession } from "./terminal-session";

const FONT_KEY = "typenova.terminal.fontSize";
const SAVE_KEY = "typenova.terminal.saveToProject";
const DEFAULT_SHELL_KEY = "typenova.terminal.defaultShell";
const CUSTOM_SHELLS_KEY = "typenova.terminal.customShells";
const TRUST_KEY = "typenova.terminal.trust";
const LAYOUT_KEY = "typenova.terminal.layout";
const SAVE_DELAY_MS = 500;

export type TerminalStatus = "idle" | "running" | "exited" | "failed";

export interface TerminalTab {
  setup: TerminalSetup;
  /** The project folder this terminal belongs to (its config file keeps it); null when no folder was open. */
  root: string | null;
  session: TerminalSession;
  status: TerminalStatus;
  exitCode: number | null;
  /** The user typed into it (closing it then asks first). */
  typed: boolean;
  /** The project's startup command may be run (the user approved it). */
  startupAllowed: boolean;
}

export const terminalState = { tabs: [] as TerminalTab[], activeId: null as string | null, /** What is on screen: one terminal, or splits of terminals (the active one is among them). */ layout: null as Layout | null, /** The terminals on screen, in reading order. */ panes: [] as string[], detected: [] as ShellProfile[], detectedDefault: null as string | null };

const listeners = new Set<() => void>();
export function onTerminalsChanged(listener: () => void): void { listeners.add(listener); }
export function notifyTerminals(): void { for (const listener of listeners) listener(); }

// ---- Settings (this computer, not the project) ----
export const terminalFontSize = (): number => readPreferenceNumber(FONT_KEY, 13, 9, 28);
export function setTerminalFontSize(size: number): void {
  try { localStorage.setItem(FONT_KEY, String(size)); } catch { /* storage unavailable */ }
  for (const tab of terminalState.tabs) tab.session.setFontSize(terminalFontSize());
}
export const saveTerminalsInProject = (): boolean => readPreferenceFlag(SAVE_KEY, true);
export const setSaveTerminalsInProject = (enabled: boolean): void => { writePreferenceFlag(SAVE_KEY, enabled); if (enabled) persistSoon(); };
export const customShells = (): ShellProfile[] => { try { return parseCustomProfiles(localStorage.getItem(CUSTOM_SHELLS_KEY)); } catch { return []; } };
export function saveCustomShells(list: readonly ShellProfile[]): void {
  try { localStorage.setItem(CUSTOM_SHELLS_KEY, JSON.stringify(list.map(({ id, label, path, args }) => ({ id, label, path, args })))); } catch { /* storage unavailable */ }
  notifyTerminals();
}
/** The shells a terminal can use: those the system has, then the user's own. */
export const shellProfiles = (): ShellProfile[] => [...terminalState.detected, ...customShells()];
export function defaultShellId(): string | null {
  let chosen: string | null = null;
  try { chosen = localStorage.getItem(DEFAULT_SHELL_KEY); } catch { /* storage unavailable */ }
  return chosen && shellProfiles().some(profile => profile.id === chosen) ? chosen : terminalState.detectedDefault;
}
export function setDefaultShell(id: string): void { try { localStorage.setItem(DEFAULT_SHELL_KEY, id); } catch { /* storage unavailable */ } notifyTerminals(); }

// ---- Trust: the startup commands a project may run ----
const trustKeyOf = (root: string): string => root.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
function readTrust(): Record<string, string[]> {
  try { const value: unknown = JSON.parse(localStorage.getItem(TRUST_KEY) ?? "{}"); return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, string[]> : {}; } catch { return {}; }
}
export const trustedCommands = (root: string): Set<string> => new Set(readTrust()[trustKeyOf(root)] ?? []);
export function trustCommands(root: string, commands: readonly string[]): void {
  const all = readTrust();
  const key = trustKeyOf(root);
  all[key] = [...new Set([...(all[key] ?? []), ...commands.map(commandHash)])];
  try { localStorage.setItem(TRUST_KEY, JSON.stringify(all)); } catch { /* storage unavailable: asked again next time */ }
}

// ---- The list ----
export const activeTab = (): TerminalTab | null => terminalState.tabs.find(tab => tab.setup.id === terminalState.activeId) ?? null;
export const tabById = (id: string): TerminalTab | undefined => terminalState.tabs.find(tab => tab.setup.id === id);

let hostOf: (id: string) => HTMLElement | null = () => null;
/** Tells where a terminal's screen goes: the pane that shows it (set by the panel; null while it is in no pane). */
export function setTerminalHostResolver(resolver: (id: string) => HTMLElement | null): void { hostOf = resolver; }

/** Keeps the layout valid (existing terminals, the active one among them) and remembers it. */
function syncLayout(): void {
  const before = JSON.stringify(terminalState.layout);
  terminalState.layout = normalizeLayout(terminalState.layout ?? readLayout(), terminalState.tabs.map(tab => tab.setup.id), terminalState.activeId);
  terminalState.panes = leaves(terminalState.layout);
  if (JSON.stringify(terminalState.layout) !== before) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(terminalState.layout)); } catch { /* storage unavailable */ } }
}
const readLayout = (): Layout | null => { try { return parseLayout(localStorage.getItem(LAYOUT_KEY)); } catch { return null; } };

/** The project folder a new terminal starts in: the one of the document in use, else the first open one. */
export function defaultTerminalRoot(): string | null {
  const path = documentState.tabs.find(tab => tab.id === documentState.activeTabId)?.path;
  return (path ? projectRootFor(path) : null) ?? documentState.projectRoots[0] ?? null;
}

function makeTab(setup: TerminalSetup, root: string | null, startupAllowed: boolean): TerminalTab {
  const tab: TerminalTab = {
    setup, root, status: "idle", exitCode: null, typed: false, startupAllowed,
    session: new TerminalSession(setup.id, terminalFontSize(), {
      onStatus: (status, code) => { tab.status = status; tab.exitCode = code; notifyTerminals(); },
      onInput: () => { tab.typed = true; },
      onRestartRequest: () => void startTab(tab),
    }),
  };
  return tab;
}

/** Starts the shell of a terminal (the screen is put in the page first, so that the shell learns its size). */
export async function startTab(tab: TerminalTab): Promise<void> {
  const host = hostOf(tab.setup.id);
  if (!host || tab.session.isAlive) return;
  tab.session.mount(host);
  const profile = pickProfile(shellProfiles(), tab.setup.shell, defaultShellId());
  if (!profile) { tab.status = "failed"; notifyTerminals(); showToast(langText("Nie znaleziono żadnej powłoki.", "No shell was found.")); return; }
  const cwd = tab.root ? absoluteFolder(tab.root, tab.setup.cwd) : null;
  await tab.session.start({ shell: profile.path, args: profile.args, cwd, startup: tab.startupAllowed ? tab.setup.startup : "" });
}

export interface NewTerminal { name?: string; shell?: string; root?: string | null; cwd?: string; startup?: string; activate?: boolean }

export function createTerminal(options: NewTerminal = {}): TerminalTab | null {
  if (terminalState.tabs.length >= MAX_TERMINALS) { showToast(langText(`Można mieć najwyżej ${MAX_TERMINALS} terminali.`, `You can have at most ${MAX_TERMINALS} terminals.`)); return null; }
  const profile = pickProfile(shellProfiles(), options.shell ?? "", defaultShellId());
  const name = uniqueName(options.name || profile?.label || "Terminal", terminalState.tabs.map(tab => tab.setup.name));
  const setup: TerminalSetup = { id: newTerminalId(), name, shell: profile?.id ?? options.shell ?? "", cwd: options.cwd ?? "", startup: options.startup ?? "" };
  const root = options.root === undefined ? defaultTerminalRoot() : options.root;
  const tab = makeTab(setup, root, true);
  terminalState.tabs.push(tab);
  if (options.activate !== false) activateTerminal(setup.id); else { persistSoon(); notifyTerminals(); }
  return tab;
}

const lastActiveByRoot = new Map<string, string>();

export function activateTerminal(id: string): void {
  const tab = tabById(id);
  if (!tab) return;
  // A terminal that is not on screen takes the place of the one in focus.
  if (!terminalState.panes.includes(id) && terminalState.layout && terminalState.activeId && terminalState.panes.includes(terminalState.activeId)) terminalState.layout = replaceLeaf(terminalState.layout, terminalState.activeId, id);
  terminalState.activeId = id;
  syncLayout();
  if (tab.root) lastActiveByRoot.set(tab.root, id);
  persistSoon();
  notifyTerminals();
}

/** Shows a terminal next to the one in focus (side by side, or below it) and focuses it. Without an id a new terminal is opened, started like the active one. */
export function splitTerminal(id?: string, dir: SplitDir = "columns"): void {
  if (terminalState.panes.length >= MAX_PANES && !(id && terminalState.panes.includes(id))) { showToast(langText(`Na ekranie może być najwyżej ${MAX_PANES} terminale naraz.`, `At most ${MAX_PANES} terminals can be on screen at once.`)); return; }
  const source = activeTab();
  const tab = id ? tabById(id) : createTerminal({ shell: source?.setup.shell, root: source ? source.root : undefined, cwd: source?.setup.cwd, activate: false });
  if (!tab) return;
  if (!terminalState.panes.includes(tab.setup.id)) {
    const focused = terminalState.activeId && terminalState.panes.includes(terminalState.activeId) ? terminalState.activeId : null;
    terminalState.layout = focused && terminalState.layout ? splitLayout(terminalState.layout, focused, tab.setup.id, dir) : paneOf(tab.setup.id);
    terminalState.panes = leaves(terminalState.layout);
  }
  activateTerminal(tab.setup.id);
}

/** Shows only the terminal in focus again (the others stay open, in the tabs). */
export function unsplitTerminals(): void {
  terminalState.layout = terminalState.activeId ? paneOf(terminalState.activeId) : null;
  syncLayout();
  notifyTerminals();
}

/** Takes a terminal off the screen without closing it; the focus goes to a neighbour. */
export function hideFromSplit(id: string): void {
  const at = terminalState.panes.indexOf(id);
  if (at < 0 || terminalState.panes.length < 2) return;
  terminalState.layout = removeLeaf(terminalState.layout, id);
  terminalState.panes = leaves(terminalState.layout);
  if (terminalState.activeId === id) terminalState.activeId = terminalState.panes[Math.min(at, terminalState.panes.length - 1)];
  syncLayout();
  notifyTerminals();
}

export function renameTerminal(tab: TerminalTab, name: string): void {
  const clean = cleanName(name);
  if (!clean || clean === tab.setup.name) return;
  tab.setup.name = uniqueName(clean, terminalState.tabs.filter(other => other !== tab).map(other => other.setup.name));
  persistSoon();
  notifyTerminals();
}

/** Changes what a terminal is set up with (its shell, folder or startup command take effect the next time its shell starts). */
export function updateTerminal(tab: TerminalTab, patch: Partial<TerminalSetup>, root?: string | null): void {
  if (patch.name !== undefined) renameTerminal(tab, patch.name);
  const { name: _name, ...rest } = patch;
  Object.assign(tab.setup, rest);
  if (root !== undefined) tab.root = root;
  persistSoon();
  notifyTerminals();
}

export function duplicateTerminal(tab: TerminalTab): TerminalTab | null {
  return createTerminal({ name: tab.setup.name, shell: tab.setup.shell, root: tab.root, cwd: tab.setup.cwd, startup: tab.setup.startup });
}

/** Whether closing the terminal would end something the user may be using. */
export const isBusy = (tab: TerminalTab): boolean => tab.session.isAlive && tab.typed;

export async function closeTerminal(tab: TerminalTab, ask = true): Promise<boolean> {
  if (ask && isBusy(tab)) {
    const confirmed = await appConfirm(langText(`Zamknąć terminal „${tab.setup.name}”? Działający w nim proces zostanie przerwany.`, `Close the terminal “${tab.setup.name}”? The process running in it will be stopped.`), { confirmLabel: langText("Zamknij terminal", "Close terminal"), primaryAction: "cancel" });
    if (!confirmed) return false;
  }
  const index = terminalState.tabs.indexOf(tab);
  if (index < 0) return true;
  terminalState.tabs.splice(index, 1);
  terminalState.layout = removeLeaf(terminalState.layout, tab.setup.id);
  if (terminalState.activeId === tab.setup.id) {
    const next = terminalState.tabs[index] ?? terminalState.tabs[index - 1];
    terminalState.activeId = next?.setup.id ?? null;
    if (next?.root) lastActiveByRoot.set(next.root, next.setup.id);
  }
  void tab.session.dispose();
  syncLayout();
  persistSoon();
  notifyTerminals();
  return true;
}

/** Closes several terminals with one question when some of them are in use (a process the user started would be stopped). Returns whether they were closed. */
export async function closeTerminals(tabs: readonly TerminalTab[]): Promise<boolean> {
  const busy = tabs.filter(isBusy);
  if (busy.length) {
    const names = busy.map(tab => `• ${tab.setup.name}`).join("\n");
    const confirmed = await appConfirm(langText(
      `Zamknąć ${tabs.length} ${tabs.length === 1 ? "terminal" : "terminali"}? Procesy działające w tych terminalach zostaną przerwane:\n\n${names}`,
      `Close ${tabs.length} ${tabs.length === 1 ? "terminal" : "terminals"}? The processes running in these terminals will be stopped:\n\n${names}`,
    ), { confirmLabel: langText("Zamknij terminale", "Close terminals"), primaryAction: "cancel" });
    if (!confirmed) return false;
  }
  for (const tab of [...tabs]) await closeTerminal(tab, false);
  return true;
}

export async function restartTerminal(tab: TerminalTab): Promise<void> {
  await tab.session.stop();
  tab.session.clear();
  await startTab(tab);
}

export async function loadShells(): Promise<void> {
  try { const list = await listShells(); terminalState.detected = list.shells; terminalState.detectedDefault = list.defaultId; } catch (error) { console.warn("Could not list the shells", error); }
  notifyTerminals();
}

// ---- The project config ----
const loadedRoots = new Set<string>();
/** Folders whose config file holds terminals now (so that removing the last terminal removes them from it). */
const savedRoots = new Set<string>();
const warned = new Set<string>();
let saveTimer = 0;

function persistSoon(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void persistNow(); }, SAVE_DELAY_MS);
}

async function persistNow(): Promise<void> {
  if (!saveTerminalsInProject()) return;
  const roots = new Set<string>([...terminalState.tabs.map(tab => tab.root).filter((root): root is string => !!root), ...savedRoots]);
  for (const root of roots) {
    const mine = terminalState.tabs.filter(tab => tab.root === root);
    const active = lastActiveByRoot.get(root) ?? null;
    try {
      await updateProjectConfig(root, config => withTerminals(config, mine.map(tab => tab.setup), active));
      if (mine.length) savedRoots.add(root); else savedRoots.delete(root);
    } catch (error) {
      if (warned.has(root)) continue;
      warned.add(root);
      showToast(error instanceof ProjectConfigUnreadable
        ? langText("Plik typenova.config.json w tym projekcie nie jest plikiem konfiguracji, więc terminale nie zostaną w nim zapisane.", "The typenova.config.json file in this project is not a config file, so the terminals will not be saved in it.")
        : langText("Nie można zapisać terminali w pliku konfiguracji projektu.", "The terminals could not be saved in the project config file."));
    }
  }
}

/** The startup commands of a project the user has not approved: asked about once, in one question. Returns whether they may run. */
async function approveStartupCommands(root: string, setups: readonly TerminalSetup[]): Promise<boolean> {
  const unknown = untrustedCommands(setups, trustedCommands(root));
  if (!unknown.length) return true;
  const list = unknown.map(item => `• ${item.name}: ${item.command.split("\n")[0]}${item.command.includes("\n") ? " …" : ""}`).join("\n");
  const allowed = await appConfirm(langText(
    `Projekt „${basename(root)}” zapisał polecenia, które mają być wpisane w jego terminalach po ich uruchomieniu:\n\n${list}\n\nZezwolić na ich uruchamianie? Jeśli nie, terminale otworzą się bez nich.`,
    `The project “${basename(root)}” saved commands to be typed into its terminals when they start:\n\n${list}\n\nAllow them to run? If not, the terminals open without them.`,
  ), { confirmLabel: langText("Zezwól", "Allow"), primaryAction: "cancel" });
  if (allowed) trustCommands(root, unknown.map(item => item.command));
  return allowed;
}

/** Reads the terminals a project folder saved and adds them (their shells start when they are first shown). */
async function loadRoot(root: string): Promise<void> {
  const key = trustKeyOf(root);
  if (loadedRoots.has(key) || !saveTerminalsInProject()) return;
  loadedRoots.add(key);
  const read = await readProjectConfig(root);
  if (read.kind !== "found") return;
  const setups = terminalsOfConfig(read.config).filter(setup => !tabById(setup.id));
  if (!setups.length) return;
  savedRoots.add(root);
  await approveStartupCommands(root, setups);
  const trusted = trustedCommands(root);
  for (const setup of setups) {
    setup.name = uniqueName(setup.name || "Terminal", terminalState.tabs.map(tab => tab.setup.name));
    terminalState.tabs.push(makeTab(setup, root, setup.startup.trim() === "" || trusted.has(commandHash(setup.startup))));
  }
  const remembered = activeTerminalOfConfig(read.config, setups);
  if (remembered) lastActiveByRoot.set(root, remembered);
  if (!terminalState.activeId) terminalState.activeId = remembered ?? setups[0].id;
  syncLayout();
  notifyTerminals();
}

/** Called when the open project folders change: the terminals saved in the new ones appear. */
export function loadTerminalsOfRoots(roots: readonly string[]): void {
  void (async () => { for (const root of roots) await loadRoot(root); })();
}

/** The startup commands a terminal's project would run, for the dialog. */
export const startupCommandsOf = (tab: TerminalTab): string[] => startupCommands([tab.setup]).map(item => item.command);

export function refreshTerminalThemes(): void { for (const tab of terminalState.tabs) tab.session.refreshTheme(); }
