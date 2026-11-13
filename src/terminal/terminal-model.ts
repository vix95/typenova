/** The integrated terminal's data: what a terminal is, what the project config keeps about it, and the rules for names, folders and trust. Pure (no DOM, no files). */

/** The project config: one file in the root of a project folder (no hidden folder: the file system grants of a chosen folder do not reach hidden names on every system). */
export const PROJECT_CONFIG_FILE = "typenova.config.json";
export const TERMINAL_CONFIG_VERSION = 1;

export const MAX_TERMINAL_NAME = 60;
export const MAX_STARTUP_LENGTH = 2000;
export const MAX_TERMINALS = 24;

/** A shell the system offers, or one the user added. */
export interface ShellProfile { id: string; label: string; path: string; args: string[]; custom?: boolean }

/** What the project config keeps about one terminal. The shell is named by profile id, never by a path: a path would let a project file start any program. */
export interface TerminalSetup {
  id: string;
  name: string;
  /** Id of a shell profile of this computer. */
  shell: string;
  /** Folder to start in, relative to the project folder ("" is the folder itself). */
  cwd: string;
  /** Typed into the shell after it started (empty for none). Only run once the project is trusted for it. */
  startup: string;
}

export type ProjectConfig = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The content of a project config file's text: an empty text is an empty config, text that is not a JSON object is not a config (null), so it is never overwritten. */
export function parseProjectConfig(raw: string | null | undefined): ProjectConfig | null {
  if (raw === null || raw === undefined || raw.trim() === "") return {};
  try { const value: unknown = JSON.parse(raw); return isRecord(value) ? value : null; } catch { return null; }
}

export function newTerminalId(random: () => number = Math.random, now: () => number = Date.now): string {
  return `t${now().toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export function cleanName(name: string): string { return name.replace(/\s+/g, " ").trim().slice(0, MAX_TERMINAL_NAME); }

/** A relative folder written in the config, brought to a safe form: forward slashes, no empty or "." parts, and null when it would leave the project (".." or an absolute path). */
export function cleanRelativeFolder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\\/g, "/");
  if (text === "" || text === ".") return "";
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null;
  const parts = text.split("/").filter(part => part !== "" && part !== ".");
  return parts.some(part => part === "..") ? null : parts.join("/");
}

/** The terminals a config describes. Entries that cannot be used are dropped, an unknown or unusable field is replaced by its default, and ids are made unique. */
export function terminalsOfConfig(config: ProjectConfig, makeId: () => string = newTerminalId): TerminalSetup[] {
  const list = Array.isArray(config.terminals) ? config.terminals : [];
  const taken = new Set<string>();
  const found: TerminalSetup[] = [];
  for (const entry of list.slice(0, MAX_TERMINALS)) {
    if (!isRecord(entry)) continue;
    let id = validId(entry.id) ? entry.id : makeId();
    while (taken.has(id)) id = makeId();
    taken.add(id);
    const name = typeof entry.name === "string" ? cleanName(entry.name) : "";
    const shell = typeof entry.shell === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(entry.shell) ? entry.shell : "";
    const startup = typeof entry.startup === "string" ? entry.startup.replace(/\r\n?/g, "\n").slice(0, MAX_STARTUP_LENGTH) : "";
    found.push({ id, name, shell, cwd: cleanRelativeFolder(entry.cwd) ?? "", startup });
  }
  return found;
}

/** The id of the terminal that was active when the config was written, if it is among the terminals. */
export function activeTerminalOfConfig(config: ProjectConfig, setups: readonly TerminalSetup[]): string | null {
  const id = config.activeTerminal;
  return typeof id === "string" && setups.some(setup => setup.id === id) ? id : null;
}

/** A copy of the config with the terminals replaced (other parts are kept); no terminals removes both keys. */
export function withTerminals(config: ProjectConfig, setups: readonly TerminalSetup[], activeId: string | null): ProjectConfig {
  const next: ProjectConfig = { ...config };
  if (!setups.length) { delete next.terminals; delete next.activeTerminal; }
  else {
    next.terminals = setups.map(setup => ({ id: setup.id, name: setup.name, shell: setup.shell, cwd: setup.cwd, ...(setup.startup ? { startup: setup.startup } : {}) }));
    if (activeId && setups.some(setup => setup.id === activeId)) next.activeTerminal = activeId; else delete next.activeTerminal;
  }
  if (!("version" in next)) next.version = TERMINAL_CONFIG_VERSION;
  return next;
}

/** True when the config holds nothing worth a file. */
export function isEmptyProjectConfig(config: ProjectConfig): boolean {
  return !Object.entries(config).some(([key, value]) => key !== "version" && value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0));
}

export function serializeProjectConfig(config: ProjectConfig): string { return `${JSON.stringify(config, null, 2)}\n`; }

/** `base`, or `base (2)`, `base (3)`… when that name is taken (names are compared without regard to case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(name => name.toLocaleLowerCase()));
  const clean = cleanName(base) || "Terminal";
  if (!used.has(clean.toLocaleLowerCase())) return clean;
  for (let n = 2; ; n++) {
    const candidate = `${clean.slice(0, MAX_TERMINAL_NAME - 6)} (${n})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

const normalizeSeparators = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** The folder of `absolute` relative to `root`, or null when it is not inside it. */
export function relativeFolder(root: string, absolute: string): string | null {
  const base = normalizeSeparators(root), target = normalizeSeparators(absolute);
  if (target.toLocaleLowerCase() === base.toLocaleLowerCase()) return "";
  return target.toLocaleLowerCase().startsWith(`${base.toLocaleLowerCase()}/`) ? target.slice(base.length + 1) : null;
}

/** The absolute folder for a relative one in the config, written with the root's own kind of separator. */
export function absoluteFolder(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return relative ? `${base}${separator}${relative.split("/").join(separator)}` : base;
}

/** The profile with this id; else the default one; else the first. */
export function pickProfile(profiles: readonly ShellProfile[], id: string, defaultId: string | null): ShellProfile | null {
  return profiles.find(profile => profile.id === id) ?? profiles.find(profile => profile.id === defaultId) ?? profiles[0] ?? null;
}

/** The commands a project wants typed into its terminals when it starts them (what the user is asked to trust). */
export function startupCommands(setups: readonly TerminalSetup[]): { name: string; command: string }[] {
  return setups.filter(setup => setup.startup.trim() !== "").map(setup => ({ name: setup.name, command: setup.startup.trim() }));
}

/** A short fingerprint of one command: trust is given to a command as it is written, and a change asks again. */
export function commandHash(command: string): string {
  let hash = 5381;
  for (const char of command.trim()) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/** The commands of these terminals that the user has not approved yet. */
export function untrustedCommands(setups: readonly TerminalSetup[], trusted: ReadonlySet<string>): { name: string; command: string }[] {
  return startupCommands(setups).filter(item => !trusted.has(commandHash(item.command)));
}

/** The user's own shells (name, program, arguments), checked: a program must be an absolute path, ids start with "custom-". */
export function parseCustomProfiles(raw: string | null | undefined): ShellProfile[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const found: ShellProfile[] = [];
    for (const entry of value.slice(0, 20)) {
      if (!isRecord(entry) || typeof entry.label !== "string" || typeof entry.path !== "string") continue;
      const path = entry.path.trim();
      if (!path || !(/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\"))) continue;
      const id = typeof entry.id === "string" && /^custom-[A-Za-z0-9_-]{1,40}$/.test(entry.id) ? entry.id : `custom-${found.length + 1}`;
      const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string").slice(0, 20) : [];
      found.push({ id, label: cleanName(entry.label) || id, path, args, custom: true });
    }
    return found;
  } catch { return []; }
}

/** Splits a line of arguments the way a shell would for simple cases: words separated by spaces, with "double quotes" around a word that holds spaces. */
export function splitArguments(text: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) args.push(match[1] ?? match[2]);
  return args;
}

export function joinArguments(args: readonly string[]): string {
  return args.map(arg => (/\s/.test(arg) || arg === "" ? `"${arg}"` : arg)).join(" ");
}

/** Most terminals shown at once. */
export const MAX_PANES = 4;

/** How a split lays out its parts: side by side, or one above the other. */
export type SplitDir = "columns" | "rows";
/** What is on screen: one terminal, or parts split in a direction (each part again a terminal or a split), like the groups of a split editor. */
export type Layout = { kind: "pane"; id: string } | { kind: "split"; dir: SplitDir; children: Layout[] };

export const paneOf = (id: string): Layout => ({ kind: "pane", id });

/** The terminals of a layout, in reading order. */
export function leaves(layout: Layout | null): string[] {
  if (!layout) return [];
  return layout.kind === "pane" ? [layout.id] : layout.children.flatMap(leaves);
}

/** A split with fewer than two parts is just its part; a split inside a split of the same direction is merged into it. */
function simplify(layout: Layout | null): Layout | null {
  if (!layout || layout.kind === "pane") return layout;
  const children: Layout[] = [];
  for (const child of layout.children.map(simplify)) {
    if (!child) continue;
    if (child.kind === "split" && child.dir === layout.dir) children.push(...child.children); else children.push(child);
  }
  if (!children.length) return null;
  return children.length === 1 ? children[0] : { kind: "split", dir: layout.dir, children };
}

/** Puts a new terminal next to the one in focus in the given direction: in the same split when it already runs that way, else the focused terminal becomes a split of its own. */
export function splitLayout(layout: Layout, focusedId: string, newId: string, dir: SplitDir): Layout {
  const insert = (node: Layout): Layout => {
    if (node.kind === "pane") return node.id === focusedId ? { kind: "split", dir, children: [node, paneOf(newId)] } : node;
    const at = node.children.findIndex(child => child.kind === "pane" && child.id === focusedId);
    if (at >= 0 && node.dir === dir) { const children = [...node.children]; children.splice(at + 1, 0, paneOf(newId)); return { ...node, children }; }
    return { ...node, children: node.children.map(insert) };
  };
  return simplify(insert(layout)) ?? layout;
}

/** The layout without a terminal (null when none is left). */
export function removeLeaf(layout: Layout | null, id: string): Layout | null {
  const prune = (node: Layout): Layout | null => {
    if (node.kind === "pane") return node.id === id ? null : node;
    return { ...node, children: node.children.map(prune).filter((child): child is Layout => child !== null) };
  };
  return layout ? simplify(prune(layout)) : null;
}

/** The layout with one terminal shown instead of another. */
export function replaceLeaf(layout: Layout, from: string, to: string): Layout {
  return layout.kind === "pane" ? (layout.id === from ? paneOf(to) : layout) : { ...layout, children: layout.children.map(child => replaceLeaf(child, from, to)) };
}

/**
 * A layout that can be drawn: only terminals that exist, once each, at most `MAX_PANES`, always including the active one, never empty while a terminal exists.
 * The active terminal replaces the last one when there is no room.
 */
export function normalizeLayout(layout: Layout | null, ids: readonly string[], activeId: string | null): Layout | null {
  const known = new Set(ids);
  const seen = new Set<string>();
  const clean = (node: Layout): Layout | null => {
    if (node.kind === "pane") { if (!known.has(node.id) || seen.has(node.id) || seen.size >= MAX_PANES) return null; seen.add(node.id); return node; }
    return { ...node, children: node.children.map(clean).filter((child): child is Layout => child !== null) };
  };
  let result = layout ? simplify(clean(layout)) : null;
  const active = activeId && known.has(activeId) ? activeId : null;
  if (!result) return ids.length ? paneOf(active ?? ids[0]) : null;
  if (active && !leaves(result).includes(active)) {
    if (leaves(result).length < MAX_PANES) result = simplify({ kind: "split", dir: "columns", children: [result, paneOf(active)] });
    else result = replaceLeaf(result, leaves(result)[leaves(result).length - 1], active);
  }
  return result;
}

/** A layout read back from storage (anything that is not a valid layout gives null). */
export function parseLayout(raw: string | null | undefined): Layout | null {
  const read = (value: unknown, depth: number): Layout | null => {
    if (typeof value !== "object" || value === null || depth > 4) return null;
    const node = value as Record<string, unknown>;
    if (node.kind === "pane") return typeof node.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(node.id) ? paneOf(node.id) : null;
    if (node.kind !== "split" || (node.dir !== "columns" && node.dir !== "rows") || !Array.isArray(node.children)) return null;
    const children = node.children.slice(0, MAX_PANES).map(child => read(child, depth + 1)).filter((child): child is Layout => child !== null);
    return { kind: "split", dir: node.dir, children };
  };
  try { return simplify(read(JSON.parse(raw ?? "null"), 0)); } catch { return null; }
}

/** The sides of a terminal that another one can be dropped on. */
export type DropSide = "left" | "right" | "top" | "bottom";

/** Puts a terminal on a side of another one (left and top: before it), taking it away from where it was shown. A split of the same direction takes it in; otherwise the target becomes a split of its own. */
export function placeBeside(layout: Layout, targetId: string, movedId: string, side: DropSide): Layout {
  if (targetId === movedId) return layout;
  const without = removeLeaf(layout, movedId) ?? paneOf(targetId);
  const dir: SplitDir = side === "left" || side === "right" ? "columns" : "rows";
  const before = side === "left" || side === "top";
  const insert = (node: Layout): Layout => {
    if (node.kind === "pane") return node.id === targetId ? { kind: "split", dir, children: before ? [paneOf(movedId), node] : [node, paneOf(movedId)] } : node;
    const at = node.children.findIndex(child => child.kind === "pane" && child.id === targetId);
    if (at >= 0 && node.dir === dir) { const children = [...node.children]; children.splice(before ? at : at + 1, 0, paneOf(movedId)); return { ...node, children }; }
    return { ...node, children: node.children.map(insert) };
  };
  return simplify(insert(without)) ?? without;
}

/** The layout with two terminals exchanging places (one of them may not be shown yet: the other then simply gives way to it). */
export function swapLeaves(layout: Layout, a: string, b: string): Layout {
  const swap = (node: Layout): Layout => node.kind === "pane" ? (node.id === a ? paneOf(b) : node.id === b ? paneOf(a) : node) : { ...node, children: node.children.map(swap) };
  return swap(layout);
}

/** The ids with one moved to a slot (the position it should have among the others once it is taken out). */
export function moveId(ids: readonly string[], id: string, slot: number): string[] {
  const rest = ids.filter(other => other !== id);
  if (rest.length === ids.length) return [...ids];
  rest.splice(Math.max(0, Math.min(rest.length, slot)), 0, id);
  return rest;
}

/** A family of shells whose commands read alike: what a code block is written for, and what a terminal runs. */
export type ShellFamily = "posix" | "powershell" | "cmd";

const LANGUAGE_FAMILY: Readonly<Record<string, ShellFamily>> = {
  bash: "posix", sh: "posix", shell: "posix", zsh: "posix", ksh: "posix",
  powershell: "powershell", pwsh: "powershell", ps1: "powershell", ps: "powershell",
  cmd: "cmd", bat: "cmd", batch: "cmd",
};
const SHELL_FAMILY: Readonly<Record<string, ShellFamily>> = {
  gitbash: "posix", bash: "posix", zsh: "posix", sh: "posix", wsl: "posix", ksh: "posix",
  powershell: "powershell", pwsh: "powershell", cmd: "cmd",
};
/** Shells that suit a family, best first. */
const PREFERRED_SHELLS: Readonly<Record<ShellFamily, readonly string[]>> = {
  posix: ["gitbash", "bash", "zsh", "wsl", "sh"], powershell: ["pwsh", "powershell"], cmd: ["cmd"],
};

/** The family a fenced code block's language belongs to (bash, sh, powershell, ps1, cmd, bat…), or null when it is not a shell script. */
export const languageFamily = (language: string): ShellFamily | null => LANGUAGE_FAMILY[language.trim().toLowerCase()] ?? null;

/** The family of a shell by its id, or null for one that is not known (a shell of the user's own). */
export const shellFamily = (shellId: string): ShellFamily | null => SHELL_FAMILY[shellId] ?? null;

/** The shell of a family that this computer has, by preference, or null. */
export function pickShellFor(family: ShellFamily, profiles: readonly ShellProfile[]): ShellProfile | null {
  for (const id of PREFERRED_SHELLS[family]) { const found = profiles.find(profile => profile.id === id); if (found) return found; }
  return null;
}

/** What is typed into a terminal for a code block: blank lines at the ends dropped, the "$ " prompt marks of documentation removed when every line has one, lines separated by Enter. */
export function commandText(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/\s+$/, ""));
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const filled = lines.filter(line => line !== "");
  const marked = filled.length > 0 && filled.every(line => /^\s*\$ /.test(line));
  return (marked ? lines.map(line => line.replace(/^(\s*)\$ /, "$1")) : lines).join("\r");
}
