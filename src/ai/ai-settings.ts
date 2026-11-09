/** Assistant settings: which provider is on, and for each provider its model, its address and what is known about its stored API key. The key itself is never in the interface: it lives encrypted in the backend. */
import { invoke } from "@tauri-apps/api/core";
import { validModel } from "./ai-model";
import { defaultModel, keySecretName, normalizeUrl, parseProvider, providerInfo, readiness, type AdapterId, type AiProvider, type Readiness } from "./providers";

const PROVIDER_STORAGE = "typenova.ai.provider";
const modelStorage = (provider: AiProvider): string => `typenova.ai.${provider}.model`;
const urlStorage = (provider: AiProvider): string => `typenova.ai.${provider}.url`;
/** Where earlier versions kept these (Claude and Ollama only), read when the new place has nothing. */
const LEGACY_MODEL: Partial<Record<AiProvider, string>> = { anthropic: "typenova.ai.model", ollama: "typenova.ai.ollamaModel" };
const LEGACY_URL: Partial<Record<AiProvider, string>> = { ollama: "typenova.ai.ollamaUrl" };
/** Where the first versions kept the Claude key in plain text; it is moved into the encrypted store and removed. */
const LEGACY_KEY_STORAGE = "typenova.ai.apiKey";

/** Dispatched whenever a setting or what is known about a key changes. */
export const AI_SETTINGS_EVENT = "typenova:ai-settings-changed";
function changed(): void { document.dispatchEvent(new CustomEvent(AI_SETTINGS_EVENT)); }

function read(key: string | undefined): string | null {
  if (!key) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: the choice lasts until the program closes */ }
}

/** True in the desktop program, where the backend that holds the keys and makes the requests is. */
export function aiBackendAvailable(): boolean { return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window; }

// ---- Provider, model and address

export function readProvider(): AiProvider { return parseProvider(read(PROVIDER_STORAGE)); }
export function saveProvider(provider: AiProvider): void { write(PROVIDER_STORAGE, provider); changed(); }

/** The model chosen for a provider; Claude always has one of its own, the others none until one is chosen. */
export function readModel(provider: AiProvider): string {
  const stored = (read(modelStorage(provider)) ?? read(LEGACY_MODEL[provider]) ?? "").trim();
  if (providerInfo(provider).models === "fixed") return validModel(stored || defaultModel(provider));
  return stored;
}
export function saveModel(provider: AiProvider, name: string): void {
  write(modelStorage(provider), providerInfo(provider).models === "fixed" ? validModel(name) : name.trim());
  changed();
}

/** The address of a provider: the one the user gave, else its default (empty when it has none). */
export function readUrl(provider: AiProvider): string {
  const info = providerInfo(provider);
  if (info.url === "none") return info.defaultUrl;
  return normalizeUrl(read(urlStorage(provider)) ?? read(LEGACY_URL[provider]) ?? "", info.defaultUrl) ?? info.defaultUrl;
}
/** Saves an address; false when it is not an address (nothing is changed then). */
export function saveUrl(provider: AiProvider, input: string): boolean {
  const url = normalizeUrl(input, providerInfo(provider).defaultUrl);
  if (url === null) return false;
  write(urlStorage(provider), url);
  changed();
  return true;
}

/** The model of the provider that is on. */
export function activeModel(): string { return readModel(readProvider()); }

// ---- API keys (kept by the backend)

export interface KeyInfo { present: boolean; readable: boolean; lastChars: string }
const NO_KEY: KeyInfo = { present: false, readable: false, lastChars: "" };
const keyInfos = new Map<AiProvider, KeyInfo>();

/** What is known about the stored key of a provider: whether there is one, whether it can be read here, and its last characters. */
export function getKeyInfo(provider: AiProvider): KeyInfo { return keyInfos.get(provider) ?? NO_KEY; }

function setKeyInfo(provider: AiProvider, next: KeyInfo): void { keyInfos.set(provider, next); changed(); }

/** Asks the backend about the stored key of a provider (of every provider that has one when none is named). */
export async function refreshKeyInfo(provider?: AiProvider): Promise<void> {
  if (!aiBackendAvailable()) return;
  const targets = provider ? [provider] : (["anthropic", "openai", "gemini", "custom"] as const);
  for (const target of targets) {
    const name = keySecretName(target);
    if (!name) continue;
    try { keyInfos.set(target, await invoke<KeyInfo>("secret_info", { name })); } catch { /* the backend is not there */ }
  }
  changed();
}

/** Encrypts and stores a key. False when it is not a valid key or the backend could not store it. */
export async function saveApiKey(provider: AiProvider, value: string): Promise<boolean> {
  const name = keySecretName(provider);
  if (!name || !aiBackendAvailable() || !value.trim()) return false;
  try { setKeyInfo(provider, await invoke<KeyInfo>("secret_store", { name, value })); return true; } catch { return false; }
}

export async function removeApiKey(provider: AiProvider): Promise<void> {
  const name = keySecretName(provider);
  if (!name || !aiBackendAvailable()) return;
  try { await invoke("secret_delete", { name }); } catch { /* nothing stored */ }
  setKeyInfo(provider, NO_KEY);
}

/** A Claude key from the first versions, kept in plain text in the program's settings, is stored encrypted and removed from the settings. */
export async function migrateLegacyApiKey(): Promise<void> {
  const legacy = read(LEGACY_KEY_STORAGE);
  if (!legacy || !aiBackendAvailable()) return;
  if (await saveApiKey("anthropic", legacy)) { try { localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* storage unavailable */ } }
}

export function hasApiKey(provider: AiProvider): boolean { const info = getKeyInfo(provider); return info.present && info.readable; }

// ---- Readiness and the request target

/** What a provider still needs before it can be used. */
export function providerReadiness(provider: AiProvider): Readiness {
  return readiness(providerInfo(provider), { hasKey: hasApiKey(provider), url: readUrl(provider), model: readModel(provider) });
}

/** Whether the provider that is on can be used. */
export function isAiReady(): boolean { return providerReadiness(readProvider()) === "ready"; }

/** What the backend needs to reach a provider: its protocol, its address (only where the user may choose one) and the name of its key. */
export function backendTarget(provider: AiProvider): { adapter: AdapterId; baseUrl: string | null; keyName: string | null } {
  const info = providerInfo(provider);
  return { adapter: info.adapter, baseUrl: info.url === "none" ? null : readUrl(provider) || null, keyName: keySecretName(provider) };
}
