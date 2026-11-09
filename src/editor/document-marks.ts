/** The marks the editor shows for a document (bookmarks and highlights): one call that redraws them all, for code that replaces the editor state. */
import { refreshSelectionContext } from "../ai/chat-panel";
import { refreshBookmarkMarkers } from "./bookmarks";
import { refreshHighlightMarks } from "./highlights";

export function refreshDocumentMarks(): void {
  refreshBookmarkMarkers();
  refreshHighlightMarks();
  // A tab was switched or replaced: the chat shows the document that is open now.
  refreshSelectionContext();
}
