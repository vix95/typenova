/** CodeMirror extension set: keymaps, completion, folding, update listeners and size-based performance profiles. */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { highlightActiveLine, lineNumbers, drawSelection, EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { history, indentWithTab, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { editorThemeFor, syntaxThemeFor } from "./themes";
import { Prec } from "@codemirror/state";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { search, openSearchPanel, searchKeymap } from "@codemirror/search";
import { isMarkdownPath } from "../filesystem/path-utils";
import { openCommandPalette } from "../app/command-palette";
import { $ } from "../app/dom";
import { markDirty } from "../documents/dirty-state";
import { documentState } from "../documents/document-state";
import { updateQuickStats } from "../documents/document-stats";
import { openDocument, saveDocument, saveDocumentAs, scheduleAutoSave } from "../documents/file-actions";
import { scheduleRecovery } from "../documents/recovery";
import { initialDocumentText } from "../documents/start-text";
import { configureLanguageForTab } from "../documents/tabs";
import { editorThemeCompartment, languageCompartment, lineNumbersCompartment, performanceCompartment, syntaxThemeCompartment, wrapping } from "./compartments";
import { completions } from "./completions";
import { wrapSelection } from "./editing-commands";
import { view } from "./editor-view";
import { hideImageHoverPreview } from "./image-hover";
import { scheduleMinimapDraw, updateMinimapViewport } from "./minimap";
import { lineNumbersEnabled } from "../layout/appearance";
import { updateHeadingBreadcrumbs } from "../outline/breadcrumbs";
import { updateActiveOutline } from "../outline/outline";
import { printDocument } from "../preview/export-print";
import { schedulePreview } from "../preview/preview-scheduler";

// Preserve Markdown styling in large files, but avoid activating nested parsers
// for fenced programming languages once the document reaches 2 MB. CodeMirror's
// Lezer parser remains incremental, so headings/emphasis/lists/links keep their
// syntax colors without paying the cost of language detection inside every fence.
const LARGE_MARKDOWN_THRESHOLD = 2_000_000;
export const LARGE_SOURCE_THRESHOLD = 750_000;
export function markdownSupportForSize(docLength: number) {
  return docLength >= LARGE_MARKDOWN_THRESHOLD
    ? markdown({ base: markdownLanguage })
    : markdown({ base: markdownLanguage, codeLanguages: languages });
}
export function performanceExtensions(docLength: number) {
  // CodeMirror virtualizes gutter elements to the visible viewport. Keep the folding gutter
  // enabled even for huge documents: heading folds are lightweight and are needed for Markdown
  // navigation. Only the active-line decoration is disabled above 1 MB to reduce redraw work.
  // Use SVG disclosure chevrons for fold markers instead of tiny font glyphs (which can look like "v").
  const markdownFoldGutter = foldGutter({
    markerDOM: (open: boolean) => {
      const marker = document.createElement("span");
      marker.className = "cm-fold-marker";
      marker.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("width", "13");
      svg.setAttribute("height", "13");
      svg.setAttribute("focusable", "false");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", open ? "M3.5 6 L8 10.5 L12.5 6" : "M6 3.5 L10.5 8 L6 12.5");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.8");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
      marker.append(svg);
      return marker;
    }
  });
  return docLength >= 1_000_000 ? [markdownFoldGutter] : [highlightActiveLine(), markdownFoldGutter];
}
export const editorExtensions = [
  performanceCompartment.of(performanceExtensions(initialDocumentText.length)),
  lineNumbersCompartment.of(lineNumbersEnabled ? lineNumbers() : []), drawSelection(), history(),
  wrapping.of(localStorage.getItem("typenova.wrap") === "true" ? EditorView.lineWrapping : []),
  languageCompartment.of([]),
  editorThemeCompartment.of(editorThemeFor(localStorage.getItem("typenova.theme") || "midnight")),
  syntaxThemeCompartment.of(syntaxThemeFor(localStorage.getItem("typenova.theme") || "midnight")),
  // Give completion acceptance higher priority than the ordinary indentWithTab binding.
  Prec.highest(keymap.of([{
    key: "Tab",
    preventDefault: true,
    run: (editor: EditorView) => acceptCompletion(editor) || (indentWithTab.run?.(editor) ?? false)
  }])),
  autocompletion({ override: [completions], activateOnTyping: true }),
  search(),
  EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off" }),
  // Typing a dollar sign while text is selected wraps the selection in inline
  // math delimiters. When there is no selection, the character is inserted normally.
  EditorView.domEventHandlers({
    beforeinput: (event: Event, editor: EditorView) => {
      const input = event as InputEvent;
      if (input.inputType !== "insertText" || input.data !== "$" || input.isComposing) return false;
      const selection = editor.state.selection.main;
      if (selection.empty) return false;
      const selectedText = editor.state.sliceDoc(selection.from, selection.to);
      event.preventDefault();
      editor.dispatch({
        changes: { from: selection.from, to: selection.to, insert: `$${selectedText}$` },
        selection: { anchor: selection.from + 1, head: selection.from + 1 + selectedText.length },
        userEvent: "input.type"
      });
      editor.focus();
      return true;
    }
  }),
  keymap.of([
    { key: "Mod-n", run: () => { ($("menuNew") as HTMLButtonElement).click(); return true; } },
    { key: "Mod-s", run: () => { void saveDocument(); return true; } },
    { key: "Mod-Shift-s", run: () => { void saveDocumentAs(); return true; } },
    { key: "Mod-p", run: () => { void printDocument(); return true; } },
    { key: "Mod-o", run: () => { void openDocument(); return true; } },
    { key: "Mod-f", run: () => { openSearchPanel(view); return true; } },
    { key: "Mod-Shift-p", run: () => { openCommandPalette(); return true; } },
    { key: "Mod-k", run: () => { openCommandPalette(); return true; } },
    { key: "Mod-b", run: () => wrapSelection("**", "**") },
    { key: "Mod-i", run: () => wrapSelection("*", "*") },
    { key: "Mod-Shift-x", run: () => wrapSelection("~~", "~~") },
    ...Object.entries({ "'": "'", '"': '"', "~": "~", "`": "`", "(": ")", "[": "]", "{": "}" }).map(([open, close]) => ({ key: open, run: () => { const sel = view.state.selection.main; if (sel.empty) return false; wrapSelection(open, close); return true; } })),
    ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab
  ]),
  EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged) {
      hideImageHoverPreview();
      scheduleMinimapDraw();
      documentState.docRevision++;
      markDirty();
      updateQuickStats();
      schedulePreview();
      scheduleRecovery();
      scheduleAutoSave();
      const nextPerformanceMode = update.state.doc.length >= 1_000_000;
      if (nextPerformanceMode !== documentState.performanceMode) {
        documentState.performanceMode = nextPerformanceMode;
        requestAnimationFrame(() => {
          if (view.state === update.state) view.dispatch({ effects: performanceCompartment.reconfigure(performanceExtensions(view.state.doc.length)) });
        });
      }
      // Keep Markdown highlighting enabled for large documents. At 2 MB we only
      // switch off nested language parsers inside fenced code blocks; non-Markdown
      // source files retain the existing 750 KB syntax-mode safety threshold.
      const activeTabForThreshold = documentState.tabs.find(tab => tab.id === documentState.activeTabId);
      const activePathForThreshold = activeTabForThreshold?.path || activeTabForThreshold?.label || documentState.untitledLabel;
      const threshold = isMarkdownPath(activePathForThreshold) ? LARGE_MARKDOWN_THRESHOLD : LARGE_SOURCE_THRESHOLD;
      const crossedLanguageThreshold = (update.startState.doc.length >= threshold) !== (update.state.doc.length >= threshold);
      if (crossedLanguageThreshold) {
        const tabId = documentState.activeTabId;
        requestAnimationFrame(() => {
          if (documentState.activeTabId === tabId) {
            const activeTabState = documentState.tabs.find(tab => tab.id === tabId);
            if (activeTabState) void configureLanguageForTab(activeTabState);
          }
        });
      }
    }
    const active = documentState.tabs.find(tab => tab.id === documentState.activeTabId);
    if (active) active.state = update.state;
    if (update.viewportChanged || update.selectionSet) updateMinimapViewport();
    if (update.docChanged || update.selectionSet) updateHeadingBreadcrumbs();
    if (update.selectionSet) {
      const p = update.state.selection.main.head;
      const line = update.state.doc.lineAt(p);
      $("cursorStatus").textContent = document.documentElement.lang === "en" ? `Ln ${line.number}, Col ${p - line.from + 1}` : `Wiersz ${line.number}, kol. ${p - line.from + 1}`;
      updateActiveOutline();
    }
  })
];
