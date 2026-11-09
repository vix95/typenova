/** Requests to the assistant: the backend makes them (it holds the API key and talks to the provider that is on) and streams the answer back piece by piece. */
import { Channel, invoke } from "@tauri-apps/api/core";
import { langText } from "../i18n/language";
import { activeModel, aiBackendAvailable, backendTarget, isAiReady, providerReadiness, readProvider, readUrl } from "./ai-settings";
import { providerInfo } from "./providers";
import { displayName, setupHint } from "./provider-texts";

export interface AiRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  /** Called with each new piece of text and with all the text so far. */
  onText?: (delta: string, full: string) => void;
}

export interface AiResult { text: string; refused: boolean; truncated: boolean }

/** Thrown when the provider that is on has nothing to work with yet (no key, no address or no model chosen). */
export class AiNotConfigured extends Error {}

/** A failure reported by the backend or the provider; `kind` says what went wrong. */
export class AiFailure extends Error {
  constructor(readonly kind: string, message: string, readonly status?: number) { super(message); }
}

class AiCancelled extends Error {}

/** True for the error that a cancelled request raises. */
export function isAiCancelled(error: unknown): boolean { return error instanceof AiCancelled; }

function toFailure(error: unknown): AiFailure {
  if (error instanceof AiFailure) return error;
  if (typeof error === "object" && error !== null && "kind" in error) {
    const item = error as { kind: unknown; message?: unknown; status?: unknown };
    return new AiFailure(String(item.kind), typeof item.message === "string" ? item.message : "", typeof item.status === "number" ? item.status : undefined);
  }
  return new AiFailure("api", String(error));
}

/** Sends a conversation to the provider that is on and streams the answer. A request is cancelled by aborting `signal`. */
export async function askAi(request: AiRequest): Promise<AiResult> {
  if (!isAiReady()) throw new AiNotConfigured();
  if (!aiBackendAvailable()) throw new AiFailure("unavailable", "The assistant needs the desktop program.");
  if (request.signal?.aborted) throw new AiCancelled();
  const id = globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let text = "";
  const channel = new Channel<{ type: string; text?: string }>();
  channel.onmessage = event => {
    if (event.type !== "text" || !event.text) return;
    text += event.text;
    request.onText?.(event.text, text);
  };
  const provider = readProvider();
  const target = backendTarget(provider);
  const cancel = () => { void invoke("ai_cancel", { id }).catch(() => undefined); };
  request.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const outcome = await invoke<{ stopReason: string }>("ai_chat", {
      request: { id, adapter: target.adapter, model: activeModel(), system: request.system, messages: request.messages, baseUrl: target.baseUrl, keyName: target.keyName },
      onEvent: channel,
    });
    if (outcome.stopReason === "cancelled" || request.signal?.aborted) throw new AiCancelled();
    return { text, refused: outcome.stopReason === "refusal", truncated: outcome.stopReason === "max_tokens" };
  } catch (error) {
    if (error instanceof AiCancelled || request.signal?.aborted) throw new AiCancelled();
    throw toFailure(error);
  } finally {
    request.signal?.removeEventListener("abort", cancel);
  }
}

/** A message for the user about a failed request, in the interface language. */
export function describeAiError(error: unknown): string {
  const provider = readProvider();
  if (error instanceof AiNotConfigured) return setupHint(provider, providerReadiness(provider)) || langText("Skonfiguruj asystenta w opcjach.", "Set the assistant up in the options.");
  const failure = toFailure(error);
  const info = providerInfo(provider);
  const name = displayName(provider);
  switch (failure.kind) {
    case "unavailable": return langText("Asystent działa tylko w aplikacji desktopowej TypeNova.", "The assistant works only in the TypeNova desktop program.");
    case "no_key": return langText(`Dodaj klucz API ${name} w opcjach.`, `Add your ${name} API key in the options.`);
    case "auth": return langText("Klucz API został odrzucony. Sprawdź go w opcjach.", "The API key was rejected. Check it in the options.");
    case "permission": return langText("Ten klucz API nie ma dostępu do wybranego modelu.", "This API key has no access to the chosen model.");
    case "rate_limit": return langText("Przekroczono limit zapytań. Spróbuj ponownie za chwilę.", "The rate limit was reached. Try again in a moment.");
    case "quota": return langText(`Konto ${info.account || name} nie ma już środków lub limitu. Sprawdź rozliczenia u dostawcy.`, `The ${info.account || name} account is out of credit or quota. Check the billing with the provider.`);
    case "model_missing": return info.where === "local"
      ? langText(`Model „${activeModel()}” nie jest zainstalowany w ${name}. Zainstaluj go poleceniem: ollama pull ${activeModel()}`, `The model “${activeModel()}” is not installed in ${name}. Install it with: ollama pull ${activeModel()}`)
      : langText(`Model „${activeModel()}” nie jest dostępny. Wybierz inny w opcjach.`, `The model “${activeModel()}” is not available. Choose another in the options.`);
    case "connection": return info.where === "cloud"
      ? langText(`Nie można połączyć się z ${name} (${info.host}). Sprawdź połączenie z internetem.`, `Could not reach ${name} (${info.host}). Check your internet connection.`)
      : langText(`Nie można połączyć się z usługą pod adresem ${readUrl(provider)}. Sprawdź, czy działa, i adres w opcjach.`, `Could not reach the service at ${readUrl(provider)}. Check that it is running and the address in the options.`);
    case "server": return langText(`${name} jest chwilowo przeciążony lub niedostępny. Spróbuj ponownie za chwilę.`, `${name} is overloaded or unavailable for a moment. Try again shortly.`);
    case "bad_request": return `${langText("Zapytanie zostało odrzucone", "The request was rejected")}${failure.message ? `: ${failure.message}` : ""}`;
    default: return `${langText("Błąd", "Error")}${failure.status ? ` (${failure.status})` : ""}: ${failure.message || failure.kind}`;
  }
}

/** The note shown when the model declined to answer. */
export function refusalMessage(): string {
  return langText("Model odmówił odpowiedzi na to zapytanie. Zmień polecenie i spróbuj ponownie.", "The model declined to answer this request. Rephrase it and try again.");
}
