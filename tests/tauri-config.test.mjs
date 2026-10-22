import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const security = conf.app.security;

test("style-src 'unsafe-inline' stays effective in production builds", () => {
  // Tauri appends a nonce/hash to every CSP directive it is allowed to modify. Browsers ignore
  // 'unsafe-inline' once a nonce or hash is present, which silently blocks every inline style:
  // CodeMirror's runtime stylesheets (editor layout collapses) and the style attributes used by
  // KaTeX and the tooltip/menu positioning. Production builds then look broken although the
  // development server (no modification) looks fine.
  const styleSrc = /(?:^|;)\s*style-src\s+([^;]*)/.exec(String(security.csp))?.[1] ?? "";
  if (!styleSrc.includes("'unsafe-inline'")) return;
  const disabled = security.dangerousDisableAssetCspModification;
  assert.ok(
    disabled === true || (Array.isArray(disabled) && disabled.includes("style-src")),
    "style-src allows 'unsafe-inline' but Tauri is not prevented from adding a nonce to it; add \"style-src\" to app.security.dangerousDisableAssetCspModification"
  );
});

test("the asset protocol scope stays narrow", () => {
  const scope = security.assetProtocol?.scope ?? [];
  assert.deepEqual([...scope].sort(), ["$APPDATA/**", "$HOME/**"]);
});
