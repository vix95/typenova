/** The assistant options window: the provider cards (drawn from the provider list, exactly one is on) and the fields of each provider (`ai-provider-fields.ts`). Keys are encrypted by the backend; once saved only their last characters are shown. */
import { $ } from "./dom";
import { buildProviderFields, commitAllKeys, endKeyEditing, renderProviderFields } from "./ai-provider-fields";
import { openAiOptions } from "../ai/ai-options";
import { AI_SETTINGS_EVENT, migrateLegacyApiKey, providerReadiness, readProvider, refreshKeyInfo, saveProvider } from "../ai/ai-settings";
import { refreshModels } from "../ai/model-list";
import { bindModelSelect } from "../ai/model-select";
import { displayName, readinessLabel } from "../ai/provider-texts";
import { AI_PROVIDERS, providerInfo, type AiProvider } from "../ai/providers";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

/** One card per provider in the list, drawn once; the cards act as one radio group. */
function buildProviderCards(): void {
  const switchBox = $("aiProviderSwitch");
  switchBox.replaceChildren();
  for (const info of AI_PROVIDERS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ai-provider-card";
    card.dataset.provider = info.id;
    card.setAttribute("role", "radio");
    for (const part of ["ai-provider-name", "ai-provider-sub", "ai-provider-state"]) {
      const span = document.createElement("span");
      span.className = part;
      card.append(span);
    }
    card.addEventListener("click", () => chooseProvider(info.id));
    // Arrow keys move between the cards, as in any radio group.
    card.addEventListener("keydown", event => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = AI_PROVIDERS[(AI_PROVIDERS.findIndex(entry => entry.id === info.id) + step + AI_PROVIDERS.length) % AI_PROVIDERS.length];
      chooseProvider(next.id);
      switchBox.querySelector<HTMLElement>(`[data-provider="${next.id}"]`)?.focus();
    });
    switchBox.append(card);
  }
}

function renderCards(): void {
  const provider = readProvider();
  for (const card of $("aiProviderSwitch").querySelectorAll<HTMLButtonElement>(".ai-provider-card")) {
    const info = providerInfo(card.dataset.provider as AiProvider);
    const own = info.id === provider;
    card.setAttribute("aria-checked", String(own));
    card.classList.toggle("selected", own);
    card.tabIndex = own ? 0 : -1;
    card.querySelector(".ai-provider-name")!.textContent = displayName(info.id);
    card.dataset.tooltip = langText(info.tooltipPl, info.tooltipEn);
    card.querySelector(".ai-provider-sub")!.textContent = langText(info.taglinePl, info.taglineEn);
    const state = providerReadiness(info.id);
    const badge = card.querySelector<HTMLElement>(".ai-provider-state")!;
    badge.textContent = readinessLabel(state);
    badge.classList.toggle("ready", state === "ready");
  }
}

/** Asks the provider that is on for its models, when it has what it needs to be asked (a key, an address). */
function refreshActiveModels(): void {
  const provider = readProvider();
  const state = providerReadiness(provider);
  if (providerInfo(provider).models === "fetched" && state !== "no_key" && state !== "no_url") void refreshModels(provider);
}

function chooseProvider(provider: AiProvider): void {
  if (readProvider() === provider) return;
  saveProvider(provider);
  showToast(langText(`Włączono ${displayName(provider)}.`, `${displayName(provider)} is on.`));
  refreshActiveModels();
}

function renderAll(): void { renderCards(); renderProviderFields(); }

export function initAiSettingsBindings(): void {
  const dialog = $("aiOptionsDialog") as HTMLDialogElement;
  buildProviderCards();
  buildProviderFields($("aiProviderFields"));
  $("aiOpenOptions").addEventListener("click", () => { openAiOptions(); void refreshKeyInfo().then(refreshActiveModels); });
  // The keys are saved when the window is confirmed or closed in any way; they are not saved while they are typed.
  $("aiOptionsClose").addEventListener("click", () => { void commitAllKeys().then(() => dialog.close()); });
  dialog.addEventListener("close", () => { void commitAllKeys(); endKeyEditing(); renderAll(); });
  bindModelSelect($("aiModelQuick") as HTMLSelectElement);
  document.addEventListener(AI_SETTINGS_EVENT, renderAll);
  document.addEventListener("typenova:language-changed", renderAll);
  renderAll();
  // A Claude key from the first versions, kept in plain text, is encrypted now; then what is stored is asked for, and the models of the provider that is on.
  void migrateLegacyApiKey().then(() => refreshKeyInfo()).then(refreshActiveModels);
}
