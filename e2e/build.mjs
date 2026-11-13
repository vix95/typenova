// Builds the isolated copy of the program that the end-to-end tests drive: another identifier (so it cannot hand its start over to a TypeNova that is already running)
// and its own target folder (so it does not fight with a running development build for the executable).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./harness.mjs";

const config = path.join(ROOT, "e2e", "tauri.e2e.conf.json");
const result = spawnSync("npx", ["tauri", "build", "--debug", "--no-bundle", "--config", `"${config}"`], {
  cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, CARGO_TARGET_DIR: path.join(ROOT, "src-tauri", "target-e2e") },
});
process.exit(result.status ?? 1);
