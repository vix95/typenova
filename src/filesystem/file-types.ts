/** Which kind of file a name stands for: Markdown, text (opened in the editor), an image, PDF, audio, video, a Word document to import, a known binary format, or unknown (tried as text). Generated lists live here so the sets stay in one place. */

export type FileKind = "markdown" | "text" | "image" | "pdf" | "audio" | "video" | "docx" | "binary" | "unknown";

const words = (text: string): Set<string> => new Set(text.split(/\s+/).filter(Boolean));

export const MARKDOWN_EXTENSIONS = words("md markdown mdown mkd mdx rmd qmd mdc");

/** Text formats that open in the editor (the extensions CodeMirror can highlight plus the formats TypeNova adds). */
const TEXT_EXTENSIONS = words(
  "4th adoc ahk apl asc asciidoc asm asn asn1 ass astro atom b babelrc base bash bat bf bib bicep browserslistrc build bzl c c++ canvas cc cer cfg cjs cl " +
  "clj cljc cljs cljx cls cmake cmd cob coffee conf cpp cpy cql cr creole crt cs csproj css csv cts cu cue cuh cxx cyp cypher d dart desktop diff " +
  "dockerignore dot drawio dtd dyalog dyl dylan e ecl editorconfig edn ejs el elm eml env erb erl eslintrc ex excalidraw exs f f77 f90 f95 factor feature " +
  "fish for forth frag fs fsi fsproj fth fun geojson gitattributes gitignore gitmodules glsl go gql gradle graphql groovy gss gv gvy h h++ handlebars hbs " +
  "hcl hh hlsl hpp hr hs htm html hx hxml hxx ics ini ino intr ipynb j2 jade java jinja jinja2 jl js json json5 jsonc jsonl jsonld jsx key ksh kt kts l " +
  "less lhs liquid lisp lock log lrc ls ltx lua m mak markdown mbox md mdc mdown mdx mermaid metal mjs mk mkd ml mli mll mly mm mmd mo mount mps mrc msc " +
  "mscgen mscin msgenny mts mustache nasm nb ndjson nfo nim nix njk npmrc nq nsh nsi nt nut nvmrc opml org oz p pas patch pem pgp php php3 php4 php5 php7 " +
  "phtml pig pl plantuml plist pls pm pp prettierrc pro properties props proto ps1 psd1 psm1 pu pug puml purs pxd pxi py pyi pyw pyx q qmd r rb reg resx " +
  "rkt rmd rq rs rss rst s sas sass sbt scala scm scss service sh sieve sig siv sln smackspec sml socket sol sparql spec sql srt ss st sty styl " +
  "stylelintrc sv svelte svh swift targets tcl tex text textile tf tfvars timer toml topojson ts tsv tsx ttcn ttcn3 ttcnpp ttl twig txt typ url v vb " +
  "vbproj vbs vcf vert vhd vhdl vtl vtt vue wast wat webidl webmanifest wgsl wiki wl wls xaml xhtml xml xq xqm xquery xqy xsd xsl xslt xu xy yaml yarnrc " +
  "yml ys z80 zig zsh"
);

/** File names without a telling extension (compared in lower case). */
const TEXT_NAMES = words(".gitignore .gitattributes .gitmodules .editorconfig .env .dockerignore .npmrc .nvmrc .yarnrc .prettierrc .eslintrc .babelrc .stylelintrc .browserslistrc dockerfile makefile gnumakefile cmakelists.txt procfile gemfile rakefile jenkinsfile vagrantfile brewfile justfile caddyfile codeowners authors changelog notice copying readme license");

export const IMAGE_EXTENSIONS = words("png jpg jpeg jfif gif webp svg bmp ico avif apng tif tiff");
export const PDF_EXTENSIONS = words("pdf");
export const AUDIO_EXTENSIONS = words("mp3 wav ogg oga m4a flac aac opus weba");
export const VIDEO_EXTENSIONS = words("mp4 m4v webm ogv mov mkv");
const DOCX_EXTENSIONS = words("docx");

/** Formats that are certainly not text: they stay greyed out in the project tree. */
const BINARY_EXTENSIONS = words("exe dll so dylib bin dat o obj a lib class jar war ear msi dmg iso img apk ipa zip 7z rar tar gz tgz bz2 xz zst cab doc xls ppt xlsx pptx odt ods odp rtf psd ai indd sketch fig xd eps raw cr2 nef dng heic heif jxl woff woff2 ttf otf eot sqlite sqlite3 db mdb accdb pyc pyd wasm swf flv avi wmv wma mid midi 3gp ogx psb blend fbx obj3ds stl glb gltf");

const extensionOf = (base: string): string => (base.includes(".") ? base.split(".").pop() || "" : "");

/** Classifies a file by its name (a path is fine too). */
export function fileKind(name: string): FileKind {
  const base = (name.split(/[\\/]/).pop() || name).toLowerCase();
  const extension = extensionOf(base);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (PDF_EXTENSIONS.has(extension)) return "pdf";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (DOCX_EXTENSIONS.has(extension)) return "docx";
  if (TEXT_NAMES.has(base) || base.startsWith(".env") || base.startsWith("dockerfile.") || base.endsWith(".dockerfile")) return "text";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  return "unknown";
}
