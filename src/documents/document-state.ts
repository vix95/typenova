/** Shared mutable state of the active document session: tabs, paths, dirty flag and revisions. */
import { EditorState } from "@codemirror/state";
import type { ViewPosition } from "./session";
import { readPreferenceFlag } from "../settings/preferences";

export type DocumentTab = { id: string; path: string | null; label: string; state: EditorState; savedText: string; dirty: boolean; viewPosition?: ViewPosition | null };
export const OPEN_SESSION_STORAGE_KEY = "typenova.openSession.v1";
export const showWelcomeWhenNoSession = readPreferenceFlag("typenova.showWelcomeWhenNoSession");
export const documentState = {
  tabs: [] as DocumentTab[],
  activeTabId: "" as string,
  tabSequence: 1 as number,
  startupSessionReady: false as boolean,
  performanceMode: false as boolean,
  currentPath: null as string | null,
  projectRoot: null as string | null,
  untitledLabel: (showWelcomeWhenNoSession ? "Welcome.md" : "Untitled.md") as string,
  savedText: "" as string,
  dirty: false as boolean,
  docRevision: 0 as number,
};
