/** Opens a file in the viewer that suits it: pictures, PDF, audio and video here, Word documents through the import. */
import { fileKind } from "../filesystem/file-types.js";
import { openImageFile } from "./media-viewer";
import { openMediaPlayer } from "./media-player";
import { openPdfFile } from "./pdf-viewer";

/** True when the file has a viewer (or an import); false for text, which opens in the editor. */
export async function openViewerFile(path: string): Promise<boolean> {
  switch (fileKind(path)) {
    case "image": await openImageFile(path); return true;
    case "pdf": await openPdfFile(path); return true;
    case "audio": case "video": await openMediaPlayer(path); return true;
    case "docx": { const { importWordDocument } = await import("../documents/import-document"); await importWordDocument(path); return true; }
    default: return false;
  }
}
