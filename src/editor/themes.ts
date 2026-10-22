import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export function syntaxThemeFor(name: string) {
  const palette: Record<string, Record<string, string>> = {
    midnight: { keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#aab8cc", func: "#8be9fd", definition: "#50fa7b", type: "#8be9fd", operator: "#ffb86c", heading: "#82b7ff", link: "#8bd5ff", code: "#ffc7f7", quote: "#9fb5d6" },
    retro: { keyword: "#ffb86c", string: "#baff83", number: "#e6b8ff", comment: "#a8c99f", func: "#8be9fd", definition: "#d7ffd0", type: "#8be9fd", operator: "#ffd166", heading: "#b9ff66", link: "#a7f3ff", code: "#d7b5ff", quote: "#a8c99f" },
    contrast: { keyword: "#ffff66", string: "#7dffb3", number: "#b8a7ff", comment: "#ffffff", func: "#00ffff", definition: "#7dffb3", type: "#00ffff", operator: "#ffb86c", heading: "#ffffff", link: "#00ffff", code: "#ffff00", quote: "#ffffff" },
    light: { keyword: "#8a1c65", string: "#176b35", number: "#6b39a8", comment: "#5d6878", func: "#005b91", definition: "#176b35", type: "#005b91", operator: "#9a4d00", heading: "#135fc1", link: "#0055c8", code: "#6b1c80", quote: "#53647d" },
    newsprint: { keyword: "#8a1c65", string: "#176b35", number: "#6b39a8", comment: "#625d52", func: "#075e91", definition: "#176b35", type: "#075e91", operator: "#8b3a2d", heading: "#8b3a2d", link: "#075e91", code: "#6b1c80", quote: "#625d52" }
  }; const c = palette[name] || palette.midnight;
  return syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: c.keyword }, { tag: tags.string, color: c.string }, { tag: tags.number, color: c.number }, { tag: tags.comment, color: c.comment, fontStyle: "italic" }, { tag: tags.function(tags.variableName), color: c.func }, { tag: tags.definition(tags.variableName), color: c.definition }, { tag: tags.typeName, color: c.type }, { tag: tags.className, color: c.type }, { tag: tags.operator, color: c.operator }, { tag: tags.heading, color: c.heading, fontWeight: "750", textDecoration: "none" }, { tag: tags.processingInstruction, color: c.comment }, { tag: tags.meta, color: c.comment }, { tag: tags.link, color: c.link, textDecoration: "underline" }, { tag: tags.url, color: c.link, textDecoration: "underline" }, { tag: tags.monospace, color: c.code, backgroundColor: name === "light" || name === "newsprint" ? "#e9edf5" : "#202c40" }, { tag: tags.quote, color: c.quote, fontStyle: "italic" }, { tag: tags.strikethrough, textDecoration: "line-through" }, { tag: tags.emphasis, fontStyle: "italic" }, { tag: tags.strong, fontWeight: "800" }
  ]), { fallback: true });
}

export function editorThemeFor(name: string) {
  const themes: Record<string, any> = {
    midnight: { bg: "#171b24", fg: "#f2f5fc", gutter: "#12151c", gutterFg: "#aeb9ce", active: "#ffffff0b", cursor: "#5794ff", selection: "#39496c", tooltip: "#202838", border: "#364157" },
    newsprint: { bg: "#fbf5e9", fg: "#2b2925", gutter: "#eae1d1", gutterFg: "#6d6355", active: "#e4d6c1", cursor: "#8d4634", selection: "#d7c49d", tooltip: "#fffaf0", border: "#c6b9a2" },
    light: { bg: "#ffffff", fg: "#17263d", gutter: "#eef3f9", gutterFg: "#52637c", active: "#e2eaf5", cursor: "#1768dc", selection: "#bfd4ff", tooltip: "#ffffff", border: "#c2ccda" },
    retro: { bg: "#0d170e", fg: "#d8ffd0", gutter: "#0b130c", gutterFg: "#9cbe96", active: "#223b24", cursor: "#b9ff66", selection: "#345c38", tooltip: "#111e12", border: "#345638" },
    contrast: { bg: "#000000", fg: "#ffffff", gutter: "#000000", gutterFg: "#ffffff", active: "#202020", cursor: "#ffff00", selection: "#005d5d", tooltip: "#000000", border: "#ffffff" }
  };
  const t = themes[name] || themes.midnight;
  return EditorView.theme({ "&": { height: "100%", backgroundColor: t.bg, color: t.fg }, ".cm-content": { fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: "13px", lineHeight: "1.65", padding: "18px 0" }, ".cm-gutters": { backgroundColor: t.gutter, color: t.gutterFg, border: "none" }, ".cm-activeLineGutter": { color: t.fg }, ".cm-activeLine": { backgroundColor: t.active }, ".cm-cursor": { borderLeftColor: t.cursor }, ".cm-selectionBackground": { backgroundColor: t.selection + " !important" }, ".cm-tooltip": { backgroundColor: t.tooltip, color: t.fg, border: `1px solid ${t.border || "#364157"}` }, ".cm-line": { color: t.fg } }, { dark: name !== "light" });
}
