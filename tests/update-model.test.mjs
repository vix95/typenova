import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_INTERVAL_MS, checkIsDue, downloadPercent, releaseNote } from "../.test-build/updates/update-model.js";

test("the check at the start is done when it was never done or the interval has passed", () => {
  const now = 1_000_000_000_000;
  assert.equal(checkIsDue(null, now), true);
  assert.equal(checkIsDue(now - 1000, now), false);
  assert.equal(checkIsDue(now - CHECK_INTERVAL_MS, now), true);
  assert.equal(checkIsDue(now + 5000, now), true, "a clock that went back asks again");
  assert.equal(checkIsDue(Number.NaN, now), true);
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
