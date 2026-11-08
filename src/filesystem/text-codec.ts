/** Reading and writing text files in their own encoding and line endings: detection, decoding, encoding and binary sniffing (pure, no Tauri). */

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1250" | "iso-8859-2" | "windows-1252" | "iso-8859-15" | "windows-1251";
export type LineEnding = "lf" | "crlf" | "cr";

/** How a document is stored on disk; kept with its tab and used again when it is saved. */
export interface TextFormat { encoding: TextEncodingName; bom: boolean; lineEnding: LineEnding }
export interface DecodedText extends TextFormat { text: string; mixedLineEndings: boolean }

export const DEFAULT_FORMAT: TextFormat = { encoding: "utf-8", bom: false, lineEnding: "lf" };

export const ENCODINGS: ReadonlyArray<{ name: TextEncodingName; label: string }> = [
  { name: "utf-8", label: "UTF-8" },
  { name: "utf-16le", label: "UTF-16 LE" },
  { name: "utf-16be", label: "UTF-16 BE" },
  { name: "windows-1250", label: "Windows-1250 (Europa Środkowa)" },
  { name: "iso-8859-2", label: "ISO-8859-2 (Latin-2)" },
  { name: "windows-1252", label: "Windows-1252 (Europa Zachodnia)" },
  { name: "iso-8859-15", label: "ISO-8859-15 (Latin-9)" },
  { name: "windows-1251", label: "Windows-1251 (cyrylica)" },
];

export const LINE_ENDING_TEXT: Record<LineEnding, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

export function formatLabel(format: TextFormat): string {
  const name = ENCODINGS.find(item => item.name === format.encoding)?.label.split(" (")[0] ?? format.encoding;
  return format.bom ? `${name} BOM` : name;
}

const startsWith = (bytes: Uint8Array, ...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);

/** True for content that is not text: NUL bytes without a UTF-16 byte order mark, or mostly control characters. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (startsWith(bytes, 0xff, 0xfe) || startsWith(bytes, 0xfe, 0xff)) return false;
  const sample = bytes.subarray(0, 8192);
  let control = 0;
  for (const value of sample) {
    if (value === 0) return true;
    if (value < 32 && value !== 9 && value !== 10 && value !== 13 && value !== 12 && value !== 27) control++;
  }
  return sample.length > 0 && control / sample.length > 0.3;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** The most likely single-byte encoding of text that is not valid UTF-8: Windows-1250 or ISO-8859-2 for Polish text, otherwise Windows-1250 (the usual "ANSI" of a Polish system). */
export function guessLegacyEncoding(bytes: Uint8Array): TextEncodingName {
  let windows = 0, iso = 0;
  for (const value of bytes.subarray(0, 65536)) {
    // Letters that sit at different places in the two code pages (ą ś ź Ą Ś Ź ...).
    if (value === 0xb9 || value === 0x9c || value === 0x9f || value === 0xa5 || value === 0x8c || value === 0x8f) windows++;
    else if (value === 0xb1 || value === 0xb6 || value === 0xbc || value === 0xa1 || value === 0xa6 || value === 0xac) iso++;
  }
  return iso > windows ? "iso-8859-2" : "windows-1250";
}

/** The dominant line ending of a text, and whether another kind occurs as well. */
export function detectLineEnding(text: string): { lineEnding: LineEnding; mixed: boolean } {
  let crlf = 0, lf = 0, cr = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) { if (text.charCodeAt(index + 1) === 10) { crlf++; index++; } else cr++; }
    else if (code === 10) lf++;
  }
  const kinds = [crlf, lf, cr].filter(count => count > 0).length;
  const lineEnding: LineEnding = crlf >= lf && crlf >= cr && crlf > 0 ? "crlf" : cr > lf ? "cr" : "lf";
  return { lineEnding, mixed: kinds > 1 };
}

const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, "\n");

/** Decodes the bytes of a text file (the encoding is detected unless `forced`); the returned text uses "\n" for every line break. */
export function decodeBytes(bytes: Uint8Array, forced?: TextEncodingName): DecodedText {
  let encoding: TextEncodingName, bom = false, body = bytes;
  if (startsWith(bytes, 0xef, 0xbb, 0xbf) && (!forced || forced === "utf-8")) { encoding = "utf-8"; bom = true; body = bytes.subarray(3); }
  else if (startsWith(bytes, 0xff, 0xfe) && (!forced || forced === "utf-16le")) { encoding = "utf-16le"; bom = true; body = bytes.subarray(2); }
  else if (startsWith(bytes, 0xfe, 0xff) && (!forced || forced === "utf-16be")) { encoding = "utf-16be"; bom = true; body = bytes.subarray(2); }
  else if (forced) encoding = forced;
  else encoding = isValidUtf8(bytes) ? "utf-8" : guessLegacyEncoding(bytes);
  const raw = new TextDecoder(encoding).decode(body);
  const { lineEnding, mixed } = detectLineEnding(raw);
  return { text: normalizeLineEndings(raw), encoding, bom, lineEnding, mixedLineEndings: mixed };
}

const reverseTables = new Map<string, Map<string, number>>();
function reverseTable(encoding: TextEncodingName): Map<string, number> {
  let table = reverseTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let value = 0; value < 256; value++) {
      const character = decoder.decode(new Uint8Array([value]));
      if (character !== "�" && !table.has(character)) table.set(character, value);
    }
    reverseTables.set(encoding, table);
  }
  return table;
}

/** How many characters of `text` cannot be stored in the encoding (they would be written as "?"). */
export function countUnmappable(text: string, encoding: TextEncodingName): number {
  if (encoding === "utf-8" || encoding === "utf-16le" || encoding === "utf-16be") return 0;
  const table = reverseTable(encoding);
  let missing = 0;
  for (const character of text) if (character !== "\n" && !table.has(character)) missing++;
  return missing;
}

/** The bytes to write for `text` (which uses "\n") in the given format. */
export function encodeText(text: string, format: TextFormat): Uint8Array {
  const body = format.lineEnding === "lf" ? text : text.replace(/\n/g, LINE_ENDING_TEXT[format.lineEnding]);
  if (format.encoding === "utf-8") {
    const encoded = new TextEncoder().encode(body);
    if (!format.bom) return encoded;
    const out = new Uint8Array(encoded.length + 3); out.set([0xef, 0xbb, 0xbf]); out.set(encoded, 3); return out;
  }
  if (format.encoding === "utf-16le" || format.encoding === "utf-16be") {
    const little = format.encoding === "utf-16le", extra = format.bom ? 2 : 0;
    const out = new Uint8Array(extra + body.length * 2);
    if (format.bom) out.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let index = 0; index < body.length; index++) {
      const unit = body.charCodeAt(index), at = extra + index * 2;
      out[at] = little ? unit & 0xff : unit >> 8; out[at + 1] = little ? unit >> 8 : unit & 0xff;
    }
    return out;
  }
  const table = reverseTable(format.encoding);
  const out: number[] = [];
  for (const character of body) out.push(table.get(character) ?? 0x3f);
  return Uint8Array.from(out);
}
