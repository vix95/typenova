import test from "node:test";
import assert from "node:assert/strict";
import { isOwnEntry, withoutOwnEntries } from "../.test-build/project/own-files.js";

const file = name => ({ name, isDirectory: false });
const folder = name => ({ name, isDirectory: true });

test("the files TypeNova writes are recognised: the config of a document beside it, the project config, the dictionary folder", () => {
  const listing = [folder(".typenova"), folder("docs"), file("notes.md"), file("notes.md.config.json"), file("typenova.config.json"), file("README.md")];
  assert.deepEqual(withoutOwnEntries(listing).map(entry => entry.name), ["docs", "notes.md", "README.md"]);
});

test("ordinary files that only look alike are kept", () => {
  const listing = [file("app.settings.config.json"), file("webpack.config.json"), file("tsconfig.json"), file("gone.md.config.json"), folder("typenova.config.json"), file(".typenova"), folder(".typenova-old")];
  assert.deepEqual(withoutOwnEntries(listing).map(entry => entry.name), listing.map(entry => entry.name), "no document of that name beside it, or a folder where a file is expected");
});

test("names are compared without case, as on Windows, and the order is kept", () => {
  const listing = [file("Zeta.MD.Config.JSON"), file("zeta.md"), folder(".TypeNova"), file("TypeNova.Config.json"), file("a.txt"), file("a.txt.config.json")];
  assert.deepEqual(withoutOwnEntries(listing).map(entry => entry.name), ["zeta.md", "a.txt"]);
  assert.equal(isOwnEntry(file("x.md.config.json"), new Set()), false);
  assert.equal(isOwnEntry(file("x.md.config.json"), new Set(["x.md"])), true);
});
