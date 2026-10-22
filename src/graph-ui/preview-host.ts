/** Temporarily hosts the shared Markdown preview inside the graph node-preview pane. */
import { $ } from "../app/dom";
import { preview, previewBottomSpacer, previewContent, previewTopSpacer } from "../app/workspace-dom";
import type { GraphSection } from "./graph-state";
import { decorateCodeBlocks, resolveLocalImages } from "../preview/code-blocks";
import { observeMermaid, renderMermaidBlock } from "../preview/mermaid";
import { ensurePreviewFallbackRenderer, normalizeGraphMathDelimiters, normalizeGraphWikiImageEmbeds } from "../preview/preview-fallback";
import { clearPreviewCache, schedulePreview } from "../preview/preview-scheduler";

// The graph's section excerpt temporarily reuses this same Preview element and renderer.
export let graphPreviewOwnsPreview = false;
let graphPreviewPreviousScrollTop = 0;
let graphPreviewOriginalParent: Node | null = null;
let graphPreviewOriginalNextSibling: Node | null = null;
export function mountGraphPreviewRenderer(section: GraphSection) {
  const body = $("brainPreviewBody") as HTMLElement;
  if (!graphPreviewOwnsPreview) {
    graphPreviewPreviousScrollTop = preview.scrollTop;
    graphPreviewOriginalParent = preview.parentNode;
    graphPreviewOriginalNextSibling = preview.nextSibling;
    graphPreviewOwnsPreview = true;
    preview.classList.add("graph-preview-shared");
    body.classList.add("uses-shared-preview");
    body.replaceChildren(preview);
  }
  clearPreviewCache();
  const renderer = ensurePreviewFallbackRenderer();
  const source = normalizeGraphMathDelimiters(normalizeGraphWikiImageEmbeds(section.content || ""));
  const env: Record<string, any> = {};
  const tokens = renderer.parse(source, env);
  previewContent.innerHTML = renderer.renderer.render(tokens, renderer.options, env);
  previewTopSpacer.style.height = "0px";
  previewBottomSpacer.style.height = "0px";
  resolveLocalImages(previewContent, section.path);
  decorateCodeBlocks(previewContent);
  observeMermaid(previewContent);
  for (const pre of Array.from(previewContent.querySelectorAll<HTMLElement>("pre"))) if (pre.querySelector("code.language-mermaid")) void renderMermaidBlock(pre);
  preview.scrollTop = 0;
}
export function restoreGraphPreviewRenderer() {
  if (!graphPreviewOwnsPreview) return;
  const body = $("brainPreviewBody") as HTMLElement;
  body.classList.remove("uses-shared-preview");
  const parent = graphPreviewOriginalParent || ($("previewPane") as HTMLElement);
  if (graphPreviewOriginalNextSibling && graphPreviewOriginalNextSibling.parentNode === parent) parent.insertBefore(preview, graphPreviewOriginalNextSibling);
  else parent.appendChild(preview);
  graphPreviewOwnsPreview = false;
  graphPreviewOriginalParent = null;
  graphPreviewOriginalNextSibling = null;
  preview.classList.remove("graph-preview-shared");
  clearPreviewCache();
  schedulePreview();
  requestAnimationFrame(() => { preview.scrollTop = Math.min(graphPreviewPreviousScrollTop, Math.max(0, preview.scrollHeight - preview.clientHeight)); });
}
