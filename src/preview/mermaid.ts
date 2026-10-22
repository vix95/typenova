/** Lazy, theme-aware Mermaid rendering. */
import { preview, previewContent } from "../app/workspace-dom";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";

let mermaidObserver: IntersectionObserver | null = null;
let mermaidPromise: Promise<any> | null = null;
let mermaidThemeKey = "";
function currentMermaidTheme(): string {
  return document.documentElement.dataset.theme || "midnight";
}
function mermaidConfigForTheme(theme: string) {
  // Use Mermaid's configurable base theme and explicit palette values. Its
  // built-in dark theme can leave a dark SVG canvas embedded in Paper mode.
  const palettes: Record<string, Record<string, string | boolean>> = {
    midnight: {
      darkMode: true, background: "transparent", primaryColor: "#26364d", primaryTextColor: "#f2f5fc", primaryBorderColor: "#819abd",
      secondaryColor: "#202c40", secondaryTextColor: "#e5ebf6", secondaryBorderColor: "#667d9f", tertiaryColor: "#172234", tertiaryTextColor: "#e5ebf6", tertiaryBorderColor: "#526580",
      textColor: "#e4e7ef", lineColor: "#aab9d1", mainBkg: "#1a2434", nodeBorder: "#819abd", clusterBkg: "#202b3d", clusterBorder: "#516784",
      edgeLabelBackground: "#202b3d", noteBkgColor: "#283750", noteTextColor: "#f2f5fc", noteBorderColor: "#819abd", actorBkg: "#26364d", actorBorder: "#819abd", actorTextColor: "#f2f5fc",
      signalColor: "#aab9d1", signalTextColor: "#e4e7ef", labelBoxBkgColor: "#202b3d", labelBoxBorderColor: "#819abd", labelTextColor: "#e4e7ef", loopTextColor: "#e4e7ef",
      activationBkgColor: "#26364d", activationBorderColor: "#819abd", sequenceNumberColor: "#e4e7ef", sectionBkgColor: "#26364d", altSectionBkgColor: "#202b3d",
      taskBkgColor: "#26364d", taskBorderColor: "#819abd", activeTaskBkgColor: "#344d6b", gridColor: "#405570", todayLineColor: "#ffcc66"
    },
    light: {
      darkMode: false, background: "transparent", primaryColor: "#dbe7fb", primaryTextColor: "#17263d", primaryBorderColor: "#6d8fcb",
      secondaryColor: "#f8fafd", secondaryTextColor: "#17263d", secondaryBorderColor: "#9aacc8", tertiaryColor: "#e9eff8", tertiaryTextColor: "#17263d", tertiaryBorderColor: "#aebdd2",
      textColor: "#17263d", lineColor: "#52637c", mainBkg: "#edf2f8", nodeBorder: "#6d8fcb", clusterBkg: "#f8fafd", clusterBorder: "#c2ccda",
      edgeLabelBackground: "#f8fafd", noteBkgColor: "#fff8df", noteTextColor: "#17263d", noteBorderColor: "#a9a06c", actorBkg: "#dbe7fb", actorBorder: "#6d8fcb", actorTextColor: "#17263d",
      signalColor: "#354b69", signalTextColor: "#17263d", labelBoxBkgColor: "#f8fafd", labelBoxBorderColor: "#9aacc8", labelTextColor: "#17263d", loopTextColor: "#17263d",
      activationBkgColor: "#e1eaf7", activationBorderColor: "#6d8fcb", sequenceNumberColor: "#17263d", sectionBkgColor: "#dbe7fb", altSectionBkgColor: "#f8fafd",
      taskBkgColor: "#dbe7fb", taskBorderColor: "#6d8fcb", activeTaskBkgColor: "#bfd4f3", gridColor: "#d1dbea", todayLineColor: "#c14824"
    },
    newsprint: {
      darkMode: false, background: "transparent", primaryColor: "#e6d8bd", primaryTextColor: "#30291e", primaryBorderColor: "#9d8260",
      secondaryColor: "#f7f0e2", secondaryTextColor: "#30291e", secondaryBorderColor: "#bfb19a", tertiaryColor: "#eee4d2", tertiaryTextColor: "#30291e", tertiaryBorderColor: "#b5a48b",
      textColor: "#30291e", lineColor: "#70614d", mainBkg: "#eee4d2", nodeBorder: "#9d8260", clusterBkg: "#f7f0e2", clusterBorder: "#bfb19a",
      edgeLabelBackground: "#f7f0e2", noteBkgColor: "#f5e7bd", noteTextColor: "#30291e", noteBorderColor: "#9d8260", actorBkg: "#e6d8bd", actorBorder: "#9d8260", actorTextColor: "#30291e",
      signalColor: "#4e4435", signalTextColor: "#30291e", labelBoxBkgColor: "#f7f0e2", labelBoxBorderColor: "#9d8260", labelTextColor: "#30291e", loopTextColor: "#30291e",
      activationBkgColor: "#e6d8bd", activationBorderColor: "#9d8260", sequenceNumberColor: "#30291e", sectionBkgColor: "#e6d8bd", altSectionBkgColor: "#f7f0e2",
      taskBkgColor: "#e6d8bd", taskBorderColor: "#9d8260", activeTaskBkgColor: "#d5c09b", gridColor: "#ded1bb", todayLineColor: "#9b3e2c"
    },
    retro: {
      darkMode: true, background: "transparent", primaryColor: "#213a22", primaryTextColor: "#d8ffd0", primaryBorderColor: "#78a36e",
      secondaryColor: "#172719", secondaryTextColor: "#d8ffd0", secondaryBorderColor: "#42623c", tertiaryColor: "#0d170e", tertiaryTextColor: "#d8ffd0", tertiaryBorderColor: "#345638",
      textColor: "#d8ffd0", lineColor: "#a3c69a", mainBkg: "#09110a", nodeBorder: "#78a36e", clusterBkg: "#172719", clusterBorder: "#42623c",
      edgeLabelBackground: "#172719", noteBkgColor: "#213a22", noteTextColor: "#d8ffd0", noteBorderColor: "#78a36e", actorBkg: "#213a22", actorBorder: "#78a36e", actorTextColor: "#d8ffd0",
      signalColor: "#a3c69a", signalTextColor: "#d8ffd0", labelBoxBkgColor: "#172719", labelBoxBorderColor: "#42623c", labelTextColor: "#d8ffd0", loopTextColor: "#d8ffd0",
      activationBkgColor: "#213a22", activationBorderColor: "#78a36e", sequenceNumberColor: "#d8ffd0", sectionBkgColor: "#213a22", altSectionBkgColor: "#172719",
      taskBkgColor: "#213a22", taskBorderColor: "#78a36e", activeTaskBkgColor: "#345c38", gridColor: "#345638", todayLineColor: "#b9ff66"
    },
    contrast: {
      darkMode: true, background: "transparent", primaryColor: "#000000", primaryTextColor: "#ffff00", primaryBorderColor: "#ffffff",
      secondaryColor: "#080808", secondaryTextColor: "#ffffff", secondaryBorderColor: "#ffff00", tertiaryColor: "#161616", tertiaryTextColor: "#00ffff", tertiaryBorderColor: "#ffffff",
      textColor: "#ffffff", lineColor: "#00ffff", mainBkg: "#000000", nodeBorder: "#ffffff", clusterBkg: "#080808", clusterBorder: "#ffffff",
      edgeLabelBackground: "#000000", noteBkgColor: "#080808", noteTextColor: "#ffff00", noteBorderColor: "#ffffff", actorBkg: "#000000", actorBorder: "#ffffff", actorTextColor: "#ffff00",
      signalColor: "#00ffff", signalTextColor: "#ffffff", labelBoxBkgColor: "#000000", labelBoxBorderColor: "#ffffff", labelTextColor: "#ffffff", loopTextColor: "#ffff00",
      activationBkgColor: "#080808", activationBorderColor: "#ffffff", sequenceNumberColor: "#ffff00", sectionBkgColor: "#000000", altSectionBkgColor: "#111111",
      taskBkgColor: "#000000", taskBorderColor: "#ffffff", activeTaskBkgColor: "#242424", gridColor: "#666666", todayLineColor: "#ffff00"
    }
  };
  return { startOnLoad: false, securityLevel: "strict", fontFamily: "inherit", theme: "base", themeVariables: palettes[theme] || palettes.midnight };
}
function initializeMermaidTheme(mermaid: any): string {
  const theme = currentMermaidTheme();
  if (mermaidThemeKey !== theme) {
    mermaid.initialize(mermaidConfigForTheme(theme));
    mermaidThemeKey = theme;
  }
  return theme;
}
export function observeMermaid(root: HTMLElement) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("pre code.language-mermaid"));
  if (!mermaidObserver) {
    mermaidObserver = new IntersectionObserver(entries => { for (const entry of entries) { if (entry.isIntersecting) { mermaidObserver?.unobserve(entry.target); void renderMermaidBlock(entry.target as HTMLElement); } } }, { root: preview, rootMargin: "700px 0px" });
  }
  for (const node of nodes) { const pre = node.closest("pre") as HTMLElement | null; if (pre && pre.dataset.rendered !== "yes") mermaidObserver.observe(pre); }
}
export async function renderMermaidBlock(pre: HTMLElement) {
  if (pre.dataset.rendered === "yes" || !pre.isConnected) return;
  pre.dataset.rendered = "yes";
  const source = pre.querySelector("code")?.textContent || "";
  try {
    if (!mermaidPromise) mermaidPromise = import("mermaid").then(({ default: mermaid }) => mermaid);
    const mermaid = await mermaidPromise;
    const renderTheme = initializeMermaidTheme(mermaid);
    const result = await mermaid.render(`typenova-diagram-${documentState.docRevision}-${Math.random().toString(36).slice(2)}`, source);
    if (!pre.isConnected) return;
    // A theme can change while Mermaid is processing. Do not install an SVG
    // generated with stale colors; queue the source for rendering under the new theme.
    if (renderTheme !== currentMermaidTheme()) {
      delete pre.dataset.rendered;
      void renderMermaidBlock(pre);
      return;
    }
    const container = document.createElement("div");
    container.className = "mermaid-container";
    container.dataset.mermaidSource = source;
    container.dataset.mermaidTheme = renderTheme;
    container.innerHTML = result.svg;
    pre.replaceWith(container);
  } catch (error) { pre.dataset.rendered = "error"; pre.title = langText("Nie udało się wyrenderować diagramu Mermaid", "Could not render Mermaid diagram"); console.warn("Mermaid render error", error); }
}
export function refreshMermaidTheme() {
  const rendered = Array.from(previewContent.querySelectorAll<HTMLElement>(".mermaid-container[data-mermaid-source]"));
  if (!rendered.length) return;
  for (const container of rendered) {
    const source = container.dataset.mermaidSource;
    if (source === undefined) continue;
    const pre = document.createElement("pre");
    pre.className = "mermaid-source";
    const code = document.createElement("code"); code.className = "language-mermaid"; code.textContent = source;
    pre.append(code); container.replaceWith(pre);
  }
  observeMermaid(previewContent);
}
