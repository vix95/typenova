/** After the fence of a code block (```), the languages to choose from; typing narrows the list (ba -> bash). Choosing one also writes the closing fence when the block has none. */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { documentState } from "../documents/document-state";
import { isMarkdownPath } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { FENCE_LANGUAGES, fenceAt, typedLanguage, type FenceInfo, type FenceLanguage } from "./fence-model";

/** What is written for a language: its name, and for a few of them a starting body. `lead` is how far the cursor goes into it. */
function body(language: FenceLanguage): { text: string; cursor: number } {
  switch (language.id) {
    case "mermaid": { const text = "mermaid\nflowchart TD\n  A[Start] --> B[Koniec]\n"; return { text, cursor: "mermaid\nflowchart TD\n  ".length }; }
    case "chart": { const text = "chart\nfile: data.csv\ntype: bar\nx: \n"; return { text, cursor: "chart\nfile: ".length }; }
    default: return { text: `${language.id}\n\n`, cursor: language.id.length + 1 };
  }
}

function option(language: FenceLanguage, info: FenceInfo): Completion {
  return {
    label: language.id, detail: langText(language.pl, language.en), type: "keyword", boost: language.boost,
    apply: (editor: EditorView, _completion: Completion, from: number, to: number) => {
      // A block that already has its closing fence only gets the name; a new one gets the closing fence too.
      if (info.closed) { editor.dispatch({ changes: { from, to, insert: language.id }, selection: { anchor: from + language.id.length }, scrollIntoView: true }); return; }
      const { text, cursor } = body(language);
      editor.dispatch({ changes: { from, to, insert: `${text}${info.fence}` }, selection: { anchor: from + cursor }, scrollIntoView: true });
    },
  };
}

export function completeFenceLanguage(context: CompletionContext): CompletionResult | null {
  if (!isMarkdownPath(documentState.currentPath || documentState.untitledLabel)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const typed = typedLanguage(line.text.slice(0, context.pos - line.from));
  if (typed === null) return null;
  const doc = context.state.doc;
  const info = fenceAt(Array.from({ length: doc.lines }, (_, index) => doc.line(index + 1).text), line.number - 1);
  if (!info?.opening) return null;
  return { from: context.pos - typed.length, options: FENCE_LANGUAGES.map(language => option(language, info)), validFor: /^[\w+#.-]*$/ };
}
