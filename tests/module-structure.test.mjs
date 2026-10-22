import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for the 0.5.113 split of the former monolithic src/main.ts.
// They read source text only (no DOM, no Tauri) so they run under plain `node --test`.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function listTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
const files = listTs(SRC);
const rel = (f) => relative(SRC, f).replace(/\\/g, "/");
const read = (f) => readFileSync(f, "utf8");

test("main.ts stays a thin composition root", () => {
  const text = read(join(SRC, "main.ts"));
  assert.ok(text.split("\n").length <= 200, "main.ts grew beyond 200 lines; move the logic into a feature module");
  assert.equal(/^\s*(async\s+)?function\s/m.test(text), false, "main.ts must not declare functions");
});

test("no feature module grows back into a monolith", () => {
  const limit = 600;
  const tooLarge = files
    .filter((f) => !/i18n\/translations\.ts$/.test(f))
    .map((f) => [rel(f), read(f).split("\n").length])
    .filter(([, lines]) => lines > limit);
  assert.deepEqual(tooLarge, [], `modules above ${limit} lines: ${JSON.stringify(tooLarge)}`);
});

test("no module imports the composition root", () => {
  for (const f of files) {
    if (rel(f) === "main.ts") continue;
    assert.equal(/from\s+["'][^"']*\/main["']/.test(read(f)), false, `${rel(f)} imports main.ts`);
  }
});

test("every init function imported by main.ts is called exactly once, in a single boot sequence", () => {
  const text = read(join(SRC, "main.ts"));
  const imported = [...text.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
  const inits = imported.filter((n) => /^init[A-Z]\w*$/.test(n));
  assert.ok(inits.length > 0);
  for (const name of inits) {
    const calls = text.match(new RegExp(`^${name}\\(\\);`, "gm")) ?? [];
    assert.equal(calls.length, 1, `${name} must be called exactly once from main.ts`);
  }
});

test("every exported init function is wired into the boot sequence", () => {
  const main = read(join(SRC, "main.ts"));
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/^export function (init[A-Z]\w*)\(\): void/gm)) {
      assert.ok(new RegExp(`^${m[1]}\\(\\);`, "m").test(main), `${rel(f)} exports ${m[1]} but main.ts never calls it`);
    }
  }
});

test("worker URLs resolve relative to the file that creates them", () => {
  const found = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
      found.push([rel(f), m[1]]);
      assert.ok(existsSync(resolve(dirname(f), m[1])), `${rel(f)} points to a missing file: ${m[1]}`);
    }
  }
  assert.ok(found.length >= 4, "expected the preview, export, index and layout workers to be referenced");
});

test("feature modules document their responsibility", () => {
  const dirs = ["app", "ui", "i18n", "layout", "project", "graph-ui", "outline"];
  for (const f of files) {
    const r = rel(f);
    if (!dirs.some((d) => r.startsWith(d + "/"))) continue;
    assert.ok(read(f).startsWith("/** "), `${r} should start with a one-line responsibility comment`);
  }
});

test("no function declaration exceeds 100 lines", async () => {
  const ts = (await import("typescript")).default;
  const limit = 100;
  const tooLong = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.ES2022, true);
    (function walk(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const start = sf.getLineAndCharacterOfPosition(node.getStart()).line;
        const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
        if (end - start + 1 > limit) tooLong.push(`${rel(f)} ${node.name.text} (${end - start + 1} lines)`);
      }
      ts.forEachChild(node, walk);
    })(sf);
  }
  assert.deepEqual(tooLong, [], `functions above ${limit} lines: ${tooLong.join(", ")}`);
});
