import test from "node:test";
import assert from "node:assert/strict";
import { segmentMayIntersectBounds } from "../.test-build/graph/spatial-query.js";

const viewport = { left: 0, right: 100, top: 0, bottom: 80 };

test("long graph segments crossing the viewport are retained", () => {
  assert.equal(segmentMayIntersectBounds(-1000, 40, 1000, 40, viewport), true);
  assert.equal(segmentMayIntersectBounds(40, -1000, 40, 1000, viewport), true);
});

test("long graph segments entirely outside the viewport are rejected", () => {
  assert.equal(segmentMayIntersectBounds(-400, -300, -200, -100, viewport), false);
  assert.equal(segmentMayIntersectBounds(120, 10, 400, 70, viewport), false);
  assert.equal(segmentMayIntersectBounds(10, 90, 70, 140, viewport), false);
});

test("segment viewport tests include touching boundaries and accept inverted bounds", () => {
  assert.equal(segmentMayIntersectBounds(100, 80, 140, 120, viewport), true);
  assert.equal(segmentMayIntersectBounds(20, 20, 30, 30, { left: 100, right: 0, top: 80, bottom: 0 }), true);
});

test("segment viewport tests reject non-finite coordinates", () => {
  assert.equal(segmentMayIntersectBounds(Number.NaN, 0, 10, 10, viewport), false);
  assert.equal(segmentMayIntersectBounds(0, 0, 10, 10, { left: 0, right: Infinity, top: 0, bottom: 80 }), false);
});
