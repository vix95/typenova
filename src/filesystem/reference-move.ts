/** When a file or a folder is moved or renamed, the Markdown links and images that point at it (or at something inside it) must follow, and so must the relative links of a document that is itself moved. This is the pure rule: from the text of one document it finds those references and says what to write instead. No file system, no editor. */

export interface PathMove { from: string; to: string }
export interface ReferenceEdit { from: number; to: number; insert: string }

const slashes = (path: string): string => path.replace(/\\/g, "/");
const trimmed = (path: string): string => slashes(path).replace(/\/+$/, "");
const sameKey = (a: string, b: string): boolean => trimmed(a).toLowerCase() === trimmed(b).toLowerCase();

/** Where `path` is after the move, or null when it is not the moved item or inside it (case does not matter, as on Windows). */
function movedPath(path: string, move: PathMove): string | null {
  const text = slashes(path), from = trimmed(move.from), to = trimmed(move.to);
  if (sameKey(text, from)) return to;
  return text.toLowerCase().startsWith(`${from.toLowerCase()}/`) ? to + text.slice(from.length) : null;
}

function parentOf(path: string): string {
  const text = trimmed(path);
  const cut = text.lastIndexOf("/");
  return cut > 0 ? text.slice(0, cut) : cut === 0 ? "/" : "";
}

/** `relative` appended to `folder`, with `.` and `..` resolved. */
function resolveFrom(folder: string, relative: string): string {
  const base = slashes(folder);
  const root = base.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of `${base}/${slashes(relative)}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 1) parts.pop(); else if (part !== "..") parts.push(part);
  }
  return root + parts.join("/");
}

/** The path from `folder` to `target` (both absolute), or null when they are on different drives. */
function relativePath(folder: string, target: string): string | null {
  const from = slashes(folder).split("/").filter(Boolean), to = slashes(target).split("/").filter(Boolean);
  if (/^[a-z]:$/i.test(from[0] ?? "") && (from[0] ?? "").toLowerCase() !== (to[0] ?? "").toLowerCase()) return null;
  let common = 0;
  while (common < from.length && common < to.length && from[common].toLowerCase() === to[common].toLowerCase()) common++;
  return [...Array(from.length - common).fill(".."), ...to.slice(common)].join("/");
}

const isExternal = (target: string): boolean => (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) || target.startsWith("//");
const encodeTarget = (path: string): string => path.replace(/[ %()<>"[\]#?]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** What a reference to `raw` becomes, or null when it stays as it is (or is not a reference to a file of the project). `raw` is the text of the address as written, with its `<…>` if it has them. */
function retarget(raw: string, oldFolder: string, newFolder: string, move: PathMove): string | null {
  const angle = raw.startsWith("<") && raw.endsWith(">");
  const inner = angle ? raw.slice(1, -1) : raw;
  const cut = inner.search(/[?#]/);
  const written = cut < 0 ? inner : inner.slice(0, cut);
  const suffix = cut < 0 ? "" : inner.slice(cut);
  if (!written || isExternal(written) || written.startsWith("/")) return null;
  let decoded = written;
  try { decoded = decodeURIComponent(written); } catch { /* a percent sign that is only a percent sign */ }
  const absolute = /^[a-z]:[\\/]/i.test(decoded);
  const before = absolute ? slashes(decoded) : resolveFrom(oldFolder, decoded);
  const after = movedPath(before, move) ?? before;
  if (after === before && sameKey(oldFolder, newFolder)) return null;
  let next: string | null;
  if (absolute) next = decoded.includes("\\") ? after.replace(/\//g, "\\") : after;
  else {
    next = relativePath(newFolder, after);
    if (next !== null && decoded.startsWith("./") && !next.startsWith("../")) next = `./${next}`;
  }
  if (next === null || next === decoded) return null;
  const text = angle ? next : (written !== decoded || /[ ()]/.test(next) ? encodeTarget(next) : next);
  return (angle ? `<${text}>` : text) + suffix;
}

/** Spans of a line that are inline code, blanked out so that an address inside one is not taken for a link. */
const withoutCode = (line: string): string => line.replace(/(`+)[^`\n]*?\1/g, match => " ".repeat(match.length));

const INLINE = /\]\(\s*(<[^>\n]+>|[^\s)<][^\s)]*(?:\([^\s)]*\)[^\s)]*)*)/g;
const DEFINITION = /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/;
const HTML_ATTRIBUTE = /\b(?:src|href)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')/gi;

/**
 * The edits that make the references of a document right after `move`. The document was at `oldDocument` and is at `newDocument` now (the same path when
 * it was not moved itself). Links and images `[x](address)`, definitions `[id]: address` and `src`/`href` of HTML are looked at, not those in code.
 */
export function planReferenceMove(text: string, oldDocument: string, newDocument: string, move: PathMove): ReferenceEdit[] {
  const oldFolder = parentOf(oldDocument), newFolder = parentOf(newDocument);
  const edits: ReferenceEdit[] = [];
  let offset = 0, fence: string | null = null;
  for (const line of text.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (marker) { fence = marker; continue; }
    const visible = withoutCode(line);
    const found: { at: number; raw: string }[] = [];
    for (const match of visible.matchAll(INLINE)) found.push({ at: match.index + match[0].length - match[1].length, raw: match[1] });
    const definition = DEFINITION.exec(visible);
    if (definition) found.push({ at: definition[0].length - definition[1].length, raw: definition[1] });
    for (const match of visible.matchAll(HTML_ATTRIBUTE)) {
      const raw = match[1] ?? match[2];
      found.push({ at: match.index + match[0].lastIndexOf(raw), raw });
    }
    for (const { at, raw } of found) {
      const next = retarget(raw, oldFolder, newFolder, move);
      if (next !== null && next !== raw) edits.push({ from: start + at, to: start + at + raw.length, insert: next });
    }
  }
  return edits.sort((a, b) => a.from - b.from);
}
