/** Questions about the open documents that several features ask the same way: which tab holds a file, whether it has unsaved changes, what it was last known to contain, and which editor shows it. */
import type { EditorView } from "@codemirror/view";
import { documentState, type DocumentTab } from "./document-state";
import { groupsState } from "./groups-state";
import { sameSessionPath } from "./session";

export const tabForPath = (path: string): DocumentTab | undefined => documentState.tabs.find(tab => sameSessionPath(tab.path, path));

export const isActiveTab = (tab: Pick<DocumentTab, "id">): boolean => tab.id === documentState.activeTabId;

/** The document in use keeps its flag and its saved text in `documentState`; the others in their tab. */
export const hasUnsavedChanges = (tab: DocumentTab): boolean => (isActiveTab(tab) ? documentState.dirty : tab.dirty);
export const savedTextOf = (tab: DocumentTab): string => (isActiveTab(tab) ? documentState.savedText : tab.savedText);

/** The editor that shows the document now (null for a document that is open in a tab but not shown). */
export const liveViewOf = (tab: DocumentTab): EditorView | null => groupsState.groups.find(group => group.view && group.activeTabId === tab.id)?.view ?? null;
