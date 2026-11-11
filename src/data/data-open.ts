/** Ways into the data viewer: large CSV/text files open there instead of the editor, and any such file can be opened there from the file tree, the command palette or the File menu. */
import { open } from "@tauri-apps/plugin-dialog";
import { stat } from "@tauri-apps/plugin-fs";
import { openTextInTab } from "../documents/file-actions";
import { documentState } from "../documents/document-state";
import { basename } from "../filesystem/path-utils";
import { BinaryFileError, loadTextFile } from "../filesystem/text-io";
import { langText } from "../i18n/language";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { extensionOf } from "./data-source";
import { openDataViewer } from "./data-viewer";

const DATA_EXTENSIONS: ReadonlySet<string> = new Set(["csv", "tsv", "tab", "txt"]);
/** From this size a CSV or text file opens in the data viewer: the editor is for text a person reads and changes. */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;
const VERY_LARGE_FILE_BYTES = 300 * 1024 * 1024;

export const isDataFile = (path: string): boolean => DATA_EXTENSIONS.has(extensionOf(path));

/** Loads the file into the text editor, after a warning when it is very large. */
export async function openDataFileInEditor(path: string): Promise<void> {
  try {
    const size = (await stat(path)).size;
    if (size > VERY_LARGE_FILE_BYTES && !await appConfirm(langText(
      `Plik „${basename(path)}” ma ${Math.round(size / (1024 * 1024))} MB. Edytor wczyta go w całości do pamięci i może działać bardzo wolno. Otworzyć mimo to?`,
      `“${basename(path)}” is ${Math.round(size / (1024 * 1024))} MB. The editor loads the whole file into memory and may become very slow. Open it anyway?`,
    ), { confirmLabel: langText("Otwórz w edytorze", "Open in the editor"), primaryAction: "cancel" })) return;
    const loaded = await loadTextFile(path);
    openTextInTab(path, loaded.text, loaded);
  } catch (error) {
    await appAlert(error instanceof BinaryFileError
      ? langText("Ten plik nie jest tekstowy, więc nie można go otworzyć w edytorze.", "This file is not text, so it cannot be opened in the editor.")
      : `${langText("Nie udało się otworzyć pliku", "Could not open the file")}:\n${String(error)}`);
  }
}

export const openInDataViewer = (path: string, tab?: "table" | "profile" | "charts"): Promise<void> => openDataViewer(path, { tab, openInEditor: file => { void openDataFileInEditor(file); } });

/** "Insert chart from a data file": choose the file, then the wizard opens on the Charts tab with "Insert into note" ready. */
export async function insertChartFromFile(): Promise<void> {
  if (!documentState.currentPath || !/\.(?:md|markdown|mdown|mkd|mdx|rmd|qmd|mdc)$/i.test(documentState.currentPath)) {
    showToast(langText("Otwórz i zapisz notatkę Markdown, do której ma trafić wykres.", "Open and save the Markdown note that the chart is for."));
    return;
  }
  const chosen = await open({ multiple: false, filters: [{ name: langText("Dane (CSV, TSV, TXT)", "Data (CSV, TSV, TXT)"), extensions: ["csv", "tsv", "tab", "txt"] }] });
  if (typeof chosen === "string") await openInDataViewer(chosen, "charts");
}

/** Opens a large CSV or text file in the data viewer. Returns true when it did (the caller must then not open the file in the editor). */
export async function openLargeDataFile(path: string): Promise<boolean> {
  if (!isDataFile(path)) return false;
  let size = 0;
  try { size = (await stat(path)).size; } catch { return false; }
  if (size < LARGE_FILE_BYTES) return false;
  showToast(langText(`Duży plik (${Math.round(size / (1024 * 1024))} MB) otwarty w podglądzie danych, tylko do odczytu.`, `A large file (${Math.round(size / (1024 * 1024))} MB) was opened in the data view, read only.`));
  void openInDataViewer(path);
  return true;
}

/** The command for the file of the active tab (palette). */
export function openActiveFileInDataViewer(): void {
  const path = documentState.currentPath;
  if (!path || !isDataFile(path)) { showToast(langText("Aktywny dokument nie jest plikiem CSV, TSV ani TXT zapisanym na dysku.", "The active document is not a CSV, TSV or TXT file saved on disk.")); return; }
  void openInDataViewer(path);
}
