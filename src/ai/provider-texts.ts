/** The words about providers shown to the user, in both languages: what a provider still needs, the notes in the options window, and the outcome of checking a connection. */
import { langText } from "../i18n/language";
import { modelList } from "./model-list";
import { providerInfo, providerName, type AiProvider, type Readiness } from "./providers";

/** The name of a provider in the interface language. */
export function displayName(provider: AiProvider): string { return langText(providerName(provider), providerName(provider, true)); }

/** The short state shown on a provider's card. */
export function readinessLabel(state: Readiness): string {
  switch (state) {
    case "ready": return langText("Gotowy", "Ready");
    case "no_key": return langText("Brak klucza", "No key");
    case "no_url": return langText("Brak adresu", "No address");
    case "no_model": return langText("Wybierz model", "Choose a model");
  }
}

/** The notice in the chat pane when the provider that is on cannot be used yet, pointing at what is missing. */
export function setupHint(provider: AiProvider, state: Readiness): string {
  const name = displayName(provider);
  switch (state) {
    case "no_key": return langText(`Aby rozmawiać z ${name}, dodaj klucz API w opcjach asystenta.`, `To chat with ${name}, add its API key in the assistant options.`);
    case "no_url": return langText(`Aby użyć ${name}, podaj adres usługi w opcjach asystenta.`, `To use ${name}, give the address of the service in the assistant options.`);
    case "no_model": return providerInfo(provider).where === "local"
      ? langText(`Aby rozmawiać z ${name}, wybierz model w opcjach asystenta (${name} musi działać).`, `To chat with ${name}, choose a model in the assistant options (${name} must be running).`)
      : langText(`Aby rozmawiać z ${name}, wybierz model w opcjach asystenta.`, `To chat with ${name}, choose a model in the assistant options.`);
    case "ready": return "";
  }
}

/** The note under the key field: where the key goes, how it is kept, who is billed. */
export function keyNote(provider: AiProvider): string {
  const info = providerInfo(provider);
  const kept = langText(
    "Klucz jest szyfrowany (AES-256) i zapisany tylko na tym komputerze, w danych programu. Po zatwierdzeniu przyciskiem „Gotowe” nie da się go podejrzeć: widać tylko ostatnie znaki.",
    "The key is encrypted (AES-256) and stored only on this computer, in the program's data. After you confirm with “Done” it cannot be viewed again: only its last characters are shown.");
  if (info.where === "yours") return `${kept} ${langText("Jest wysyłany tylko pod adres usługi, który podasz powyżej.", "It is sent only to the address of the service you give above.")}`;
  return `${kept} ${langText(`Jest wysyłany wyłącznie do ${info.host}. Zapytania są płatne według zużycia na Twoim koncie ${info.account}.`, `It is sent only to ${info.host}. Requests are billed by usage to your ${info.account} account.`)}`;
}

/** The note under the model chooser. */
export function modelNote(provider: AiProvider): string {
  const info = providerInfo(provider);
  if (provider === "anthropic") return langText("Model możesz też zmienić w czacie i w oknie „Zapytaj”. Opus 5.5 jest najdokładniejszy, Haiku 5.5 najtańszy i najszybszy.", "You can also change the model in the chat and in the “Ask” window. Opus 5.5 is the most capable, Haiku 5.5 the cheapest and fastest.");
  if (info.where === "local") return langText(`Lista pokazuje modele zainstalowane w ${displayName(provider)}. Brakujący model zainstalujesz poleceniem ollama pull nazwa-modelu, a potem sprawdzisz połączenie jeszcze raz.`, `The list shows the models installed in ${displayName(provider)}. Install a missing model with ollama pull model-name, then check the connection again.`);
  return langText("Lista pochodzi od usługi: pobierana jest przyciskiem „Sprawdź połączenie”. Model możesz też zmienić w czacie i w oknie „Zapytaj”.", "The list comes from the service: it is fetched with “Check the connection”. You can also change the model in the chat and in the “Ask” window.");
}

/** What checking the connection of a provider found, or what is going on. `chosen` is the model chosen for it. */
export function connectionStatus(provider: AiProvider, address: string, chosen: string): string {
  const info = providerInfo(provider);
  const { status, models, errorKind, errorMessage } = modelList(provider);
  if (status === "idle") return langText("Kliknij „Sprawdź połączenie”, aby upewnić się, że wszystko działa.", "Press “Check the connection” to make sure everything works.");
  if (status === "loading") return langText("Sprawdzam połączenie…", "Checking the connection…");
  if (status === "ok") {
    if (!models.length) return info.where === "local"
      ? langText(`${displayName(provider)} działa, ale nie ma zainstalowanych modeli. Zainstaluj model poleceniem: ollama pull nazwa-modelu.`, `${displayName(provider)} is running, but no models are installed. Install one with: ollama pull model-name.`)
      : langText("Połączenie działa, ale usługa nie podała żadnych modeli.", "The connection works, but the service listed no models.");
    const note = chosen && !models.includes(chosen) ? langText(` Wybranego modelu „${chosen}” nie ma na liście.`, ` The chosen model “${chosen}” is not on the list.`) : "";
    return langText(`Połączenie działa. Dostępne modele: ${models.length}.${note}`, `The connection works. Models available: ${models.length}.${note}`);
  }
  const where = info.where === "cloud" ? displayName(provider) : address || displayName(provider);
  switch (errorKind) {
    case "unavailable": return langText("Sprawdzanie połączenia jest dostępne tylko w aplikacji desktopowej.", "Checking the connection is available only in the desktop program.");
    case "no_key": return langText("Najpierw wpisz klucz API.", "Enter the API key first.");
    case "auth": return langText("Klucz API został odrzucony. Sprawdź, czy jest poprawny.", "The API key was rejected. Check that it is correct.");
    case "permission": return langText("Ten klucz nie ma dostępu do listy modeli.", "This key has no access to the list of models.");
    case "rate_limit": return langText("Przekroczono limit zapytań. Spróbuj za chwilę.", "The rate limit was reached. Try again in a moment.");
    case "quota": return langText("Konto nie ma już środków lub limitu. Sprawdź rozliczenia u dostawcy.", "The account is out of credit or quota. Check the billing with the provider.");
    case "connection": return langText(`Nie można połączyć się z ${where}. Sprawdź adres i połączenie z siecią.`, `Could not reach ${where}. Check the address and your network connection.`);
    case "server": return langText(`${displayName(provider)} jest chwilowo niedostępny. Spróbuj ponownie za chwilę.`, `${displayName(provider)} is unavailable for a moment. Try again shortly.`);
    case "model_missing": return langText("Usługa nie znalazła tego adresu. Sprawdź, czy kończy się właściwą ścieżką (np. /v1).", "The service did not find this address. Check that it ends with the right path (for example /v1).");
    default: return `${langText("Błąd", "Error")}: ${errorMessage || errorKind}`;
  }
}
