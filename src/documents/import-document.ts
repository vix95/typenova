/** Importing documents as Markdown: Word (.docx) and HTML files are converted and opened in a new tab (the original file is not touched). */
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { basename } from "../filesystem/path-utils";
import { BinaryFileError, loadTextFile } from "../filesystem/text-io";
import { langText } from "../i18n/language";
import { appAlert } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { createNewTab } from "./tabs";

/** HTML to Markdown with the usual conventions (ATX headings, fenced code, dashes for bullets). */
export async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  service.remove(["script", "style", "noscript"]);
  return service.turndown(html).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const titleOf = (path: string, extension: RegExp) => basename(path).replace(extension, "") + ".md";

function openConverted(markdown: string, label: string): void {
  createNewTab(markdown, label);
  showToast(`${langText("Zaimportowano jako Markdown", "Imported as Markdown")}: ${label}. ${langText("Zapisz dokument, aby go zachować.", "Save the document to keep it.")}`);
}

export async function importWordDocument(path: string): Promise<void> {
  try {
    const [{ default: mammoth }, bytes] = await Promise.all([import("mammoth/mammoth.browser.min.js"), readFile(path)]);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const pictures = (result.value.match(/<img\b/g) ?? []).length;
    const markdown = await htmlToMarkdown(result.value.replace(/<img\b[^>]*>/g, ""));
    openConverted(markdown, titleOf(path, /\.docx$/i));
    if (pictures) showToast(langText(`Pominięto obrazy: ${pictures} (import przenosi tekst, nagłówki, listy, tabele i linki).`, `Pictures skipped: ${pictures} (the import keeps text, headings, lists, tables and links).`));
  } catch (error) {
    await appAlert(`${langText("Nie udało się zaimportować dokumentu Word", "Could not import the Word document")}:\n${String((error as Error)?.message ?? error)}`);
  }
}

export async function importHtmlFile(path: string): Promise<void> {
  try {
    const loaded = await loadTextFile(path);
    openConverted(await htmlToMarkdown(loaded.text), titleOf(path, /\.x?html?$/i));
  } catch (error) {
    await appAlert(error instanceof BinaryFileError ? langText("To nie jest plik HTML.", "This is not an HTML file.") : `${langText("Nie udało się zaimportować pliku", "Could not import the file")}:\n${String((error as Error)?.message ?? error)}`);
  }
}

/** File > Import: choose a Word or HTML file. */
export async function importDocument(): Promise<void> {
  const chosen = await open({ multiple: false, filters: [{ name: langText("Dokumenty Word i HTML", "Word and HTML documents"), extensions: ["docx", "html", "htm", "xhtml"] }] });
  if (typeof chosen !== "string") return;
  if (/\.docx$/i.test(chosen)) await importWordDocument(chosen); else await importHtmlFile(chosen);
}
