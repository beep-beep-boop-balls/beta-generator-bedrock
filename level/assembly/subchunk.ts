import { BinaryWriter } from "./binary";

export function buildPersistentStorage(indices: StaticArray<u16>, bits: i32, paletteData: Uint8Array, paletteCount: i32): Uint8Array {
  const perWord = 32 / bits;
  const wordCount = (4096 + perWord - 1) / perWord;
  const writer = new BinaryWriter(1 + wordCount * 4 + paletteData.length);
  writer.u8(<u8>(bits << 1));
  for (let wordIndex = 0; wordIndex < wordCount; ++wordIndex) {
    let word: u32 = 0;
    const first = wordIndex * perWord;
    const last = min(first + perWord, 4096);
    for (let index = first; index < last; ++index) word |= <u32>unchecked(indices[index]) << ((index - first) * bits);
    writer.u32(word);
  }
  writer.u32(paletteCount);
  let offset = paletteCount * 4;
  for (let index = 0; index < paletteCount; ++index) {
    const length = load<i32>(paletteData.dataStart + index * 4);
    writer.bytes(paletteData, offset, length);
    offset += length;
  }
  return writer.data.slice(0, writer.offset);
}

export function buildMappedPersistentStorage(indicesPointer: usize, remap: StaticArray<u16>, bits: i32, palette: Array<Uint8Array>): Uint8Array {
  const perWord = 32 / bits;
  const wordCount = (4096 + perWord - 1) / perWord;
  let paletteLength = 0;
  for (let index = 0; index < palette.length; ++index) paletteLength += unchecked(palette[index]).length;
  const writer = new BinaryWriter(1 + wordCount * 4 + 4 + paletteLength);
  writer.u8(<u8>(bits << 1));
  for (let wordIndex = 0; wordIndex < wordCount; ++wordIndex) {
    let word: u32 = 0;
    const first = wordIndex * perWord;
    const last = min(first + perWord, 4096);
    for (let index = first; index < last; ++index) {
      const source = load<u16>(indicesPointer + index * sizeof<u16>());
      word |= <u32>unchecked(remap[source]) << ((index - first) * bits);
    }
    writer.u32(word);
  }
  writer.u32(palette.length);
  for (let index = 0; index < palette.length; ++index) {
    const entry = unchecked(palette[index]);
    writer.bytes(entry, 0, entry.length);
  }
  return writer.data.slice(0, writer.offset);
}

export function unpackPersistentIndices(words: StaticArray<u32>, indices: StaticArray<u16>, bits: i32): void {
  const perWord = 32 / bits;
  const mask: u32 = bits == 16 ? 0xffff : (<u32>1 << bits) - 1;
  for (let index = 0; index < 4096; ++index) unchecked(indices[index] = <u16>((words[index / perWord] >>> ((index % perWord) * bits)) & mask));
}

export function fillIndexBox(indices: StaticArray<u16>, minX: i32, maxX: i32, minY: i32, maxY: i32, minZ: i32, maxZ: i32, paletteIndex: u16): void {
  for (let x = minX; x <= maxX; ++x) for (let z = minZ; z <= maxZ; ++z) for (let y = minY; y <= maxY; ++y) unchecked(indices[x * 256 + z * 16 + y] = paletteIndex);
}

export function scanSubChunkHeights(indices: StaticArray<u16>, solidPalette: StaticArray<u16>, heights: StaticArray<i16>, found: StaticArray<u8>, subY: i32): void {
  for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) {
    const column = z * 16 + x;
    if (unchecked(found[column]) != 0) continue;
    for (let y = 15; y >= 0; --y) if (unchecked(solidPalette[indices[x * 256 + z * 16 + y]]) != 0) {
      unchecked(heights[column] = <i16>(subY * 16 + y + 1)); unchecked(found[column] = 1); break;
    }
  }
}
