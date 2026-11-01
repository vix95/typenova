/** Hiding sections of a document: state, the sidecar config file next to the Markdown file, and applying it to editor, preview and outline. */
import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { hiddenSectionsInState, setHiddenSections } from "../editor/hidden-sections";
import { view } from "../editor/editor-view";
import { basename } from "../filesystem/path-utils";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { langText } from "../i18n/language";
import { outlineHeadings, refreshOutlineHiddenMarks } from "../outline/outline";
import { setPreviewHiddenRanges } from "../preview/preview-hidden";
import { previewState } from "../preview/preview-state";
import { readPreferenceFlag } from "../settings/preferences";
import { showToast } from "../ui/toast";
import { documentState } from "./document-state";
import { type HiddenRange, hiddenRangesFor, keysInsideRanges, parseSectionConfig, sectionConfigPath, serializeSectionConfig } from "./section-ranges";

const SHOW_ALL_KEY = "typenova.showHiddenSections";

export const sectionVisibility = {
  /** Hidden sections of the current document (heading keys). */
  hiddenKeys: new Set<string>(),
  /** Ranges of the hidden sections in the current text, whether or not they are currently shown. */
  ranges: [] as HiddenRange[],
  /** Keys of the headings that are hidden or lie inside a hidden section. */
  insideKeys: new Set<string>(),
  /** The "show hidden sections" toggle: hidden sections stay hidden in print and export either way. */
  showAll: readPreferenceFlag(SHOW_ALL_KEY, false) as boolean,
};

const loaded = new Map<string, Set<string>>();

async function readConfig(path: string): Promise<Set<string>> {
  const configPath = sectionConfigPath(path);
  try { return new Set(parseSectionConfig(await exists(configPath) ? await readTextFile(configPath) : null)); }
  catch { return new Set(); }
}

async function writeConfig(path: string, keys: ReadonlySet<string>): Promise<void> {
  const configPath = sectionConfigPath(path);
  try {
    if (keys.size) await writeTextFile(configPath, serializeSectionConfig(basename(path), keys));
    else if (await exists(configPath)) await remove(configPath);
  } catch (error) {
    showToast(`${langText("Nie udało się zapisać pliku konfiguracji ukrytych sekcji", "Could not save the hidden sections config file")}: ${String(error)}`);
  }
}

/** Makes the hidden sections of the current document known (read from its config file the first time). */
async function ensureLoaded(path: string | null): Promise<void> {
  if (!path) { sectionVisibility.hiddenKeys = new Set(); return; }
  const key = normalizedFsPath(path);
  let keys = loaded.get(key);
  if (!keys) { keys = await readConfig(path); loaded.set(key, keys); }
  sectionVisibility.hiddenKeys = keys;
}

/** Recomputes the hidden ranges from the current headings and applies them; called whenever the outline was rebuilt. */
export async function refreshSectionVisibility(): Promise<void> {
  const path = documentState.currentPath;
  await ensureLoaded(path);
  if (documentState.currentPath !== path) return; // another document became current meanwhile; its own outline build will follow
  const ranges = hiddenRangesFor(outlineHeadings, sectionVisibility.hiddenKeys, view.state.doc.lines);
  sectionVisibility.ranges = ranges;
  sectionVisibility.insideKeys = keysInsideRanges(outlineHeadings, ranges);
  const effective = sectionVisibility.showAll ? [] : ranges;
  // Compare with what the editor and the preview actually hold (the editor state is replaced whenever a tab is
  // activated, so a remembered "already applied" flag would go stale).
  const wanted = JSON.stringify(effective);
  if (JSON.stringify(hiddenSectionsInState(view.state)) !== wanted) view.dispatch({ effects: setHiddenSections.of(effective) });
  if (JSON.stringify(previewState.hiddenLineRanges) !== wanted) setPreviewHiddenRanges(effective);
  refreshOutlineHiddenMarks();
}

/** Hides or shows one section of the current document and saves the change to its config file. */
export async function setSectionHidden(key: string, hidden: boolean): Promise<void> {
  const path = documentState.currentPath;
  if (!path) { showToast(langText("Najpierw zapisz dokument, aby ukrywać sekcje.", "Save the document first to hide sections.")); return; }
  await ensureLoaded(path);
  const keys = sectionVisibility.hiddenKeys;
  if (hidden) keys.add(key); else keys.delete(key);
  await refreshSectionVisibility();
  await writeConfig(path, keys);
}

export function isSectionHidden(key: string): boolean { return sectionVisibility.hiddenKeys.has(key); }

export function setShowHiddenSections(show: boolean): void {
  sectionVisibility.showAll = show;
  try { localStorage.setItem(SHOW_ALL_KEY, String(show)); } catch { /* storage unavailable */ }
  void refreshSectionVisibility();
}

/** Wires the "show hidden sections" toggle of the outline; its pressed state follows the stored preference. */
export function initSectionVisibility(): void {
  const button = document.getElementById("toggleHiddenSections");
  if (!button) return;
  const sync = () => { button.setAttribute("aria-pressed", String(sectionVisibility.showAll)); button.classList.toggle("selected", sectionVisibility.showAll); };
  sync();
  button.addEventListener("click", () => { setShowHiddenSections(!sectionVisibility.showAll); sync(); });
}

/** Command palette entry: same as the toggle. */
export function toggleShowHiddenSections(): void {
  setShowHiddenSections(!sectionVisibility.showAll);
  const button = document.getElementById("toggleHiddenSections");
  button?.setAttribute("aria-pressed", String(sectionVisibility.showAll)); button?.classList.toggle("selected", sectionVisibility.showAll);
}
