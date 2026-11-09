/** The config file next to a document (`notes.md.config.json`): one file for everything the program keeps about a document. Pure helpers, no file access. */

/** The parts of the config file this program knows, in the order they are written. */
export const DOC_CONFIG_KEYS = ["hiddenSections", "focusedSection", "bookmarks", "highlights"] as const;
export type DocConfigKey = typeof DOC_CONFIG_KEYS[number];
export type DocConfig = Record<string, unknown>;

/** Name of the config file next to a document: the file's own name plus `.config.json`. */
export function docConfigPath(documentPath: string): string { return `${documentPath}.config.json`; }

/**
 * The content of a config file's text. An empty (missing) text is an empty config; text that is not a JSON object is
 * not a config file at all (null), so that it is never overwritten.
 */
export function parseDocConfig(raw: string | null | undefined): DocConfig | null {
  if (raw === null || raw === undefined || raw.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as DocConfig : null;
  } catch { return null; }
}

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return Array.isArray(value) ? value.length > 0 : true;
}

/** A copy of `config` with some parts replaced; a part given as undefined, null or an empty list is removed. Parts this program does not know are kept. */
export function withDocConfigParts(config: DocConfig, parts: Partial<Record<DocConfigKey, unknown>>): DocConfig {
  const next: DocConfig = { ...config };
  for (const key of DOC_CONFIG_KEYS) {
    if (!(key in parts)) continue;
    if (hasContent(parts[key])) next[key] = parts[key]; else delete next[key];
  }
  return next;
}

/** True when the config holds nothing worth a file (the file is then removed). */
export function isEmptyDocConfig(config: DocConfig): boolean {
  return !Object.entries(config).some(([key, value]) => key !== "version" && key !== "document" && hasContent(value));
}

/** The text of the config file: version, document name, the known parts in order, then any other parts as they were. */
export function serializeDocConfig(documentName: string, config: DocConfig): string {
  const known = new Set<string>(DOC_CONFIG_KEYS);
  const ordered: DocConfig = { version: 1, document: documentName };
  for (const key of DOC_CONFIG_KEYS) if (hasContent(config[key])) ordered[key] = config[key];
  for (const [key, value] of Object.entries(config)) if (!known.has(key) && key !== "version" && key !== "document") ordered[key] = value;
  return JSON.stringify(ordered, null, 2) + "\n";
}
