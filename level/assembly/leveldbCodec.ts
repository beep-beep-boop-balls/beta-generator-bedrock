import { DatabaseEntry, LevelDatabase } from "./database";
import { deflateRawFixed } from "./deflate";

const TABLE_MAGIC: u64 = 0xdb4775248b80fb57;
const BLOCK_SIZE: i32 = 160 * 1024;
const RESTART_INTERVAL: i32 = 16;
const VALUE: u8 = 1;
const DELETION: u8 = 0;
const CRC32C_TABLE = createCrcTable();

function createCrcTable(): StaticArray<u32> {
  const table = new StaticArray<u32>(256);
  for (let i = 0; i < 256; ++i) {
    let value = <u32>i;
    for (let bit = 0; bit < 8; ++bit) value = (value & 1) != 0 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    unchecked(table[i] = value);
  }
  return table;
}

class ByteWriter {
  data: Uint8Array;
  offset: i32 = 0;

  constructor(capacity: i32 = 256) { this.data = new Uint8Array(max(capacity, 1)); }
  ensure(length: i32): void {
    if (this.offset + length <= this.data.length) return;
    let capacity = this.data.length;
    while (capacity < this.offset + length) capacity *= 2;
    const next = new Uint8Array(capacity);
    memory.copy(next.dataStart, this.data.dataStart, this.offset);
    this.data = next;
  }
  u8(value: u8): ByteWriter { this.ensure(1); unchecked(this.data[this.offset++] = value); return this; }
  u32(value: u32): ByteWriter { this.ensure(4); store<u32>(this.data.dataStart + this.offset, value); this.offset += 4; return this; }
  u64(value: u64): ByteWriter { this.ensure(8); store<u64>(this.data.dataStart + this.offset, value); this.offset += 8; return this; }
  bytes(value: Uint8Array, start: i32 = 0, length: i32 = -1): ByteWriter {
    if (length < 0) length = value.length - start;
    this.ensure(length);
    memory.copy(this.data.dataStart + this.offset, value.dataStart + start, length);
    this.offset += length;
    return this;
  }
  varint(value: u64): ByteWriter {
    while (value >= 0x80) { this.u8(<u8>(value & 0x7f) | 0x80); value >>= 7; }
    return this.u8(<u8>value);
  }
  finish(): Uint8Array { return this.data.slice(0, this.offset); }
}

export class TableEntry {
  key: Uint8Array;
  value: Uint8Array;
  constructor(key: Uint8Array, value: Uint8Array) { this.key = key; this.value = value; }
}

export class BuiltTable {
  data: Uint8Array;
  smallest: Uint8Array;
  largest: Uint8Array;
  lastSequence: i64;
  constructor(data: Uint8Array, smallest: Uint8Array, largest: Uint8Array, lastSequence: i64) {
    this.data = data; this.smallest = smallest; this.largest = largest; this.lastSequence = lastSequence;
  }
}

export class IncrementalTableBuilder {
  private records: Array<TableEntry>;
  private sequence: i64;
  private writer: ByteWriter = new ByteWriter(1);
  private index: Array<TableEntry> = new Array<TableEntry>();
  private cursor: i32 = 0;
  private result: BuiltTable | null = null;

  constructor(database: LevelDatabase, preserveSequence: bool) {
    const source = database.sortedEntries();
    this.records = new Array<TableEntry>();
    this.sequence = database.sequence;
    let estimate = 64 * 1024;
    for (let index = 0; index < source.length; ++index) {
      const entry: DatabaseEntry = unchecked(source[index]);
      if (!preserveSequence && entry.value == null) continue;
      const entrySequence = preserveSequence ? entry.sequence : ++this.sequence;
      const value = entry.value == null ? new Uint8Array(0) : changetype<Uint8Array>(entry.value);
      const key = internalKey(entry.key, entrySequence, entry.value == null ? DELETION : VALUE);
      this.records.push(new TableEntry(key, value));
      estimate += key.length + value.length + 12;
    }
    this.records.sort(compareInternal);
    this.writer = new ByteWriter(estimate + estimate / 32);
  }

  step(maxBlocks: i32 = 1): bool {
    if (this.result != null) return true;
    let completedBlocks = 0;
    while (this.cursor < this.records.length && (maxBlocks <= 0 || completedBlocks < maxBlocks)) {
      const blockEntries = new Array<TableEntry>();
      let blockEstimate = 0;
      while (this.cursor < this.records.length) {
        const entry = unchecked(this.records[this.cursor++]);
        blockEntries.push(entry);
        blockEstimate += entry.key.length + entry.value.length + 12;
        if (blockEstimate >= BLOCK_SIZE) break;
      }
      const handle = appendBlock(this.writer, buildBlock(blockEntries));
      this.index.push(new TableEntry(unchecked(blockEntries[blockEntries.length - 1]).key, handle));
      ++completedBlocks;
    }
    if (this.cursor < this.records.length) return false;

    const metaHandle = appendBlock(this.writer, buildBlock(new Array<TableEntry>()));
    const indexHandle = appendBlock(this.writer, buildBlock(this.index, 1));
    const footer = new Uint8Array(48);
    memory.copy(footer.dataStart, metaHandle.dataStart, metaHandle.length);
    memory.copy(footer.dataStart + metaHandle.length, indexHandle.dataStart, indexHandle.length);
    store<u64>(footer.dataStart + 40, TABLE_MAGIC);
    this.writer.bytes(footer);
    const fallback = fallbackKey(this.sequence);
    this.result = new BuiltTable(
      this.writer.finish(),
      this.records.length == 0 ? fallback : unchecked(this.records[0]).key,
      this.records.length == 0 ? fallback : unchecked(this.records[this.records.length - 1]).key,
      this.sequence,
    );
    return true;
  }

  finish(): BuiltTable {
    if (this.result == null) unreachable();
    return changetype<BuiltTable>(this.result);
  }
}

class Cursor {
  data: Uint8Array;
  offset: i32 = 0;
  end: i32;
  constructor(data: Uint8Array, offset: i32 = 0, end: i32 = -1) { this.data = data; this.offset = offset; this.end = end < 0 ? data.length : end; }
  u8(): u8 { if (this.offset >= this.end) unreachable(); return unchecked(this.data[this.offset++]); }
  u32(): u32 { if (this.offset + 4 > this.end) unreachable(); const value = load<u32>(this.data.dataStart + this.offset); this.offset += 4; return value; }
  u64(): u64 { if (this.offset + 8 > this.end) unreachable(); const value = load<u64>(this.data.dataStart + this.offset); this.offset += 8; return value; }
  varint(): u64 { let value: u64 = 0; for (let shift = 0; shift < 70; shift += 7) { const byte = this.u8(); value |= <u64>(byte & 0x7f) << shift; if ((byte & 0x80) == 0) return value; } unreachable(); return 0; }
  bytes(length: i32): Uint8Array { if (length < 0 || this.offset + length > this.end) unreachable(); const value = this.data.slice(this.offset, this.offset + length); this.offset += length; return value; }
  varBytes(): Uint8Array { return this.bytes(<i32>this.varint()); }
}

function concatPrefix(prefix: Uint8Array, suffix: Uint8Array): Uint8Array {
  const result = new Uint8Array(prefix.length + suffix.length);
  memory.copy(result.dataStart, prefix.dataStart, prefix.length);
  memory.copy(result.dataStart + prefix.length, suffix.dataStart, suffix.length);
  return result;
}

export function parseTableBlock(input: Uint8Array): Array<TableEntry> {
  if (input.length < 4) unreachable();
  const restartCount = load<u32>(input.dataStart + input.length - 4);
  const restartOffset = input.length - 4 - <i32>restartCount * 4;
  if (restartOffset < 0) unreachable();
  const reader = new Cursor(input, 0, restartOffset);
  const result = new Array<TableEntry>();
  let previous = new Uint8Array(0);
  while (reader.offset < reader.end) {
    const shared = <i32>reader.varint(), unshared = <i32>reader.varint(), valueLength = <i32>reader.varint();
    if (shared > previous.length) unreachable();
    const prefix = previous.slice(0, shared);
    const key = concatPrefix(prefix, reader.bytes(unshared));
    const value = reader.bytes(valueLength);
    result.push(new TableEntry(key, value)); previous = key;
  }
  return result;
}

export function applyTableBlock(database: LevelDatabase, input: Uint8Array): void {
  const entries = parseTableBlock(input);
  for (let i = 0; i < entries.length; ++i) {
    const entry = unchecked(entries[i]);
    if (entry.key.length < 8) unreachable();
    const keyLength = entry.key.length - 8;
    const tag = load<u64>(entry.key.dataStart + keyLength);
    const type = <u8>(tag & 0xff), sequence = <i64>(tag >> 8);
    if (type == VALUE) {
      const joined = new Uint8Array(keyLength + entry.value.length);
      memory.copy(joined.dataStart, entry.key.dataStart, keyLength);
      memory.copy(joined.dataStart + keyLength, entry.value.dataStart, entry.value.length);
      database.apply(joined, 0, keyLength, keyLength, entry.value.length, sequence);
    } else database.apply(entry.key, 0, keyLength, 0, -1, sequence);
  }
}

function applyWriteBatch(database: LevelDatabase, record: Uint8Array): void {
  const reader = new Cursor(record);
  const firstSequence = <i64>reader.u64();
  const count = <i32>reader.u32();
  for (let index = 0; index < count; ++index) {
    const type = reader.u8(), key = reader.varBytes();
    if (type == VALUE) {
      const value = reader.varBytes();
      const joined = new Uint8Array(key.length + value.length);
      memory.copy(joined.dataStart, key.dataStart, key.length);
      memory.copy(joined.dataStart + key.length, value.dataStart, value.length);
      database.apply(joined, 0, key.length, key.length, value.length, firstSequence + index);
    } else if (type == DELETION) database.apply(key, 0, key.length, 0, -1, firstSequence + index);
    else unreachable();
  }
}

export function readLogRecords(input: Uint8Array): Array<Uint8Array> {
  const records = new Array<Uint8Array>();
  let position = 0;
  const fragments = new Array<Uint8Array>();
  while (position + 7 <= input.length) {
    const blockOffset = position % 32768;
    if (32768 - blockOffset < 7) { position += 32768 - blockOffset; continue; }
    const length = load<u16>(input.dataStart + position + 4), type = unchecked(input[position + 6]);
    if (length == 0 && type == 0) { position += 32768 - blockOffset; continue; }
    position += 7;
    if (position + length > input.length) break;
    const fragment = input.slice(position, position + length); position += length;
    if (type == 1) records.push(fragment);
    else if (type == 2) { fragments.length = 0; fragments.push(fragment); }
    else if (type == 3 && fragments.length != 0) fragments.push(fragment);
    else if (type == 4 && fragments.length != 0) {
      fragments.push(fragment);
      let total = 0; for (let i = 0; i < fragments.length; ++i) total += unchecked(fragments[i]).length;
      const record = new Uint8Array(total); let offset = 0;
      for (let i = 0; i < fragments.length; ++i) { const part = unchecked(fragments[i]); memory.copy(record.dataStart + offset, part.dataStart, part.length); offset += part.length; }
      records.push(record); fragments.length = 0;
    }
  }
  return records;
}

export function applyLogFile(database: LevelDatabase, input: Uint8Array): void {
  const records = readLogRecords(input);
  for (let index = 0; index < records.length; ++index) applyWriteBatch(database, unchecked(records[index]));
}

export class ManifestSelection {
  tables: Array<i32>;
  logs: Array<i32>;
  constructor(tables: Array<i32>, logs: Array<i32>) { this.tables = tables; this.logs = logs; }
}

export function parseManifest(input: Uint8Array): ManifestSelection {
  const active = new Map<u64, i32>();
  let logNumber: i32 = 0, previousLogNumber: i32 = 0;
  const records = readLogRecords(input);
  for (let recordIndex = 0; recordIndex < records.length; ++recordIndex) {
    const reader = new Cursor(unchecked(records[recordIndex]));
    while (reader.offset < reader.end) {
      const tag = <i32>reader.varint();
      if (tag == 1) reader.varBytes();
      else if (tag == 2) logNumber = <i32>reader.varint();
      else if (tag == 9) previousLogNumber = <i32>reader.varint();
      else if (tag == 3 || tag == 4) reader.varint();
      else if (tag == 5) { reader.varint(); reader.varBytes(); }
      else if (tag == 6) { const level = <u32>reader.varint(), file = <u32>reader.varint(); active.delete((<u64>level << 32) | file); }
      else if (tag == 7) {
        const level = <u32>reader.varint(), file = <i32>reader.varint();
        reader.varint(); reader.varBytes(); reader.varBytes(); active.set((<u64>level << 32) | <u32>file, file);
      } else unreachable();
    }
  }
  const tables = active.values(), logs = new Array<i32>();
  if (logNumber != 0) logs.push(logNumber);
  if (previousLogNumber != 0 && previousLogNumber != logNumber) logs.push(previousLogNumber);
  return new ManifestSelection(tables, logs);
}

function compareBytes(a: Uint8Array, aLength: i32, b: Uint8Array, bLength: i32): i32 {
  const length = min(aLength, bLength);
  for (let i = 0; i < length; ++i) {
    const difference = <i32>unchecked(a[i]) - <i32>unchecked(b[i]);
    if (difference != 0) return difference;
  }
  return aLength - bLength;
}

function compareInternal(a: TableEntry, b: TableEntry): i32 {
  const user = compareBytes(a.key, a.key.length - 8, b.key, b.key.length - 8);
  if (user != 0) return user;
  const aTag = load<u64>(a.key.dataStart + a.key.length - 8);
  const bTag = load<u64>(b.key.dataStart + b.key.length - 8);
  return aTag == bTag ? 0 : aTag > bTag ? -1 : 1;
}

function internalKey(key: Uint8Array, sequence: i64, type: u8): Uint8Array {
  const result = new Uint8Array(key.length + 8);
  memory.copy(result.dataStart, key.dataStart, key.length);
  store<u64>(result.dataStart + key.length, (<u64>sequence << 8) | type);
  return result;
}

function commonPrefix(a: Uint8Array, b: Uint8Array): i32 {
  const length = min(a.length, b.length);
  let index = 0;
  while (index < length && unchecked(a[index]) == unchecked(b[index])) ++index;
  return index;
}

function buildBlock(entries: Array<TableEntry>, restartInterval: i32 = RESTART_INTERVAL): Uint8Array {
  const writer = new ByteWriter();
  const restarts = new Array<i32>();
  let previous = new Uint8Array(0);
  for (let i = 0; i < entries.length; ++i) {
    const entry = unchecked(entries[i]);
    let shared = 0;
    if (i % restartInterval == 0) restarts.push(writer.offset);
    else shared = commonPrefix(previous, entry.key);
    writer.varint(shared).varint(entry.key.length - shared).varint(entry.value.length);
    writer.bytes(entry.key, shared).bytes(entry.value);
    previous = entry.key;
  }
  if (restarts.length == 0) restarts.push(0);
  for (let i = 0; i < restarts.length; ++i) writer.u32(unchecked(restarts[i]));
  writer.u32(restarts.length);
  return writer.finish();
}

function maskedCrc32c(content: Uint8Array): u32 {
  let crc: u32 = 0xffffffff;
  for (let i = 0; i < content.length; ++i) crc = unchecked(CRC32C_TABLE[(crc ^ unchecked(content[i])) & 0xff]) ^ (crc >>> 8);
  crc = ~crc;
  return ((crc >>> 15) | (crc << 17)) + 0xa282ead8;
}

export function buildLogRecord(record: Uint8Array): Uint8Array {
  const writer = new ByteWriter(record.length + 7 + record.length / 32761 * 7);
  let offset = 0, blockOffset = 0;
  while (offset < record.length || (record.length == 0 && offset == 0)) {
    if (32768 - blockOffset < 7) { const padding = new Uint8Array(32768 - blockOffset); writer.bytes(padding); blockOffset = 0; }
    const available = 32768 - blockOffset - 7;
    const length = min(available, record.length - offset);
    const begin = offset == 0, end = offset + length == record.length;
    const type: u8 = begin && end ? 1 : begin ? 2 : end ? 4 : 3;
    const crcInput = new Uint8Array(length + 1); unchecked(crcInput[0] = type);
    if (length != 0) memory.copy(crcInput.dataStart + 1, record.dataStart + offset, length);
    writer.u32(maskedCrc32c(crcInput));
    writer.ensure(3); store<u16>(writer.data.dataStart + writer.offset, length); writer.offset += 2; writer.u8(type);
    writer.bytes(record, offset, length);
    offset += length; blockOffset += 7 + length;
    if (record.length == 0) break;
  }
  return writer.finish();
}

export function buildManifestLog(metadata: Uint8Array, tableCount: i32, lastSequence: i64): Uint8Array {
  const writer = new ByteWriter();
  const comparator = Uint8Array.wrap(String.UTF8.encode("leveldb.BytewiseComparator", false));
  writer.varint(1).varint(comparator.length).bytes(comparator);
  writer.varint(2).varint(tableCount + 2);
  writer.varint(9).varint(0);
  writer.varint(3).varint(tableCount + 3);
  writer.varint(4).varint(<u64>lastSequence);
  const level = tableCount == 1 ? 2 : 0;
  const cursor = new Cursor(metadata);
  for (let index = 0; index < tableCount; ++index) {
    const number = cursor.u32(), size = cursor.u32();
    const smallest = cursor.varBytes(), largest = cursor.varBytes();
    writer.varint(7).varint(level).varint(number).varint(size).varint(smallest.length).bytes(smallest).varint(largest.length).bytes(largest);
  }
  return buildLogRecord(writer.finish());
}

function appendBlock(writer: ByteWriter, content: Uint8Array): Uint8Array {
  const offset = writer.offset;
  const compressed = deflateRawFixed(content);
  const stored = compressed.length < content.length ? compressed : content;
  const compression: u8 = stored === compressed ? 4 : 0;
  writer.bytes(stored).u8(compression);
  const crcInput = new Uint8Array(stored.length + 1);
  memory.copy(crcInput.dataStart, stored.dataStart, stored.length);
  unchecked(crcInput[stored.length] = compression);
  writer.u32(maskedCrc32c(crcInput));
  const handle = new ByteWriter(20).varint(offset).varint(stored.length).finish();
  return handle;
}

function fallbackKey(sequence: i64): Uint8Array { return internalKey(new Uint8Array(0), sequence, VALUE); }

export function buildDatabaseTable(database: LevelDatabase, preserveSequence: bool): BuiltTable {
  const builder = new IncrementalTableBuilder(database, preserveSequence);
  builder.step(0);
  return builder.finish();
}

function buildTableRecords(records: Array<TableEntry>, sequence: i64, blockSize: i32): BuiltTable {
  records.sort(compareInternal);
  let estimate = 64 * 1024;
  for (let i = 0; i < records.length; ++i) estimate += unchecked(records[i]).key.length + unchecked(records[i]).value.length + 12;
  const writer = new ByteWriter(estimate + estimate / 32);
  const index = new Array<TableEntry>();
  let blockEntries = new Array<TableEntry>();
  let blockEstimate = 0;
  for (let i = 0; i < records.length; ++i) {
    const entry = unchecked(records[i]);
    blockEntries.push(entry);
    blockEstimate += entry.key.length + entry.value.length + 12;
    if (blockEstimate >= blockSize) {
      const handle = appendBlock(writer, buildBlock(blockEntries));
      index.push(new TableEntry(unchecked(blockEntries[blockEntries.length - 1]).key, handle));
      blockEntries = new Array<TableEntry>(); blockEstimate = 0;
    }
  }
  if (blockEntries.length != 0) {
    const handle = appendBlock(writer, buildBlock(blockEntries));
    index.push(new TableEntry(unchecked(blockEntries[blockEntries.length - 1]).key, handle));
  }
  const metaHandle = appendBlock(writer, buildBlock(new Array<TableEntry>()));
  const indexHandle = appendBlock(writer, buildBlock(index, 1));
  const footer = new Uint8Array(48);
  memory.copy(footer.dataStart, metaHandle.dataStart, metaHandle.length);
  memory.copy(footer.dataStart + metaHandle.length, indexHandle.dataStart, indexHandle.length);
  store<u64>(footer.dataStart + 40, TABLE_MAGIC);
  writer.bytes(footer);
  const fallback = fallbackKey(sequence);
  return new BuiltTable(
    writer.finish(),
    records.length == 0 ? fallback : unchecked(records[0]).key,
    records.length == 0 ? fallback : unchecked(records[records.length - 1]).key,
    sequence,
  );
}

export function buildRawTable(input: Uint8Array, entryCount: i32, blockSize: i32): BuiltTable {
  const reader = new Cursor(input);
  const records = new Array<TableEntry>();
  let sequence: i64 = 0;
  for (let index = 0; index < entryCount; ++index) {
    const keyLength = <i32>reader.u32(), valueLength = <i32>reader.u32();
    const key = reader.bytes(keyLength), value = reader.bytes(valueLength);
    records.push(new TableEntry(key, value));
    if (key.length >= 8) sequence = max(sequence, <i64>(load<u64>(key.dataStart + key.length - 8) >> 8));
  }
  return buildTableRecords(records, sequence, blockSize);
}
