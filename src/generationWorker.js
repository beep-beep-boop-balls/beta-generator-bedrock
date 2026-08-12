import { blockRangeToChunkRange } from "./integration/range.js";

const PROGRESS_INTERVAL = 500;
const ARCHIVE_BATCH_BYTES = 16 * 1024 * 1024;

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "generate") return;
  let lastProgress = -Infinity;
  let completedAtFailure = 0;
  let totalAtFailure = 0;
  let archiveBatch = [];
  let archiveBatchBytes = 0;
  const archiveBlobs = [];
  const flushArchiveBatch = () => {
    if (archiveBatchBytes === 0) return;
    archiveBlobs.push(new Blob(archiveBatch, { type: "application/octet-stream" }));
    archiveBatch = [];
    archiveBatchBytes = 0;
  };
  try {
    const options = data.options;
    const range = blockRangeToChunkRange(options);
    const netherRange = blockRangeToChunkRange({
      minX: options.netherMinX ?? options.minX,
      maxX: options.netherMaxX ?? options.maxX,
      minZ: options.netherMinZ ?? options.minZ,
      maxZ: options.netherMaxZ ?? options.maxZ,
    });
    const chunks = options.decorate ? (range.chunksX + 1) * (range.chunksZ + 1) + range.chunkCount : range.chunkCount * 2;
    const netherChunks = options.decorate ? (netherRange.chunksX + 1) * (netherRange.chunksZ + 1) + netherRange.chunkCount : netherRange.chunkCount * 2;
    const border = options.addBorder ? (range.chunksX + 2) * 2 + range.chunksZ * 2 : 0;
    const netherBorder = options.addNetherBorder ? (netherRange.chunksX + 2) * 2 + netherRange.chunksZ * 2 : 0;
    const total = chunks + (options.fillNether ? netherChunks : 0) + border + netherBorder;
    totalAtFailure = total;
    self.postMessage({ type: "progress", completed: 0, total });
    const { generateArchiveInWasm } = await import("./integration/wasmArchive.js");
    generateArchiveInWasm({
      ...options,
      range,
      netherRange,
      generatorType: options.overworldGenerator === "sky" ? 2 : 0,
      collectAfterGeneration: false,
      onProgress(completed, total) {
        completedAtFailure = completed;
        totalAtFailure = total;
        if (completed === total) return;
        const now = performance.now();
        if (now - lastProgress < PROGRESS_INTERVAL) return;
        lastProgress = now;
        self.postMessage({ type: "progress", completed, total });
      },
      onArchivePart(part) {
        archiveBatch.push(part);
        archiveBatchBytes += part.byteLength;
        if (archiveBatchBytes >= ARCHIVE_BATCH_BYTES) flushArchiveBatch();
      },
    });
    flushArchiveBatch();
    const archive = new Blob(archiveBlobs, { type: "application/zip" });
    self.postMessage({ type: "progress", completed: totalAtFailure, total: totalAtFailure });
    self.postMessage({ type: "complete", archive });
  } catch (error) {
    const original = error?.message ?? String(error);
    const location = totalAtFailure > 0 ? ` at ${completedAtFailure}/${totalAtFailure} chunk operations` : "";
    self.postMessage({ type: "error", message: `${original}${location}`, stack: error?.stack });
  }
});

self.postMessage({ type: "ready" });
