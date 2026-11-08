/** Reading text files with detection of their encoding and line endings, and writing them back in the same format. */
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { decodeBytes, encodeText, looksBinary, type DecodedText, type TextEncodingName, type TextFormat } from "./text-codec";

/** Thrown when a file is not text (opening it as text would only show garbage). */
export class BinaryFileError extends Error {
  constructor(readonly path: string) { super("binary file"); this.name = "BinaryFileError"; }
}

export interface LoadedText extends DecodedText { path: string }

/** Reads a file; `forced` makes it use that encoding instead of detecting one. */
export async function loadTextFile(path: string, forced?: TextEncodingName): Promise<LoadedText> {
  const bytes = await readFile(path);
  if (!forced && looksBinary(bytes)) throw new BinaryFileError(path);
  return { path, ...decodeBytes(bytes, forced) };
}

/** Only the text of a file, decoded the same way (null for a binary file); used where the format does not matter, such as indexing. */
export async function readTextAuto(path: string): Promise<string | null> {
  const bytes = await readFile(path);
  return looksBinary(bytes) ? null : decodeBytes(bytes).text;
}

export function saveTextFile(path: string, text: string, format: TextFormat): Promise<void> {
  return writeFile(path, encodeText(text, format));
}

export const formatOf = (source: { format?: TextFormat } | null | undefined, fallback: TextFormat): TextFormat => source?.format ?? fallback;
