/** The light index of a project's Markdown files: for each file its sections and what its links name. It is enough to find which files a rename or a followed link concerns, so only those are read. Pure (no DOM, no files). */
import { linkKeysOf, sectionTitles, type SectionTitle, type SourceText } from "./link-rename.js";

export interface IndexedFile {
  path: string;
  name: string;
  /** Changes whenever the file does (modification time and size), so an unchanged file is not read again. */
  stamp: string;
  sections: SectionTitle[];
  /** What the links in the file name (titles, anchors, file names), lowercased. */
  links: string[];
}

export const INDEX_VERSION = 1;

export function indexFile(path: string, name: string, stamp: string, text: string): IndexedFile {
  return { path, name, stamp, sections: sectionTitles(text), links: linkKeysOf(text) };
}

const stemOf = (name: string): string => name.replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();

/** A file as the planner sees it when its text is not needed: only its headings, which is all the planner takes from a file without links to the section. */
export function outlineSource(file: IndexedFile): SourceText {
  return { path: file.path, name: file.name, text: file.sections.map(section => `# ${section.title}`).join("\n") };
}

/** The files that hold a link naming `title` (the ones a rename of that section may have to rewrite). */
export function filesLinkingTo(files: readonly IndexedFile[], title: string): IndexedFile[] {
  const wanted = title.trim().toLocaleLowerCase();
  return files.filter(file => file.links.includes(wanted));
}

/** The files a link naming `wanted` (a section title, or a file's name) may lead to. */
export function filesWithSection(files: readonly IndexedFile[], wanted: string): IndexedFile[] {
  const key = wanted.trim().toLocaleLowerCase();
  return files.filter(file => stemOf(file.name) === key || file.sections.some(section => section.title.toLocaleLowerCase() === key));
}

/** The files with at least one link. */
export const filesWithLinks = (files: readonly IndexedFile[]): IndexedFile[] => files.filter(file => file.links.length > 0);

/**
 * The sources a plan is made from: the texts that are known (read just now) and, for every other file, its outline.
 * `known` wins over the index, and the order of `files` is kept, because the graph resolves a title by the order of the project.
 */
export function sourcesFromIndex(files: readonly IndexedFile[], known: ReadonlyMap<string, SourceText>): SourceText[] {
  const order = files.map(file => known.get(file.path) ?? outlineSource(file));
  const listed = new Set(files.map(file => file.path));
  return [...order, ...[...known.values()].filter(source => !listed.has(source.path))];
}

/** What a link names: its section title (`[[Title]]`, `[[file#Title|label]]`), or for a link to a file alone, the file's name. Lowercased. */
export function titleOfLink(inner: string): string {
  const target = inner.split("|")[0];
  const at = target.lastIndexOf("#");
  return (at >= 0 ? target.slice(at + 1) : target).trim().replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();
}
