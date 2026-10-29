/** Markdown snippet completions and project-scoped image path completion. */
import { CompletionContext, type Completion, startCompletion } from "@codemirror/autocomplete";
import { isMarkdownPath } from "../filesystem/path-utils";
import { syntaxTree } from "@codemirror/language";
import { pathIsInside } from "../filesystem/project-tree-operations";
import { readDir } from "@tauri-apps/plugin-fs";
import { EditorView } from "@codemirror/view";
import { documentState } from "../documents/document-state";
import { encodeMarkdownImagePath, parentDirectoryPath } from "./image-insert";
import { langText } from "../i18n/language";
import { rootContaining } from "../filesystem/project-roots";

type ImagePathCompletionContext = {
  from: number;
  typedPath: string;
  directoryPrefix: string;
  query: string;
  syntax: "markdown" | "wikilink";
};
function imagePathCompletionContext(context: CompletionContext): ImagePathCompletionContext | null {
  if (!isMarkdownPath(documentState.currentPath || documentState.untitledLabel)) return null;
  // Do not suggest file paths in code fences or inline code examples.
  let syntaxNode = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (syntaxNode) {
    if (/(?:FencedCode|CodeBlock|InlineCode|CodeText|CodeSpan)/i.test(syntaxNode.name)) return null;
    syntaxNode = syntaxNode.parent!;
  }
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const markdownImage = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]*)|([^\s)\n]*))$/.exec(before);
  const wikiImage = /!\[\[([^\]\n]*)$/.exec(before);
  let typedPath = "";
  let syntax: ImagePathCompletionContext["syntax"] = "markdown";
  if (markdownImage) typedPath = markdownImage[1] ?? markdownImage[2] ?? "";
  else if (wikiImage) { typedPath = wikiImage[1] ?? ""; syntax = "wikilink"; }
  else return null;
  // External URL destinations are not local file paths and should not trigger filesystem reads.
  if (/^(?:https?:|data:|blob:|asset:|file:|\/\/)/i.test(typedPath)) return null;

  const slash = Math.max(typedPath.lastIndexOf("/"), typedPath.lastIndexOf("\\"));
  const directoryPrefix = slash >= 0 ? typedPath.slice(0, slash + 1).replace(/\\/g, "/") : "";
  const query = slash >= 0 ? typedPath.slice(slash + 1) : typedPath;
  const typedPathStart = context.pos - typedPath.length;
  return { from: typedPathStart + (slash >= 0 ? slash + 1 : 0), typedPath, directoryPrefix, query, syntax };
}
function decodeCompletionPathPart(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
function normalizeCompletionDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const unc = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  const drive = normalized.match(/^([A-Za-z]:)(?:\/(.*))?$/);
  let root = "";
  let rest = normalized;
  if (unc) { root = `//${unc[1]}/${unc[2]}`; rest = unc[3] || ""; }
  else if (drive) { root = `${drive[1]}/`; rest = drive[2] || ""; }
  else if (normalized.startsWith("/")) { root = "/"; rest = normalized.slice(1); }
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length) parts.pop(); continue; }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (root === "/") return `/${joined}`;
  if (root.endsWith("/")) return `${root}${joined}`;
  return root ? `${root}${joined ? `/${joined}` : ""}` : joined;
}
/** Folder listings are reused for a moment: the list is rebuilt on every typed character, so a quick burst of typing must not read the disk each time. */
const DIRECTORY_CACHE_MS = 1500;
let directoryCache: { path: string; at: number; entries: { name: string; isDirectory?: boolean }[] } | null = null;
async function readCompletionDirectory(path: string): Promise<{ name: string; isDirectory?: boolean }[] | null> {
  if (directoryCache && directoryCache.path === path && Date.now() - directoryCache.at < DIRECTORY_CACHE_MS) return directoryCache.entries;
  try {
    const entries = await readDir(path);
    directoryCache = { path, at: Date.now(), entries };
    return entries;
  } catch { return null; }
}
async function completeImagePath(context: CompletionContext, pathContext: ImagePathCompletionContext) {
  if (!documentState.currentPath || !isMarkdownPath(documentState.currentPath)) return null;
  const currentDirectory = parentDirectoryPath(documentState.currentPath);
  const scopeRoot = rootContaining(documentState.projectRoots, documentState.currentPath) ?? currentDirectory;
  const relativeDirectory = pathContext.directoryPrefix.replace(/\/$/, "").split("/").filter(Boolean).map(decodeCompletionPathPart).join("/");
  const targetDirectory = normalizeCompletionDirectory(relativeDirectory ? `${currentDirectory}/${relativeDirectory}` : currentDirectory);
  if (!pathIsInside(scopeRoot, targetDirectory)) return null;
  const entries = await readCompletionDirectory(targetDirectory);
  if (!entries || context.aborted) return null;
  const locale = document.documentElement.lang || "pl";
  const query = decodeCompletionPathPart(pathContext.query).toLocaleLowerCase(locale);
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const imageFile = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?)$/i;
  const matches = entries
    .filter(entry => !!entry.isDirectory || imageFile.test(entry.name))
    .filter(entry => entry.name.toLocaleLowerCase(locale).startsWith(query))
    .sort((a, b) => collator.compare(a.name, b.name));
  if (!matches.length) return null;
  const options: Completion[] = matches.map(entry => {
    const isDirectory = !!entry.isDirectory;
    const inserted = `${encodeMarkdownImagePath(entry.name)}${isDirectory ? "/" : ""}`;
    return {
      label: `${entry.name}${isDirectory ? "/" : ""}`,
      type: isDirectory ? "namespace" : "file",
      detail: isDirectory ? langText("Katalog", "Folder") : langText("Grafika", "Image"),
      apply: (editor: EditorView, _completion: Completion, from: number, to: number) => {
        editor.dispatch({ changes: { from, to, insert: inserted }, selection: { anchor: from + inserted.length }, scrollIntoView: true });
        if (isDirectory) requestAnimationFrame(() => { if (editor.hasFocus) startCompletion(editor); });
      }
    };
  });
  // No `validFor`: with it CodeMirror keeps showing the first list while the user types more characters, so the list is
  // rebuilt on every typed character and only names that start with what was typed are kept (`filter: false`).
  return { from: pathContext.from, options, filter: false };
}
export const completions = (context: CompletionContext) => {
  const imagePath = imagePathCompletionContext(context);
  if (imagePath) return completeImagePath(context, imagePath);

  // When the user types only a heading prefix at the start of a Markdown line,
  // offer the matching heading level instead of always suggesting H2.
  const currentLine = context.state.doc.lineAt(context.pos);
  const linePrefix = currentLine.text.slice(0, context.pos - currentLine.from);
  const typedHeading = /^ {0,3}(#{1,6})$/.exec(linePrefix);
  if (typedHeading) {
    const hashes = typedHeading[1];
    const level = hashes.length;
    const headingText = `${hashes} `;
    return {
      from: currentLine.from + linePrefix.length - hashes.length,
      options: [{ label: headingText, detail: langText(`Nagłówek H${level}`, `Heading H${level}`), apply: headingText }],
      filter: false
    };
  }

  const word = context.matchBefore(/(?:#{1,6}|```|!\[|\[|`{1,3}|<|:[\w-]*)/);
  if (!word && !context.explicit) return null;
  const mermaidCompletion: Completion = {
    label: "```mermaid",
    detail: "Diagram Mermaid",
    apply: (editor: EditorView, _completion: Completion, from: number, to: number) => {
      // Keep the three typed fence characters, then complete the language name
      // immediately after them. This is one CodeMirror transaction and never
      // inserts a literal Tab character.
      const matched = editor.state.sliceDoc(from, to);
      const fence = matched.startsWith("```") ? matched.slice(0, 3) : "```";
      const continuation = "mermaid\nflowchart TD\n  A[Start] --> B[Koniec]\n```";
      editor.dispatch({
        changes: { from, to, insert: `${fence}${continuation}` },
        selection: { anchor: from + fence.length + "mermaid\nflowchart TD\n  ".length },
        scrollIntoView: true
      });
    }
  };
  const headingOptions: Completion[] = Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    const headingText = `${"#".repeat(level)} `;
    return { label: headingText, detail: langText(`Nagłówek H${level}`, `Heading H${level}`), apply: headingText };
  });
  const options: Completion[] = [
    ...headingOptions,
    { label: "```", detail: "Blok kodu", apply: "```\n\n```" },
    mermaidCompletion,
    { label: "$$", detail: "Równanie LaTeX", apply: "$$\n\n$$" },
    { label: "![alt](path)", detail: "Obraz", apply: "![Opis](<path/to/image.png>)" },
    { label: "[tekst](url)", detail: "Link", apply: "[tekst](https://)" },
    { label: "- [ ] ", detail: "Zadanie", apply: "- [ ] " }
  ];
  return { from: word ? word.from : context.pos, options };
};
