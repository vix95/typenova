import test from "node:test";
import assert from "node:assert/strict";

test("the player clock reads minutes, hours and unknown lengths", async () => {
  const { formatClock } = await import("../.test-build/preview/media-format.js");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(2.9), "0:02");
  assert.equal(formatClock(75), "1:15");
  assert.equal(formatClock(600), "10:00");
  assert.equal(formatClock(3700), "1:01:40");
  for (const unknown of [NaN, Infinity, -5, undefined]) assert.equal(formatClock(unknown), "0:00");
});

test("playback speed cycles through all speeds and returns to normal", async () => {
  const { nextSpeed, PLAYBACK_SPEEDS } = await import("../.test-build/preview/media-format.js");
  const seen = [1];
  for (let step = 0; step < PLAYBACK_SPEEDS.length; step++) seen.push(nextSpeed(seen[seen.length - 1]));
  assert.deepEqual(seen, [1, 1.25, 1.5, 2, 0.5, 0.75, 1]);
  assert.equal(nextSpeed(3), 1);
});

test("keys: Space toggles except on buttons, sliders keep their keys, F is for video only", async () => {
  const { playerKeyAction: key } = await import("../.test-build/preview/media-format.js");
  assert.equal(key(" ", "DIALOG", true), "toggle");
  assert.equal(key(" ", "BUTTON", true), null);
  assert.equal(key(" ", "INPUT", true), null);
  assert.equal(key("ArrowRight", "INPUT", false), null);
  assert.equal(key("ArrowRight", "BUTTON", false), "forward");
  assert.equal(key("ArrowLeft", "DIALOG", false), "back");
  assert.equal(key("m", "DIALOG", false), "mute");
  assert.equal(key("M", "DIALOG", true), "mute");
  assert.equal(key("f", "DIALOG", true), "fullscreen");
  assert.equal(key("F", "DIALOG", false), null);
  assert.equal(key("x", "DIALOG", true), null);
});

test("skipping stays inside the file", async () => {
  const { skipTo } = await import("../.test-build/preview/media-format.js");
  assert.equal(skipTo(10, 5, 100), 15);
  assert.equal(skipTo(2, -5, 100), 0);
  assert.equal(skipTo(98, 5, 100), 100);
  assert.equal(skipTo(5, 5, NaN), 0);
});

test("the video sample is a real WebM file the player treats as video", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileKind } = await import("../.test-build/filesystem/file-types.js");
  const bytes = readFileSync(new URL("../examples/file-types/media/clip.webm", import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(bytes.length > 1000 && bytes.length < 100_000);
  assert.equal(fileKind("clip.webm"), "video");
  for (const name of ["a.mp4", "a.m4v", "a.ogv", "a.mov", "a.mkv"]) assert.equal(fileKind(name), "video", name);
  for (const name of ["a.wav", "a.mp3", "a.flac"]) assert.equal(fileKind(name), "audio", name);
});
