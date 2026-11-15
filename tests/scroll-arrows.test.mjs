import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/ui/scroll-arrows-model.js");

test("a page step moves by nine tenths of the view and stays inside the document", async () => {
  const { scrollDestination } = await model();
  assert.equal(scrollDestination("page-down", 0, 500, 3000), 450);
  assert.equal(scrollDestination("page-up", 450, 500, 3000), 0);
  assert.equal(scrollDestination("page-down", 2400, 500, 3000), 2500);
  assert.equal(scrollDestination("page-up", 100, 500, 3000), 0);
});

test("top and bottom go to the ends, and a document shorter than the view does not scroll", async () => {
  const { scrollDestination, canScroll } = await model();
  assert.equal(scrollDestination("top", 1234, 500, 3000), 0);
  assert.equal(scrollDestination("bottom", 0, 500, 3000), 2500);
  assert.equal(scrollDestination("bottom", 0, 500, 300), 0);
  assert.equal(canScroll("down", 0, 500, 300), false);
  assert.equal(canScroll("up", 0, 500, 300), false);
});

test("an arrow is available only when there is something behind it", async () => {
  const { canScroll } = await model();
  assert.equal(canScroll("up", 0, 500, 3000), false);
  assert.equal(canScroll("up", 1, 500, 3000), false);
  assert.equal(canScroll("up", 30, 500, 3000), true);
  assert.equal(canScroll("down", 2500, 500, 3000), false);
  assert.equal(canScroll("down", 2499, 500, 3000), false);
  assert.equal(canScroll("down", 2000, 500, 3000), true);
});

test("a tiny view still moves a visible distance", async () => {
  const { scrollDestination } = await model();
  assert.equal(scrollDestination("page-down", 0, 20, 3000), 40);
});
