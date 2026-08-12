import { blocksSky, isLiquidBlock, isOpaqueBlock, isSolidBlock } from "./blocks";
import { Chunk, WORLD_HEIGHT } from "./chunk";
import { Generator } from "./generators/generator";
import { chunkKey, floorDiv16, floorMod16 } from "./utils/math";

export class World {
  readonly seed: i64;
  readonly carversEnabled: bool;
  private readonly provider: Generator;
  private readonly chunks: Map<i64, Chunk> = new Map<i64, Chunk>();
  private readonly populated: Set<i64> = new Set<i64>();

  constructor(seed: i64, provider: Generator, carversEnabled: bool = true) {
    this.seed = seed;
    this.provider = provider;
    this.carversEnabled = carversEnabled;
  }

  get loadedChunkCount(): i32 { return this.chunks.size; }

  getBiomesInArea(x: i32, z: i32, width: i32, depth: i32): Uint8Array { return this.provider.getBiomesInArea(x, z, width, depth); }
  getTemperatures(x: i32, z: i32, width: i32, depth: i32): Float64Array { return this.provider.getTemperatures(null, x, z, width, depth); }

  getChunk(chunkX: i32, chunkZ: i32): Chunk {
    const key = chunkKey(chunkX, chunkZ);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const chunk = this.provider.createRawChunk(this, chunkX, chunkZ);
    this.chunks.set(key, chunk);
    return chunk;
  }

  @inline getBlock(x: i32, y: i32, z: i32): u8 {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.getChunk(floorDiv16(x), floorDiv16(z)).getBlock(floorMod16(x), y, floorMod16(z));
  }

  @inline getBlockState(x: i32, y: i32, z: i32): u8 {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.getChunk(floorDiv16(x), floorDiv16(z)).getBlockState(floorMod16(x), y, floorMod16(z));
  }

  @inline isAir(x: i32, y: i32, z: i32): bool { return this.getBlock(x, y, z) == 0; }
  @inline isLiquid(x: i32, y: i32, z: i32): bool { return isLiquidBlock(this.getBlock(x, y, z)); }
  @inline isSolid(x: i32, y: i32, z: i32): bool { return isSolidBlock(this.getBlock(x, y, z)); }
  @inline isOpaque(x: i32, y: i32, z: i32): bool { return isOpaqueBlock(this.getBlock(x, y, z)); }
  @inline canSeeSky(x: i32, y: i32, z: i32): bool { return y >= this.getHeight(x, z); }

  getHeight(x: i32, z: i32): i32 {
    return unchecked(this.getChunk(floorDiv16(x), floorDiv16(z)).heightMap[floorMod16(z) * 16 + floorMod16(x)]);
  }

  getTopSolidOrLiquidBlock(x: i32, z: i32): i32 {
    for (let y = WORLD_HEIGHT - 1; y > 0; --y) {
      const id = this.getBlock(x, y, z);
      if (isSolidBlock(id) || isLiquidBlock(id)) return y + 1;
    }
    return -1;
  }

  setBlock(x: i32, y: i32, z: i32, id: u8, state: u8 = 0): bool {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const chunk = this.getChunk(floorDiv16(x), floorDiv16(z));
    const localX = floorMod16(x), localZ = floorMod16(z);
    const oldId = chunk.getBlock(localX, y, localZ);
    const changed = chunk.setBlock(localX, y, localZ, id, state);
    if (changed && oldId != id) {
      const heightIndex = localZ * 16 + localX;
      const oldHeight = <i32>unchecked(chunk.heightMap[heightIndex]);
      const oldBlocksSky = blocksSky(oldId), newBlocksSky = blocksSky(id);
      if (newBlocksSky && y >= oldHeight) unchecked(chunk.heightMap[heightIndex] = <u8>(y + 1));
      else if (oldBlocksSky && !newBlocksSky && y == oldHeight - 1) chunk.buildHeightColumn(localX, localZ);
    }
    return changed;
  }

  populateChunk(chunkX: i32, chunkZ: i32): bool {
    const key = chunkKey(chunkX, chunkZ);
    if (this.populated.has(key)) return false;
    this.getChunk(chunkX, chunkZ);
    this.provider.decorateTerrain(this, chunkX, chunkZ);
    this.populated.add(key);
    return true;
  }

  unloadChunk(chunkX: i32, chunkZ: i32): bool {
    const key = chunkKey(chunkX, chunkZ);
    this.populated.delete(key);
    return this.chunks.delete(key);
  }

  unloadChunksAtOrBeforeX(maxChunkX: i32): i32 {
    const keys = this.chunks.keys();
    let unloaded = 0;
    for (let index = 0, count = keys.length; index < count; ++index) {
      const key = unchecked(keys[index]);
      const chunk = this.chunks.get(key);
      if (chunk.chunkX > maxChunkX) continue;
      this.chunks.delete(key);
      this.populated.delete(key);
      ++unloaded;
    }
    return unloaded;
  }

  unloadAllChunks(): void {
    this.chunks.clear();
    this.populated.clear();
  }
}
