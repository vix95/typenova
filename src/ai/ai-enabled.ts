/** The switch for the AI features as a whole (Settings → AI assistant). While it is off, the button, the chat, the options, the entries of the menus and the shortcuts are gone: the program behaves as one without an assistant. On by default. */
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";

const KEY = "typenova.ai.enabled";
export const AI_ENABLED_EVENT = "typenova:ai-enabled-changed";

export const aiEnabled = (): boolean => readPreferenceFlag(KEY, true);

function apply(): void { document.body.classList.toggle("ai-disabled", !aiEnabled()); }

export function setAiEnabled(on: boolean): void {
  writePreferenceFlag(KEY, on);
  apply();
  document.dispatchEvent(new CustomEvent(AI_ENABLED_EVENT));
}

export function installAiEnabled(): void { apply(); }
