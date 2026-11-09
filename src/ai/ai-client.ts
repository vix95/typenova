/** Calls to the Claude API through the official SDK, streaming the answer as it is written. */
import Anthropic from "@anthropic-ai/sdk";
import { langText } from "../i18n/language";
import { hasApiKey, readApiKey, readModel } from "./ai-settings";

const MAX_OUTPUT_TOKENS = 32000;

export interface AiRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  /** Called with each new piece of text and with all the text so far. */
  onText?: (delta: string, full: string) => void;
}

export interface AiResult { text: string; refused: boolean; truncated: boolean }

/** Thrown when there is no API key yet. */
export class AiNotConfigured extends Error {}

/** True for the error that a cancelled request raises. */
export function isAiCancelled(error: unknown): boolean {
  return error instanceof Anthropic.APIUserAbortError || (error instanceof DOMException && error.name === "AbortError");
}

/** Sends a conversation and streams the answer. A request is cancelled by aborting `signal`. */
export async function askClaude(request: AiRequest): Promise<AiResult> {
  if (!hasApiKey()) throw new AiNotConfigured();
  // The key stays on this computer and goes only to the Anthropic API; browser access is allowed because this is a desktop app.
  const client = new Anthropic({ apiKey: readApiKey(), dangerouslyAllowBrowser: true, maxRetries: 1 });
  const stream = client.messages.stream({
    model: readModel(),
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: "medium" },
    system: request.system,
    messages: request.messages,
  }, { signal: request.signal });
  stream.on("text", (delta, snapshot) => request.onText?.(delta, snapshot));
  const message = await stream.finalMessage();
  const text = message.content.map(block => (block.type === "text" ? block.text : "")).join("");
  return { text, refused: message.stop_reason === "refusal", truncated: message.stop_reason === "max_tokens" };
}

/** A message for the user about a failed request, in the interface language. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiNotConfigured) return langText("Dodaj klucz API Anthropic w opcjach Claude.", "Add your Anthropic API key in the Claude options.");
  if (error instanceof Anthropic.AuthenticationError) return langText("Klucz API został odrzucony. Sprawdź go w opcjach Claude.", "The API key was rejected. Check it in the Claude options.");
  if (error instanceof Anthropic.PermissionDeniedError) return langText("Ten klucz API nie ma dostępu do wybranego modelu.", "This API key has no access to the chosen model.");
  if (error instanceof Anthropic.RateLimitError) return langText("Przekroczono limit zapytań. Spróbuj ponownie za chwilę.", "The rate limit was reached. Try again in a moment.");
  if (error instanceof Anthropic.BadRequestError) return `${langText("Zapytanie zostało odrzucone", "The request was rejected")}: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return langText("Nie można połączyć się z API Anthropic. Sprawdź połączenie z internetem.", "Could not reach the Anthropic API. Check your internet connection.");
  if (error instanceof Anthropic.APIError) return `${langText("Błąd API", "API error")} (${error.status ?? "?"}): ${error.message}`;
  return String(error);
}

/** The note shown when Claude declined to answer. */
export function refusalMessage(): string {
  return langText("Claude odmówił odpowiedzi na to zapytanie. Zmień polecenie i spróbuj ponownie.", "Claude declined to answer this request. Rephrase it and try again.");
}
