class BitWriter {
  data: Uint8Array = new Uint8Array(256);
  byteOffset: i32 = 0;
  private bits: u64 = 0;
  private bitCount: i32 = 0;

  private ensure(): void {
    if (this.byteOffset < this.data.length) return;
    const next = new Uint8Array(this.data.length * 2);
    memory.copy(next.dataStart, this.data.dataStart, this.data.length);
    this.data = next;
  }
  write(value: u32, count: i32): void {
    this.bits |= <u64>value << this.bitCount;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      this.ensure();
      unchecked(this.data[this.byteOffset++] = <u8>this.bits);
      this.bits >>= 8;
      this.bitCount -= 8;
    }
  }
  finish(): Uint8Array {
    if (this.bitCount != 0) {
      this.ensure();
      unchecked(this.data[this.byteOffset++] = <u8>this.bits);
      this.bits = 0;
      this.bitCount = 0;
    }
    return this.data.slice(0, this.byteOffset);
  }
}

const LENGTH_BASE = StaticArray.fromArray<i32>([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LENGTH_EXTRA = StaticArray.fromArray<i32>([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
const DISTANCE_BASE = StaticArray.fromArray<i32>([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DISTANCE_EXTRA = StaticArray.fromArray<i32>([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);

function reverse(value: u32, count: i32): u32 {
  let result: u32 = 0;
  for (let bit = 0; bit < count; ++bit) result = (result << 1) | ((value >>> bit) & 1);
  return result;
}

function writeSymbol(writer: BitWriter, symbol: i32): void {
  if (symbol <= 143) writer.write(reverse(<u32>(0x30 + symbol), 8), 8);
  else if (symbol <= 255) writer.write(reverse(<u32>(0x190 + symbol - 144), 9), 9);
  else if (symbol <= 279) writer.write(reverse(<u32>(symbol - 256), 7), 7);
  else writer.write(reverse(<u32>(0xc0 + symbol - 280), 8), 8);
}

function writeLength(writer: BitWriter, length: i32): void {
  let code = 0;
  while (code < 28 && length >= unchecked(LENGTH_BASE[code + 1])) ++code;
  writeSymbol(writer, 257 + code);
  const extra = unchecked(LENGTH_EXTRA[code]);
  if (extra != 0) writer.write(<u32>(length - unchecked(LENGTH_BASE[code])), extra);
}

function writeDistance(writer: BitWriter, distance: i32): void {
  let code = 0;
  while (code < 29 && distance >= unchecked(DISTANCE_BASE[code + 1])) ++code;
  writer.write(reverse(<u32>code, 5), 5);
  const extra = unchecked(DISTANCE_EXTRA[code]);
  if (extra != 0) writer.write(<u32>(distance - unchecked(DISTANCE_BASE[code])), extra);
}

@inline function hash3(input: Uint8Array, position: i32): i32 {
  return ((<i32>unchecked(input[position]) * 251 + unchecked(input[position + 1])) * 251 + unchecked(input[position + 2])) & 0xffff;
}

export function deflateRawFixed(input: Uint8Array): Uint8Array {
  const writer = new BitWriter();
  writer.write(1, 1); writer.write(1, 2);
  const last = new Int32Array(65536); last.fill(-1);
  let position = 0;
  while (position < input.length) {
    let matchLength = 0, matchDistance = 0;
    if (position + 2 < input.length) {
      const hash = hash3(input, position), candidate = unchecked(last[hash]);
      unchecked(last[hash] = position);
      if (candidate >= 0 && position - candidate <= 32768) {
        const limit = min(258, input.length - position);
        let length = 0;
        while (length < limit && unchecked(input[candidate + length]) == unchecked(input[position + length])) ++length;
        if (length >= 3) { matchLength = length; matchDistance = position - candidate; }
      }
    }
    if (matchLength < 3) { writeSymbol(writer, unchecked(input[position])); ++position; continue; }
    writeLength(writer, matchLength); writeDistance(writer, matchDistance);
    const end = position + matchLength;
    for (++position; position < end; ++position) if (position + 2 < input.length) unchecked(last[hash3(input, position)] = position);
  }
  writeSymbol(writer, 256);
  return writer.finish();
}
