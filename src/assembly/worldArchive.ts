import {
  createTerrainSession, currentChunkBiomesPointer, currentChunkX, currentChunkZ,
  currentChunkBlocksPointer, currentChunkStatesPointer, disposeTerrainSession,
  parseBetaSeed, terrainSessionStep,
} from "../../worldgen/assembly/index";
import { BinaryWriter } from "../../level/assembly/binary";
import { buildChunkKey, buildColumnMetadataFromPointer } from "../../level/assembly/bedrockCodec";
import { LevelDatabase } from "../../level/assembly/database";
import { convertLegacyColumnPointers, legacyChestCount, legacyChestsPointer, legacyHeightsPointer, legacyIndicesPointer, legacyPaletteLength, legacyPalettePointer, legacySubChunkContainsBlocks, legacySubChunkCount } from "../../level/assembly/legacyColumnCodec";
import { buildDatabaseTable, buildManifestLog } from "../../level/assembly/leveldbCodec";
import { addChild, makeContainerNode, makeDecimalNode, makeIntegerNode, makeStringNode, NBT_BYTE, NBT_COMPOUND, NBT_FLOAT, NBT_INT, NBT_LIST, NBT_LONG, NBT_STRING, NbtNode, writeNbt } from "../../level/assembly/nbt";
import { buildMappedPersistentStorage } from "../../level/assembly/subchunk";
import { centralZipHeader, endOfCentralDirectory, localZipHeader } from "../../level/assembly/zipCodec";

@external("env", "reportProgress") declare function reportProgress(completed: i32, total: i32): void;
@external("env", "emitArchivePart") declare function emitArchivePart(pointer: usize, length: i32): void;

const CHUNK_SIZE: i32 = 16;
const WORLD_HEIGHT: i32 = 128;
const SUBCHUNK_BLOCK_COUNT: i32 = 4096;
const COMPACT_THRESHOLD: i32 = 512;
const COLLECTION_INTERVAL: i32 = 32;
const STATE_VERSION: i32 = (1 << 24) | (21 << 16) | (100 << 8);
const NON_AIR_IDS = new StaticArray<u8>(256);
const BIOME_COUNTS = new StaticArray<u16>(256);
const PALETTE_REMAP = new StaticArray<u16>(SUBCHUNK_BLOCK_COUNT);
const BORDER_INDICES = new StaticArray<u16>(SUBCHUNK_BLOCK_COUNT);
const BORDER_HEIGHTS = new StaticArray<i16>(256);
const STATE_CACHE = new Map<i32, Uint8Array>();
const CRC32_TABLE = createCrcTable();
let input = new Uint8Array(256);
let generatedSpawnX: i32 = 0;
let generatedSpawnY: i32 = WORLD_HEIGHT + 1;
let generatedSpawnZ: i32 = 0;
let activeDatabase: LevelDatabase | null = null;
let activeTables: Array<TableMetadata> | null = null;
let activeZip: ZipStream | null = null;
let activeWorldName: string | null = null;
let activeBorderRandom: BorderRandom | null = null;

class TableMetadata {
  constructor(readonly number: i32, readonly size: i32, readonly smallest: Uint8Array, readonly largest: Uint8Array, readonly sequence: i64) {}
}

class ZipStream {
  private offset: i32 = 0;
  private central: Array<Uint8Array> = new Array<Uint8Array>();

  add(nameText: string, data: Uint8Array): void {
    const name = Uint8Array.wrap(String.UTF8.encode(nameText, false)), checksum = crc32(data);
    const local = localZipHeader(name.length, data.length, checksum), prefix = new BinaryWriter(local.length + name.length);
    prefix.bytes(local, 0, local.length); prefix.bytes(name, 0, name.length);
    emitArchivePart(prefix.data.dataStart, prefix.offset);
    if (data.length != 0) emitArchivePart(data.dataStart, data.length);
    const header = centralZipHeader(name.length, data.length, checksum, this.offset), entry = new BinaryWriter(header.length + name.length);
    entry.bytes(header, 0, header.length); entry.bytes(name, 0, name.length); this.central.push(entry.data);
    this.offset += prefix.offset + data.length;
  }

  finish(): void {
    const centralOffset = this.offset;
    let centralSize = 0;
    for (let index = 0; index < this.central.length; ++index) {
      const entry = unchecked(this.central[index]); centralSize += entry.length; emitArchivePart(entry.dataStart, entry.length);
    }
    const end = endOfCentralDirectory(this.central.length, centralSize, centralOffset);
    emitArchivePart(end.dataStart, end.length);
  }
}

class BorderRandom {
  private state: u32;
  constructor(seed: i64) {
    this.state = <u32>seed ^ <u32>(seed >>> 32);
    if (this.state == 0) this.state = 0x6d2b79f5;
  }
  @inline nextBoolean(): bool {
    let value = this.state;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state = value;
    return (value & 1) != 0;
  }
}

function createCrcTable(): StaticArray<u32> {
  const table = new StaticArray<u32>(256);
  for (let index = 0; index < 256; ++index) {
    let value = <u32>index;
    for (let bit = 0; bit < 8; ++bit) value = (value & 1) != 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    unchecked(table[index] = value);
  }
  return table;
}

function crc32(data: Uint8Array): u32 {
  let crc: u32 = 0xffffffff;
  for (let index = 0; index < data.length; ++index) crc = unchecked(CRC32_TABLE[(crc ^ unchecked(data[index])) & 0xff]) ^ (crc >>> 8);
  return crc ^ 0xffffffff;
}

export function ensureInputCapacity(capacity: i32): usize {
  if (capacity > input.length) input = new Uint8Array(capacity);
  return input.dataStart;
}

@inline function integer(type: u8, value: i64): NbtNode { return makeIntegerNode(type, value); }
@inline function text(value: string): NbtNode { return makeStringNode(NBT_STRING, value); }
function compound(): NbtNode { return makeContainerNode(NBT_COMPOUND, 0); }
function child(parent: NbtNode, name: string, value: NbtNode): void { addChild(parent, name, value); }

function blockState(name: string, stateName: string = "", stateValue: string = "", stateInteger: i32 = 0, stateType: u8 = 0): Uint8Array {
  const root = compound(), states = compound();
  child(root, "name", text("minecraft:" + name));
  if (stateType == NBT_STRING) child(states, stateName, text(stateValue));
  else if (stateType != 0) child(states, stateName, integer(stateType, stateInteger));
  child(root, "states", states);
  child(root, "version", integer(NBT_INT, STATE_VERSION));
  return writeNbt(root, "");
}

function borderBlockState(): Uint8Array {
  const root = compound(), states = compound();
  child(root, "name", text("minecraft:border_block"));
  child(states, "wall_connection_type_east", text("none")); child(states, "wall_connection_type_north", text("none"));
  child(states, "wall_connection_type_south", text("none")); child(states, "wall_connection_type_west", text("none"));
  child(states, "wall_post_bit", integer(NBT_BYTE, 1));
  child(root, "states", states); child(root, "version", integer(NBT_INT, STATE_VERSION));
  return writeNbt(root, "");
}

function leavesBlockState(name: string): Uint8Array {
  const root = compound(), states = compound(); child(root, "name", text("minecraft:" + name));
  child(states, "persistent_bit", integer(NBT_BYTE, 0)); child(states, "update_bit", integer(NBT_BYTE, 0));
  child(root, "states", states); child(root, "version", integer(NBT_INT, STATE_VERSION)); return writeNbt(root, "");
}

function snowBlockState(height: i32): Uint8Array {
  const root = compound(), states = compound(); child(root, "name", text("minecraft:snow_layer"));
  child(states, "covered_bit", integer(NBT_BYTE, 0)); child(states, "height", integer(NBT_INT, height));
  child(root, "states", states); child(root, "version", integer(NBT_INT, STATE_VERSION)); return writeNbt(root, "");
}

function canonicalStateKey(key: u16): i32 {
  const id = <u8>(key >>> 8), state = <u8>key;
  if (id == 8 || id == 9 || id == 10 || id == 11) return (<i32>id << 8) | (state & 15);
  if (id == 17 || id == 18) return (<i32>id << 8) | (state & 3);
  if (id == 31) return (<i32>id << 8) | ((state & 3) == 2 ? 2 : 1);
  if (id == 78) return (<i32>id << 8) | (state & 7);
  if (id == 0 || id == 1 || id == 2 || id == 3 || id == 4 || id == 7 || id == 12 || id == 13 || id == 14 || id == 15 || id == 16 || id == 21 || id == 24 || id == 32 || id == 37 || id == 38 || id == 39 || id == 40 || id == 48 || id == 51 || id == 52 || id == 54 || id == 56 || id == 73 || id == 79 || id == 81 || id == 82 || id == 83 || id == 86 || id == 87 || id == 88 || id == 89) return <i32>id << 8;
  return 0;
}

function encodedState(canonical: i32): Uint8Array {
  if (STATE_CACHE.has(canonical)) return STATE_CACHE.get(canonical);
  const id = canonical >>> 8, state = canonical & 255;
  let result: Uint8Array;
  if (id == 0) result = blockState("air");
  else if (id == 1) result = blockState("stone"); else if (id == 2) result = blockState("grass_block"); else if (id == 3) result = blockState("dirt");
  else if (id == 4) result = blockState("cobblestone"); else if (id == 7) result = blockState("bedrock");
  else if (id == 8) result = blockState("flowing_water", "liquid_depth", "", state, NBT_INT);
  else if (id == 9) result = blockState("water", "liquid_depth", "", state, NBT_INT);
  else if (id == 10) result = blockState("flowing_lava", "liquid_depth", "", state, NBT_INT);
  else if (id == 11) result = blockState("lava", "liquid_depth", "", state, NBT_INT);
  else if (id == 12) result = blockState("sand"); else if (id == 13) result = blockState("gravel"); else if (id == 14) result = blockState("gold_ore"); else if (id == 15) result = blockState("iron_ore"); else if (id == 16) result = blockState("coal_ore");
  else if (id == 17) result = blockState(state == 1 ? "spruce_log" : state == 2 ? "birch_log" : "oak_log", "pillar_axis", "y", 0, NBT_STRING);
  else if (id == 18) result = leavesBlockState(state == 1 ? "spruce_leaves" : state == 2 ? "birch_leaves" : "oak_leaves");
  else if (id == 21) result = blockState("lapis_ore"); else if (id == 24) result = blockState("sandstone");
  else if (id == 31) result = blockState("tallgrass", "tall_grass_type", state == 2 ? "fern" : "tall", 0, NBT_STRING);
  else if (id == 32) result = blockState("deadbush"); else if (id == 37) result = blockState("dandelion"); else if (id == 38) result = blockState("poppy"); else if (id == 39) result = blockState("brown_mushroom"); else if (id == 40) result = blockState("red_mushroom");
  else if (id == 48) result = blockState("mossy_cobblestone"); else if (id == 51) result = blockState("fire"); else if (id == 52) result = blockState("mob_spawner");
  else if (id == 54) result = blockState("chest", "minecraft:cardinal_direction", "north", 0, NBT_STRING);
  else if (id == 56) result = blockState("diamond_ore"); else if (id == 73) result = blockState("redstone_ore");
  else if (id == 78) result = snowBlockState(state);
  else if (id == 79) result = blockState("ice"); else if (id == 81) result = blockState("cactus", "growth", "", 0, NBT_INT); else if (id == 82) result = blockState("clay"); else if (id == 83) result = blockState("reeds", "growth", "", 0, NBT_INT);
  else if (id == 86) result = blockState("pumpkin", "minecraft:cardinal_direction", "south", 0, NBT_STRING);
  else if (id == 87) result = blockState("netherrack"); else if (id == 88) result = blockState("soul_sand"); else if (id == 89) result = blockState("glowstone");
  else result = blockState("air");
  STATE_CACHE.set(canonical, result);
  return result;
}

function supportedBits(count: i32): i32 {
  if (count <= 2) return 1; if (count <= 4) return 2; if (count <= 8) return 3; if (count <= 16) return 4;
  if (count <= 32) return 5; if (count <= 64) return 6; if (count <= 256) return 8; return 16;
}

function put(database: LevelDatabase, key: Uint8Array, value: Uint8Array): void { database.putOwned(key, value); }
function byteArray(a: u8, b: i32 = -1): Uint8Array {
  const result = new Uint8Array(b < 0 ? 1 : 2); unchecked(result[0] = a); if (b >= 0) unchecked(result[1] = <u8>b); return result;
}

function dominantBiome(): i32 {
  memory.fill(changetype<usize>(BIOME_COUNTS), 0, 256 * sizeof<u16>());
  const pointer = currentChunkBiomesPointer();
  let best = 8, bestCount: u16 = 0;
  for (let index = 0; index < 256; ++index) {
    const biome = load<u8>(pointer + index), count = unchecked(++BIOME_COUNTS[biome]);
    if (count > bestCount) { best = biome; bestCount = count; }
  }
  if (best == 0) return 21; if (best == 1) return 6; if (best == 2 || best == 3) return 4; if (best == 4) return 35;
  if (best == 6) return 5; if (best == 7) return 2; if (best == 9 || best == 10) return 12; if (best == 11) return 8;
  return 1;
}

function writeCurrentColumn(database: LevelDatabase, dimension: i32, seed: i64, outputChunkOffsetX: i32, outputChunkOffsetZ: i32): void {
  const blocks = currentChunkBlocksPointer(), states = currentChunkStatesPointer();
  const sourceChunkX = currentChunkX(), sourceChunkZ = currentChunkZ();
  const chunkX = sourceChunkX + outputChunkOffsetX, chunkZ = sourceChunkZ + outputChunkOffsetZ;
  convertLegacyColumnPointers(blocks, states, changetype<usize>(NON_AIR_IDS), 54);
  if (dimension == 0 && generatedSpawnY < 0) {
    const heights = legacyHeightsPointer();
    for (let localX = 0; localX < CHUNK_SIZE && generatedSpawnY < 0; ++localX) for (let localZ = 0; localZ < CHUNK_SIZE; ++localZ) {
      const height = <i32>load<i16>(heights + (localZ * CHUNK_SIZE + localX) * sizeof<i16>());
      if (height > 0 && load<u8>(blocks + (localX * CHUNK_SIZE + localZ) * WORLD_HEIGHT + height - 1) == 2) {
        generatedSpawnX = chunkX * CHUNK_SIZE + localX;
        generatedSpawnY = height;
        generatedSpawnZ = chunkZ * CHUNK_SIZE + localZ;
        break;
      }
    }
  }
  for (let subY = 0, count = legacySubChunkCount(); subY < count; ++subY) {
    if (!legacySubChunkContainsBlocks(subY)) continue;
    const paletteMap = new Map<i32, u16>(), palette = new Array<Uint8Array>();
    const keys = legacyPalettePointer(subY), sourceCount = legacyPaletteLength(subY);
    for (let source = 0; source < sourceCount; ++source) {
      const canonical = canonicalStateKey(load<u16>(keys + source * sizeof<u16>()));
      let mapped: u16;
      if (paletteMap.has(canonical)) mapped = paletteMap.get(canonical);
      else { mapped = <u16>palette.length; paletteMap.set(canonical, mapped); palette.push(encodedState(canonical)); }
      unchecked(PALETTE_REMAP[source] = mapped);
    }
    const storage = buildMappedPersistentStorage(legacyIndicesPointer(subY), PALETTE_REMAP, supportedBits(palette.length), palette);
    const writer = new BinaryWriter(storage.length + 3);
    writer.u8(9); writer.u8(1); writer.u8(<u8>subY); writer.bytes(storage, 0, storage.length);
    put(database, buildChunkKey(chunkX, chunkZ, dimension, 47, true, <i8>subY), writer.data.slice(0, writer.offset));
  }
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 43, false, 0), buildColumnMetadataFromPointer(legacyHeightsPointer(), dimension, dominantBiome()));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 44, false, 0), byteArray(41));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 118, false, 0), byteArray(7));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 61, false, 0), byteArray(0));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 64, false, 0), byteArray(0, 8));
  const chestCount = legacyChestCount();
  if (chestCount != 0) {
    const entities = new BinaryWriter(chestCount * 180), chests = legacyChestsPointer();
    for (let index = 0; index < chestCount; ++index) {
      const packed = load<u32>(chests + index * sizeof<u32>());
      const x = chunkX * 16 + <i32>(packed & 15), y = <i32>(packed >>> 8), z = chunkZ * 16 + <i32>((packed >>> 4) & 15);
      const root = compound();
      child(root, "id", text("Chest")); child(root, "isMovable", integer(NBT_BYTE, 1));
      child(root, "x", integer(NBT_INT, x)); child(root, "y", integer(NBT_INT, y)); child(root, "z", integer(NBT_INT, z));
      child(root, "LootTable", text("loot_tables/chests/simple_dungeon.json"));
      child(root, "LootTableSeed", integer(NBT_LONG, seed ^ <i64>x * 341873128712 ^ <i64>y * 42317861 ^ <i64>z * 132897987541));
      const encoded = writeNbt(root, ""); entities.bytes(encoded, 0, encoded.length);
    }
    put(database, buildChunkKey(chunkX, chunkZ, dimension, 49, false, 0), entities.data.slice(0, entities.offset));
  }
}

function writeColumnMetadata(database: LevelDatabase, chunkX: i32, chunkZ: i32, dimension: i32, biomeId: i32): void {
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 43, false, 0), buildColumnMetadataFromPointer(changetype<usize>(BORDER_HEIGHTS), dimension, biomeId));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 44, false, 0), byteArray(41));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 118, false, 0), byteArray(7));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 61, false, 0), byteArray(0));
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 64, false, 0), byteArray(0, 8));
}

function writeIndexedSubchunk(database: LevelDatabase, chunkX: i32, chunkZ: i32, dimension: i32, subY: i32, palette: Array<Uint8Array>): void {
  for (let index = 0; index < palette.length; ++index) unchecked(PALETTE_REMAP[index] = <u16>index);
  const storage = buildMappedPersistentStorage(changetype<usize>(BORDER_INDICES), PALETTE_REMAP, supportedBits(palette.length), palette);
  const writer = new BinaryWriter(storage.length + 3);
  writer.u8(9); writer.u8(1); writer.u8(<u8>subY); writer.bytes(storage, 0, storage.length);
  put(database, buildChunkKey(chunkX, chunkZ, dimension, 47, true, <i8>subY), writer.data.slice(0, writer.offset));
}

function writeOverworldFlatLayersAboveBottom(database: LevelDatabase, chunkX: i32, chunkZ: i32): void {
  const stone = encodedState(1 << 8), water = encodedState(9 << 8);
  memory.fill(changetype<usize>(BORDER_INDICES), 0, SUBCHUNK_BLOCK_COUNT * sizeof<u16>());
  const solid = new Array<Uint8Array>(); solid.push(stone);
  writeIndexedSubchunk(database, chunkX, chunkZ, 0, 1, solid);
  writeIndexedSubchunk(database, chunkX, chunkZ, 0, 2, solid);

  for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) for (let y = 8; y < 16; ++y) unchecked(BORDER_INDICES[x * 256 + z * 16 + y] = 1);
  const surface = new Array<Uint8Array>(); surface.push(stone); surface.push(water);
  writeIndexedSubchunk(database, chunkX, chunkZ, 0, 3, surface);
}

function writeOverworldBorderColumn(database: LevelDatabase, chunkX: i32, chunkZ: i32, orientation: i32, alongStart: i32, alongEnd: i32, fillFlatLayers: bool): void {
  if (fillFlatLayers) writeOverworldFlatLayersAboveBottom(database, chunkX, chunkZ);
  memory.fill(changetype<usize>(BORDER_INDICES), 0, SUBCHUNK_BLOCK_COUNT * sizeof<u16>());
  memory.fill(changetype<usize>(BORDER_HEIGHTS), 0, 256 * sizeof<i16>());
  if (fillFlatLayers) {
    for (let index = 0; index < 256; ++index) unchecked(BORDER_HEIGHTS[index] = 64);
    for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) unchecked(BORDER_INDICES[x * 256 + z * 16] = 1);
  }
  for (let along = alongStart; along <= alongEnd; ++along) {
    const x = orientation < 2 ? along : orientation == 2 ? 15 : 0;
    const z = orientation < 2 ? orientation == 0 ? 15 : 0 : along;
    unchecked(BORDER_INDICES[x * 256 + z * 16] = fillFlatLayers ? 2 : 1);
    if (!fillFlatLayers) unchecked(BORDER_HEIGHTS[z * 16 + x] = 1);
  }
  const palette = new Array<Uint8Array>();
  if (fillFlatLayers) { palette.push(encodedState(1 << 8)); palette.push(encodedState(7 << 8)); }
  else palette.push(encodedState(0));
  palette.push(borderBlockState());
  writeIndexedSubchunk(database, chunkX, chunkZ, 0, 0, palette);
  writeColumnMetadata(database, chunkX, chunkZ, 0, 1);
}

function writeNetherBorderColumn(database: LevelDatabase, chunkX: i32, chunkZ: i32, orientation: i32, random: BorderRandom): void {
  for (let index = 0; index < 256; ++index) unchecked(BORDER_HEIGHTS[index] = 128);
  for (let along = 0; along < 16; ++along) {
    const x = orientation < 2 ? along : orientation == 2 ? 15 : 0;
    const z = orientation < 2 ? orientation == 0 ? 15 : 0 : along;
    unchecked(BORDER_HEIGHTS[z * 16 + x] = 1);
  }
  const palette = new Array<Uint8Array>(); palette.push(encodedState(7 << 8)); palette.push(encodedState(0));
  for (let subY = 0; subY < 8; ++subY) {
    memory.fill(changetype<usize>(BORDER_INDICES), 0, SUBCHUNK_BLOCK_COUNT * sizeof<u16>());
    for (let along = 0; along < 16; ++along) {
      const x = orientation < 2 ? along : orientation == 2 ? 15 : 0;
      const z = orientation < 2 ? orientation == 0 ? 15 : 0 : along;
      for (let y = 0; y < 16; ++y) if (subY != 0 || y != 0) {
        if (!random.nextBoolean()) unchecked(BORDER_INDICES[x * 256 + z * 16 + y] = 1);
        else unchecked(BORDER_HEIGHTS[z * 16 + x] = <i16>(subY * 16 + y + 1));
      }
    }
    writeIndexedSubchunk(database, chunkX, chunkZ, 1, subY, palette);
  }
  writeColumnMetadata(database, chunkX, chunkZ, 1, 8);
}

function writeBorders(database: LevelDatabase, tables: Array<TableMetadata>, zip: ZipStream, generatorType: i32, dimension: i32, minChunkX: i32, maxChunkX: i32, minChunkZ: i32, maxChunkZ: i32, outputChunkOffsetX: i32, outputChunkOffsetZ: i32, random: BorderRandom | null, progress: i32, total: i32): i32 {
  const fillFlatLayers = generatorType == 0;
  for (let chunkX = minChunkX - 1; chunkX <= maxChunkX + 1; ++chunkX) {
    const start = chunkX < minChunkX ? 15 : 0, end = chunkX > maxChunkX ? 0 : 15;
    if (dimension == 0) writeOverworldBorderColumn(database, chunkX + outputChunkOffsetX, minChunkZ - 1 + outputChunkOffsetZ, 0, start, end, fillFlatLayers);
    else writeNetherBorderColumn(database, chunkX + outputChunkOffsetX, minChunkZ - 1 + outputChunkOffsetZ, 0, changetype<BorderRandom>(random));
    sealIfNeeded(database, tables, zip); ++progress; maintainGeneration(progress, total);
    if (dimension == 0) writeOverworldBorderColumn(database, chunkX + outputChunkOffsetX, maxChunkZ + 1 + outputChunkOffsetZ, 1, start, end, fillFlatLayers);
    else writeNetherBorderColumn(database, chunkX + outputChunkOffsetX, maxChunkZ + 1 + outputChunkOffsetZ, 1, changetype<BorderRandom>(random));
    sealIfNeeded(database, tables, zip); ++progress; maintainGeneration(progress, total);
  }
  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; ++chunkZ) {
    if (dimension == 0) writeOverworldBorderColumn(database, minChunkX - 1 + outputChunkOffsetX, chunkZ + outputChunkOffsetZ, 2, 0, 15, fillFlatLayers);
    else writeNetherBorderColumn(database, minChunkX - 1 + outputChunkOffsetX, chunkZ + outputChunkOffsetZ, 2, changetype<BorderRandom>(random));
    sealIfNeeded(database, tables, zip); ++progress; maintainGeneration(progress, total);
    if (dimension == 0) writeOverworldBorderColumn(database, maxChunkX + 1 + outputChunkOffsetX, chunkZ + outputChunkOffsetZ, 3, 0, 15, fillFlatLayers);
    else writeNetherBorderColumn(database, maxChunkX + 1 + outputChunkOffsetX, chunkZ + outputChunkOffsetZ, 3, changetype<BorderRandom>(random));
    sealIfNeeded(database, tables, zip); ++progress; maintainGeneration(progress, total);
  }
  return progress;
}

function addVersionList(root: NbtNode, name: string): void {
  const list = makeContainerNode(NBT_LIST, NBT_INT);
  for (let value = 0; value < 5; ++value) addChild(list, "", integer(NBT_INT, value == 0 ? 1 : value == 1 ? 21 : value == 2 ? 100 : 0));
  child(root, name, list);
}

function buildLevelDat(name: string, seed: i64, generatorType: i32, spawnX: i32, spawnY: i32, spawnZ: i32, now: i64, legacyVersion: bool): Uint8Array {
  const root = compound();
  child(root, "LevelName", text(name)); child(root, "RandomSeed", integer(NBT_LONG, seed)); child(root, "StorageVersion", integer(NBT_INT, 9)); child(root, "NetworkVersion", integer(NBT_INT, 827));
  child(root, "Generator", integer(NBT_INT, 2));
  const flat = generatorType == 2
    ? '{"biome_id":1,"block_layers":[{"block_name":"minecraft:air","count":1}],"encoding_version":6,"structure_options":null,"world_version":"version.pre_1_18"}'
    : '{"biome_id":1,"block_layers":[{"block_name":"minecraft:bedrock","count":1},{"block_name":"minecraft:stone","count":55},{"block_name":"minecraft:water","count":8}],"encoding_version":6,"structure_options":null,"world_version":"version.pre_1_18"}';
  child(root, "FlatWorldLayers", text(flat)); child(root, "WorldVersion", integer(NBT_INT, 0)); child(root, "GameType", integer(NBT_INT, 0)); child(root, "Difficulty", integer(NBT_INT, 2));
  child(root, "commandsEnabled", integer(NBT_BYTE, 0)); child(root, "ForceGameType", integer(NBT_BYTE, 0));
  child(root, "baseGameVersion", text(legacyVersion ? "1.13.0" : "*"));
  child(root, "SpawnX", integer(NBT_INT, spawnX)); child(root, "SpawnY", integer(NBT_INT, spawnY)); child(root, "SpawnZ", integer(NBT_INT, spawnZ));
  child(root, "Time", integer(NBT_LONG, 0)); child(root, "CurrentTick", integer(NBT_LONG, 0)); child(root, "LastPlayed", integer(NBT_LONG, now));
  addVersionList(root, "MinimumCompatibleClientVersion"); addVersionList(root, "lastOpenedWithVersion");
  const oneBytes: StaticArray<string> = ["MultiplayerGame", "MultiplayerGameIntent", "LANBroadcast", "LANBroadcastIntent", "dodaylightcycle", "doentitydrops", "dofiretick", "domobloot", "domobspawning", "dotiledrops", "doweathercycle", "falldamage", "firedamage", "mobgriefing", "naturalregeneration", "spawnMobs"];
  for (let index = 0; index < oneBytes.length; ++index) child(root, unchecked(oneBytes[index]), integer(NBT_BYTE, 1));
  const zeroBytes: StaticArray<string> = ["hasBeenLoadedInCreative", "immutableWorld", "isFromLockedTemplate", "isFromWorldTemplate", "keepinventory", "showcoordinates"];
  for (let index = 0; index < zeroBytes.length; ++index) child(root, unchecked(zeroBytes[index]), integer(NBT_BYTE, 0));
  child(root, "randomtickspeed", integer(NBT_INT, 1)); child(root, "lightningLevel", makeDecimalNode(NBT_FLOAT, 0)); child(root, "lightningTime", integer(NBT_INT, 96000));
  child(root, "rainLevel", makeDecimalNode(NBT_FLOAT, 0)); child(root, "rainTime", integer(NBT_INT, 48000)); child(root, "NetherScale", integer(NBT_INT, 8));
  child(root, "worldStartCount", integer(NBT_LONG, 0xfffffffe)); child(root, "serverChunkTickRange", integer(NBT_INT, 10)); child(root, "functioncommandlimit", integer(NBT_INT, 10000));
  const payload = writeNbt(root, ""), writer = new BinaryWriter(payload.length + 8);
  writer.u32(9); writer.u32(payload.length); writer.bytes(payload, 0, payload.length);
  return writer.data.slice(0, writer.offset);
}

function sixDigits(value: i32): string { const raw = value.toString(); return "000000".substring(raw.length) + raw; }

function finishDatabase(database: LevelDatabase, tables: Array<TableMetadata>, zip: ZipStream): void {
  sealIfNeeded(database, tables, zip, true);
  const metadata = new BinaryWriter();
  let lastSequence: i64 = 0;
  for (let index = 0; index < tables.length; ++index) {
    const table = unchecked(tables[index]);
    metadata.u32(table.number); metadata.u32(table.size); metadata.varint(table.smallest.length); metadata.bytes(table.smallest, 0, table.smallest.length); metadata.varint(table.largest.length); metadata.bytes(table.largest, 0, table.largest.length);
    lastSequence = table.sequence;
  }
  const manifestData = metadata.data.slice(0, metadata.offset);
  zip.add("db/" + sixDigits(tables.length + 2) + ".log", new Uint8Array(0));
  zip.add("db/MANIFEST-000001", buildManifestLog(manifestData, tables.length, lastSequence));
  zip.add("db/CURRENT", Uint8Array.wrap(String.UTF8.encode("MANIFEST-000001\n", false)));
  zip.add("db/LOCK", new Uint8Array(0));
}

function sealIfNeeded(database: LevelDatabase, tables: Array<TableMetadata>, zip: ZipStream, force: bool = false): void {
  if (database.size == 0 || (!force && database.size < COMPACT_THRESHOLD)) return;
  const sequence = database.sequence;
  const built = buildDatabaseTable(database, true), number = tables.length + 2;
  zip.add("db/" + sixDigits(number) + ".ldb", built.data);
  tables.push(new TableMetadata(number, built.data.length, built.smallest, built.largest, built.lastSequence));
  database.clear(); database.sequence = sequence;
  __collect();
}

@inline function maintainGeneration(progress: i32, total: i32): void {
  if ((progress & 7) == 0 || progress == total) reportProgress(progress, total);
  if (progress % COLLECTION_INTERVAL == 0) __collect();
}

function generateDimension(database: LevelDatabase, tables: Array<TableMetadata>, zip: ZipStream, seed: i64, generatorType: i32, dimension: i32, minChunkX: i32, maxChunkX: i32, minChunkZ: i32, maxChunkZ: i32, decorate: bool, carve: bool, outputChunkOffsetX: i32, outputChunkOffsetZ: i32, progress: i32, total: i32): i32 {
  const handle = createTerrainSession(seed, generatorType, minChunkX, maxChunkX, minChunkZ, maxChunkZ, decorate, carve);
  while (true) {
    const event = terrainSessionStep(handle);
    if (event == 0) break;
    if (event == 2) { writeCurrentColumn(database, dimension, seed, outputChunkOffsetX, outputChunkOffsetZ); sealIfNeeded(database, tables, zip); }
    ++progress;
    maintainGeneration(progress, total);
  }
  disposeTerrainSession(handle);
  __collect();
  return progress;
}

export function generateBedrockArchive(nameLength: i32, seedLength: i32, randomSeed: i64, generatorType: i32, minChunkX: i32, maxChunkX: i32, minChunkZ: i32, maxChunkZ: i32, netherMinChunkX: i32, netherMaxChunkX: i32, netherMinChunkZ: i32, netherMaxChunkZ: i32, decorate: bool, carve: bool, fillNether: bool, addBorder: bool, addNetherBorder: bool, legacyVersion: bool, now: i64, borderRandomSeed: i64, outputChunkOffsetX: i32, outputChunkOffsetZ: i32): void {
  const worldName = String.UTF8.decodeUnsafe(input.dataStart, nameLength, false);
  const seed = parseBetaSeed(String.UTF8.decodeUnsafe(input.dataStart + nameLength, seedLength, false), randomSeed);
  activeWorldName = worldName;
  for (let id = 0; id < 256; ++id) unchecked(NON_AIR_IDS[id] = 0);
  const solidIds: StaticArray<u8> = [1,2,3,4,7,8,9,10,11,12,13,14,15,16,17,18,21,24,31,32,37,38,39,40,48,51,52,54,56,73,78,79,81,82,83,86,87,88,89];
  for (let index = 0; index < solidIds.length; ++index) unchecked(NON_AIR_IDS[unchecked(solidIds[index])] = 1);
  const chunksX = maxChunkX - minChunkX + 1, chunksZ = maxChunkZ - minChunkZ + 1, chunkCount = chunksX * chunksZ;
  const netherChunksX = netherMaxChunkX - netherMinChunkX + 1, netherChunksZ = netherMaxChunkZ - netherMinChunkZ + 1, netherChunkCount = netherChunksX * netherChunksZ;
  const overworldWork = (decorate ? (chunksX + 1) * (chunksZ + 1) : chunkCount) + chunkCount;
  const netherWork = (decorate ? (netherChunksX + 1) * (netherChunksZ + 1) : netherChunkCount) + netherChunkCount;
  const overworldBorderWork = addBorder ? (chunksX + 2) * 2 + chunksZ * 2 : 0;
  const netherBorderWork = addNetherBorder ? (netherChunksX + 2) * 2 + netherChunksZ * 2 : 0;
  const total = overworldWork + (fillNether ? netherWork : 0) + overworldBorderWork + netherBorderWork;
  let progress = 0;
  reportProgress(0, total);
  generatedSpawnX = (minChunkX * CHUNK_SIZE + maxChunkX * CHUNK_SIZE + CHUNK_SIZE - 1) / 2 + outputChunkOffsetX * CHUNK_SIZE;
  generatedSpawnY = -1;
  generatedSpawnZ = (minChunkZ * CHUNK_SIZE + maxChunkZ * CHUNK_SIZE + CHUNK_SIZE - 1) / 2 + outputChunkOffsetZ * CHUNK_SIZE;
  const database = new LevelDatabase(), tables = new Array<TableMetadata>(), zip = new ZipStream();
  activeDatabase = database; activeTables = tables; activeZip = zip;
  progress = generateDimension(database, tables, zip, seed, generatorType, 0, minChunkX, maxChunkX, minChunkZ, maxChunkZ, decorate, carve, outputChunkOffsetX, outputChunkOffsetZ, progress, total);
  if (fillNether) {
    progress = generateDimension(database, tables, zip, seed, 1, 1, netherMinChunkX, netherMaxChunkX, netherMinChunkZ, netherMaxChunkZ, decorate, carve, outputChunkOffsetX, outputChunkOffsetZ, progress, total);
  }
  if (addBorder) {
    progress = writeBorders(database, tables, zip, generatorType, 0, minChunkX, maxChunkX, minChunkZ, maxChunkZ, outputChunkOffsetX, outputChunkOffsetZ, null, progress, total);
  }
  if (addNetherBorder) {
    activeBorderRandom = new BorderRandom(borderRandomSeed);
    progress = writeBorders(database, tables, zip, generatorType, 1, netherMinChunkX, netherMaxChunkX, netherMinChunkZ, netherMaxChunkZ, outputChunkOffsetX, outputChunkOffsetZ, activeBorderRandom, progress, total);
  }
  if (generatedSpawnY < 0) generatedSpawnY = 64;
  finishDatabase(database, tables, zip);
  zip.add("level.dat", buildLevelDat(worldName, seed, generatorType, generatedSpawnX, generatedSpawnY, generatedSpawnZ, now, legacyVersion));
  zip.add("levelname.txt", Uint8Array.wrap(String.UTF8.encode(worldName, false)));
  zip.finish();
  reportProgress(total, total);
  activeDatabase = null; activeTables = null; activeZip = null; activeWorldName = null; activeBorderRandom = null;
}
