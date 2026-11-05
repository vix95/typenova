import { performance } from "node:perf_hooks";
import { buildSectionNodes, buildSectionGraphModel } from "../.benchmark-build/section-model.js";

function createCorpus(fileCount) {
  return Array.from({ length: fileCount }, (_, index) => {
    const next = (index + 1) % fileCount;
    return {
      path: `notes/file-${index}.md`,
      name: `file-${index}.md`,
      text: `# Document ${index}\n\nOverview for document ${index}.\n\n## Topic ${index}\n\nRelated: [[file-${next}.md#Document ${next}]]\n\n### Detail ${index}\n\nA representative Markdown body with a few words.\n`
    };
  });
}

const requestedCounts = process.argv.slice(2).map(value => Number.parseInt(value, 10)).filter(value => Number.isInteger(value) && value > 0);
const counts = requestedCounts.length ? requestedCounts : [100, 1000, 5000];
const results = [];

for (const fileCount of counts) {
  const files = createCorpus(fileCount);
  const beforeHeap = process.memoryUsage().heapUsed;
  const indexingStart = performance.now();
  const sections = await buildSectionNodes(files);
  const indexingMs = performance.now() - indexingStart;
  const modelStart = performance.now();
  const model = buildSectionGraphModel(sections);
  const modelMs = performance.now() - modelStart;
  const afterHeap = process.memoryUsage().heapUsed;

  results.push({
    files: fileCount,
    sections: sections.length,
    relations: model.relations.length,
    indexingMs: Number(indexingMs.toFixed(2)),
    modelMs: Number(modelMs.toFixed(2)),
    totalMs: Number((indexingMs + modelMs).toFixed(2)),
    heapDeltaMiB: Number(((afterHeap - beforeHeap) / 1024 / 1024).toFixed(2))
  });
}

console.log(JSON.stringify({
  benchmark: "typenova-section-indexing",
  node: process.version,
  note: "Synthetic deterministic corpus; measures parser/model work and cooperative async-yield overhead, excludes disk I/O and DOM/Canvas rendering. Run on the same machine and Node version for comparisons.",
  results
}, null, 2));
