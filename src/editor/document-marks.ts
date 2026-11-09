/** The marks the editor shows for a document (bookmarks and highlights): one call that redraws them all, for code that replaces the editor state. */
import { refreshBookmarkMarkers } from "./bookmarks";
import { refreshHighlightMarks } from "./highlights";

export function refreshDocumentMarks(): void {
  refreshBookmarkMarkers();
  refreshHighlightMarks();
}
