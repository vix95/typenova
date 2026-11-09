/** Highlights in the config file next to a Markdown document (`notes.md.config.json`): reading and writing them. */
import { readDocConfig, updateDocConfig } from "../documents/doc-config";
import { withDocConfigParts } from "../documents/doc-config-model";
import { highlightEntries, parseHighlightList, type Highlight } from "./highlights-model";

/** What was found next to a document: nothing, highlights, or a file that is not a config file (it is never overwritten). */
export type HighlightFileState = { kind: "none" } | { kind: "found"; highlights: Highlight[] } | { kind: "unreadable" } | { kind: "unavailable" };

export async function readHighlightFile(path: string): Promise<HighlightFileState> {
  const read = await readDocConfig(path);
  if (read.kind === "unreadable" || read.kind === "unavailable") return { kind: read.kind };
  if (read.kind === "found" && Array.isArray(read.config.highlights)) return { kind: "found", highlights: parseHighlightList(read.config.highlights, path) };
  return { kind: "none" };
}

/** Writes the highlights of a document into its config file (other parts stay as they are); with none the part is removed, and the file with it when nothing is left. */
export async function writeHighlightFile(path: string, highlights: readonly Highlight[]): Promise<void> {
  await updateDocConfig(path, config => withDocConfigParts(config, { highlights: highlightEntries(highlights) }));
}
