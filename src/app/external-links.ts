/** Routes external hyperlinks to the OS default handler instead of navigating the WebView. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

// Route every external hyperlink from Help, About, Markdown, notebook Markdown,
// and other dynamically rendered content to the OS default application. Listen
// at window capture so target-level handlers and WebView2's default navigation
// cannot consume the click first. The composed path also handles SVG/text targets.
function openExternalAnchor(event: MouseEvent): void {
  if (event.type === "auxclick" && event.button !== 1) return;
  const link = event.composedPath().find((item): item is HTMLAnchorElement =>
    item instanceof HTMLAnchorElement && item.hasAttribute("href")
  );
  if (!link) return;
  const rawHref = link.getAttribute("href")?.trim() || "";
  // Only intercept explicit external schemes. Relative document links and in-page
  // anchors must remain available to the app's own navigation behavior.
  if (!/^(?:https?:\/\/|\/\/|mailto:|tel:)/i.test(rawHref)) return;
  let externalUrl: URL;
  try {
    externalUrl = new URL(rawHref, window.location.href);
  } catch {
    return;
  }
  if (!(externalUrl.protocol === "http:" || externalUrl.protocol === "https:" || externalUrl.protocol === "mailto:" || externalUrl.protocol === "tel:")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openUrl(externalUrl.href).catch((error: unknown) => {
    console.error("Could not open external link", error);
    showToast(langText("Nie udało się otworzyć linku w przeglądarce.", "Could not open the link in your browser."));
  });
}

export function initExternalLinks(): void {
  window.addEventListener("click", openExternalAnchor, true);
  window.addEventListener("auxclick", openExternalAnchor, true);
}
