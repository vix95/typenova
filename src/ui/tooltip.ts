/** Application tooltip system: `data-tooltip` handling, `title` migration, hover and focus behaviour. */
import { translations } from "../i18n/translations";

// TypeNova tooltips: use the application theme instead of native browser title popups.
const appTooltip = document.createElement("div");
const appTooltipLabel = document.createElement("span");
const appTooltipShortcut = document.createElement("kbd");
const appTooltipImage = document.createElement("img");
let tooltipTarget: HTMLElement | null = null;
let tooltipTimer: number | undefined;
let tooltipToken = 0;
let tooltipPreviousDescribedBy: string | null = null;
function translatedTooltip(value: string) {
  const language = document.documentElement.dataset.language || "en";
  const normalized = value.trim();
  if (language === "en") return translations[normalized]?.trim() || normalized;
  return Object.entries(translations).find(([, english]) => english.trim() === normalized)?.[0] || normalized;
}
function moveTitleToTooltip(el: HTMLElement) {
  if (!el.hasAttribute("title")) return;
  const value = (el.getAttribute("title") || "").trim();
  if (value && !el.dataset.tooltip) el.dataset.tooltip = translatedTooltip(value);
  else if (value) el.dataset.tooltip = translatedTooltip(value);
  el.removeAttribute("title");
}
function prepareTooltipCandidates(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches("[title]")) moveTitleToTooltip(root);
  root.querySelectorAll<HTMLElement>("[title]").forEach(moveTitleToTooltip);
  const buttons: HTMLButtonElement[] = [];
  if (root instanceof HTMLButtonElement) buttons.push(root);
  buttons.push(...Array.from(root.querySelectorAll<HTMLButtonElement>("button")));
  for (const button of buttons) {
    if (button.id === "typenovaTooltip" || button.dataset.tooltipDisabled === "true" || button.dataset.tooltip || button.hasAttribute("title")) continue;
    const label = (button.getAttribute("aria-label") || button.textContent || "").replace(/\s+/g, " ").trim();
    if (label) button.dataset.tooltip = translatedTooltip(label);
  }
}
function splitTooltipText(raw: string) {
  const text = raw.replace(/\s+/g, " ").trim();
  const match = text.match(/((?:(?:Ctrl|Shift|Alt|Meta|Cmd)\s*\+\s*)+[A-Za-z0-9]+)\)?$/i);
  if (!match || match.index === undefined) return { label: text, shortcut: "" };
  const shortcut = match[1].replace(/\)$/, " ").trim().replace(/\s+/g, "");
  const label = text.slice(0, match.index).trim().replace(/\s*\($/, "").trim();
  return label ? { label, shortcut } : { label: text, shortcut: "" };
}
export function hideAppTooltip() {
  tooltipToken++;
  if (tooltipTimer !== undefined) { window.clearTimeout(tooltipTimer); tooltipTimer = undefined; }
  appTooltip.classList.remove("visible");
  appTooltip.hidden = true;
  appTooltip.style.visibility = "";
  if (tooltipTarget) {
    if (tooltipPreviousDescribedBy === null) tooltipTarget.removeAttribute("aria-describedby");
    else tooltipTarget.setAttribute("aria-describedby", tooltipPreviousDescribedBy);
  }
  tooltipTarget = null;
  tooltipPreviousDescribedBy = null;
}
export function showAppTooltip(target: HTMLElement, delay = 420, preferredPlacement: "auto" | "right" = "auto") {
  const text = (target.dataset.tooltip || "").trim();
  if (!text || target.matches(":disabled,[hidden]") || target.closest("[hidden]")) return;
  if (window.matchMedia("(pointer: coarse)").matches && document.activeElement !== target) return;
  if (tooltipTimer !== undefined) window.clearTimeout(tooltipTimer);
  const token = ++tooltipToken;
  const present = (withThumbnail: boolean) => {
    hideAppTooltip();
    appTooltipImage.hidden = !withThumbnail;
    appTooltip.classList.toggle("has-thumbnail", withThumbnail);
    // A modal dialog lives in the top layer, above everything in the page, so the tooltip must be inside it to be visible.
    const host: HTMLElement = target.closest<HTMLElement>("dialog[open]") ?? document.body;
    if (appTooltip.parentElement !== host) host.append(appTooltip);
    tooltipTarget = target;
    tooltipPreviousDescribedBy = target.getAttribute("aria-describedby");
    const describedBy = [tooltipPreviousDescribedBy, appTooltip.id].filter(Boolean).join(" ");
    target.setAttribute("aria-describedby", describedBy);
    const parts = splitTooltipText(translatedTooltip(text));
    appTooltip.classList.toggle("section-preview", target.dataset.tooltipKind === "section-preview");
    appTooltipLabel.textContent = parts.label;
    appTooltipShortcut.textContent = parts.shortcut;
    appTooltipShortcut.hidden = !parts.shortcut;
    appTooltip.dataset.placement = "top";
    appTooltip.hidden = false;
    appTooltip.style.visibility = "hidden";
    const targetRect = target.getBoundingClientRect();
    const tipRect = appTooltip.getBoundingClientRect();
    const gap = 9;
    const canPlaceRight = preferredPlacement === "right" && targetRect.right + gap + tipRect.width <= window.innerWidth - 8;
    if (canPlaceRight) {
      const left = targetRect.right + gap;
      const top = Math.max(8, Math.min(targetRect.top + targetRect.height / 2 - tipRect.height / 2, window.innerHeight - tipRect.height - 8));
      const arrowY = Math.max(12, Math.min(targetRect.top + targetRect.height / 2 - top, tipRect.height - 12));
      appTooltip.dataset.placement = "right";
      appTooltip.style.left = `${Math.round(left)}px`;
      appTooltip.style.top = `${Math.round(top)}px`;
      appTooltip.style.setProperty("--tooltip-arrow-y", `${Math.round(arrowY)}px`);
    } else {
      const placeAbove = targetRect.top >= tipRect.height + gap + 8;
      const top = placeAbove ? targetRect.top - tipRect.height - gap : Math.min(window.innerHeight - tipRect.height - 8, targetRect.bottom + gap);
      const left = Math.max(8, Math.min(targetRect.left + targetRect.width / 2 - tipRect.width / 2, window.innerWidth - tipRect.width - 8));
      const arrowX = Math.max(12, Math.min(targetRect.left + targetRect.width / 2 - left, tipRect.width - 12));
      appTooltip.dataset.placement = placeAbove ? "top" : "bottom";
      appTooltip.style.left = `${Math.round(left)}px`;
      appTooltip.style.top = `${Math.round(Math.max(8, top))}px`;
      appTooltip.style.setProperty("--tooltip-arrow-x", `${Math.round(arrowX)}px`);
    }
    appTooltip.style.visibility = "visible";
    void appTooltip.offsetWidth;
    appTooltip.classList.add("visible");
    tooltipTimer = undefined;
  };
  tooltipTimer = window.setTimeout(() => {
    if (token !== tooltipToken || !target.isConnected) return;
    const thumbnail = target.dataset.tooltipImage;
    if (!thumbnail) { present(false); return; }
    // The picture is loaded first so the tooltip is measured and placed with its final size.
    void loadTooltipThumbnail(thumbnail).then(loaded => { if (token === tooltipToken && target.isConnected) present(loaded); });
  }, delay);
}

/** Loads a local image into the tooltip's thumbnail; false when it cannot be shown. */
async function loadTooltipThumbnail(path: string): Promise<boolean> {
  try {
    const { localImageUrl } = await import("../preview/code-blocks");
    appTooltipImage.src = await localImageUrl(path);
    await appTooltipImage.decode();
    return true;
  } catch { return false; }
}
function tooltipTargetFromEvent(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-tooltip]");
  if (el?.dataset.tooltipDisabled === "true") return null;
  return el && el !== appTooltip ? el : null;
}
const tooltipMutationObserver = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === "attributes" && record.target instanceof HTMLElement) { moveTitleToTooltip(record.target); }
    for (const node of Array.from(record.addedNodes)) if (node instanceof HTMLElement) prepareTooltipCandidates(node);
  }
});

export function initTooltips(): void {
  appTooltip.id = "typenovaTooltip";
  appTooltip.className = "typenova-tooltip";
  appTooltip.setAttribute("role", "tooltip");
  appTooltip.hidden = true;
  appTooltipLabel.className = "typenova-tooltip-label";
  appTooltipShortcut.className = "typenova-tooltip-shortcut";
  appTooltipImage.className = "typenova-tooltip-thumb"; appTooltipImage.alt = ""; appTooltipImage.hidden = true; appTooltipImage.decoding = "async";
  appTooltip.append(appTooltipLabel, appTooltipShortcut, appTooltipImage);
  document.body.append(appTooltip);
  document.addEventListener("pointerover", event => {
    if (!(event instanceof PointerEvent) || event.pointerType === "touch") return;
    const next = tooltipTargetFromEvent(event.target);
    if (!next) return;
    if (next === tooltipTarget) return;
    const previous = tooltipTargetFromEvent(event.relatedTarget);
    if (previous === next) return;
    showAppTooltip(next);
  });
  document.addEventListener("pointerout", event => {
    const leaving = tooltipTargetFromEvent(event.target);
    if (!leaving) return;
    const entering = tooltipTargetFromEvent(event.relatedTarget);
    if (leaving !== entering && leaving === tooltipTarget) hideAppTooltip();
    else if (leaving !== entering && entering === null && tooltipTimer !== undefined) { window.clearTimeout(tooltipTimer); tooltipTimer = undefined; tooltipToken++; }
  });
  document.addEventListener("focusin", event => {
    const target = tooltipTargetFromEvent(event.target);
    if (target) showAppTooltip(target, 240);
  });
  document.addEventListener("focusout", event => {
    const leaving = tooltipTargetFromEvent(event.target);
    const entering = tooltipTargetFromEvent(event.relatedTarget);
    if (leaving && leaving !== entering && leaving === tooltipTarget) hideAppTooltip();
  });
  window.addEventListener("resize", hideAppTooltip);
  window.addEventListener("scroll", hideAppTooltip, true);
  window.addEventListener("blur", hideAppTooltip);
  prepareTooltipCandidates(document);
  tooltipMutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
}
