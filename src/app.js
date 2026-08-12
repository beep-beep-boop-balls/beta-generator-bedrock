import { blockRadiusToChunkRange } from "./integration/range.js";

const FORM = document.querySelector("#generator-form");
const BUTTON = document.querySelector("#generate");
const STATUS = document.querySelector("#status");
const DOWNLOAD = document.querySelector("#download");
const BACK = document.querySelector("#back");
const SEED_INPUT = document.querySelector("#seed");
const RADIUS_INPUT = document.querySelector("#radius");
const ROUNDED_RANGE = document.querySelector("#rounded-range");
const NETHER_RADIUS_INPUT = document.querySelector("#nether-radius");
const NETHER_ROUNDED_RANGE = document.querySelector("#nether-rounded-range");
const ORIGIN_X_INPUT = document.querySelector("#origin-x");
const ORIGIN_Z_INPUT = document.querySelector("#origin-z");
const OVERWORLD_GENERATOR_INPUT = document.querySelector(
  "#overworld-generator",
);
const CARVE_INPUT = document.querySelector("#carve");
const FILL_NETHER_INPUT = document.querySelector("#fill-nether");
const ADD_BORDER_INPUT = document.querySelector("#add-border");
const ADD_NETHER_BORDER_INPUT = document.querySelector("#add-nether-border");
const MAP_ORIGIN_INPUT = document.querySelector("#map-origin");
const LEGACY_VERSION_INPUT = document.querySelector("#legacy-version");
const WORLD_SCREEN = document.querySelector(".world-screen");
const COMPLETION_SCREEN = document.querySelector("#completion-screen");
const LOADING_OVERLAY = document.querySelector("#loading-overlay");
const LOADING_MESSAGE = document.querySelector("#loading-message");
const LOADING_PROGRESS = document.querySelector("#loading-progress");
const LOADING_PROGRESS_FILL = document.querySelector("#loading-progress-fill");
const OVERWORLD_GENERATORS = [
  { label: "Type: Overworld", value: "overworld" },
  { label: "Type: Sky", value: "sky" },
];
const RANDOM_SEEDS = [
  "gargamel",
  "Glacier",
  "JASON",
  "303",
  "worstseedever",
  "random",
  "2151901553968352745",
  "8091867987493326313",
  "3257840388504953787",
];

SEED_INPUT.value =
  RANDOM_SEEDS[Math.floor(Math.random() * RANDOM_SEEDS.length)];

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setLoadingProgress(progress, message) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  LOADING_MESSAGE.textContent = message;
  LOADING_PROGRESS_FILL.style.width = `${percent}%`;
  LOADING_PROGRESS.setAttribute("aria-valuenow", String(Math.round(percent)));
}

function showLoadingOverlay() {
  setLoadingProgress(0, "0/0 chunks");
  WORLD_SCREEN.hidden = true;
  COMPLETION_SCREEN.hidden = true;
  LOADING_OVERLAY.hidden = false;
  document.body.setAttribute("aria-busy", "true");
}

function hideLoadingOverlay() {
  LOADING_OVERLAY.hidden = true;
  WORLD_SCREEN.hidden = false;
  COMPLETION_SCREEN.hidden = true;
  document.body.removeAttribute("aria-busy");
}

function showCompletionScreen() {
  LOADING_OVERLAY.hidden = true;
  WORLD_SCREEN.hidden = true;
  COMPLETION_SCREEN.hidden = false;
  document.body.removeAttribute("aria-busy");
}

function generateInWorker(options, onProgress) {
  const worker = new Worker(new URL("./generationWorker.js", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    let started = false;
    const startupTimer = setTimeout(() => {
      worker.terminate();
      reject(new Error("The generation worker did not start"));
    }, 15000);
    worker.addEventListener("message", ({ data }) => {
      if (data?.type === "ready" && !started) {
        started = true;
        clearTimeout(startupTimer);
        worker.postMessage({ type: "generate", options });
      } else if (data?.type === "progress")
        onProgress(data.completed, data.total);
      else if (data?.type === "complete") {
        clearTimeout(startupTimer);
        worker.terminate();
        if (!(data.archive instanceof Blob))
          reject(new Error("The generation worker returned no archive"));
        else resolve(data.archive);
      } else if (data?.type === "error") {
        clearTimeout(startupTimer);
        worker.terminate();
        const error = new Error(data.message);
        if (data.stack) error.stack = data.stack;
        reject(error);
      }
    });
    worker.addEventListener("error", (error) => {
      clearTimeout(startupTimer);
      worker.terminate();
      reject(error);
    });
  });
}

function radiusSummary(input) {
  if (input.value.trim() === "") return "Enter a block radius";
  const value = Number(input.value);
  if (!Number.isSafeInteger(value)) return "Enter a whole number of blocks";
  if (value < 0) return "Radius cannot be negative";
  try {
    const range = blockRadiusToChunkRange(value);
    return `${range.chunksX}×${range.chunksZ}, ${range.chunkCount} chunks`;
  } catch {
    return "That radius is too large";
  }
}

function userFacingError(error) {
  const message = String(error?.message ?? error);
  if (message.includes("did not start"))
    return "The world generator did not start. Reload the page and try again.";
  if (message.includes("returned no archive"))
    return "The world finished generating, but the download could not be prepared. Please try again.";
  if (
    /memory|allocation|outside the bounds|out of bounds|start offset|unreachable/i.test(
      message,
    )
  )
    return "Your browser could not finish this world. Try a smaller radius or close other tabs and try again.";
  if (/safe integer|32-bit chunk range|whole multiples of 16/i.test(message))
    return "Enter valid whole coordinates in multiples of 16 blocks.";
  if (/radius|range/i.test(message))
    return "Check the selected radii and try again.";
  return "The world could not be generated. Please try again or use a smaller area.";
}

function updateRoundedRange() {
  ROUNDED_RANGE.textContent = radiusSummary(RADIUS_INPUT);
  NETHER_ROUNDED_RANGE.textContent = radiusSummary(NETHER_RADIUS_INPUT);
}

RADIUS_INPUT.addEventListener("input", updateRoundedRange);
NETHER_RADIUS_INPUT.addEventListener("input", updateRoundedRange);
updateRoundedRange();

OVERWORLD_GENERATOR_INPUT.addEventListener("click", () => {
  const currentIndex = OVERWORLD_GENERATORS.findIndex(
    ({ value }) => value === OVERWORLD_GENERATOR_INPUT.value,
  );
  const nextIndex = (currentIndex + 1) % OVERWORLD_GENERATORS.length;
  const nextGenerator = OVERWORLD_GENERATORS[nextIndex];
  OVERWORLD_GENERATOR_INPUT.value = nextGenerator.value;
  OVERWORLD_GENERATOR_INPUT.textContent = nextGenerator.label;
});

BACK.addEventListener("click", () => location.reload());

FORM.addEventListener("submit", async (event) => {
  event.preventDefault();
  BUTTON.disabled = true;
  DOWNLOAD.hidden = true;
  STATUS.textContent = "Starting…";
  showLoadingOverlay();
  let completed = false;
  try {
    const name =
      document.querySelector("#world-name").value.trim() || "New World";
    const seed = SEED_INPUT.value;
    const radius = Number(RADIUS_INPUT.value);
    const netherRadius = Number(NETHER_RADIUS_INPUT.value);
    const originX = Number(ORIGIN_X_INPUT.value);
    const originZ = Number(ORIGIN_Z_INPUT.value);
    if (
      !Number.isSafeInteger(originX) ||
      originX % 16 !== 0 ||
      !Number.isSafeInteger(originZ) ||
      originZ % 16 !== 0
    )
      throw new RangeError(
        "World origin X and Z must be whole multiples of 16 blocks",
      );
    const decorate = document.querySelector("#decorate").checked;
    const carve = CARVE_INPUT.checked;
    const overworldGenerator = OVERWORLD_GENERATOR_INPUT.value;
    const fillNether = FILL_NETHER_INPUT.checked;
    const addBorder = ADD_BORDER_INPUT.checked;
    const addNetherBorder = ADD_NETHER_BORDER_INPUT.checked;
    const mapOrigin = MAP_ORIGIN_INPUT.checked;
    const legacyVersion = LEGACY_VERSION_INPUT.checked;
    await nextPaint();
    const blob = await generateInWorker(
      {
        name,
        seed,
        minX: originX - radius,
        maxX: originX + radius,
        minZ: originZ - radius,
        maxZ: originZ + radius,
        netherMinX: originX - netherRadius,
        netherMaxX: originX + netherRadius,
        netherMinZ: originZ - netherRadius,
        netherMaxZ: originZ + netherRadius,
        outputChunkOffsetX: mapOrigin ? -(originX / 16) : 0,
        outputChunkOffsetZ: mapOrigin ? -(originZ / 16) : 0,
        decorate,
        carve,
        overworldGenerator,
        fillNether,
        addBorder,
        addNetherBorder,
        legacyVersion,
      },
      (completed, total) => {
        STATUS.textContent = `Generating chunks ${completed}/${total}`;
        setLoadingProgress(
          total === 0 ? 0 : completed / total,
          `${completed}/${total} chunks`,
        );
      },
    );
    DOWNLOAD.href = URL.createObjectURL(blob);
    DOWNLOAD.download = `${name.replaceAll(/[^a-z0-9._-]+/gi, "_") || "new_world"}.mcworld`;
    DOWNLOAD.textContent = `Download ${DOWNLOAD.download}`;
    DOWNLOAD.hidden = false;
    completed = true;
  } catch (error) {
    console.error(error);
    STATUS.textContent = userFacingError(error);
  } finally {
    if (completed) showCompletionScreen();
    else hideLoadingOverlay();
    BUTTON.disabled = false;
  }
});
