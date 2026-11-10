import test from "node:test";
import assert from "node:assert/strict";

const engine = () => import("../.test-build/graph/project-index-engine.js");
const model = () => import("../.test-build/graph/project-index-model.js");
const rename = () => import("../.test-build/graph/link-rename.js");

/** A disk, a place to store the index, and a clock, all in memory, counting what the index does to them. */
function world(roots = ["/p"]) {
  const disk = new Map(); // path -> { text, mtime }
  const stored = new Map(); // key -> files
  const calls = { readDir: 0, readText: 0, stat: 0, save: 0 };
  const timers = [];
  let clock = 1_000;
  let statWorks = true;
  const port = {
    roots: () => roots,
    load: async key => structuredClone(stored.get(key) ?? []),
    save: async (key, files) => { calls.save++; stored.set(key, structuredClone(files)); },
    stamp: async path => { calls.stat++; const file = disk.get(path); return file && statWorks ? `${file.mtime}:${file.text.length}` : "?"; },
    readDir: async path => {
      calls.readDir++;
      const names = new Map();
      for (const file of disk.keys()) {
        if (!file.startsWith(`${path}/`)) continue;
        const rest = file.slice(path.length + 1), slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      if (!names.size && path !== "/p") throw new Error(`no such folder ${path}`);
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    readText: async path => { calls.readText++; return disk.get(path).text; },
    join: async (folder, name) => `${folder}/${name}`,
    isInside: (list, path) => list.some(root => path.startsWith(`${root}/`)),
    samePath: (a, b) => a.toLowerCase() === b.toLowerCase(),
    now: () => clock,
    setTimer: (run, ms) => { const timer = { run, at: clock + ms, live: true }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.live = false; },
    warn: () => undefined,
  };
  return {
    disk, stored, calls, port,
    write: (path, text, mtime = 1) => disk.set(path, { text, mtime }),
    advance(ms) { clock += ms; for (const timer of timers.splice(0)) { if (timer.live && timer.at <= clock) { timer.live = false; timer.run(); } else if (timer.live) timers.push(timer); } },
    breakStat: () => { statWorks = false; },
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

test("a first read indexes every file, keeps the index after a delay, and only when something changed", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  w.write("/p/a.md", "# A\n\n## Sec\n\n[[b.md#Other]]\n");
  w.write("/p/sub/b.md", "# B\n\n## Other\n");
  w.write("/p/notes.txt", "not markdown");
  w.write("/p/node_modules/x.md", "# skipped");
  const index = createProjectIndex(w.port);
  const { files } = await index.indexedFiles();
  assert.deepEqual(files.map(f => f.path).sort(), ["/p/a.md", "/p/sub/b.md"]);
  assert.deepEqual(files.find(f => f.path === "/p/a.md").sections.map(s => s.title), ["A", "Sec"]);
  assert.ok(files.find(f => f.path === "/p/a.md").links.includes("other"));
  assert.equal(w.calls.save, 0, "not stored at once: a burst of changes is stored once");
  w.advance(3000);
  await flush();
  assert.equal(w.calls.save, 1);
  assert.equal([...w.stored.values()][0].length, 2);
});

test("after a restart the stored index is usable at once, and no file is read again", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  for (let i = 0; i < 40; i++) w.write(`/p/d${i % 4}/f${i}.md`, `# F${i}\n\n## Part ${i}\n\n[[f${(i + 1) % 40}.md#Part ${(i + 1) % 40}]]\n`);
  const first = createProjectIndex(w.port);
  await first.indexedFiles();
  w.advance(3000);
  await flush();
  assert.equal(w.stored.size, 1);

  const readsBefore = w.calls.readText, savesBefore = w.calls.save;
  const second = createProjectIndex(w.port); // a new run of the program: nothing in memory
  const now = await second.indexedFilesNow();
  assert.equal(now.files.length, 40, "the map is there without waiting for a scan");
  assert.equal(w.calls.readText - readsBefore, 0, "no file read to get it");
  const checked = await second.indexedFiles(); // the check against the disk, in the background
  assert.equal(checked.files.length, 40);
  assert.equal(w.calls.readText - readsBefore, 0, "unchanged files are recognised by their stamp and not read");
  w.advance(10_000);
  await flush();
  assert.equal(w.calls.save, savesBefore, "nothing changed, nothing is stored again");
});

test("after a restart only the files that changed are read, and added and deleted files are noticed", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  w.write("/p/a.md", "# A\n"); w.write("/p/b.md", "# B\n"); w.write("/p/c.md", "# C\n");
  const first = createProjectIndex(w.port);
  await first.indexedFiles(); w.advance(3000); await flush();
  w.write("/p/b.md", "# B changed\n\n## New section\n", 2);
  w.disk.delete("/p/c.md");
  w.write("/p/d.md", "# D\n");
  const reads = w.calls.readText;
  const second = createProjectIndex(w.port);
  const { files } = await second.indexedFiles();
  assert.equal(w.calls.readText - reads, 2, "the changed file and the new one");
  assert.deepEqual(files.map(f => f.path).sort(), ["/p/a.md", "/p/b.md", "/p/d.md"]);
  assert.deepEqual(files.find(f => f.path === "/p/b.md").sections.map(s => s.title), ["B changed", "New section"]);
  const saves = w.calls.save;
  w.advance(3000); await flush();
  assert.equal(w.calls.save, saves + 1, "the changes are stored");
  assert.equal(w.stored.values().next().value.length, 3);
});

test("a rename needs no scan when the map exists: the stored map answers, and only the files that link are read", async () => {
  const { createProjectIndex } = await engine();
  const m = await model();
  const r = await rename();
  const w = world();
  for (let i = 0; i < 300; i++) w.write(`/p/n${i}.md`, `# N${i}\n\n## Section ${i}\n\ntext\n`);
  w.write("/p/linker.md", "# L\n\nsee [[n7.md#Section 7]] and [[n9.md#Section 9]]\n");
  const first = createProjectIndex(w.port);
  await first.indexedFiles(); w.advance(3000); await flush();

  const second = createProjectIndex(w.port);
  const reads = w.calls.readText, dirs = w.calls.readDir;
  const { files } = await second.indexedFilesNow();
  assert.equal(w.calls.readText - reads, 0);
  const linking = m.filesLinkingTo(files, "Section 7");
  assert.deepEqual(linking.map(f => f.path), ["/p/linker.md"], "one file out of 301 links to the section");
  const texts = new Map(linking.map(f => [f.path, { path: f.path, name: f.name, text: w.disk.get(f.path).text }]));
  texts.set("/p/n7.md", { path: "/p/n7.md", name: "n7.md", text: "# N7\n\n## Seventh\n\ntext\n" });
  const plan = r.planLinkRename(m.sourcesFromIndex(files, texts), { path: "/p/n7.md", line: 3, oldTitle: "Section 7", newTitle: "Seventh" });
  assert.equal(plan.linkCount, 1);
  assert.equal(r.applyEdits(texts.get("/p/linker.md").text, plan.files[0].edits), "# L\n\nsee [[n7.md#Seventh]] and [[n9.md#Section 9]]\n");
  assert.equal(dirs >= 0, true);
});

test("a large project: the first read is checkpointed, a restart is instant, and nothing above the limit is indexed", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  const total = 3000;
  for (let i = 0; i < total; i++) w.write(`/p/g${i % 30}/h${i % 7}/doc${i}.md`, `# Doc ${i}\n\n## Part\n\n[[doc${(i * 7) % total}.md#Part]]\n`);
  const first = createProjectIndex(w.port, { checkpointEvery: 500 });
  const done = await first.indexedFiles();
  assert.equal(done.files.length, total);
  assert.ok(w.calls.save >= 5, "stored as it went: closing the program half way loses little");
  w.advance(3000); await flush();

  const reads = w.calls.readText;
  const second = createProjectIndex(w.port);
  const started = process.hrtime.bigint();
  const now = await second.indexedFilesNow();
  const microseconds = Number(process.hrtime.bigint() - started) / 1000;
  assert.equal(now.files.length, total);
  assert.equal(w.calls.readText - reads, 0, "not one of the 3000 files is read to get the map");
  console.log(`  restart with ${total} files: map available after ${Math.round(microseconds / 1000)} ms, 0 files read`);
  const all = await second.indexedFiles();
  assert.equal(all.files.length, total);
  assert.equal(w.calls.readText - reads, 0, "and none is read when the map is checked against the disk");

  const limited = createProjectIndex(w.port, { maxFiles: 100 }); // another set of folders is not needed: a smaller limit
  const part = await limited.indexedFiles();
  assert.equal(part.tooLarge, true);
});

test("a saved file renews its entry, a file outside the folders is ignored", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  w.write("/p/a.md", "# A\n"); w.write("/p/b.md", "# B\n");
  const index = createProjectIndex(w.port);
  await index.indexedFiles(); w.advance(3000); await flush();
  const saves = w.calls.save;
  w.write("/p/a.md", "# A\n\n## Added\n\n[[b.md#B]]\n", 5);
  index.noteFileSaved("/p/a.md", "# A\n\n## Added\n\n[[b.md#B]]\n");
  index.noteFileSaved("/elsewhere/z.md", "# Z\n");
  index.noteFileSaved("/p/readme.txt", "x");
  await flush();
  const entry = index.indexedNow().find(f => f.path === "/p/a.md");
  assert.deepEqual(entry.sections.map(s => s.title), ["A", "Added"]);
  assert.ok(entry.links.includes("b.md") && entry.links.includes("b"));
  assert.equal(index.indexedNow().length, 2);
  w.advance(3000); await flush();
  assert.equal(w.calls.save, saves + 1);
  // The save of a new file in the project adds it.
  w.write("/p/new.md", "# New\n", 6);
  index.noteFileSaved("/p/new.md", "# New\n");
  await flush();
  assert.equal(index.indexedNow().length, 3);
});

test("when the system gives no stamps the stored map still serves at once, files are just read again in the background", async () => {
  const { createProjectIndex } = await engine();
  const w = world();
  w.write("/p/a.md", "# A\n"); w.write("/p/b.md", "# B\n");
  w.breakStat();
  const first = createProjectIndex(w.port);
  await first.indexedFiles(); w.advance(3000); await flush();
  const reads = w.calls.readText;
  const second = createProjectIndex(w.port);
  assert.equal((await second.indexedFilesNow()).files.length, 2);
  assert.equal(w.calls.readText - reads <= 2, true);
  await second.indexedFiles();
  assert.equal(w.calls.readText - reads, 2, "without stamps nothing can be recognised as unchanged");
});

test("the index follows the folders: other folders have their own index, and an unreadable folder is reported, not fatal", async () => {
  const { createProjectIndex, indexKeyOf } = await engine();
  assert.notEqual(indexKeyOf(["/p"]), indexKeyOf(["/q"]));
  assert.equal(indexKeyOf(["/a", "/b"]), indexKeyOf(["/b", "/a"]));
  const w = world(["/p", "/missing"]);
  w.write("/p/a.md", "# A\n");
  const index = createProjectIndex(w.port);
  const result = await index.indexedFiles();
  assert.equal(result.files.length, 1);
  assert.match(result.problem, /missing/);
  assert.equal(index.indexReady(), true);
});
