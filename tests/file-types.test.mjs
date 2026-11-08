import test from "node:test";
import assert from "node:assert/strict";

test("files are told apart by their names", async () => {
  const { fileKind } = await import("../.test-build/filesystem/file-types.js");
  const expect = {
    "notes.md": "markdown", "paper.qmd": "markdown", "report.Rmd": "markdown", "page.mdc": "markdown",
    "photo.JPG": "image", "scan.tif": "image", "logo.svg": "image",
    "manual.pdf": "pdf", "song.mp3": "audio", "clip.mp4": "video", "letter.docx": "docx",
    "main.rs": "text", "flow.mmd": "text", "data.jsonl": "text", "infra.tf": "text", "layout.xaml": "text", "Dockerfile": "text", "Dockerfile.dev": "text",
    ".env.local": "text", ".gitignore": "text", "CMakeLists.txt": "text", "Procfile": "text", "program.hs": "text", "shader.glsl": "text",
    "setup.exe": "binary", "archive.zip": "binary", "font.woff2": "binary", "sheet.xlsx": "binary", "picture.heic": "binary",
    "data.xyz": "unknown", "noextension": "unknown", "C:\\proj\\sub\\file.weird": "unknown",
  };
  for (const [name, kind] of Object.entries(expect)) assert.equal(fileKind(name), kind, name);
});

test("syntax highlighting is chosen for the formats TypeNova opens", async () => {
  const { highlightFilename } = await import("../.test-build/filesystem/language-map.js");
  const { languages } = await import("@codemirror/language-data");
  const { LanguageDescription } = await import("@codemirror/language");
  const languageOf = path => { const name = highlightFilename(path); return name ? LanguageDescription.matchFilename(languages, name)?.name ?? null : null; };
  const expected = {
    "a.json": "JSON", "a.jsonc": "JSON", "a.jsonl": "JSON", "tsconfig.json": "JSON", "a.canvas": "JSON", "a.ipynb": "JSON", ".prettierrc": "JSON",
    "a.zsh": "Shell", "a.sh": "Shell", "a.pyi": "Python", "a.py": "Python", "a.svelte": "HTML", "a.astro": "HTML", "a.hbs": "HTML",
    "a.xsd": "XML", "a.csproj": "XML", "a.plist": "XML", "a.drawio": "XML", "a.conf": "Properties files", ".editorconfig": "Properties files",
    "a.bib": "LaTeX", "a.diff": "diff", "a.patch": "diff", "Dockerfile": "Dockerfile", "Cargo.lock": "TOML", "a.toml": "TOML", "a.yaml": "YAML",
    "a.hs": "Haskell", "a.cmake": "CMake", "a.ml": "OCaml", "a.sql": "SQL", "a.rs": "Rust", "a.ts": "TypeScript", "a.vue": "Vue",
    "a.glsl": "C", "a.cu": "C++", "a.ejs": "HTML",
    "a.txt": null, "a.csv": null, "a.log": null, ".env": null, "a.md": null, "a.mmd": null, "a.dot": null, "a.pem": null, "noext": null, "a.exe": null,
  };
  for (const [path, language] of Object.entries(expected)) assert.equal(languageOf(path), language, path);
});
