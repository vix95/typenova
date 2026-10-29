# TypeNova 0.5.112 — Performance and quality audit

## Summary

This focused audit addressed allocation churn in Flat Canvas rendering and excess downstream work for off-screen long edges. It does not claim a complete renderer rewrite or an end-to-end performance improvement without WebView measurements.

## Remediated

- Per-frame arrays and a `Set` used by Canvas node/edge collection are now scratch buffers owned by the render closure and reused synchronously.
- Long edges are subjected to a conservative segment-bounds test before being added to the visible-edge candidate list.
- Geometry logic is extracted into a pure TypeScript module and covered with explicit regression tests.

## Verification

- `npm test`: 38/38 passed.
- Synthetic small graph-indexing benchmark: completed for 100 and 1,000 files. It does not measure Canvas rendering.
- Archive will exclude `.git`, `node_modules`, and generated test/benchmark output.

## Open findings

1. No `package-lock.json` exists. Registry access timed out on a lockfile-only install attempt, so reproducible dependency resolution is still a release blocker.
2. Full `npm run build`/Vite and Tauri compilation are not verified without dependencies.
3. No WebView2 profiling result quantifies frame-time or heap changes from scratch-buffer reuse.
4. The long-edge candidate list is still searched linearly; consider a coarse secondary index only if representative benchmarks show it dominates frame cost.

## Recommendation

Before a production release, generate a lockfile on a network-enabled machine, run clean dependency installation, full TypeScript/Vite and Tauri builds, then benchmark interaction frame times on representative 1k/5k/10k-section projects.
