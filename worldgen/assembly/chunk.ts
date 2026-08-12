import { blocksSky } from "./blocks";

export const CHUNK_SIZE: i32 = 16;
export const WORLD_HEIGHT: i32 = 128;
export const COLUMN_COUNT: i32 = CHUNK_SIZE * CHUNK_SIZE;
export const BLOCK_COUNT: i32 = COLUMN_COUNT * WORLD_HEIGHT;

export class Chunk {
  readonly chunkX: i32;
  readonly chunkZ: i32;
  readonly blocks: StaticArray<u8> = new StaticArray<u8>(BLOCK_COUNT);
  readonly states: StaticArray<u8> = new StaticArray<u8>(BLOCK_COUNT);
  readonly heightMap: StaticArray<u8> = new StaticArray<u8>(COLUMN_COUNT);
  readonly biomes: StaticArray<u8> = new StaticArray<u8>(COLUMN_COUNT);

  constructor(chunkX: i32, chunkZ: i32) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
  }

  @inline
  static index(x: i32, y: i32, z: i32): i32 {
    return (x * CHUNK_SIZE + z) * WORLD_HEIGHT + y;
  }

  @inline
  getBlock(x: i32, y: i32, z: i32): u8 {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return unchecked(this.blocks[Chunk.index(x, y, z)]);
  }

  @inline
  getBlockState(x: i32, y: i32, z: i32): u8 {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return unchecked(this.states[Chunk.index(x, y, z)]);
  }

  @inline
  setBlock(x: i32, y: i32, z: i32, id: u8, state: u8 = 0): bool {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const index = Chunk.index(x, y, z);
    unchecked(this.blocks[index] = id);
    unchecked(this.states[index] = state);
    return true;
  }

  buildHeightColumn(x: i32, z: i32): u8 {
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !blocksSky(this.getBlock(x, y - 1, z))) --y;
    unchecked(this.heightMap[z * CHUNK_SIZE + x] = <u8>y);
    return <u8>y;
  }

  buildHeightMap(): void {
    for (let x = 0; x < CHUNK_SIZE; ++x) {
      for (let z = 0; z < CHUNK_SIZE; ++z) this.buildHeightColumn(x, z);
    }
  }
}
