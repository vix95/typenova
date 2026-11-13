/** The links that lead into the note in use: the files that may hold one are picked with the link index, read (the open documents as they are now) and their links resolved the way the section graph resolves them. */
import { linksInto, sectionTitles, type LinkOccurrence, type SourceText } from "../graph/link-rename";
import { sourcesFromIndex } from "../graph/project-index-model";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { documentState } from "./document-state";
import { indexWithTabPaths, pathKeyOf, readTexts, textOfTab } from "./link-rename-apply";
import { indexedFiles } from "./project-index";

export interface BacklinkResult {
  /** The links, by file in the order of the project. */
  hits: LinkOccurrence[];
  /** The project is too big to be indexed: nothing was searched. */
  tooLarge: boolean;
  /** What was asked about. */
  path: string;
  title: string;
}

/** The saved Markdown note in use, or null (another kind of file, or a note that has no name yet: nothing can link to it). */
export function activeNoteTab() {
  const tab = documentState.tabs.find(item => item.id === documentState.activeTabId);
  return tab?.path && isMarkdownPath(tab.path) ? tab : null;
}

const stemOf = (name: string): string => name.replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();

export async function backlinksOfActive(): Promise<BacklinkResult | null> {
  const active = activeNoteTab();
  if (!active) return null;
  const targetPath = pathKeyOf(active), name = basename(active.path!);
  const tabs = documentState.tabs.filter(tab => isMarkdownPath(tab.path || tab.label));
  const open: SourceText[] = tabs.map(tab => ({ path: pathKeyOf(tab), name: tab.path ? basename(tab.path) : tab.label, text: textOfTab(tab).toString() }));
  const own = open.find(source => source.path === targetPath);
  const base: BacklinkResult = { hits: [], tooLarge: false, path: targetPath, title: name };
  if (!own) return base;
  const read = await indexedFiles();
  if (read.tooLarge) return { ...base, tooLarge: true };
  const indexed = indexWithTabPaths(read.files, tabs);
  // A file can hold a link into this note only if one of its links names this file or one of its sections.
  const keys = new Set([stemOf(name), ...sectionTitles(own.text).map(section => section.title.toLocaleLowerCase())]);
  const candidates = indexed.filter(file => file.path !== targetPath && file.links.some(link => keys.has(link)) && !open.some(source => source.path === file.path));
  const known = new Map<string, SourceText>(open.map(source => [source.path, source]));
  for (const text of await readTexts(candidates)) known.set(text.path, text);
  return { ...base, hits: linksInto(sourcesFromIndex(indexed, known), targetPath) };
}
