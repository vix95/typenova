/** Files copied in the system file manager (Explorer, Finder…): are there any, are they newer than TypeNova's own copy, and pasting them into a folder. */
import { invoke } from "@tauri-apps/api/core";
import { langText } from "../i18n/language";

export interface SystemClipboardFiles { names: string[]; sequence: number }

const EMPTY: SystemClipboardFiles = { names: [], sequence: 0 };
/** Clipboard sequence number at the time of the last copy or cut inside the tree. */
let internalCopySequence = 0;

export async function systemClipboardFiles(): Promise<SystemClipboardFiles> {
  try { return await invoke<SystemClipboardFiles>("clipboard_file_list"); } catch { return EMPTY; }
}

/** Remembers where the system clipboard stood when something was copied inside the tree, to tell later which copy is newer. */
export async function noteInternalCopy(): Promise<void> {
  internalCopySequence = (await systemClipboardFiles()).sequence;
}

/** True when the files on the system clipboard are the ones to paste: nothing was copied in the tree, or the system clipboard changed since. */
export function systemFilesAreNewer(files: SystemClipboardFiles, hasInternalCopy: boolean): boolean {
  return files.names.length > 0 && (!hasInternalCopy || files.sequence !== internalCopySequence);
}

/** Copies the files on the system clipboard into `folder` (names that exist get a "(copy)" suffix) and returns the created paths. */
export function pasteSystemFiles(folder: string): Promise<string[]> {
  return invoke<string[]>("paste_clipboard_files", { destDir: folder, copyLabel: langText("kopia", "copy") });
}
