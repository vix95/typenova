/** The providers the assistant can talk to, as data. The options window, the chooser of models, the readiness of a provider and the request sent to the backend are all worked out from this list, so a new provider is an entry here (and, when it speaks a protocol the backend does not know yet, an adapter in `src-tauri/src/ai/`). Pure: no DOM, no network. */
import { AI_MODELS, DEFAULT_AI_MODEL } from "./ai-model.js";

/** The protocol a provider speaks; the backend has one adapter for each. */
export type AdapterId = "anthropic" | "openai" | "gemini" | "ollama";
export type AiProvider = "anthropic" | "openai" | "gemini" | "ollama" | "custom";

export interface ProviderInfo {
  id: AiProvider;
  /** The name shown to the user (in Polish when it is a word, as it is for most providers). */
  name: string;
  /** The English name when it differs. */
  nameEn?: string;
  adapter: AdapterId;
  /** Whose computer the text goes to: the provider's cloud, this computer's own model, or a service the user points to. */
  where: "cloud" | "local" | "yours";
  /** The company whose account is billed, for the notes (empty when it is not a company). */
  account: string;
  /** The address the key is sent to, for the notes (empty when the user chooses it). */
  host: string;
  taglinePl: string;
  taglineEn: string;
  tooltipPl: string;
  tooltipEn: string;
  /** Whether an API key is needed, wanted when the service asks for it, or not used at all. */
  key: "required" | "optional" | "none";
  keyPlaceholder: string;
  /** Where the user gets a key. */
  keyHelpUrl: string;
  /** Whether the user gives an address: not at all (the provider has one), may change the default one, or must give one. */
  url: "none" | "optional" | "required";
  defaultUrl: string;
  urlPlaceholder: string;
  /** The models are a fixed list in the program, or the provider is asked for them. */
  models: "fixed" | "fetched";
  /** For a provider asked for its models: the names that are chosen first when the user has not chosen (the first one found in the list). */
  preferred: readonly string[];
  /** Whether the provider is used by default; exactly one is. */
  isDefault?: boolean;
}

export const AI_PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic", name: "Claude", adapter: "anthropic", where: "cloud", account: "Anthropic", host: "api.anthropic.com",
    taglinePl: "Anthropic API, w chmurze", taglineEn: "Anthropic API, in the cloud",
    tooltipPl: "Użyj Claude przez API Anthropic", tooltipEn: "Use Claude through the Anthropic API",
    key: "required", keyPlaceholder: "sk-ant-…", keyHelpUrl: "https://console.anthropic.com/settings/keys",
    url: "none", defaultUrl: "", urlPlaceholder: "", models: "fixed", preferred: [], isDefault: true,
  },
  {
    id: "openai", name: "OpenAI", adapter: "openai", where: "cloud", account: "OpenAI", host: "api.openai.com",
    taglinePl: "API OpenAI (GPT), w chmurze", taglineEn: "OpenAI API (GPT), in the cloud",
    tooltipPl: "Użyj modeli GPT przez API OpenAI", tooltipEn: "Use GPT models through the OpenAI API",
    key: "required", keyPlaceholder: "sk-…", keyHelpUrl: "https://platform.openai.com/api-keys",
    url: "none", defaultUrl: "https://api.openai.com/v1", urlPlaceholder: "", models: "fetched", preferred: ["gpt-5", "gpt-4.1", "gpt-4o"],
  },
  {
    id: "gemini", name: "Gemini", adapter: "gemini", where: "cloud", account: "Google", host: "generativelanguage.googleapis.com",
    taglinePl: "Google Gemini, w chmurze", taglineEn: "Google Gemini, in the cloud",
    tooltipPl: "Użyj Gemini przez API Google", tooltipEn: "Use Gemini through the Google API",
    key: "required", keyPlaceholder: "AIza…", keyHelpUrl: "https://aistudio.google.com/apikey",
    url: "none", defaultUrl: "", urlPlaceholder: "", models: "fetched", preferred: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "ollama", name: "Ollama", adapter: "ollama", where: "local", account: "", host: "",
    taglinePl: "Model lokalny, tekst zostaje na komputerze", taglineEn: "A local model, the text stays on your computer",
    tooltipPl: "Użyj modelu lokalnego w Ollama", tooltipEn: "Use a local model in Ollama",
    key: "none", keyPlaceholder: "", keyHelpUrl: "",
    url: "optional", defaultUrl: "http://localhost:11434", urlPlaceholder: "http://localhost:11434", models: "fetched", preferred: [],
  },
  {
    id: "custom", name: "Własny API", nameEn: "Custom API", adapter: "openai", where: "yours", account: "", host: "",
    taglinePl: "Dowolna usługa zgodna z OpenAI (LM Studio, OpenRouter…)", taglineEn: "Any OpenAI-compatible service (LM Studio, OpenRouter…)",
    tooltipPl: "Użyj własnej usługi zgodnej z API OpenAI", tooltipEn: "Use a service of your own that speaks the OpenAI API",
    key: "optional", keyPlaceholder: "", keyHelpUrl: "",
    url: "required", defaultUrl: "", urlPlaceholder: "http://localhost:1234/v1", models: "fetched", preferred: [],
  },
];

export const DEFAULT_PROVIDER: AiProvider = (AI_PROVIDERS.find(info => info.isDefault) ?? AI_PROVIDERS[0]).id;

export function providerInfo(id: AiProvider): ProviderInfo { return AI_PROVIDERS.find(info => info.id === id) ?? AI_PROVIDERS[0]; }

/** The provider named in a stored setting; the default one when it is anything else. */
export function parseProvider(value: string | null | undefined): AiProvider { return AI_PROVIDERS.find(info => info.id === value)?.id ?? DEFAULT_PROVIDER; }

/** The name of a provider in a language. */
export function providerName(provider: AiProvider, english = false): string { const info = providerInfo(provider); return english ? info.nameEn ?? info.name : info.name; }

/** The name under which the backend keeps the key of a provider; null for a provider that has no key. */
export function keySecretName(provider: AiProvider): string | null { return providerInfo(provider).key === "none" ? null : `${provider}-api-key`; }

/** The model a provider starts with: the first of the fixed list, or none until the provider's list is known. */
export function defaultModel(provider: AiProvider): string { return providerInfo(provider).models === "fixed" ? DEFAULT_AI_MODEL : ""; }

/** The models of a provider with a fixed list. */
export function fixedModels(provider: AiProvider): readonly { id: string; label: string }[] { return providerInfo(provider).models === "fixed" ? AI_MODELS : []; }

/** The model to choose from a list the provider gave when the user has not chosen one: the first preferred name that is there (the shortest model that starts with it when it is not there as it is, so a family name gives its main model), else the first of the list. */
export function pickModel(list: readonly string[], preferred: readonly string[]): string {
  for (const name of preferred) {
    if (list.includes(name)) return name;
    const family = list.filter(item => item.startsWith(name)).sort((left, right) => left.length - right.length || left.localeCompare(right));
    if (family.length) return family[0];
  }
  return list[0] ?? "";
}

/**
 * An address as the user typed it: an http or https address without a trailing slash. Empty gives the fallback (the
 * provider's default address, or nothing). Anything that is not an address gives null.
 */
export function normalizeUrl(input: string, fallback: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (/\s/.test(trimmed) || !/^https?:\/\/[^/\s]+/i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/** How a stored key is shown: all but its last characters hidden. */
export function maskedKey(lastChars: string): string { return `${"•".repeat(16)}${lastChars}`; }

/** The models to offer for a provider asked for its list: the ones it gave, and the chosen one even when it is not among them (so the choice is not lost silently). */
export function modelChoices(available: readonly string[], chosen: string): { name: string; available: boolean }[] {
  const list = available.map(name => ({ name, available: true }));
  return chosen && !available.includes(chosen) ? [{ name: chosen, available: false }, ...list] : list;
}

/** What a provider still needs before it can be used. */
export type Readiness = "ready" | "no_key" | "no_url" | "no_model";

export interface ProviderState { hasKey: boolean; url: string; model: string }

/** Whether a provider can be used with what is stored for it, and if not, what is missing first. */
export function readiness(info: ProviderInfo, state: ProviderState): Readiness {
  if (info.key === "required" && !state.hasKey) return "no_key";
  if (info.url === "required" && !state.url) return "no_url";
  if (!state.model) return "no_model";
  return "ready";
}
