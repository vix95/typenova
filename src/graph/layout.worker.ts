/// <reference lib="webworker" />

type EdgeKind = "tree" | "section" | "link";
interface LayoutNode { x: number; y: number; radius: number }
interface LayoutEdge { a: number; b: number; kind: EdgeKind }
type WorkerRequest =
  | { type: "start"; runId: number; nodes: LayoutNode[]; edges: LayoutEdge[]; iterations: number }
  | { type: "cancel"; runId: number };
const cancelledRuns = new Set<number>();
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

self.addEventListener("message", event => {
  const message = event.data as WorkerRequest;
  if (message.type === "cancel") { cancelledRuns.add(message.runId); return; }
  if (message.type !== "start") return;
  void runLayout(message);
});

async function runLayout(message: Extract<WorkerRequest, { type: "start" }>): Promise<void> {
  const { runId, nodes: sourceNodes, edges, iterations } = message;
  const count = sourceNodes.length;
  const x = new Float64Array(count), y = new Float64Array(count);
  const vx = new Float64Array(count), vy = new Float64Array(count);
  const fx = new Float64Array(count), fy = new Float64Array(count);
  const radius = new Float64Array(count);
  sourceNodes.forEach((node, i) => { x[i] = node.x; y[i] = node.y; radius[i] = node.radius; });
  const cellX = new Int32Array(count), cellY = new Int32Array(count);
  const buckets = new Map<string, number[]>();
  const reusableBuckets: number[][] = [];
  const cellSize = 180, cutoff = 230, cutoffSquared = cutoff * cutoff;
  const activeEdges = edges.filter(edge => edge.a >= 0 && edge.b >= 0 && edge.a < count && edge.b < count && edge.a !== edge.b);

  const repel = (i: number, j: number) => {
    let dx = x[j] - x[i], dy = y[j] - y[i];
    let distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < 1) {
      const angle = ((i * 31 + j * 17) % 360) * Math.PI / 180;
      dx = Math.cos(angle); dy = Math.sin(angle); distanceSquared = 1;
    }
    const distance = Math.sqrt(distanceSquared), ux = dx / distance, uy = dy / distance;
    const repulsion = Math.min(1.6, 1500 / distanceSquared);
    fx[i] -= ux * repulsion; fy[i] -= uy * repulsion;
    fx[j] += ux * repulsion; fy[j] += uy * repulsion;
    const minimum = radius[i] + radius[j] + 18;
    if (distance < minimum) {
      const push = (minimum - distance) * 0.075;
      fx[i] -= ux * push; fy[i] -= uy * push;
      fx[j] += ux * push; fy[j] += uy * push;
    }
  };
  const sendPositions = (iteration: number, done = false) => {
    const positions = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) { positions[i * 2] = x[i]; positions[i * 2 + 1] = y[i]; }
    self.postMessage({ type: done ? "done" : "frame", runId, iteration, iterations, positions }, [positions.buffer]);
  };

  for (let iteration = 1; iteration <= Math.max(1, iterations); iteration++) {
    if (cancelledRuns.has(runId)) { cancelledRuns.delete(runId); return; }
    fx.fill(0); fy.fill(0);
    if (count <= 400) {
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) repel(i, j);
    } else {
      for (const bucket of buckets.values()) { bucket.length = 0; reusableBuckets.push(bucket); }
      buckets.clear();
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(x[i] / cellSize), cy = Math.floor(y[i] / cellSize);
        cellX[i] = cx; cellY[i] = cy;
        const key = `${cx},${cy}`;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = reusableBuckets.pop() || []; buckets.set(key, bucket); }
        bucket.push(i);
      }
      for (let i = 0; i < count; i++) {
        for (let cx = cellX[i] - 2; cx <= cellX[i] + 2; cx++) {
          for (let cy = cellY[i] - 2; cy <= cellY[i] + 2; cy++) {
            const bucket = buckets.get(`${cx},${cy}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const dx = x[j] - x[i], dy = y[j] - y[i];
              if (dx * dx + dy * dy <= cutoffSquared) repel(i, j);
            }
          }
        }
      }
    }
    for (const edge of activeEdges) {
      const dx = x[edge.b] - x[edge.a], dy = y[edge.b] - y[edge.a];
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const desired = edge.kind === "tree" ? 82 : edge.kind === "section" ? 100 : 142;
      const strength = edge.kind === "tree" ? 0.013 : edge.kind === "section" ? 0.011 : 0.008;
      const pull = (distance - desired) * strength;
      const px = dx / distance * pull, py = dy / distance * pull;
      fx[edge.a] += px; fy[edge.a] += py;
      fx[edge.b] -= px; fy[edge.b] -= py;
    }
    for (let i = 0; i < count; i++) {
      vx[i] = (vx[i] + fx[i] - x[i] * 0.001) * 0.82;
      vy[i] = (vy[i] + fy[i] - y[i] * 0.001) * 0.82;
      x[i] += vx[i]; y[i] += vy[i];
    }
    if (iteration % 4 === 0 || iteration === 1) sendPositions(iteration);
    // Yield inside the worker so cancellation messages can be handled for very large layouts.
    if (iteration % 2 === 0) await yieldTask();
  }
  if (!cancelledRuns.has(runId)) sendPositions(iterations, true);
  cancelledRuns.delete(runId);
}
