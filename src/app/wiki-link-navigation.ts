/** Following `[[links]]`: a click on one in the preview (or Ctrl/Cmd+click in the editor) opens the section it leads to, resolved like the section graph does. */
import { join } from "@tauri-apps/api/path";
import { documentState } from "../documents/document-state";
import { indexWithTabPaths, pathKeyOf, readTexts, textOfTab } from "../documents/link-rename-apply";
import { indexedNow, indexUsable, indexedFiles, recheckIndex } from "../documents/project-index";
import { sameSessionPath } from "../documents/session";
import { openGraphSection } from "../graph-ui/selection";
import { loadTextFile } from "../filesystem/text-io";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { resolveLinkTarget, type LinkTarget, type SourceText } from "../graph/link-rename";
import { filesWithSection, sourcesFromIndex, titleOfLink, type IndexedFile } from "../graph/project-index-model";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

/** A link that names its file and header (`[[folder/file.md#Header]]`) is read from that one file, found next to the document or under a project folder: no search at all. Null when the link names no file or the file is not there. */
async function readNamedFile(inner: string, sourcePath: string): Promise<SourceText | null> {
  const named = inner.split("|")[0].split("#")[0].trim();
  const hasExtension = /\.[a-z0-9]{1,8}$/i.test(named);
  if (!named || !inner.includes("#") || !(hasExtension || /[\\/]/.test(named))) return null;
  const file = hasExtension ? named : `${named}.md`;
  const cut = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
  const folders = [...(cut > 0 && !sourcePath.startsWith("untitled:") ? [sourcePath.slice(0, cut)] : []), ...documentState.projectRoots, ...(documentState.projectRoot ? [documentState.projectRoot] : [])];
  for (const folder of folders) {
    try {
      const path = await join(folder, file);
      return { path, name: basename(path), text: (await loadTextFile(path)).text };
    } catch { /* not there: the next folder */ }
  }
  return null;
}

/** Looks a link up in the index: the files that have its section are read and the link is resolved among them (and the open documents). */
async function lookUp(inner: string, sourcePath: string, open: SourceText[], tabs: typeof documentState.tabs, files: readonly IndexedFile[]): Promise<LinkTarget | null> {
  const indexed = indexWithTabPaths(files, tabs);
  const hits = filesWithSection(indexed, titleOfLink(inner)).filter(file => !open.some(source => source.path === file.path));
  if (!hits.length) return resolveLinkTarget(open, sourcePath, inner);
  const known = new Map<string, SourceText>(open.map(source => [source.path, source]));
  for (const text of await readTexts(hits)) known.set(text.path, text);
  return resolveLinkTarget(sourcesFromIndex(indexed, known), sourcePath, inner);
}

/** Opens the section a link leads to; says so when there is none. `inner` is the text between `[[` and `]]`. */
export async function followWikiLink(inner: string): Promise<void> {
  try {
    const active = documentState.tabs.find(tab => tab.id === documentState.activeTabId);
    const sourcePath = active ? pathKeyOf(active) : "";
    // The open documents are read fresh: they hold the text as it is now, saved or not.
    const tabs = documentState.tabs.filter(tab => isMarkdownPath(tab.path || tab.label));
    const open: SourceText[] = tabs.map(tab => ({ path: pathKeyOf(tab), name: tab.path ? basename(tab.path) : tab.label, text: textOfTab(tab).toString() }));
    // A section of the document the link is in wins over any other (the graph resolves it the same way): no need to look further.
    let target = resolveLinkTarget(open, sourcePath, inner);
    let searched = "";
    if (!target || target.path !== sourcePath) {
      const named = await readNamedFile(inner, sourcePath);
      if (named && !tabs.some(tab => tab.path && sameSessionPath(tab.path, named.path))) target = resolveLinkTarget([...open, named], sourcePath, inner) ?? target;
    }
    if (!target || target.path !== sourcePath) {
      // The index as it is now (the first read of a project may still be going on); the whole of it only when nothing is found yet.
      target = (await lookUp(inner, sourcePath, open, tabs, indexedNow())) ?? target;
      if (!target) {
        if (!indexUsable()) showToast(langText("Szukam sekcji w projekcie…", "Looking for the section in the project…"));
        const read = await indexedFiles();
        if (read.tooLarge) { showToast(langText("Projekt jest za duży, żeby przejść do sekcji z linku.", "The project is too large to follow a link to a section.")); return; }
        target = await lookUp(inner, sourcePath, open, tabs, read.files);
        if (!target) {
          // Files may have been added or changed by other programs since the index was read.
          const again = await recheckIndex();
          target = await lookUp(inner, sourcePath, open, tabs, again.files);
          searched = langText(` (przeszukano ${again.files.length} plików${again.problem ? `, błąd: ${again.problem}` : ""})`, ` (${again.files.length} files searched${again.problem ? `, error: ${again.problem}` : ""})`);
        }
      }
    }
    if (!target) { showToast(langText(`Nie ma sekcji „${inner.split("|")[0].trim()}”.${searched}`, `There is no section “${inner.split("|")[0].trim()}”.${searched}`)); return; }
    const tab = tabs.find(item => pathKeyOf(item) === target!.path);
    if (tab && !tab.path) { const { switchToTab } = await import("../documents/tabs"); switchToTab(tab.id); return; }
    await openGraphSection({ path: target.path, line: target.line });
  } catch (error) {
    console.error("Could not follow a link", error);
    showToast(`${langText("Nie można otworzyć sekcji", "Could not open section")}: ${String(error)}`);
  }
}

function onPreviewActivate(event: MouseEvent | KeyboardEvent): void {
  if (event instanceof KeyboardEvent && event.key !== "Enter") return;
  const link = event.target instanceof Element ? event.target.closest<HTMLElement>("a.wikilink[data-wiki-link]") : null;
  if (!link) return;
  event.preventDefault();
  void followWikiLink(link.dataset.wikiLink ?? "");
}

export function listenForWikiLinks(): void {
  document.addEventListener("click", onPreviewActivate, true);
  document.addEventListener("keydown", onPreviewActivate, true);
}
