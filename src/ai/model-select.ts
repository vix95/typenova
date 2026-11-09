/** A model chooser. The options window, the chat pane and the "Ask" window offer the same stored choice, and they follow each other and the provider that is on. */
import { langText } from "../i18n/language";
import { refreshCustomSelect } from "../ui/custom-select";
import { AI_SETTINGS_EVENT, readModel, readProvider, saveModel } from "./ai-settings";
import { modelList } from "./model-list";
import { fixedModels, modelChoices, providerInfo, type AiProvider } from "./providers";

/** Which models a chooser shows: those of the provider that is on, or always those of one provider (in the options window, which shows every provider). */
export type ModelSelectKind = "active" | AiProvider;

function fill(select: HTMLSelectElement, kind: ModelSelectKind): void {
  const provider: AiProvider = kind === "active" ? readProvider() : kind;
  select.replaceChildren();
  if (providerInfo(provider).models === "fixed") {
    for (const info of fixedModels(provider)) select.append(new Option(info.label, info.id));
    select.value = readModel(provider);
  } else {
    const chosen = readModel(provider);
    const choices = modelChoices(modelList(provider).models, chosen);
    if (!choices.length) {
      const empty = new Option(langText("Brak modeli — sprawdź połączenie w opcjach", "No models — check the connection in the options"), "");
      empty.disabled = true;
      select.append(empty);
      select.value = "";
    } else {
      for (const choice of choices) select.append(new Option(choice.available ? choice.name : `${choice.name} (${langText("niedostępny", "not available")})`, choice.name));
      select.value = chosen;
    }
  }
  select.disabled = !select.options.length || (select.options.length === 1 && select.options[0].disabled);
  refreshCustomSelect(select);
}

/** Fills a select with the models and keeps it in step with the stored choice. */
export function bindModelSelect(select: HTMLSelectElement, kind: ModelSelectKind = "active"): void {
  fill(select, kind);
  select.addEventListener("change", () => {
    const provider: AiProvider = kind === "active" ? readProvider() : kind;
    if (select.value) saveModel(provider, select.value);
  });
  const rebuild = () => { if (select.isConnected) fill(select, kind); };
  document.addEventListener(AI_SETTINGS_EVENT, rebuild);
  document.addEventListener("typenova:language-changed", rebuild);
}
