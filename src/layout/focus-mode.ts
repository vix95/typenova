/** Distraction-free focus mode. */
import { $ } from "../app/dom";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";

export function setFocusMode(on: boolean) {
  document.body.classList.toggle("focus-mode", on);
  const cb = $("focusToggle") as HTMLInputElement | null; if (cb) cb.checked = on;
  localStorage.setItem("typenova.focus", String(on));
  let hint = document.getElementById("focusHint");
  if (on) { if (!hint) { hint = document.createElement("button"); hint.id = "focusHint"; hint.className = "focus-hint"; hint.textContent = langText("Tryb skupienia · Esc, aby wyjść", "Focus mode · press Esc to exit"); hint.title = langText("Wyjdź z trybu skupienia (Esc)", "Exit focus mode (Esc)"); hint.addEventListener("click", () => setFocusMode(false)); document.body.append(hint); } hint.hidden = false; } else if (hint) hint.hidden = true;
  requestAnimationFrame(() => view.requestMeasure());
}
export function toggleFocus() { setFocusMode(!document.body.classList.contains("focus-mode")); }
