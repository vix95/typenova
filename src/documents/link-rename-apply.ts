/** After a heading was renamed: finds the `[[links]]` that pointed at it and rewrites them, in the open documents (as edits that can be undone with the editor's history) and in the other Markdown files of the project (on disk). It says what it did and offers to undo it. */
import { ChangeSet, type Text } from "@codemirror/state";
import { annotationOfRename } from "../editor/heading-rename-annotation";
import { loadTextFile, saveTextFile } from "../filesystem/text-io";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { filesLinkingTo, filesWithLinks, sourcesFromIndex, type IndexedFile } from "../graph/project-index-model";
import { indexedFilesNow, indexUsable } from "./project-index";
import { planLinkRename, planQualifyLinks, applyEdits, headingTitleOfLine, type FilePlan, type RenamePlan, type SourceText } from "../graph/link-rename";
import { langText } from "../i18n/language";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { showActionToast, showToast } from "../ui/toast";
import { documentState, type DocumentTab } from "./document-state";
import { groupsState } from "./groups-state";
import { sameSessionPath } from "./session";
import { renderTabs } from "./tabs";

const SETTING_KEY = "typenova.autoRenameLinks";

export const autoRenameLinksEnabled = (): boolean => readPreferenceFlag(SETTING_KEY, true);
export const setAutoRenameLinks = (enabled: boolean): void => writePreferenceFlag(SETTING_KEY, enabled);

export interface HeadingRename { tabId: string; line: number; oldTitle: string; newTitle: string }

export const pathKeyOf = (tab: DocumentTab): string => tab.path ?? `untitled:${tab.id}`;
const liveGroup = (tab: DocumentTab) => groupsState.groups.find(group => group.view && group.activeTabId === tab.id);

/** The current text of a tab: what its editor holds when it is shown, else its saved state. */
export const textOfTab = (tab: DocumentTab): Text => (liveGroup(tab)?.view?.state ?? tab.state).doc;

interface Undo { run: () => Promise<boolean> }

/** Applies edits to an open document. Returns how to undo it, or null when the text is no longer what the plan was made from. */
function editOpenTab(tab: DocumentTab, planned: Text, edits: FilePlan["edits"]): Undo | null {
  const group = liveGroup(tab);
  const view = group?.view ?? null;
  const before = (view?.state ?? tab.state).doc;
  if (!before.eq(planned)) return null;
  const changes = edits.map(edit => ({ from: edit.from, to: edit.to, insert: edit.insert }));
  const inverse = ChangeSet.of(changes, before.length).invert(before);
  let after: Text;
  if (view) {
    view.dispatch({ changes, annotations: annotationOfRename.of(true), userEvent: "input.rename-links" });
    after = view.state.doc;
  } else {
    tab.state = tab.state.update({ changes, annotations: annotationOfRename.of(true), userEvent: "input.rename-links" }).state;
    tab.dirty = true;
    after = tab.state.doc;
  }
  return {
    async run() {
      const live = liveGroup(tab)?.view ?? null;
      const doc = (live?.state ?? tab.state).doc;
      if (!doc.eq(after)) return false;
      if (live) live.dispatch({ changes: inverse, annotations: annotationOfRename.of(true), userEvent: "undo.rename-links" });
      else { tab.state = tab.state.update({ changes: inverse, annotations: annotationOfRename.of(true) }).state; renderTabs(); }
      return true;
    },
  };
}

/** Rewrites a file that is not open: only when it still holds the text the plan was made from. */
async function editDiskFile(path: string, planned: string, edits: FilePlan["edits"]): Promise<Undo | null> {
  const loaded = await loadTextFile(path);
  // A file with mixed line endings would be rewritten with one kind: it is left alone rather than changed beyond the links.
  if (loaded.text !== planned || loaded.mixedLineEndings) return null;
  const after = applyEdits(planned, edits);
  await saveTextFile(path, after, loaded);
  return {
    async run() {
      const now = await loadTextFile(path);
      if (now.text !== after) return false;
      await saveTextFile(path, planned, now);
      return true;
    },
  };
}

/** The texts of some indexed files, read now (a few at a time); a file that cannot be read is left out. */
export async function readTexts(files: readonly IndexedFile[]): Promise<SourceText[]> {
  const out: SourceText[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let at = next++; at < files.length; at = next++) {
      try { out.push({ path: files[at].path, name: files[at].name, text: (await loadTextFile(files[at].path)).text }); } catch { /* skipped */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return out;
}

/** The index with the paths of the files that are open taken from their tabs, so that a file is the same one for the index, the editor and the planner. */
export function indexWithTabPaths(files: readonly IndexedFile[], tabs: readonly DocumentTab[]): IndexedFile[] {
  return files.map(file => {
    const tab = tabs.find(item => sameSessionPath(item.path, file.path));
    return tab?.path && tab.path !== file.path ? { ...file, path: tab.path } : file;
  });
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

function sayDone(old: string, now: string, links: number, files: number, undo: () => Promise<void>): void {
  const pl = `Zaktualizowano ${links} ${plural(links, "link", "linków")} w ${files} ${plural(files, "pliku", "plikach")} po zmianie „${old}” na „${now}”.`;
  const en = `Updated ${links} ${plural(links, "link", "links")} in ${files} ${plural(files, "file", "files")} after renaming “${old}” to “${now}”.`;
  showActionToast(langText(pl, en), langText("Cofnij", "Undo"), () => { void undo(); });
}

/** What one round of rewriting did. */
interface Round { undos: Undo[]; links: number; skipped: number }

/** Plans the rename over `sources` and applies it to the open tabs and to disk. With `only`, just the file of that path is touched. */
async function applyPlan(rename: HeadingRename, tabs: DocumentTab[], sources: SourceText[], tabDocs: Map<string, Text>, only?: string): Promise<{ round: Round; plan: RenamePlan }> {
  const renamed = tabs.find(tab => tab.id === rename.tabId);
  const request = { path: renamed ? pathKeyOf(renamed) : "", line: rename.line, oldTitle: rename.oldTitle, newTitle: rename.newTitle };
  let plan = planLinkRename(sources, request, { qualify: true });
  // The kept copy of a file may be out of date: the files about to be rewritten are read again, and the plan is made again if one of them changed.
  let stale = false;
  for (const file of plan.files) {
    if (tabs.some(item => pathKeyOf(item) === file.path)) continue;
    const entry = sources.find(source => source.path === file.path);
    try { const fresh = (await loadTextFile(file.path)).text; if (entry && entry.text !== fresh) { entry.text = fresh; stale = true; } } catch { /* editDiskFile reports it */ }
  }
  if (stale) plan = planLinkRename(sources, request, { qualify: true });
  return { round: await applyFiles(plan.blocked ? [] : plan.files, tabs, sources, tabDocs, only), plan };
}

/** Writes the planned edits: into the open documents (as edits that can be undone) and into the files on disk. With `only`, just the file of that path. */
async function applyFiles(files: FilePlan[], tabs: DocumentTab[], sources: SourceText[], tabDocs: Map<string, Text>, only?: string): Promise<Round> {
  const round: Round = { undos: [], links: 0, skipped: 0 };
  for (const file of files) {
    if (only !== undefined && file.path !== only) continue;
    const tab = tabs.find(item => pathKeyOf(item) === file.path);
    try {
      const entry = sources.find(source => source.path === file.path)!;
      const undo = tab ? editOpenTab(tab, tabDocs.get(tab.id)!, file.edits) : await editDiskFile(file.path, entry.text, file.edits);
      if (undo && !tab) entry.text = applyEdits(entry.text, file.edits);
      if (undo) { round.undos.push(undo); round.links += file.edits.length; } else round.skipped++;
    } catch { round.skipped++; }
  }
  return round;
}

/** The open Markdown documents as they are right now (the editors hold the truth, saved or not). */
function openSnapshot(): { tabs: DocumentTab[]; tabDocs: Map<string, Text>; open: SourceText[] } {
  const tabs = documentState.tabs.filter(tab => isMarkdownPath(tab.path || tab.label));
  const tabDocs = new Map(tabs.map(tab => [tab.id, textOfTab(tab)]));
  const open = tabs.map(tab => ({ path: pathKeyOf(tab), name: tab.path ? basename(tab.path) : tab.label, text: tabDocs.get(tab.id)!.toString() }));
  return { tabs, tabDocs, open };
}

function reportRound(rename: HeadingRename, round: Round): void {
  renderTabs();
  if (round.undos.length) {
    sayDone(rename.oldTitle, rename.newTitle, round.links, round.undos.length, async () => {
      let restored = true;
      for (const undo of round.undos) restored = (await undo.run().catch(() => false)) && restored;
      showToast(restored ? langText("Linki przywrócone.", "Links restored.") : langText("Nie wszystkie linki dało się przywrócić: te pliki zmieniły się w międzyczasie.", "Not every link could be restored: those files changed in the meantime."));
      renderTabs();
    });
  }
  if (round.skipped) showToast(langText(`${round.skipped} ${plural(round.skipped, "plik", "plików")} zmieniło się w trakcie i nie zostało zaktualizowane.`, `${round.skipped} ${plural(round.skipped, "file", "files")} changed meanwhile and ${plural(round.skipped, "was", "were")} not updated.`));
}

/** Renames are handled one after another: a second one (the title was edited again) is planned from what the first one left, never in parallel with it. One that has not started yet and is continued by the next edit of the same heading is merged with it (old title of the first, new title of the last). */
let queue: Promise<void> = Promise.resolve();
const waiting: { rename: HeadingRename }[] = [];
export function applyHeadingRename(rename: HeadingRename): Promise<void> {
  const earlier = waiting.find(item => item.rename.tabId === rename.tabId && item.rename.newTitle === rename.oldTitle);
  if (earlier) { earlier.rename = { ...rename, oldTitle: earlier.rename.oldTitle }; return queue; }
  const item = { rename };
  waiting.push(item);
  const run = (): Promise<void> => { waiting.splice(waiting.indexOf(item), 1); return runHeadingRename(item.rename); };
  queue = queue.then(run, run);
  return queue;
}

/** The line of the renamed heading as it is now: the one noted when it is still a heading (the title may have changed again meanwhile), else the only heading with the new title (lines move while renames wait). */
function currentHeadingLine(tab: DocumentTab, rename: HeadingRename): number | null {
  const doc = textOfTab(tab);
  if (rename.line <= doc.lines && headingTitleOfLine(doc.line(rename.line).text) !== null) return rename.line;
  const found: number[] = [];
  for (let number = 1; number <= doc.lines; number++) if (headingTitleOfLine(doc.line(number).text) === rename.newTitle) found.push(number);
  return found.length === 1 ? found[0] : null;
}

async function runHeadingRename(noted: HeadingRename): Promise<void> {
  if (!autoRenameLinksEnabled()) return;
  const renamed = documentState.tabs.find(tab => tab.id === noted.tabId);
  if (!renamed || !isMarkdownPath(renamed.path || renamed.label)) return;
  const line = currentHeadingLine(renamed, noted);
  if (line === null) return;
  const rename = { ...noted, line };
  try {
    // First the links in the document itself: a link to a section of its own file always means that section (the graph resolves it the same way), so this needs nothing from the rest of the project and happens at once, however large the project is.
    const first = openSnapshot();
    const own = await applyPlan(rename, first.tabs, first.open, first.tabDocs, pathKeyOf(renamed));
    if (own.round.undos.length) reportRound(rename, own.round);
    // Then the other files: the project is read (it can take a while) and the open documents are read again right before planning, so that what the plan says matches what is in the editors.
    const searching = !indexUsable();
    if (searching) showToast(langText(`Szukam linków do „${rename.oldTitle}” w projekcie…`, `Looking for links to “${rename.oldTitle}” in the project…`));
    const { files, tooLarge, problem } = await indexedFilesNow();
    if (tooLarge) { showToast(langText("Projekt jest za duży, żeby automatycznie zaktualizować linki po zmianie nagłówka.", "The project is too large to update the links automatically after a heading was renamed.")); return; }
    const now = openSnapshot();
    // Only the files that have a link to this title are read; of every other file the index knows its sections, which is all the plan needs of it.
    const indexed = indexWithTabPaths(files, now.tabs);
    const known = new Map<string, SourceText>(now.open.map(source => [source.path, source]));
    for (const text of await readTexts(filesLinkingTo(indexed, rename.oldTitle).filter(file => !known.has(file.path)))) known.set(text.path, text);
    const sources = sourcesFromIndex(indexed, known);
    const { round, plan } = await applyPlan(rename, now.tabs, sources, now.tabDocs);
    if (plan.blocked) {
      if (plan.linkCount) showToast(langText("Linki do tej sekcji nie zostały zmienione: nowy tytuł zawiera znaki ([ ] | #), których link nie może zawierać.", "Links to this section were not updated: the new title contains characters ([ ] | #) that a link cannot hold."));
      return;
    }
    if (!plan.files.length && plan.ambiguous) showToast(langText(`${plan.ambiguous} ${plural(plan.ambiguous, "link", "linków")} do tytułu „${rename.oldTitle}” zostało bez zmian, bo mogły dotyczyć innej sekcji o tym samym tytule.`, `${plan.ambiguous} ${plural(plan.ambiguous, "link", "links")} to “${rename.oldTitle}” were left as they are, because they could mean another section with the same title.`));
    reportRound(rename, round);
    if (searching && !round.undos.length && !own.round.undos.length && !plan.ambiguous && !round.skipped) showToast(langText(`Nie znaleziono linków do „${rename.oldTitle}” (przeszukano ${files.length} plików${problem ? `, błąd: ${problem}` : ""}).`, `No links to “${rename.oldTitle}” found (${files.length} files searched${problem ? `, error: ${problem}` : ""}).`));
  } catch (error) {
    console.warn("Could not update the links after a heading was renamed", error);
  }
}

/** Writes every link that names only a title in full (`[[Title]]` → `[[File.md#Title]]`) across the project, in the open documents (undoable) and on disk, and offers to undo it. */
export async function qualifyProjectLinks(): Promise<void> {
  try {
    if (!indexUsable()) showToast(langText("Czytam projekt…", "Reading the project…"));
    const { files, tooLarge } = await indexedFilesNow();
    if (tooLarge) { showToast(langText("Projekt jest za duży, żeby zamienić linki.", "The project is too large to convert the links.")); return; }
    const now = openSnapshot();
    const indexed = indexWithTabPaths(files, now.tabs);
    const known = new Map<string, SourceText>(now.open.map(source => [source.path, source]));
    for (const text of await readTexts(filesWithLinks(indexed).filter(file => !known.has(file.path)))) known.set(text.path, text);
    const sources = sourcesFromIndex(indexed, known);
    const plan = planQualifyLinks(sources);
    const round = await applyFiles(plan.files, now.tabs, sources, now.tabDocs);
    renderTabs();
    if (!round.undos.length) {
      showToast(plan.ambiguous
        ? langText(`${plan.ambiguous} ${plural(plan.ambiguous, "link", "linków")} bez zmian: tytuł występuje w kilku plikach, wpisz plik ręcznie.`, `${plan.ambiguous} ${plural(plan.ambiguous, "link", "links")} left as they are: the title is in several files, name the file by hand.`)
        : langText("Wszystkie linki mają już plik i nagłówek.", "Every link already names its file and header."));
      return;
    }
    const pl = `Zamieniono ${round.links} ${plural(round.links, "link", "linków")} w ${round.undos.length} ${plural(round.undos.length, "pliku", "plikach")} na postać plik#nagłówek${plan.ambiguous ? `; ${plan.ambiguous} bez zmian (tytuł w kilku plikach)` : ""}.`;
    const en = `Converted ${round.links} ${plural(round.links, "link", "links")} in ${round.undos.length} ${plural(round.undos.length, "file", "files")} to the file#header form${plan.ambiguous ? `; ${plan.ambiguous} left (title in several files)` : ""}.`;
    showActionToast(langText(pl, en), langText("Cofnij", "Undo"), () => {
      void (async () => {
        let restored = true;
        for (const undo of round.undos) restored = (await undo.run().catch(() => false)) && restored;
        showToast(restored ? langText("Linki przywrócone.", "Links restored.") : langText("Nie wszystkie linki dało się przywrócić: te pliki zmieniły się w międzyczasie.", "Not every link could be restored: those files changed in the meantime."));
        renderTabs();
      })();
    });
  } catch (error) {
    console.warn("Could not convert the links", error);
    showToast(`${langText("Nie można zamienić linków", "Could not convert the links")}: ${String(error)}`);
  }
}
