/** Files the application was started with (a double click in the file manager) or that a second launch handed over. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { documentState } from "../documents/document-state";
import { openDroppedPaths } from "./external-drop";

/** The session restore replaces the open tabs; opening starts after it, or after a few seconds at the latest. */
async function whenSessionIsRestored(): Promise<void> {
  for (let waited = 0; !documentState.startupSessionReady && waited < 5000; waited += 100) await new Promise(resolve => window.setTimeout(resolve, 100));
}

export function initLaunchPaths(): void {
  void listen<string[]>("open-paths", event => void openDroppedPaths(event.payload)).catch(() => { /* no event bridge outside Tauri */ });
  void invoke<string[]>("take_launch_paths")
    .then(async paths => { if (paths.length) { await whenSessionIsRestored(); await openDroppedPaths(paths); } })
    .catch(() => { /* not running inside Tauri */ });
}
