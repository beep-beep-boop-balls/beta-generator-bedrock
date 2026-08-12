import { locateBiomeId } from "./biomes";
import { Chunk } from "./chunk";
import { Generator } from "./generators/generator";
import { SimplexNoise } from "./noise/simplexNoise";
import { OverworldGenerator } from "./generators/overworldGenerator";
import { HellGenerator } from "./generators/hellGenerator";
import { SkyGenerator } from "./generators/skyGenerator";
import { JavaRandom } from "./utils/random";
import { javaStringHashCode, parseBetaSeed } from "./utils/seed";
import { World } from "./world";
import { absMax, javaAbs, javaCos, javaFloor, javaInt, javaSin, javaSqrt } from "./utils/math";

const WORLDS = new Map<i32, World>();
const RANDOMS = new Map<i32, JavaRandom>();
const TERRAIN_SESSIONS = new Map<i32, TerrainSession>();
let nextWorldHandle: i32 = 1;
let nextRandomHandle: i32 = 1;
let nextTerrainSessionHandle: i32 = 1;
let currentChunk: Chunk | null = null;
let currentBiomeBuffer: Uint8Array | null = null;
let currentTemperatureBuffer: Float64Array | null = null;
let seedInput = new Uint8Array(64);

const TERRAIN_EVENT_DONE: i32 = 0;
const TERRAIN_EVENT_PREPARED: i32 = 1;
const TERRAIN_EVENT_COLUMN: i32 = 2;

export function ensureSeedInputCapacity(capacity: i32): usize {
  if (capacity > seedInput.length) seedInput = new Uint8Array(capacity);
  return seedInput.dataStart;
}

export function seedTextHash(length: i32): i32 {
  return javaStringHashCode(String.UTF8.decodeUnsafe(seedInput.dataStart, length, false));
}

export function parseSeedText(length: i32, randomSeed: i64): i64 {
  return parseBetaSeed(String.UTF8.decodeUnsafe(seedInput.dataStart, length, false), randomSeed);
}

export { javaStringHashCode, parseBetaSeed } from "./utils/seed";

class TerrainSession {
  readonly world: World;
  readonly minChunkX: i32;
  readonly maxChunkX: i32;
  readonly minChunkZ: i32;
  readonly maxChunkZ: i32;
  readonly decorate: bool;
  readonly firstSourceZ: i32;
  sourceX: i32;
  sourceZ: i32;
  outputZ: i32;
  phase: i32 = 0;
  prepared: i32 = 0;
  written: i32 = 0;
  outputChunk: Chunk | null = null;

  constructor(seed: i64, generatorType: i32, minChunkX: i32, maxChunkX: i32, minChunkZ: i32, maxChunkZ: i32, decorate: bool, carve: bool) {
    const generator: Generator = generatorType == 0 ? new OverworldGenerator(seed) : generatorType == 1 ? new HellGenerator(seed) : new SkyGenerator(seed);
    this.world = new World(seed, generator, carve);
    this.minChunkX = minChunkX;
    this.maxChunkX = maxChunkX;
    this.minChunkZ = minChunkZ;
    this.maxChunkZ = maxChunkZ;
    this.decorate = decorate;
    this.sourceX = decorate ? minChunkX - 1 : minChunkX;
    this.firstSourceZ = decorate ? minChunkZ - 1 : minChunkZ;
    this.sourceZ = this.firstSourceZ;
    this.outputZ = minChunkZ;
  }

  step(): i32 {
    while (true) {
      if (this.phase == 2 || this.sourceX > this.maxChunkX) {
        this.phase = 2;
        return TERRAIN_EVENT_DONE;
      }
      if (this.phase == 0) {
        if (this.sourceZ <= this.maxChunkZ) {
          if (this.decorate) this.world.populateChunk(this.sourceX, this.sourceZ);
          else this.world.getChunk(this.sourceX, this.sourceZ);
          ++this.sourceZ;
          ++this.prepared;
          return TERRAIN_EVENT_PREPARED;
        }
        if (this.sourceX >= this.minChunkX) {
          this.phase = 1;
          this.outputZ = this.minChunkZ;
          continue;
        }
        this.world.unloadChunksAtOrBeforeX(this.minChunkX - 1);
        ++this.sourceX;
        this.sourceZ = this.firstSourceZ;
        continue;
      }
      if (this.outputZ <= this.maxChunkZ) {
        this.outputChunk = this.world.getChunk(this.sourceX, this.outputZ++);
        ++this.written;
        return TERRAIN_EVENT_COLUMN;
      }
      this.world.unloadChunksAtOrBeforeX(this.sourceX);
      ++this.sourceX;
      this.sourceZ = this.firstSourceZ;
      this.phase = 0;
    }
  }

  dispose(): void { this.outputChunk = null; this.world.unloadAllChunks(); }
}

export function locateBiome(temperature: f64, downfall: f64): u8 {
  return <u8>locateBiomeId(temperature, downfall);
}

export function simplexWrap(value: f64): i32 {
  return SimplexNoise.wrap(value);
}

export function mathSin(value: f32): f32 { return javaSin(value); }
export function mathCos(value: f32): f32 { return javaCos(value); }
export function mathSqrt(value: f32): f32 { return javaSqrt(value); }
export function mathFloor(value: f64): i32 { return javaFloor(value); }
export function mathAbs(value: f32): f32 { return javaAbs(value); }
export function mathAbsMax(a: f64, b: f64): f64 { return absMax(a, b); }
export function mathIntMultiply(a: i32, b: i32): i32 { return a * b; }
export function mathToInt(value: f64): i32 { return javaInt(value); }
export function mathToFloat(value: f64): f32 { return <f32>value; }

export function createWorld(seed: i64, generatorType: i32, carve: bool): i32 {
  const handle = nextWorldHandle++;
  if (generatorType < 0 || generatorType > 2) unreachable();
  const generator: Generator = generatorType == 0 ? new OverworldGenerator(seed) : generatorType == 1 ? new HellGenerator(seed) : new SkyGenerator(seed);
  WORLDS.set(handle, new World(seed, generator, carve));
  return handle;
}

export function createTerrainSession(seed: i64, generatorType: i32, minChunkX: i32, maxChunkX: i32, minChunkZ: i32, maxChunkZ: i32, decorate: bool, carve: bool): i32 {
  if (generatorType < 0 || generatorType > 2 || minChunkX > maxChunkX || minChunkZ > maxChunkZ) unreachable();
  const handle = nextTerrainSessionHandle++;
  TERRAIN_SESSIONS.set(handle, new TerrainSession(seed, generatorType, minChunkX, maxChunkX, minChunkZ, maxChunkZ, decorate, carve));
  return handle;
}

export function terrainSessionStep(handle: i32): i32 {
  const session = TERRAIN_SESSIONS.get(handle);
  const event = session.step();
  if (event == TERRAIN_EVENT_COLUMN) currentChunk = changetype<Chunk>(session.outputChunk);
  return event;
}
export function terrainSessionPrepared(handle: i32): i32 { return TERRAIN_SESSIONS.get(handle).prepared; }
export function terrainSessionWritten(handle: i32): i32 { return TERRAIN_SESSIONS.get(handle).written; }
export function terrainSessionLoadedChunks(handle: i32): i32 { return TERRAIN_SESSIONS.get(handle).world.loadedChunkCount; }
export function disposeTerrainSession(handle: i32): void {
  const session = TERRAIN_SESSIONS.get(handle);
  session.dispose();
  TERRAIN_SESSIONS.delete(handle);
  currentChunk = null;
}

export function disposeWorld(handle: i32): void {
  WORLDS.delete(handle);
  currentChunk = null;
}

export function worldLoadedChunkCount(handle: i32): i32 {
  return WORLDS.get(handle).loadedChunkCount;
}

export function worldGetChunk(handle: i32, chunkX: i32, chunkZ: i32): void {
  currentChunk = WORLDS.get(handle).getChunk(chunkX, chunkZ);
}

export function worldGetBiomesInArea(handle: i32, x: i32, z: i32, width: i32, depth: i32): usize {
  currentBiomeBuffer = WORLDS.get(handle).getBiomesInArea(x, z, width, depth);
  return changetype<Uint8Array>(currentBiomeBuffer).dataStart;
}
export function worldGetTemperatures(handle: i32, x: i32, z: i32, width: i32, depth: i32): usize { currentTemperatureBuffer = WORLDS.get(handle).getTemperatures(x, z, width, depth); return changetype<Float64Array>(currentTemperatureBuffer).dataStart; }

export function currentChunkX(): i32 { return changetype<Chunk>(currentChunk).chunkX; }
export function currentChunkZ(): i32 { return changetype<Chunk>(currentChunk).chunkZ; }
export function currentChunkBlocksPointer(): usize { return changetype<usize>(changetype<Chunk>(currentChunk).blocks); }
export function currentChunkStatesPointer(): usize { return changetype<usize>(changetype<Chunk>(currentChunk).states); }
export function currentChunkHeightMapPointer(): usize { return changetype<usize>(changetype<Chunk>(currentChunk).heightMap); }
export function currentChunkBiomesPointer(): usize { return changetype<usize>(changetype<Chunk>(currentChunk).biomes); }

export function worldPopulateChunk(handle: i32, chunkX: i32, chunkZ: i32): bool {
  return WORLDS.get(handle).populateChunk(chunkX, chunkZ);
}

export function worldUnloadChunksAtOrBeforeX(handle: i32, maxChunkX: i32): i32 {
  currentChunk = null;
  return WORLDS.get(handle).unloadChunksAtOrBeforeX(maxChunkX);
}

export function worldUnloadChunk(handle: i32, chunkX: i32, chunkZ: i32): bool { currentChunk = null; return WORLDS.get(handle).unloadChunk(chunkX, chunkZ); }
export function worldGetBlock(handle: i32, x: i32, y: i32, z: i32): u8 { return WORLDS.get(handle).getBlock(x, y, z); }
export function worldGetBlockState(handle: i32, x: i32, y: i32, z: i32): u8 { return WORLDS.get(handle).getBlockState(x, y, z); }
export function worldSetBlock(handle: i32, x: i32, y: i32, z: i32, id: u8, state: u8): bool { return WORLDS.get(handle).setBlock(x, y, z, id, state); }
export function worldGetHeight(handle: i32, x: i32, z: i32): i32 { return WORLDS.get(handle).getHeight(x, z); }
export function worldGetTopSolidOrLiquidBlock(handle: i32, x: i32, z: i32): i32 { return WORLDS.get(handle).getTopSolidOrLiquidBlock(x, z); }

export function worldUnloadAllChunks(handle: i32): void {
  currentChunk = null;
  WORLDS.get(handle).unloadAllChunks();
}

export function createRandom(seed: i64): i32 { const handle = nextRandomHandle++; RANDOMS.set(handle, new JavaRandom(seed)); return handle; }
export function disposeRandom(handle: i32): void { RANDOMS.delete(handle); }
export function randomSetSeed(handle: i32, seed: i64): void { RANDOMS.get(handle).setSeed(seed); }
export function randomNext(handle: i32, bits: i32): i32 { return RANDOMS.get(handle).next(bits); }
export function randomNextInt(handle: i32, bound: i32): i32 { return RANDOMS.get(handle).nextInt(bound); }
export function randomNextLong(handle: i32): i64 { return RANDOMS.get(handle).nextLong(); }
export function randomNextDouble(handle: i32): f64 { return RANDOMS.get(handle).nextDouble(); }
export function randomNextFloat(handle: i32): f32 { return RANDOMS.get(handle).nextFloat(); }
export function randomNextBoolean(handle: i32): bool { return RANDOMS.get(handle).nextBoolean(); }
