/** The files TypeNova itself writes into the folders of a project, so that they can be left out of its own lists (the setting "Hide TypeNova's files", on by default). They stay on disk and travel with the folder; only the program does not show them. Pure, no files. */

/** The folder of a repository with its dictionary (`.typenova/dictionary.txt`). */
export const OWN_FOLDER = ".typenova";
/** The project config file in the root of a project folder (its terminals). */
export const PROJECT_CONFIG_NAME = "typenova.config.json";
/**
 * The files that belong to a document and sit beside it: `name.md.config.json` (hidden sections, bookmarks, highlights) and the former `name.md.bookmarks.json`
 * (read once and moved into the config file). They follow their document when it is moved, copied or deleted.
 */
export const COMPANION_SUFFIXES: readonly string[] = [".config.json", ".bookmarks.json"];

/** The companion files a document may have (they need not exist). */
export const companionPaths = (documentPath: string): string[] => COMPANION_SUFFIXES.map(suffix => `${documentPath}${suffix}`);

export interface ListedEntry { name: string; isDirectory?: boolean }

const key = (name: string): string => name.toLowerCase();

/**
 * Whether an entry of a folder listing is a file of TypeNova. A companion file of a document counts only when that document is in the same folder,
 * so that an ordinary file such as `app.settings.config.json` is never taken for one. Names are compared without case, as on Windows.
 */
export function isOwnEntry(entry: ListedEntry, siblingFiles: ReadonlySet<string>): boolean {
  const name = key(entry.name);
  if (entry.isDirectory) return name === OWN_FOLDER;
  if (name === PROJECT_CONFIG_NAME) return true;
  return COMPANION_SUFFIXES.some(suffix => {
    if (!name.endsWith(suffix)) return false;
    const document = name.slice(0, -suffix.length);
    return document.includes(".") && siblingFiles.has(document);
  });
}

/** The listing without TypeNova's files (the order is kept). */
export function withoutOwnEntries<T extends ListedEntry>(entries: readonly T[]): T[] {
  const files = new Set(entries.filter(entry => !entry.isDirectory).map(entry => key(entry.name)));
  return entries.filter(entry => !isOwnEntry(entry, files));
}
