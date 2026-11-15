/** The notes of the open project as searchable passages: the files of the link index, read once and kept until they change, with the open documents taken as they are now (saved or not). Nothing is sent anywhere from here. */
import { documentState } from "../documents/document-state";
import { indexedFiles } from "../documents/project-index";
import { indexWithTabPaths, readTexts, textOfTab } from "../documents/link-rename-apply";
import { sameSessionPath } from "../documents/session";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { rootContaining } from "../filesystem/project-roots";
import { pathIsInside } from "../filesystem/project-tree-operations";
import type { IndexedFile } from "../graph/project-index-model";
import { chunkMarkdown, type Chunk } from "./project-chunks";
import { buildSearchIndex, type SearchIndex } from "./project-search";

export interface Corpus {
  chunks: Chunk[];
  index: SearchIndex;
  /** The notes the passages come from, as the person sees them (relative path) and as the program names them. */
  files: { file: string; path: string }[];
  /** The project has too many files to be indexed: nothing was searched. */
  tooLarge: boolean;
}

const cache = new Map<string, { stamp: string; chunks: Chunk[] }>();

/** A file as the person sees it: relative to its project folder, with the folder's name in front when there are several folders. */
export function displayPath(path: string): string {
  const roots = documentState.projectRoots;
  const root = rootContaining(roots, path);
  if (!root) return basename(path);
  const rest = path.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return roots.length > 1 ? `${basename(root)}/${rest}` : rest;
}

/** Reads (what changed of) the notes and cuts them into passages. `folder` limits it to the notes inside one folder. */
export async function loadCorpus(folder?: string): Promise<Corpus> {
  const read = await indexedFiles();
  const tabs = documentState.tabs.filter(tab => tab.path && isMarkdownPath(tab.path));
  const files: IndexedFile[] = indexWithTabPaths(read.files, tabs).filter(file => !folder || pathIsInside(folder, file.path));
  const live = new Map<string, string>();
  for (const file of files) {
    const tab = tabs.find(item => sameSessionPath(item.path, file.path));
    if (tab) live.set(file.path, textOfTab(tab).toString());
  }
  const stale = files.filter(file => !live.has(file.path) && cache.get(file.path)?.stamp !== file.stamp);
  for (const text of await readTexts(stale)) {
    const file = files.find(item => item.path === text.path);
    if (file) cache.set(file.path, { stamp: file.stamp, chunks: chunkMarkdown(file.path, file.name, text.text) });
  }
  const chunks: Chunk[] = [];
  for (const file of files) {
    const text = live.get(file.path);
    chunks.push(...(text !== undefined ? chunkMarkdown(file.path, file.name, text) : cache.get(file.path)?.chunks ?? []));
  }
  return { chunks, index: buildSearchIndex(chunks), files: files.map(file => ({ file: displayPath(file.path), path: file.path })), tooLarge: read.tooLarge };
}
