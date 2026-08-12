export class DatabaseEntry {
  key: Uint8Array;
  value: Uint8Array | null;
  sequence: i64;

  constructor(key: Uint8Array, value: Uint8Array | null, sequence: i64) {
    this.key = key;
    this.value = value;
    this.sequence = sequence;
  }
}

function copyBytes(source: Uint8Array, offset: i32, length: i32): Uint8Array {
  const result = new Uint8Array(length);
  memory.copy(result.dataStart, source.dataStart + offset, length);
  return result;
}

function binaryKey(source: Uint8Array, offset: i32, length: i32): string {
  let result = "";
  for (let i = 0; i < length; ++i) result += String.fromCharCode(unchecked(source[offset + i]));
  return result;
}

function compareBytes(a: Uint8Array, b: Uint8Array): i32 {
  const length = min(a.length, b.length);
  for (let i = 0; i < length; ++i) {
    const difference = <i32>unchecked(a[i]) - <i32>unchecked(b[i]);
    if (difference != 0) return difference;
  }
  return a.length - b.length;
}

function compareEntries(a: DatabaseEntry, b: DatabaseEntry): i32 {
  return compareBytes(a.key, b.key);
}

export class LevelDatabase {
  private entries: Map<string, DatabaseEntry> = new Map<string, DatabaseEntry>();
  sequence: i64 = 0;

  get size(): i32 { return this.entries.size; }

  has(input: Uint8Array, keyOffset: i32, keyLength: i32): bool {
    const id = binaryKey(input, keyOffset, keyLength);
    return this.entries.has(id) && this.entries.get(id).value != null;
  }

  get(input: Uint8Array, keyOffset: i32, keyLength: i32): DatabaseEntry | null {
    const id = binaryKey(input, keyOffset, keyLength);
    if (!this.entries.has(id)) return null;
    const entry = this.entries.get(id);
    return entry.value != null ? entry : null;
  }

  put(input: Uint8Array, keyOffset: i32, keyLength: i32, valueOffset: i32, valueLength: i32): void {
    ++this.sequence;
    const id = binaryKey(input, keyOffset, keyLength);
    this.entries.set(id, new DatabaseEntry(copyBytes(input, keyOffset, keyLength), copyBytes(input, valueOffset, valueLength), this.sequence));
  }

  putOwned(key: Uint8Array, value: Uint8Array): void {
    ++this.sequence;
    this.entries.set(binaryKey(key, 0, key.length), new DatabaseEntry(key, value, this.sequence));
  }

  remove(input: Uint8Array, keyOffset: i32, keyLength: i32): bool {
    const id = binaryKey(input, keyOffset, keyLength);
    const existed = this.entries.has(id) && this.entries.get(id).value != null;
    ++this.sequence;
    this.entries.delete(id);
    return existed;
  }

  apply(input: Uint8Array, keyOffset: i32, keyLength: i32, valueOffset: i32, valueLength: i32, sequence: i64): void {
    const id = binaryKey(input, keyOffset, keyLength);
    if (!this.entries.has(id) || sequence >= this.entries.get(id).sequence) {
      let value: Uint8Array | null = null;
      if (valueLength >= 0) value = copyBytes(input, valueOffset, valueLength);
      this.entries.set(id, new DatabaseEntry(copyBytes(input, keyOffset, keyLength), value, sequence));
    }
    if (sequence > this.sequence) this.sequence = sequence;
  }

  clear(): void {
    this.entries.clear();
    this.sequence = 0;
  }

  removeDeletions(): void {
    const remove = new Array<string>();
    const keys = this.entries.keys();
    for (let i = 0; i < keys.length; ++i) {
      const id = unchecked(keys[i]);
      if (this.entries.get(id).value == null) remove.push(id);
    }
    for (let i = 0; i < remove.length; ++i) this.entries.delete(unchecked(remove[i]));
  }

  sortedEntries(): Array<DatabaseEntry> {
    const result = new Array<DatabaseEntry>();
    const values = this.entries.values();
    for (let i = 0; i < values.length; ++i) {
      const entry = unchecked(values[i]);
      result.push(entry);
    }
    result.sort(compareEntries);
    return result;
  }
}

export function entryKey(entry: DatabaseEntry): Uint8Array { return entry.key; }
export function entryValue(entry: DatabaseEntry): Uint8Array | null { return entry.value; }
