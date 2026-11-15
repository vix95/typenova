/** Where the image of a Markdown image element is: a web address or data, used as it is, or a file on this computer (resolved against the folder of the document). Pure, no DOM. */

export type ImageSource = { kind: "url"; url: string } | { kind: "file"; path: string };

const REMOTE = /^(?:https?:\/\/|data:image\/|blob:|asset:)/i;

/** The path with `.` and `..` segments resolved, written with forward slashes (a drive letter, `/` or `//server` start is kept). */
function collapse(path: string): string {
  const unc = /^[\\/]{2}[^\\/]/.test(path);
  const parts = path.split(/[\\/]+/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." ) continue;
    if (part === "..") { if (out.length > 1 || (out.length === 1 && out[0] !== "" && !/^[A-Za-z]:$/.test(out[0]))) out.pop(); continue; }
    out.push(part);
  }
  return `${unc ? "//" : ""}${out.join("/")}`;
}

export function imageSource(target: string, documentPath: string | null): ImageSource | null {
  const value = target.trim().replace(/^<|>$/g, "");
  if (!value) return null;
  if (REMOTE.test(value)) return { kind: "url", url: value };
  let clean = value.replace(/^file:\/\/\/(?=[A-Za-z]:)/i, "").replace(/^file:\/\//i, "").split(/[?#]/, 1)[0];
  try { clean = decodeURIComponent(clean); } catch { /* a literal percent stays */ }
  if (!clean) return null;
  const absolute = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(clean);
  if (!absolute && !documentPath) return null;
  const base = documentPath ? documentPath.replace(/[\\/][^\\/]*$/, "") : "";
  return { kind: "file", path: collapse(absolute ? clean : `${base}/${clean}`) };
}
