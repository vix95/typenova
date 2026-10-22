/** Code-block toolbar (language label, copy action) and local image resolution. */
import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizeLocalImagePath } from "../filesystem/path-utils";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Try the WebView-compatible fallback below. */ }
  const previousFocus = document.activeElement;
  const temporary = document.createElement("textarea");
  temporary.value = text; temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed"; temporary.style.inset = "0 auto auto -10000px"; temporary.style.opacity = "0";
  document.body.append(temporary); temporary.focus({ preventScroll: true }); temporary.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  temporary.remove();
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  return copied;
}
export function decorateCodeBlocks(root: HTMLElement) {
  for (const pre of Array.from(root.querySelectorAll<HTMLPreElement>("pre"))) {
    // Notebook cells have their own toolbar and are not Markdown fenced snippets.
    if (pre.closest(".notebook-code-cell, .notebook-raw-cell")) continue;
    const code = pre.querySelector<HTMLElement>(":scope > code") || pre.querySelector<HTMLElement>("code");
    if (!code) continue;

    let toolbar = pre.querySelector<HTMLElement>(":scope > .code-block-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "code-block-toolbar";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", langText("Narzędzia bloku kodu", "Code block actions"));
      pre.insertBefore(toolbar, pre.firstChild);
    }

    let copy = toolbar.querySelector<HTMLButtonElement>(":scope > .code-copy-button");
    if (!copy) {
      copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-copy-button";
      copy.dataset.copyCode = "yes";
      copy.innerHTML = '<svg class="code-copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg><span class="code-copy-label"></span>';
      const label = copy.querySelector<HTMLElement>(".code-copy-label");
      if (label) label.textContent = langText("Kopiuj", "Copy");
      copy.title = langText("Kopiuj kod do schowka", "Copy code to clipboard");
      copy.setAttribute("aria-label", langText("Kopiuj kod do schowka", "Copy code to clipboard"));
      copy.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const copied = await copyTextToClipboard(code.textContent || "");
        const copyLabel = copy?.querySelector<HTMLElement>(".code-copy-label");
        if (copied) {
          if (copyLabel) copyLabel.textContent = langText("Skopiowano", "Copied");
          copy!.title = langText("Skopiowano kod do schowka", "Code copied to clipboard");
          copy!.setAttribute("aria-label", langText("Skopiowano kod do schowka", "Code copied to clipboard"));
          copy!.classList.add("copied");
          showToast(langText("Skopiowano kod do schowka.", "Code copied to clipboard."));
        } else {
          showToast(langText("Nie udało się skopiować kodu.", "Could not copy the code."));
        }
        if (copied) window.setTimeout(() => {
          if (!copy?.isConnected) return;
          const currentLabel = copy.querySelector<HTMLElement>(".code-copy-label");
          if (currentLabel) currentLabel.textContent = langText("Kopiuj", "Copy");
          copy.title = langText("Kopiuj kod do schowka", "Copy code to clipboard");
          copy.setAttribute("aria-label", langText("Kopiuj kod do schowka", "Copy code to clipboard"));
          copy.classList.remove("copied");
        }, 1400);
      });
      toolbar.append(copy);
      pre.dataset.copyButton = "yes";
      pre.classList.add("has-code-copy");
    }

    if (pre.dataset.languagePill === "yes") continue;
    const languageClass = Array.from(code.classList).find(cls => cls.startsWith("language-"));
    if (!languageClass) continue;
    const language = languageClass.slice("language-".length).replace(/[^a-z0-9_+#.-]/gi, "");
    if (!language) continue;
    const pill = document.createElement("span");
    pill.className = "code-language-pill";
    const lower = language.toLowerCase();
    pill.textContent = lower === "js" ? "javascript" : lower === "ts" ? "typescript" : lower;
    pill.setAttribute("aria-label", langText(`Język kodu: ${language}`, `Code language: ${language}`));
    toolbar.insertBefore(pill, copy);
    pre.classList.add("has-language-pill");
    pre.dataset.languagePill = "yes";
  }
}
export function resolveLocalImages(root: HTMLElement, sourcePath: string | null = documentState.currentPath) {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const src = img.getAttribute("src") || "";
    if (img.dataset.resolved === "yes" || /^(https?:|data:|asset:|https:\/\/asset\.localhost)/i.test(src)) continue;
    if (!sourcePath || !src) continue;
    let clean = src.trim();
    // Strip URI query/hash before decoding so an encoded %23 remains a literal filename character.
    clean = clean.replace(/^file:\/\/\/([A-Za-z]:)/i, "$1").replace(/^file:\/\//i, "").replace(/^\.\//, "").split(/[?#]/, 1)[0];
    try { clean = decodeURIComponent(clean); } catch { /* Keep the literal path if it contains an invalid escape. */ }
    const parent = sourcePath.replace(/[\\/][^\\/]*$/, "");
    const combined = /^(?:[A-Za-z]:[\\/]|\/)/.test(clean) ? clean : `${parent}/${clean}`;
    img.src = convertFileSrc(normalizeLocalImagePath(combined)); img.loading = "lazy"; img.decoding = "async"; img.dataset.resolved = "yes";
  }
}
