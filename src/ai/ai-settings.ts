/** Claude assistant settings: the API key and the model. They live in this program's local storage on this computer. */
import { DEFAULT_AI_MODEL, validModel } from "./ai-model";

const KEY_STORAGE = "typenova.ai.apiKey";
const MODEL_STORAGE = "typenova.ai.model";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function readApiKey(): string { return (read(KEY_STORAGE) ?? "").trim(); }
export function hasApiKey(): boolean { return readApiKey().length > 0; }

export function saveApiKey(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed); else localStorage.removeItem(KEY_STORAGE);
  } catch { /* storage unavailable: the key lasts only until the program closes */ }
  document.dispatchEvent(new CustomEvent("typenova:ai-settings-changed"));
}

export function readModel(): string { return validModel(read(MODEL_STORAGE) ?? DEFAULT_AI_MODEL); }

export function saveModel(id: string): void {
  try { localStorage.setItem(MODEL_STORAGE, validModel(id)); } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent("typenova:ai-settings-changed"));
}
