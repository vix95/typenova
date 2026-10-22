import test from "node:test";
import assert from "node:assert/strict";
import { createGraphWorkspaceController } from "../.test-build/graph/workspace-controller.js";
import { buildSectionNodes } from "../.test-build/graph/section-model.js";

test("graph workspace controller invalidates stale generations and terminates the previous worker", () => {
  const controller = createGraphWorkspaceController();
  const terminated = { count: 0 };
  let cancelled = 0;
  const first = controller.beginBuild();
  assert.equal(controller.isCurrent(first), true);
  assert.equal(controller.attachIndexWorker(first, { terminate() { terminated.count += 1; } }, () => { cancelled += 1; }), true);
  const second = controller.beginBuild();
  assert.equal(controller.isCurrent(first), false);
  assert.equal(controller.isCurrent(second), true);
  assert.equal(terminated.count, 1);
  assert.equal(cancelled, 1);
});

test("graph workspace controller terminates a worker attached to a stale generation", () => {
  const controller = createGraphWorkspaceController();
  const stale = controller.beginBuild();
  const current = controller.beginBuild();
  let terminated = 0;
  assert.equal(controller.attachIndexWorker(stale, { terminate() { terminated += 1; } }), false);
  assert.equal(terminated, 1);
  assert.equal(controller.isCurrent(current), true);
});

test("graph workspace controller cancellation invalidates work and releases its worker", () => {
  const controller = createGraphWorkspaceController();
  let terminated = 0;
  const generation = controller.beginBuild();
  const worker = { terminate() { terminated += 1; } };
  controller.attachIndexWorker(generation, worker);
  const cancelledGeneration = controller.cancel();
  assert.equal(controller.isCurrent(generation), false);
  assert.equal(controller.isCurrent(cancelledGeneration), true);
  assert.equal(terminated, 1);
  controller.releaseIndexWorker(worker);
  controller.cancel();
  assert.equal(terminated, 1);
});

test("section indexing batches yields and throttles progress for many small files", async () => {
  const files = Array.from({ length: 100 }, (_, index) => ({
    path: `notes/file-${index}.md`,
    name: `file-${index}.md`,
    text: `# Document ${index}\n\n## Topic ${index}\n\nBody [[file-${(index + 1) % 100}.md#Document ${(index + 1) % 100}]]`
  }));
  let yields = 0;
  const progress = [];
  const sections = await buildSectionNodes(files, {
    yieldControl: async () => { yields += 1; },
    onProgress: item => progress.push(item)
  });
  assert.equal(sections.length, 200);
  assert.ok(yields <= 12, `expected at most 12 batched yields, got ${yields}`);
  assert.ok(progress.length <= 160, `expected throttled progress, got ${progress.length} messages`);
  assert.equal(progress.at(-1)?.stage, "links");
});
