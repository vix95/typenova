/** Which syntax highlighter a file gets: aliases for formats the highlighter does not list under their own extension, and the formats that stay plain text. */
import { fileKind, MARKDOWN_EXTENSIONS } from "./file-types.js";

/** Formats shown as plain text on purpose. */
const PLAIN_EXTENSIONS = new Set(["txt", "text", "log", "csv", "tsv", "env", "lock", "pem", "cer", "crt", "key", "bat", "cmd", "graphql", "gql", "rst", "adoc", "asciidoc", "org", "typ", "wiki", "creole", "srt", "vtt", "ass", "lrc", "nfo", "url", "tf", "tfvars", "hcl", "nix", "bicep", "cue", "zig", "nim", "sol", "ex", "exs", "mmd", "mermaid", "puml", "plantuml", "pu", "dot", "gv", "base", "ics", "vcf", "eml"]);

/** Extension (or file name) of a format the highlighter knows that stands in for the format's own. */
const EXTENSION_ALIASES: Record<string, string> = {
  jsonc: "json", json5: "json", jsonl: "json", ndjson: "json", geojson: "json", topojson: "json", webmanifest: "json", canvas: "json", excalidraw: "json", ipynb: "json",
  zsh: "sh", ksh: "sh", fish: "sh", pyi: "py", pyw: "py", fsi: "fs", gvy: "groovy",
  svelte: "html", astro: "html", handlebars: "html", ejs: "html", erb: "html", twig: "html", njk: "html", mustache: "html", xhtml: "html", htm: "html",
  xaml: "xml", csproj: "xml", vbproj: "xml", fsproj: "xml", props: "xml", targets: "xml", resx: "xml", plist: "xml", drawio: "xml", rss: "xml", atom: "xml", opml: "xml", xsd: "xml", xsl: "xml", xslt: "xml",
  conf: "ini", cfg: "ini", editorconfig: "ini", gitattributes: "ini", gitmodules: "ini", dockerignore: "ini", npmrc: "ini", yarnrc: "ini", desktop: "ini", service: "ini", socket: "ini", mount: "ini", timer: "ini",
  prettierrc: "json", eslintrc: "json", babelrc: "json", stylelintrc: "json", browserslistrc: "ini", nvmrc: "ini",
  bib: "tex", ltx: "latex", sty: "tex", cls: "tex", jade: "pug", j2: "jinja", jinja2: "jinja", hbs: "html",
  glsl: "c", frag: "c", vert: "c", wgsl: "c", hlsl: "c", metal: "cpp", cu: "cpp", cuh: "cpp", ino: "cpp", sbt: "scala", mk: "sh", mak: "sh",
};

/**
 * The file name to give the highlighter (`LanguageDescription.matchFilename`), or null for plain text. Markdown is handled
 * elsewhere and also returns null. Known names (Dockerfile, ...) are passed on as they are.
 */
export function highlightFilename(path: string): string | null {
  const base = (path.split(/[\\/]/).pop() || path).toLowerCase();
  const extension = base.includes(".") ? base.split(".").pop() || "" : "";
  if (MARKDOWN_EXTENSIONS.has(extension) || fileKind(base) === "binary") return null;
  if (base === "cargo.lock" || base === "poetry.lock" || base === "pipfile") return "file.toml";
  if (base === ".env" || base.startsWith(".env.")) return null;
  if (base === "dockerfile" || base.startsWith("dockerfile.") || base.endsWith(".dockerfile")) return "Dockerfile";
  if (PLAIN_EXTENSIONS.has(extension)) return null;
  const alias = EXTENSION_ALIASES[extension] ?? EXTENSION_ALIASES[base.replace(/^\./, "")];
  if (alias) return `file.${alias}`;
  return extension || base.startsWith(".") ? base : null;
}
