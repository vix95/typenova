/** The models a provider offers, asked for from the backend (which contacts the provider with the stored key). Asking also tells whether the address and the key work, so it is what "Check the connection" does. */
import { invoke } from "@tauri-apps/api/core";
import { aiBackendAvailable, AI_SETTINGS_EVENT, backendTarget, readModel, saveModel } from "./ai-settings";
import { pickModel, providerInfo, type AiProvider } from "./providers";

export type ListStatus = "idle" | "loading" | "ok" | "error";

export interface ModelList {
  models: readonly string[];
  status: ListStatus;
  /** What went wrong, as the backend names it (`auth`, `connection`…), or `unavailable` outside the desktop program. */
  errorKind: string;
  errorMessage: string;
}

const EMPTY: ModelList = { models: [], status: "idle", errorKind: "", errorMessage: "" };
const lists = new Map<AiProvider, ModelList>();
const generation = new Map<AiProvider, number>();

export function modelList(provider: AiProvider): ModelList { return lists.get(provider) ?? EMPTY; }

function set(provider: AiProvider, next: ModelList): void {
  lists.set(provider, next);
  document.dispatchEvent(new CustomEvent(AI_SETTINGS_EVENT));
}

function errorOf(error: unknown): { kind: string; message: string } {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const item = error as { kind: unknown; message?: unknown };
    return { kind: String(item.kind), message: typeof item.message === "string" ? item.message : "" };
  }
  return { kind: "api", message: String(error) };
}

/**
 * Asks the provider which models it offers. The list and the outcome are kept for the options window and the model
 * choosers. When the user has not chosen a model yet, a sensible one is chosen from the list.
 */
export async function refreshModels(provider: AiProvider): Promise<void> {
  if (!aiBackendAvailable()) { set(provider, { models: [], status: "error", errorKind: "unavailable", errorMessage: "" }); return; }
  const mine = (generation.get(provider) ?? 0) + 1;
  generation.set(provider, mine);
  set(provider, { models: modelList(provider).models, status: "loading", errorKind: "", errorMessage: "" });
  const target = backendTarget(provider);
  try {
    const models = await invoke<string[]>("ai_list_models", { adapter: target.adapter, baseUrl: target.baseUrl, keyName: target.keyName });
    if (generation.get(provider) !== mine) return;
    const info = providerInfo(provider);
    if (info.models === "fetched" && !readModel(provider) && models.length) saveModel(provider, pickModel(models, info.preferred));
    set(provider, { models, status: "ok", errorKind: "", errorMessage: "" });
  } catch (error) {
    if (generation.get(provider) !== mine) return;
    const { kind, message } = errorOf(error);
    set(provider, { models: [], status: "error", errorKind: kind, errorMessage: message });
  }
}
