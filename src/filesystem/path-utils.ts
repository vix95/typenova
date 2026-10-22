/** Pure filesystem-path helpers shared by editor, project explorer and graph indexing. */
export const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function normalizePath(input: string): string {
  const unc = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.exec(input);
  if (unc) {
    const rootParts = unc[0].replace(/\//g, "\\").split("\\").filter(Boolean);
    const rest = input.slice(unc[0].length).replace(/[\\/]+/g, "\\");
    const stack = rest.split("\\").filter(Boolean);
    const normalized: string[] = [];
    for (const part of stack) {
      if (part === ".") continue;
      if (part === "..") { if (normalized.length) normalized.pop(); }
      else normalized.push(part);
    }
    return `\\\\${[...rootParts, ...normalized].join("\\")}`;
  }

  const drive = /^([A-Za-z]:)[\\/]/.exec(input);
  const absolute = input.startsWith("/") || input.startsWith("\\");
  const separator = drive ? "\\" : "/";
  const root = drive ? drive[1] : absolute ? "/" : "";
  const remainder = drive ? input.slice(drive[0].length) : input;
  const parts = remainder.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!root) out.push("..");
    } else out.push(part);
  }
  if (drive) return `${root}\\${out.join("\\")}`;
  if (absolute) return `/${out.join("/")}`;
  return out.join(separator) || ".";
}

export function normalizeLocalImagePath(input: string): string {
  return normalizePath(input);
}

export function isMarkdownPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return MARKDOWN_EXTENSIONS.has(extension);
}

const EDITABLE_TEXT_EXTENSIONS = new Set((
  "md markdown mdown mkd mdx txt text log csv tsv env diff patch py pyw pyi ipynb java js jsx mjs cjs ts tsx mts cts json jsonc yaml yml toml xml html htm css scss sass less sql sh bash zsh ps1 bat cmd c cc cpp cxx h hh hpp hxx cs fs fsi vb go rs rb php swift kt kts scala clj cljs ex exs erl hr l lua r jl pl pm dart vue svelte astro graphql gql proto ini cfg conf properties tex bib rst adoc org lock pem cer crt key gradle groovy gvy"
).split(/\s+/));
const EDITABLE_TEXT_NAMES = new Set([".gitignore", ".editorconfig", ".env", "dockerfile", "makefile", "readme", "license"]);

export function isEditableTextFile(name: string): boolean {
  const base = basename(name).toLowerCase();
  const extension = base.includes(".") ? (base.split(".").pop() || "") : "";
  return EDITABLE_TEXT_EXTENSIONS.has(extension) || EDITABLE_TEXT_NAMES.has(base);
}
