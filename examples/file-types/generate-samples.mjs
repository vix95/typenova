// Writes the sample files and manifest.json from samples.mjs.
//   node examples/file-types/generate-samples.mjs          writes everything
//   node examples/file-types/generate-samples.mjs --check  fails if a file differs from what samples.mjs describes
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSamples } from "./samples.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const samples = await buildSamples();
const check = process.argv.includes("--check");
let differing = 0;
for (const sample of samples) {
  const target = join(root, sample.path);
  if (check) {
    const same = existsSync(target) && Buffer.compare(Buffer.from(readFileSync(target)), Buffer.from(sample.content)) === 0;
    if (!same) { differing++; console.error(`differs: ${sample.path}`); }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, sample.content);
  }
}
const manifest = JSON.stringify(samples.map(({ path, expect }) => ({ path, ...expect })), null, 2) + "\n";
if (check) { if (readFileSync(join(root, "manifest.json"), "utf8") !== manifest) { differing++; console.error("differs: manifest.json"); } }
else writeFileSync(join(root, "manifest.json"), manifest);
if (check && differing) process.exit(1);
console.log(check ? `${samples.length} samples match.` : `Wrote ${samples.length} samples and manifest.json.`);
