import { DatabaseEntry, entryKey, entryValue, LevelDatabase } from "./database";
import { applyLogFile, applyTableBlock, buildDatabaseTable, buildLogRecord, buildManifestLog, buildRawTable, BuiltTable, IncrementalTableBuilder, ManifestSelection, parseManifest, parseTableBlock, readLogRecords, TableEntry } from "./leveldbCodec";
import { BinaryReader, BinaryWriter } from "./binary";
import { addChild, makeBytesNode, makeContainerNode, makeDecimalNode, makeIntegerNode, makeIntsNode, makeLongsNode, makeStringNode, NamedNbt, NbtNode, readNbt, writeNbt } from "./nbt";
import { buildPersistentStorage, fillIndexBox, scanSubChunkHeights, unpackPersistentIndices } from "./subchunk";
import { centralZipHeader, endOfCentralDirectory, localZipHeader } from "./zipCodec";
import { buildChunkKey, buildColumnMetadata } from "./bedrockCodec";
import { convertLegacyColumn, legacyChestCount, legacyChestsPointer, legacyHeightsPointer, legacyIndicesPointer, legacyPaletteLength, legacyPalettePointer, legacySubChunkContainsBlocks, legacySubChunkCount } from "./legacyColumnCodec";

const SCRATCH_CAPACITY = 65536;
const SCRATCH = new StaticArray<u8>(SCRATCH_CAPACITY);
const INDICES = new StaticArray<u16>(4096);
const WORDS = new StaticArray<u32>(4096);
const PALETTE_REMAP = new StaticArray<u16>(65536);
const COLUMN_HEIGHTS = new StaticArray<i16>(256);
const HEIGHT_FOUND = new StaticArray<u8>(256);
const CRC32_TABLE = createCrcTable(0xedb88320);
const CRC32C_TABLE = createCrcTable(0x82f63b78);
const DATABASES = new Map<i32, LevelDatabase>();
const READERS = new Map<i32, BinaryReader>();
const WRITERS = new Map<i32, BinaryWriter>();
const NBT_NODES = new Map<i32, NbtNode>();
let nextDatabaseHandle: i32 = 1;
let nextReaderHandle: i32 = 1;
let nextWriterHandle: i32 = 1;
let nextNbtHandle: i32 = 1;
let transfer = new Uint8Array(SCRATCH_CAPACITY);
let selectedEntries: Array<DatabaseEntry> | null = null;
let selectedKey: Uint8Array | null = null;
let selectedValue: Uint8Array | null = null;
let builtTable: BuiltTable | null = null;
let incrementalTableBuilder: IncrementalTableBuilder | null = null;
let nbtOutput: Uint8Array | null = null;
let parsedNbt: NamedNbt | null = null;
let nbtStringOutput: Uint8Array | null = null;
let storageOutput: Uint8Array | null = null;
let leveldbOutput: Uint8Array | null = null;
let zipOutput: Uint8Array | null = null;
let parsedTableEntries: Array<TableEntry> | null = null;
let parsedLogRecords: Array<Uint8Array> | null = null;
let manifestSelection: ManifestSelection | null = null;
let bedrockOutput: Uint8Array | null = null;
let selectedLegacySubY: i32 = 0;

function createCrcTable(polynomial: u32): StaticArray<u32> {
  const table = new StaticArray<u32>(256);
  for (let i = 0; i < 256; ++i) {
    let value = <u32>i;
    for (let bit = 0; bit < 8; ++bit) value = (value & 1) != 0 ? (value >>> 1) ^ polynomial : value >>> 1;
    unchecked(table[i] = value);
  }
  return table;
}

export function scratchPointer(): usize {
  return changetype<usize>(SCRATCH);
}

export function scratchCapacity(): i32 {
  return SCRATCH_CAPACITY;
}

export function indicesPointer(): usize {
  return changetype<usize>(INDICES);
}

export function wordsPointer(): usize {
  return changetype<usize>(WORDS);
}
export function paletteRemapPointer(): usize { return changetype<usize>(PALETTE_REMAP); }
export function columnHeightsPointer(): usize { return changetype<usize>(COLUMN_HEIGHTS); }

export function crc32Update(crc: u32, length: i32): u32 {
  for (let i = 0; i < length; ++i) crc = unchecked(CRC32_TABLE[(crc ^ SCRATCH[i]) & 0xff]) ^ (crc >>> 8);
  return crc;
}

export function crc32cUpdate(crc: u32, length: i32): u32 {
  for (let i = 0; i < length; ++i) crc = unchecked(CRC32C_TABLE[(crc ^ SCRATCH[i]) & 0xff]) ^ (crc >>> 8);
  return crc;
}

export function packIndices(bits: i32): i32 {
  const perWord = 32 / bits;
  const wordCount = (4096 + perWord - 1) / perWord;
  for (let i = 0; i < wordCount; ++i) unchecked(WORDS[i] = 0);
  for (let i = 0; i < 4096; ++i) {
    const word = i / perWord;
    unchecked(WORDS[word] |= <u32>INDICES[i] << ((i % perWord) * bits));
  }
  return wordCount;
}

export function ensureTransferCapacity(capacity: i32): usize {
  if (capacity > transfer.length) {
    let next = transfer.length;
    while (next < capacity) next = next < 16 * 1024 * 1024 ? next * 2 : next + 16 * 1024 * 1024;
    transfer = new Uint8Array(next);
  }
  return transfer.dataStart;
}

export function createDatabase(): i32 {
  const handle = nextDatabaseHandle++;
  DATABASES.set(handle, new LevelDatabase());
  return handle;
}

export function disposeDatabase(handle: i32): void {
  DATABASES.delete(handle);
  selectedEntries = null;
  selectedKey = null;
  selectedValue = null;
}

export function databaseSize(handle: i32): i32 { return DATABASES.get(handle).size; }
export function databaseSequence(handle: i32): i64 { return DATABASES.get(handle).sequence; }
export function databaseSetSequence(handle: i32, sequence: i64): void { DATABASES.get(handle).sequence = sequence; }
export function databaseHas(handle: i32, keyLength: i32): bool { return DATABASES.get(handle).has(transfer, 0, keyLength); }

export function databaseGet(handle: i32, keyLength: i32): bool {
  const entry = DATABASES.get(handle).get(transfer, 0, keyLength);
  if (entry == null) { selectedValue = null; return false; }
  selectedValue = entryValue(entry);
  return selectedValue != null;
}

export function databasePut(handle: i32, keyLength: i32, valueLength: i32): void {
  DATABASES.get(handle).put(transfer, 0, keyLength, keyLength, valueLength);
}

export function databaseDelete(handle: i32, keyLength: i32): bool { return DATABASES.get(handle).remove(transfer, 0, keyLength); }
export function databaseClear(handle: i32): void { DATABASES.get(handle).clear(); }
export function databaseRemoveDeletions(handle: i32): void { DATABASES.get(handle).removeDeletions(); }

export function databaseApply(handle: i32, keyLength: i32, valueLength: i32, sequence: i64): void {
  DATABASES.get(handle).apply(transfer, 0, keyLength, keyLength, valueLength, sequence);
}
export function databaseApplyTableBlock(handle: i32, length: i32): void { applyTableBlock(DATABASES.get(handle), transfer.slice(0, length)); }
export function databaseApplyLogFile(handle: i32, length: i32): void { applyLogFile(DATABASES.get(handle), transfer.slice(0, length)); }

export function databaseBeginEntries(handle: i32): i32 {
  selectedEntries = DATABASES.get(handle).sortedEntries();
  return changetype<Array<DatabaseEntry>>(selectedEntries).length;
}

export function databaseSelectEntry(index: i32): void {
  const entry = unchecked(changetype<Array<DatabaseEntry>>(selectedEntries)[index]);
  selectedKey = entryKey(entry);
  selectedValue = entryValue(entry);
}

export function selectedKeyPointer(): usize { return changetype<Uint8Array>(selectedKey).dataStart; }
export function selectedKeyLength(): i32 { return changetype<Uint8Array>(selectedKey).length; }
export function selectedValuePointer(): usize { return selectedValue == null ? 0 : changetype<Uint8Array>(selectedValue).dataStart; }
export function selectedValueLength(): i32 { return selectedValue == null ? -1 : changetype<Uint8Array>(selectedValue).length; }
export function selectedEntrySequence(index: i32): i64 {
  return unchecked(changetype<Array<DatabaseEntry>>(selectedEntries)[index]).sequence;
}
export function endSelectedEntries(): void { selectedEntries = null; selectedKey = null; selectedValue = null; }

export function databaseBuildTable(handle: i32, preserveSequence: bool): void {
  builtTable = buildDatabaseTable(DATABASES.get(handle), preserveSequence);
}
export function databaseBeginTableBuild(handle: i32, preserveSequence: bool): void {
  if (incrementalTableBuilder != null) unreachable();
  incrementalTableBuilder = new IncrementalTableBuilder(DATABASES.get(handle), preserveSequence);
}
export function databaseStepTableBuild(maxBlocks: i32): bool {
  const builder = changetype<IncrementalTableBuilder>(incrementalTableBuilder);
  if (!builder.step(maxBlocks)) return false;
  builtTable = builder.finish();
  incrementalTableBuilder = null;
  return true;
}
export function databaseCancelTableBuild(): void { incrementalTableBuilder = null; builtTable = null; }
export function leveldbBuildRawTable(length: i32, entryCount: i32, blockSize: i32): void { builtTable = buildRawTable(transfer.slice(0, length), entryCount, blockSize); }
export function builtTablePointer(): usize { return changetype<BuiltTable>(builtTable).data.dataStart; }
export function builtTableLength(): i32 { return changetype<BuiltTable>(builtTable).data.length; }
export function builtTableSmallestPointer(): usize { return changetype<BuiltTable>(builtTable).smallest.dataStart; }
export function builtTableSmallestLength(): i32 { return changetype<BuiltTable>(builtTable).smallest.length; }
export function builtTableLargestPointer(): usize { return changetype<BuiltTable>(builtTable).largest.dataStart; }
export function builtTableLargestLength(): i32 { return changetype<BuiltTable>(builtTable).largest.length; }
export function builtTableLastSequence(): i64 { return changetype<BuiltTable>(builtTable).lastSequence; }
export function releaseBuiltTable(): void { builtTable = null; }

export function createReader(length: i32, offset: i32, limit: i32): i32 {
  const data = new Uint8Array(length);
  memory.copy(data.dataStart, transfer.dataStart, length);
  const handle = nextReaderHandle++;
  READERS.set(handle, new BinaryReader(data, offset, limit));
  return handle;
}
export function disposeReader(handle: i32): void { READERS.delete(handle); }
export function readerOffset(handle: i32): i32 { return READERS.get(handle).offset; }
export function readerSetOffset(handle: i32, offset: i32): void {
  const reader = READERS.get(handle);
  if (offset < 0 || offset > reader.end) unreachable();
  reader.offset = offset;
}
export function readerU8(handle: i32): u8 { return READERS.get(handle).u8(); }
export function readerI8(handle: i32): i8 { return READERS.get(handle).i8(); }
export function readerU16(handle: i32): u16 { return READERS.get(handle).u16(); }
export function readerI16(handle: i32): i16 { return READERS.get(handle).i16(); }
export function readerU32(handle: i32): u32 { return READERS.get(handle).u32(); }
export function readerI32(handle: i32): i32 { return READERS.get(handle).i32(); }
export function readerU64(handle: i32): u64 { return READERS.get(handle).u64(); }
export function readerI64(handle: i32): i64 { return READERS.get(handle).i64(); }
export function readerF32(handle: i32): f32 { return READERS.get(handle).f32(); }
export function readerF64(handle: i32): f64 { return READERS.get(handle).f64(); }
export function readerSkip(handle: i32, length: i32): void { READERS.get(handle).skip(length); }
export function readerVarint(handle: i32): u64 { return READERS.get(handle).varint(); }

export function createWriter(capacity: i32): i32 {
  const handle = nextWriterHandle++;
  WRITERS.set(handle, new BinaryWriter(capacity));
  return handle;
}
export function disposeWriter(handle: i32): void { WRITERS.delete(handle); }
export function writerOffset(handle: i32): i32 { return WRITERS.get(handle).offset; }
export function writerU8(handle: i32, value: u8): void { WRITERS.get(handle).u8(value); }
export function writerU16(handle: i32, value: u16): void { WRITERS.get(handle).u16(value); }
export function writerU32(handle: i32, value: u32): void { WRITERS.get(handle).u32(value); }
export function writerU64(handle: i32, value: u64): void { WRITERS.get(handle).u64(value); }
export function writerF32(handle: i32, value: f32): void { WRITERS.get(handle).f32(value); }
export function writerF64(handle: i32, value: f64): void { WRITERS.get(handle).f64(value); }
export function writerBytes(handle: i32, length: i32): void { WRITERS.get(handle).bytes(transfer, 0, length); }
export function writerVarint(handle: i32, value: u64): void { WRITERS.get(handle).varint(value); }
export function writerDataPointer(handle: i32): usize { return WRITERS.get(handle).data.dataStart; }
export function writerDataLength(handle: i32): i32 { return WRITERS.get(handle).offset; }

function inputString(length: i32): string { return String.UTF8.decodeUnsafe(transfer.dataStart, length, false); }
function exposeNbtNode(node: NbtNode): i32 { const handle = nextNbtHandle++; NBT_NODES.set(handle, node); return handle; }
function selectNbtString(value: string): void { nbtStringOutput = Uint8Array.wrap(String.UTF8.encode(value, false)); }

export function nbtReset(): void { NBT_NODES.clear(); nbtOutput = null; parsedNbt = null; nbtStringOutput = null; }
export function nbtCreateInteger(type: u8, value: i64): i32 { return exposeNbtNode(makeIntegerNode(type, value)); }
export function nbtCreateDecimal(type: u8, value: f64): i32 { return exposeNbtNode(makeDecimalNode(type, value)); }
export function nbtCreateString(type: u8, length: i32): i32 { return exposeNbtNode(makeStringNode(type, inputString(length))); }
export function nbtCreateBytes(type: u8, length: i32): i32 {
  const value = new Uint8Array(length); memory.copy(value.dataStart, transfer.dataStart, length);
  return exposeNbtNode(makeBytesNode(type, value));
}
export function nbtCreateInts(type: u8, length: i32): i32 {
  const value = new Int32Array(length); memory.copy(value.dataStart, transfer.dataStart, length * 4);
  return exposeNbtNode(makeIntsNode(type, value));
}
export function nbtCreateLongs(type: u8, length: i32): i32 {
  const value = new Int64Array(length); memory.copy(value.dataStart, transfer.dataStart, length * 8);
  return exposeNbtNode(makeLongsNode(type, value));
}
export function nbtCreateContainer(type: u8, elementType: u8): i32 { return exposeNbtNode(makeContainerNode(type, elementType)); }
export function nbtAddChild(parentHandle: i32, childHandle: i32, nameLength: i32): void { addChild(NBT_NODES.get(parentHandle), nameLength == 0 ? "" : inputString(nameLength), NBT_NODES.get(childHandle)); }
export function nbtWrite(rootHandle: i32, nameLength: i32): void { nbtOutput = writeNbt(NBT_NODES.get(rootHandle), nameLength == 0 ? "" : inputString(nameLength)); }
export function nbtOutputPointer(): usize { return changetype<Uint8Array>(nbtOutput).dataStart; }
export function nbtOutputLength(): i32 { return changetype<Uint8Array>(nbtOutput).length; }

export function nbtRead(length: i32, offset: i32): i32 {
  const data = new Uint8Array(length); memory.copy(data.dataStart, transfer.dataStart, length);
  parsedNbt = readNbt(data, offset);
  return exposeNbtNode(changetype<NamedNbt>(parsedNbt).node);
}
export function nbtBytesRead(): i32 { return changetype<NamedNbt>(parsedNbt).bytesRead; }
export function nbtSelectParsedName(): void { selectNbtString(changetype<NamedNbt>(parsedNbt).name); }
export function nbtNodeType(handle: i32): u8 { return NBT_NODES.get(handle).type; }
export function nbtNodeInteger(handle: i32): i64 { return NBT_NODES.get(handle).integer; }
export function nbtNodeDecimal(handle: i32): f64 { return NBT_NODES.get(handle).decimal; }
export function nbtNodeSelectString(handle: i32): void { selectNbtString(NBT_NODES.get(handle).text); }
export function nbtStringPointer(): usize { return changetype<Uint8Array>(nbtStringOutput).dataStart; }
export function nbtStringLength(): i32 { return changetype<Uint8Array>(nbtStringOutput).length; }
export function nbtNodeDataPointer(handle: i32): usize {
  const node = NBT_NODES.get(handle);
  if (node.type == 7) return changetype<Uint8Array>(node.bytes).dataStart;
  if (node.type == 11) return changetype<Int32Array>(node.integers).dataStart;
  return changetype<Int64Array>(node.longs).dataStart;
}
export function nbtNodeDataLength(handle: i32): i32 {
  const node = NBT_NODES.get(handle);
  if (node.type == 7) return changetype<Uint8Array>(node.bytes).length;
  if (node.type == 11) return changetype<Int32Array>(node.integers).length;
  return changetype<Int64Array>(node.longs).length;
}
export function nbtNodeElementType(handle: i32): u8 { return NBT_NODES.get(handle).elementType; }
export function nbtNodeChildCount(handle: i32): i32 { return changetype<Array<NbtNode>>(NBT_NODES.get(handle).children).length; }
export function nbtNodeChild(handle: i32, index: i32): i32 { return exposeNbtNode(unchecked(changetype<Array<NbtNode>>(NBT_NODES.get(handle).children)[index])); }
export function nbtNodeSelectChildName(handle: i32, index: i32): void { selectNbtString(unchecked(changetype<Array<string>>(NBT_NODES.get(handle).names)[index])); }

export function buildStorage(bits: i32, paletteCount: i32, paletteDataLength: i32): void {
  storageOutput = buildPersistentStorage(INDICES, bits, transfer, paletteCount);
}
export function storageOutputPointer(): usize { return changetype<Uint8Array>(storageOutput).dataStart; }
export function storageOutputLength(): i32 { return changetype<Uint8Array>(storageOutput).length; }
export function releaseStorageOutput(): void { storageOutput = null; }
export function unpackIndices(bits: i32): void { unpackPersistentIndices(WORDS, INDICES, bits); }
export function remapIndices(): void { for (let index = 0; index < 4096; ++index) unchecked(INDICES[index] = PALETTE_REMAP[INDICES[index]]); }
export function fillIndices(minX: i32, maxX: i32, minY: i32, maxY: i32, minZ: i32, maxZ: i32, paletteIndex: u16): void { fillIndexBox(INDICES, minX, maxX, minY, maxY, minZ, maxZ, paletteIndex); }
export function beginHeightScan(): void { for (let index = 0; index < 256; ++index) { unchecked(COLUMN_HEIGHTS[index] = 0); unchecked(HEIGHT_FOUND[index] = 0); } }
export function scanHeights(subY: i32): void { scanSubChunkHeights(INDICES, PALETTE_REMAP, COLUMN_HEIGHTS, HEIGHT_FOUND, subY); }
export function leveldbBuildLogRecord(length: i32): void { leveldbOutput = buildLogRecord(transfer.slice(0, length)); }
export function leveldbBuildManifest(length: i32, tableCount: i32, lastSequence: i64): void { leveldbOutput = buildManifestLog(transfer.slice(0, length), tableCount, lastSequence); }
export function leveldbOutputPointer(): usize { return changetype<Uint8Array>(leveldbOutput).dataStart; }
export function leveldbOutputLength(): i32 { return changetype<Uint8Array>(leveldbOutput).length; }
export function releaseLeveldbOutput(): void { leveldbOutput = null; }
export function zipBuildLocalHeader(nameLength: i32, size: i32, checksum: u32): void { zipOutput = localZipHeader(nameLength, size, checksum); }
export function zipBuildCentralHeader(nameLength: i32, size: i32, checksum: u32, offset: i32): void { zipOutput = centralZipHeader(nameLength, size, checksum, offset); }
export function zipBuildEnd(count: i32, centralSize: i32, centralOffset: i32): void { zipOutput = endOfCentralDirectory(count, centralSize, centralOffset); }
export function zipOutputPointer(): usize { return changetype<Uint8Array>(zipOutput).dataStart; }
export function zipOutputLength(): i32 { return changetype<Uint8Array>(zipOutput).length; }
export function releaseZipOutput(): void { zipOutput = null; }
export function leveldbParseBlock(length: i32): i32 { parsedTableEntries = parseTableBlock(transfer.slice(0, length)); return changetype<Array<TableEntry>>(parsedTableEntries).length; }
export function leveldbSelectBlockEntry(index: i32): void { const entry = unchecked(changetype<Array<TableEntry>>(parsedTableEntries)[index]); selectedKey = entry.key; selectedValue = entry.value; }
export function leveldbReleaseParsedBlock(): void { parsedTableEntries = null; selectedKey = null; selectedValue = null; }
export function leveldbReadLogRecords(length: i32): i32 { parsedLogRecords = readLogRecords(transfer.slice(0, length)); return changetype<Array<Uint8Array>>(parsedLogRecords).length; }
export function leveldbSelectLogRecord(index: i32): void { selectedValue = unchecked(changetype<Array<Uint8Array>>(parsedLogRecords)[index]); }
export function leveldbReleaseLogRecords(): void { parsedLogRecords = null; selectedValue = null; }
export function leveldbParseManifest(length: i32): void { manifestSelection = parseManifest(transfer.slice(0, length)); }
export function leveldbManifestTableCount(): i32 { return changetype<ManifestSelection>(manifestSelection).tables.length; }
export function leveldbManifestTable(index: i32): i32 { return unchecked(changetype<ManifestSelection>(manifestSelection).tables[index]); }
export function leveldbManifestLogCount(): i32 { return changetype<ManifestSelection>(manifestSelection).logs.length; }
export function leveldbManifestLog(index: i32): i32 { return unchecked(changetype<ManifestSelection>(manifestSelection).logs[index]); }
export function leveldbReleaseManifest(): void { manifestSelection = null; }
export function bedrockBuildChunkKey(chunkX: i32, chunkZ: i32, dimension: i32, type: u8, hasSubY: bool, subY: i8): void { bedrockOutput = buildChunkKey(chunkX, chunkZ, dimension, type, hasSubY, subY); }
export function bedrockBuildColumnMetadata(dimension: i32, biomeId: i32): void { bedrockOutput = buildColumnMetadata(COLUMN_HEIGHTS, dimension, biomeId); }
export function bedrockOutputPointer(): usize { return changetype<Uint8Array>(bedrockOutput).dataStart; }
export function bedrockOutputLength(): i32 { return changetype<Uint8Array>(bedrockOutput).length; }
export function releaseBedrockOutput(): void { bedrockOutput = null; }

export function bedrockConvertLegacyColumn(blocksOffset: i32, statesOffset: i32, nonAirOffset: i32, chestId: u8): void {
  convertLegacyColumn(transfer, blocksOffset, statesOffset, nonAirOffset, chestId);
  selectedLegacySubY = 0;
}
export function bedrockLegacyHeightsPointer(): usize { return legacyHeightsPointer(); }
export function bedrockLegacySubChunkCount(): i32 { return legacySubChunkCount(); }
export function bedrockSelectLegacySubChunk(index: i32): bool {
  selectedLegacySubY = index;
  return legacySubChunkContainsBlocks(index);
}
export function bedrockLegacyPalettePointer(): usize { return legacyPalettePointer(selectedLegacySubY); }
export function bedrockLegacyPaletteLength(): i32 { return legacyPaletteLength(selectedLegacySubY); }
export function bedrockLegacyIndicesPointer(): usize { return legacyIndicesPointer(selectedLegacySubY); }
export function bedrockLegacyChestCount(): i32 { return legacyChestCount(); }
export function bedrockLegacyChestsPointer(): usize { return legacyChestsPointer(); }
export function releaseLegacyColumn(): void {}
