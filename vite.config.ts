import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**", "**/node_modules/**"]
    }
  },
  // Dependencies that are only imported from web workers or lazily are not found by Vite's start-up scan. Discovering them
  // later makes the dev server re-optimize and reload the page in the middle of a session (the desktop window can then
  // hang on the start-up screen or exit), so they are pre-bundled up front.
  optimizeDeps: {
    include: [
      "highlight.js/lib/common",
      "katex",
      "markdown-it",
      "markdown-it-anchor",
      "markdown-it-task-lists",
      "markdown-it-texmath",
      "mermaid"
    ]
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false
  },
  worker: {
    format: "es"
  }
});
