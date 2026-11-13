/** Languages offered after the fence of a code block, and where a line stands among the fences of a document (pure). */

export interface FenceLanguage { id: string; pl: string; en: string; /** Ranks common languages higher in the list. */ boost: number }

const language = (id: string, pl: string, en: string, boost = 0): FenceLanguage => ({ id, pl, en, boost });

/** Names a Markdown renderer or highlighter knows for fenced code, with a short description in both languages. */
export const FENCE_LANGUAGES: readonly FenceLanguage[] = [
  language("bash", "Skrypt powłoki (można uruchomić)", "Shell script (can be run)", 9), language("sh", "Skrypt sh (można uruchomić)", "sh script (can be run)", 5),
  language("zsh", "Skrypt zsh", "zsh script", 3), language("shell", "Skrypt powłoki", "Shell script", 2),
  language("powershell", "PowerShell (można uruchomić)", "PowerShell (can be run)", 9), language("ps1", "PowerShell", "PowerShell", 3),
  language("cmd", "Wiersz polecenia Windows", "Windows command prompt", 4), language("bat", "Plik wsadowy Windows", "Windows batch file", 3),
  language("python", "Python", "Python", 9), language("py", "Python", "Python", 2),
  language("javascript", "JavaScript", "JavaScript", 8), language("js", "JavaScript", "JavaScript", 3), language("typescript", "TypeScript", "TypeScript", 8), language("ts", "TypeScript", "TypeScript", 3),
  language("jsx", "React (JSX)", "React (JSX)", 1), language("tsx", "React (TSX)", "React (TSX)", 1),
  language("json", "JSON", "JSON", 8), language("jsonc", "JSON z komentarzami", "JSON with comments", 1), language("yaml", "YAML", "YAML", 7), language("yml", "YAML", "YAML", 2), language("toml", "TOML", "TOML", 3), language("ini", "Plik INI", "INI file", 2),
  language("html", "HTML", "HTML", 7), language("xml", "XML", "XML", 5), language("css", "CSS", "CSS", 6), language("scss", "SCSS", "SCSS", 2), language("vue", "Vue", "Vue", 1),
  language("sql", "SQL", "SQL", 7), language("graphql", "GraphQL", "GraphQL", 2),
  language("csharp", "C#", "C#", 6), language("cs", "C#", "C#", 2), language("cpp", "C++", "C++", 5), language("c", "C", "C", 5), language("java", "Java", "Java", 5), language("kotlin", "Kotlin", "Kotlin", 3),
  language("go", "Go", "Go", 5), language("rust", "Rust", "Rust", 5), language("ruby", "Ruby", "Ruby", 3), language("php", "PHP", "PHP", 4), language("swift", "Swift", "Swift", 3), language("dart", "Dart", "Dart", 2), language("lua", "Lua", "Lua", 2), language("perl", "Perl", "Perl", 1), language("r", "R", "R", 2), language("scala", "Scala", "Scala", 1),
  language("dockerfile", "Dockerfile", "Dockerfile", 4), language("makefile", "Makefile", "Makefile", 2), language("nginx", "Konfiguracja nginx", "nginx configuration", 1), language("diff", "Różnice (diff)", "Differences (diff)", 3),
  language("latex", "LaTeX", "LaTeX", 2), language("markdown", "Markdown", "Markdown", 3), language("md", "Markdown", "Markdown", 1),
  language("mermaid", "Diagram Mermaid", "Mermaid diagram", 8), language("chart", "Wykres z pliku danych (CSV/TXT)", "Chart from a data file (CSV/TXT)", 6),
  language("csv", "Dane CSV", "CSV data", 2), language("tsv", "Dane TSV", "TSV data", 1), language("text", "Zwykły tekst", "Plain text", 4), language("plaintext", "Zwykły tekst", "Plain text", 1), language("console", "Sesja konsoli", "Console session", 1),
];

export interface FenceInfo {
  /** The line opens a code block (false when it closes one). */
  opening: boolean;
  /** A later line closes the block this line opens. */
  closed: boolean;
  /** The fence characters of the line. */
  fence: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * What the fence line `index` is: the opening of a block, or the closing of one that is open. `lines` are the lines of the whole document.
 * A block is closed by a later line of the same character, at least as long, with nothing after it.
 */
export function fenceAt(lines: readonly string[], index: number): FenceInfo | null {
  let open: string | null = null;
  for (let at = 0; at < index; at++) {
    const match = FENCE.exec(lines[at]);
    if (!match) continue;
    if (open === null) { if (!(match[1][0] === "`" && match[2].includes("`"))) open = match[1]; }
    else if (match[1][0] === open[0] && match[1].length >= open.length && match[2].trim() === "") open = null;
  }
  const here = FENCE.exec(lines[index] ?? "");
  if (!here) return null;
  if (open !== null) return { opening: false, closed: true, fence: here[1] };
  const fence = here[1];
  // The next fence line decides: a bare one closes this block; one with a language is the opening of another block, so this one is still open
  // (a fence typed above existing blocks must not be taken for the opening of the block below it).
  let closed = false;
  for (let at = index + 1; at < lines.length; at++) {
    const match = FENCE.exec(lines[at]);
    if (!match) continue;
    closed = match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === "";
    break;
  }
  return { opening: true, closed, fence };
}

/** What is typed after the fence on the cursor's line (the part of the language name before the cursor), or null when the text before the cursor is not a fence with a name being typed. */
export function typedLanguage(textBeforeCursor: string): string | null {
  const match = /^ {0,3}(?:`{3,}|~{3,})([\w+#.-]*)$/.exec(textBeforeCursor);
  return match ? match[1] : null;
}
