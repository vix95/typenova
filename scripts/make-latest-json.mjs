// Writes latest.json, the file the program reads to learn about a new release.
// Usage: node scripts/make-latest-json.mjs "<one general sentence about the release>"
// It reads the version from package.json and the signature from the installer's .sig file made by `tauri build`
// (the build must run with TAURI_SIGNING_PRIVATE_KEY set, see scripts/build-release.ps1), and writes
// src-tauri/target/release/bundle/nsis/latest.json. Upload that file, the installer and its .sig to the GitHub release.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const dir = "src-tauri/target/release/bundle/nsis";
const installer = `TypeNova_${version}_x64-setup.exe`;
const signature = readFileSync(`${dir}/${installer}.sig`, "utf8").trim();
const notes = process.argv[2] ?? "";
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature, url: `https://github.com/vix95/typenova/releases/download/${version}/${installer}` },
  },
};
writeFileSync(`${dir}/latest.json`, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`${dir}/latest.json for ${version}`);
