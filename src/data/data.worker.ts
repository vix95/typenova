/** Worker that profiles a delimited file or computes one chart from it. The window reads the file in pieces and sends them here; nothing but small results comes back. */
import { createDataJob, type DataJob, type JobResult, type JobTarget } from "./data-job";

export type DataWorkerRequest =
  | { type: "start"; target: JobTarget; extension: string }
  | { type: "chunk"; bytes: ArrayBuffer; length: number }
  | { type: "end" };

export type DataWorkerResponse =
  | { type: "ack"; rows: number }
  | { type: "done"; result: JobResult };

let job: DataJob | null = null;
const reply = (message: DataWorkerResponse): void => { self.postMessage(message); };

self.onmessage = (event: MessageEvent<DataWorkerRequest>) => {
  const request = event.data;
  if (request.type === "start") { job = createDataJob(request.target, request.extension); return; }
  if (!job) return;
  if (request.type === "chunk") { job.push(new Uint8Array(request.bytes, 0, request.length)); reply({ type: "ack", rows: job.rows }); return; }
  reply({ type: "done", result: job.finish() });
  job = null;
};
