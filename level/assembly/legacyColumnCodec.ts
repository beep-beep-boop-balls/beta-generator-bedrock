const CHUNK_SIZE: i32 = 16;
const WORLD_HEIGHT: i32 = 128;
const SUBCHUNK_HEIGHT: i32 = 16;
const SUBCHUNK_COUNT: i32 = WORLD_HEIGHT / SUBCHUNK_HEIGHT;
const SUBCHUNK_BLOCK_COUNT: i32 = CHUNK_SIZE * CHUNK_SIZE * SUBCHUNK_HEIGHT;
const BLOCK_COUNT: i32 = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
const PALETTE_KEY_COUNT: i32 = 1 << 16;

const PALETTE_LOOKUP = new StaticArray<u16>(PALETTE_KEY_COUNT);
const PALETTE_STAMPS = new StaticArray<u32>(PALETTE_KEY_COUNT);
const PALETTE_KEYS = new StaticArray<u16>(SUBCHUNK_COUNT * SUBCHUNK_BLOCK_COUNT);
const PALETTE_COUNTS = new StaticArray<u16>(SUBCHUNK_COUNT);
const INDICES = new StaticArray<u16>(SUBCHUNK_COUNT * SUBCHUNK_BLOCK_COUNT);
const CONTAINS_BLOCKS = new StaticArray<u8>(SUBCHUNK_COUNT);
const HEIGHTS = new StaticArray<i16>(CHUNK_SIZE * CHUNK_SIZE);
const CHESTS = new StaticArray<u32>(BLOCK_COUNT);
let nextPaletteStamp: u32 = 1;
let chestCount: i32 = 0;

export function convertLegacyColumn(
  input: Uint8Array,
  blocksOffset: i32,
  statesOffset: i32,
  nonAirOffset: i32,
  chestId: u8,
): void {
  if (blocksOffset < 0 || statesOffset < 0 || nonAirOffset < 0) unreachable();
  if (blocksOffset + BLOCK_COUNT > input.length || statesOffset + BLOCK_COUNT > input.length || nonAirOffset + 256 > input.length) unreachable();

  convertLegacyColumnPointers(
    input.dataStart + blocksOffset,
    input.dataStart + statesOffset,
    input.dataStart + nonAirOffset,
    chestId,
  );
}

export function convertLegacyColumnPointers(
  blocksPointer: usize,
  statesPointer: usize,
  nonAirPointer: usize,
  chestId: u8,
): void {
  memory.fill(changetype<usize>(HEIGHTS), 0, CHUNK_SIZE * CHUNK_SIZE * sizeof<i16>());
  chestCount = 0;
  for (let subY = 0; subY < SUBCHUNK_COUNT; ++subY) {
    let stamp = nextPaletteStamp++;
    if (nextPaletteStamp == 0) {
      memory.fill(changetype<usize>(PALETTE_STAMPS), 0, PALETTE_KEY_COUNT * sizeof<u32>());
      nextPaletteStamp = 1;
      stamp = nextPaletteStamp++;
    }
    const outputOffset = subY * SUBCHUNK_BLOCK_COUNT;
    let paletteCount: u16 = 0;
    let containsBlocks: u8 = 0;

    for (let localX = 0; localX < CHUNK_SIZE; ++localX) {
      for (let localZ = 0; localZ < CHUNK_SIZE; ++localZ) {
        const columnOffset = (localX * CHUNK_SIZE + localZ) * WORLD_HEIGHT;
        const heightIndex = localZ * CHUNK_SIZE + localX;
        for (let localY = 0; localY < SUBCHUNK_HEIGHT; ++localY) {
          const blockY = subY * SUBCHUNK_HEIGHT + localY;
          const sourceIndex = columnOffset + blockY;
          const id = load<u8>(blocksPointer + sourceIndex);
          const state = load<u8>(statesPointer + sourceIndex);
          const key = (<u16>id << 8) | state;
          let paletteIndex: u16;
          if (unchecked(PALETTE_STAMPS[key]) != stamp) {
            paletteIndex = paletteCount++;
            unchecked(PALETTE_STAMPS[key] = stamp);
            unchecked(PALETTE_LOOKUP[key] = paletteIndex);
            unchecked(PALETTE_KEYS[outputOffset + paletteIndex] = key);
          } else paletteIndex = unchecked(PALETTE_LOOKUP[key]);

          unchecked(INDICES[outputOffset + localX * 256 + localZ * SUBCHUNK_HEIGHT + localY] = paletteIndex);
          if (load<u8>(nonAirPointer + id) != 0) {
            containsBlocks = 1;
            unchecked(HEIGHTS[heightIndex] = <i16>(blockY + 1));
          }
          if (id == chestId) unchecked(CHESTS[chestCount++] = <u32>localX | (<u32>localZ << 4) | (<u32>blockY << 8));
        }
      }
    }
    unchecked(PALETTE_COUNTS[subY] = paletteCount);
    unchecked(CONTAINS_BLOCKS[subY] = containsBlocks);
  }
}

export function legacyHeightsPointer(): usize { return changetype<usize>(HEIGHTS); }
export function legacySubChunkCount(): i32 { return SUBCHUNK_COUNT; }
export function legacySubChunkContainsBlocks(subY: i32): bool { return unchecked(CONTAINS_BLOCKS[subY]) != 0; }
export function legacyPalettePointer(subY: i32): usize { return changetype<usize>(PALETTE_KEYS) + subY * SUBCHUNK_BLOCK_COUNT * sizeof<u16>(); }
export function legacyPaletteLength(subY: i32): i32 { return unchecked(PALETTE_COUNTS[subY]); }
export function legacyIndicesPointer(subY: i32): usize { return changetype<usize>(INDICES) + subY * SUBCHUNK_BLOCK_COUNT * sizeof<u16>(); }
export function legacyChestCount(): i32 { return chestCount; }
export function legacyChestsPointer(): usize { return changetype<usize>(CHESTS); }
