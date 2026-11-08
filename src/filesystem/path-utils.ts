/** Pure filesystem-path helpers shared by editor, project explorer and graph indexing. */
import { fileKind, MARKDOWN_EXTENSIONS as MARKDOWN_EXTENSION_SET } from "./file-types.js";

export const MARKDOWN_EXTENSIONS = MARKDOWN_EXTENSION_SET;

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function normalizePath(input: string): string {
  const unc = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.exec(input);
  if (unc) {
    const rootParts = unc[0].replace(/\//g, "\\").split("\\").filter(Boolean);
    const rest = input.slice(unc[0].length).replace(/[\\/]+/g, "\\");
    const stack = rest.split("\\").filter(Boolean);
    const normalized: string[] = [];
    for (const part of stack) {
      if (part === ".") continue;
      if (part === "..") { if (normalized.length) normalized.pop(); }
      else normalized.push(part);
    }
    return `\\\\${[...rootParts, ...normalized].join("\\")}`;
  }

  const drive = /^([A-Za-z]:)[\\/]/.exec(input);
  const absolute = input.startsWith("/") || input.startsWith("\\");
  const separator = drive ? "\\" : "/";
  const root = drive ? drive[1] : absolute ? "/" : "";
  const remainder = drive ? input.slice(drive[0].length) : input;
  const parts = remainder.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!root) out.push("..");
    } else out.push(part);
  }
  if (drive) return `${root}\\${out.join("\\")}`;
  if (absolute) return `/${out.join("/")}`;
  return out.join(separator) || ".";
}

export function normalizeLocalImagePath(input: string): string {
  return normalizePath(input);
}

export function isMarkdownPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return MARKDOWN_EXTENSIONS.has(extension);
}

/** Image formats the viewer shows instead of the editor (see `file-types.ts`). */
export function isViewableImageFile(name: string): boolean {
  return fileKind(name) === "image";
}

/** Files with a viewer of their own (picture, PDF, audio, video) or an import (Word) instead of the editor. */
export function isViewerFile(name: string): boolean {
  const kind = fileKind(name);
  return kind === "image" || kind === "pdf" || kind === "audio" || kind === "video" || kind === "docx";
}

/** Files that can be tried in the editor: known text formats and files of an unknown kind (a binary one is turned away after reading the start of it). */
export function isEditableTextFile(name: string): boolean {
  const kind = fileKind(name);
  return kind === "markdown" || kind === "text" || kind === "unknown";
}
