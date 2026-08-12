import { Chunk } from "../chunk";
import { World } from "../world";

export abstract class Generator {
  abstract createRawChunk(world: World, chunkX: i32, chunkZ: i32): Chunk;
  abstract decorateTerrain(world: World, chunkX: i32, chunkZ: i32): void;
  abstract getBiomesInArea(x: i32, z: i32, width: i32, depth: i32): Uint8Array;
  abstract getTemperatures(buffer: Float64Array | null, x: i32, z: i32, width: i32, depth: i32): Float64Array;
}
