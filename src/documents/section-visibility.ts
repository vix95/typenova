/** Hiding sections of a document: state, the sidecar config file next to the Markdown file, and applying it to editor, preview and outline. */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { hiddenSectionsInState, setHiddenSections } from "../editor/hidden-sections";
import { view } from "../editor/editor-view";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { langText } from "../i18n/language";
import { outlineHeadings, refreshOutlineHiddenMarks } from "../outline/outline";
import { setPreviewHiddenRanges } from "../preview/preview-hidden";
import { previewState } from "../preview/preview-state";
import { readPreferenceFlag } from "../settings/preferences";
import { showToast } from "../ui/toast";
import { documentState } from "./document-state";
import { DocConfigUnreadable, updateDocConfig } from "./doc-config";
import { withDocConfigParts } from "./doc-config-model";
import { type HiddenRange, focusRangesFor, hiddenRangesFor, keysInsideRanges, parseFocusedSection, parseSectionConfig, sectionConfigPath, storedFocusOf, storedSectionsOf } from "./section-ranges";

const SHOW_ALL_KEY = "typenova.showHiddenSections";

export const sectionVisibility = {
  /** Hidden sections of the current document (heading keys). */
  hiddenKeys: new Set<string>(),
  /** The one section shown while the rest is hidden ("show only this section"), or null. */
  focusKey: null as string | null,
  /** Ranges of the hidden sections in the current text, whether or not they are currently shown. */
  ranges: [] as HiddenRange[],
  /** Keys of the headings that are hidden or lie inside a hidden section. */
  insideKeys: new Set<string>(),
  /** The "show hidden sections" toggle: hidden sections stay hidden in print and export either way. */
  showAll: readPreferenceFlag(SHOW_ALL_KEY, false) as boolean,
};

interface StoredVisibility { keys: Set<string>; focusKey: string | null }
const loaded = new Map<string, StoredVisibility>();

async function readConfig(path: string): Promise<StoredVisibility> {
  const configPath = sectionConfigPath(path);
  try {
    const raw = await exists(configPath) ? await readTextFile(configPath) : null;
    return { keys: new Set(parseSectionConfig(raw)), focusKey: parseFocusedSection(raw) };
  } catch { return { keys: new Set(), focusKey: null }; }
}

async function writeConfig(path: string, keys: ReadonlySet<string>, focusKey: string | null): Promise<void> {
  try {
    // Only the hidden sections are changed; bookmarks and highlights in the same file stay as they are.
    await updateDocConfig(path, config => withDocConfigParts(config, { hiddenSections: storedSectionsOf(keys), focusedSection: storedFocusOf(focusKey) }));
  } catch (error) {
    const reason = error instanceof DocConfigUnreadable ? langText("Plik konfiguracji obok dokumentu jest uszkodzony i nie został nadpisany", "The config file next to the document is damaged and was not overwritten") : String(error);
    showToast(`${langText("Nie udało się zapisać ukrytych sekcji", "Could not save the hidden sections")}: ${reason}`);
  }
}

/** Makes the hidden sections of the current document known (read from its config file the first time). */
async function ensureLoaded(path: string | null): Promise<void> {
  if (!path) { sectionVisibility.hiddenKeys = new Set(); sectionVisibility.focusKey = null; return; }
  const key = normalizedFsPath(path);
  let stored = loaded.get(key);
  if (!stored) { stored = await readConfig(path); loaded.set(key, stored); }
  sectionVisibility.hiddenKeys = stored.keys;
  sectionVisibility.focusKey = stored.focusKey;
}

/** Recomputes the hidden ranges from the current headings and applies them; called whenever the outline was rebuilt. */
export async function refreshSectionVisibility(): Promise<void> {
  const path = documentState.currentPath;
  await ensureLoaded(path);
  if (documentState.currentPath !== path) return; // another document became current meanwhile; its own outline build will follow
  const totalLines = view.state.doc.lines;
  const hidden = hiddenRangesFor(outlineHeadings, sectionVisibility.hiddenKeys, totalLines);
  // "Show only this section" hides everything around the chosen one (and what is hidden inside it); it ends by itself when that heading is gone.
  const ranges = (sectionVisibility.focusKey && focusRangesFor(outlineHeadings, sectionVisibility.focusKey, hidden, totalLines)) || hidden;
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
  await writeConfig(path, keys, sectionVisibility.focusKey);
}

/** Shows only the given section (null returns to the whole document) and saves the choice to the config file. */
export async function setFocusedSection(key: string | null): Promise<void> {
  const path = documentState.currentPath;
  if (!path) { showToast(langText("Najpierw zapisz dokument, aby pokazać tylko jedną sekcję.", "Save the document first to show only one section.")); return; }
  await ensureLoaded(path);
  const stored = loaded.get(normalizedFsPath(path));
  if (!stored) return;
  stored.focusKey = key; sectionVisibility.focusKey = key;
  await refreshSectionVisibility();
  await writeConfig(path, stored.keys, key);
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
