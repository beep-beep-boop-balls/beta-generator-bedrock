import { appRuntime, setWasmArchivePartHandler, setWasmProgressHandler } from "../runtime.js";

const UTF8 = new TextEncoder();

function randomLong() {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return BigInt.asIntN(64, BigInt(words[0]) << 32n | BigInt(words[1]));
}

export function generateArchiveInWasm({
  name,
  seed,
  generatorType,
  range,
  netherRange = range,
  decorate,
  carve = true,
  fillNether,
  addBorder,
  addNetherBorder = false,
  legacyVersion = false,
  onProgress,
  onArchivePart,
  collectAfterGeneration = true,
  outputChunkOffsetX = 0,
  outputChunkOffsetZ = 0,
}) {
  const nameBytes = UTF8.encode(name), seedBytes = UTF8.encode(String(seed ?? ""));
  const pointer = appRuntime.ensureInputCapacity(nameBytes.length + seedBytes.length);
  new Uint8Array(appRuntime.memory.buffer, pointer, nameBytes.length).set(nameBytes);
  new Uint8Array(appRuntime.memory.buffer, pointer + nameBytes.length, seedBytes.length).set(seedBytes);
  setWasmProgressHandler(onProgress);
  const parts = onArchivePart ? null : [];
  setWasmArchivePartHandler((view) => {
    const part = view.slice();
    if (onArchivePart) onArchivePart(part);
    else parts.push(part);
  });
  try {
    const borderRandomSeed = randomLong();
    appRuntime.generateBedrockArchive(
      nameBytes.length,
      seedBytes.length,
      randomLong(),
      generatorType,
      range.minChunkX,
      range.maxChunkX,
      range.minChunkZ,
      range.maxChunkZ,
      netherRange.minChunkX,
      netherRange.maxChunkX,
      netherRange.minChunkZ,
      netherRange.maxChunkZ,
      Boolean(decorate),
      Boolean(carve),
      Boolean(fillNether),
      Boolean(addBorder),
      Boolean(addNetherBorder),
      Boolean(legacyVersion),
      BigInt(Math.floor(Date.now() / 1000)),
      borderRandomSeed,
      outputChunkOffsetX | 0,
      outputChunkOffsetZ | 0,
    );
    if (onArchivePart) return null;
    const length = parts.reduce((sum, part) => sum + part.length, 0), archive = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { archive.set(part, offset); offset += part.length; }
    return archive;
  } finally {
    setWasmArchivePartHandler(null);
    setWasmProgressHandler(null);
    if (collectAfterGeneration) appRuntime.__collect();
  }
}
