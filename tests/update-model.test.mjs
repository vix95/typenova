import test from "node:test";
import assert from "node:assert/strict";
import { RECHECK_MS, downloadPercent, releaseNote } from "../.test-build/updates/update-model.js";

test("an open program asks again every few hours, not more often than every hour", () => {
  assert.ok(RECHECK_MS >= 60 * 60 * 1000 && RECHECK_MS <= 24 * 60 * 60 * 1000);
});

test("the progress of a download is whole percent, and unknown without a size", () => {
  assert.equal(downloadPercent(50, 200), 25);
  assert.equal(downloadPercent(999, 1000), 99);
  assert.equal(downloadPercent(5000, 1000), 100);
  assert.equal(downloadPercent(10, null), null);
  assert.equal(downloadPercent(10, 0), null);
});

test("the note of a release is one short plain line", () => {
  assert.equal(releaseNote("## 1.2.3\n\n- **A clearer graph.**\n\n**Full Changelog**: x"), "1.2.3");
  assert.equal(releaseNote("\n\nA clearer branch graph.\n\n**Full Changelog**: x"), "A clearer branch graph.");
  assert.equal(releaseNote(undefined), "");
  assert.equal(releaseNote("x".repeat(300)).length, 160);
});
