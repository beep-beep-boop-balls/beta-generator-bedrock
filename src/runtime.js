const WASM_URL = new URL("./build/app.wasm", import.meta.url);
let progressHandler = () => {};
let archivePartHandler = () => {};
let wasmExports;
const IMPORTS = {
  env: {
    abort() {
      throw new Error("The world generation AssemblyScript runtime aborted");
    },
    reportProgress(completed, total) {
      progressHandler(completed, total);
    },
    emitArchivePart(pointer, length) {
      archivePartHandler(new Uint8Array(wasmExports.memory.buffer, pointer >>> 0, length >>> 0));
    },
  },
};

async function instantiate() {
  if (WASM_URL.protocol === "file:") {
    const { readFile } = globalThis.process.getBuiltinModule("fs").promises;
    return WebAssembly.instantiate(await readFile(WASM_URL), IMPORTS);
  }
  const response = await fetch(WASM_URL);
  try {
    return await WebAssembly.instantiateStreaming(response.clone(), IMPORTS);
  } catch {
    return WebAssembly.instantiate(await response.arrayBuffer(), IMPORTS);
  }
}

const { instance } = await instantiate();
wasmExports = instance.exports;
export const appRuntime = wasmExports;
export function setWasmProgressHandler(handler) {
  progressHandler = typeof handler === "function" ? handler : () => {};
}
export function setWasmArchivePartHandler(handler) {
  archivePartHandler = typeof handler === "function" ? handler : () => {};
}
