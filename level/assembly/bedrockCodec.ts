import { BinaryWriter } from "./binary";

export function buildChunkKey(chunkX: i32, chunkZ: i32, dimension: i32, type: u8, hasSubY: bool, subY: i8): Uint8Array {
  const writer = new BinaryWriter(14);
  writer.u32(chunkX); writer.u32(chunkZ);
  if (dimension != 0) writer.u32(dimension);
  writer.u8(type);
  if (hasSubY) writer.u8(<u8>subY);
  return writer.data.slice(0, writer.offset);
}

export function buildColumnMetadata(heights: StaticArray<i16>, dimension: i32, biomeId: i32): Uint8Array {
  return buildColumnMetadataFromPointer(changetype<usize>(heights), dimension, biomeId);
}

export function buildColumnMetadataFromPointer(heightsPointer: usize, dimension: i32, biomeId: i32): Uint8Array {
  const biomeHeight = dimension == 1 ? 8 : dimension == 2 ? 16 : 24;
  const writer = new BinaryWriter(512 + biomeHeight * 521);
  for (let index = 0; index < 256; ++index) writer.u16(<u16>load<i16>(heightsPointer + index * sizeof<i16>()));
  for (let biomeY = 0; biomeY < biomeHeight; ++biomeY) {
    writer.u8(3);
    for (let word = 0; word < 128; ++word) writer.u32(0);
    writer.u32(1); writer.u32(biomeId);
  }
  return writer.data.slice(0, writer.offset);
}
