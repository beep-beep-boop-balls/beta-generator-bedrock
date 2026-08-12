export class BinaryReader {
  readonly data: Uint8Array;
  offset: i32 = 0;
  readonly end: i32;

  constructor(data: Uint8Array, offset: i32, length: i32) {
    this.data = data;
    this.offset = offset;
    this.end = length < 0 ? data.length : offset + length;
  }
  get remaining(): i32 { return this.end - this.offset; }
  require(length: i32): void { if (length < 0 || this.offset + length > this.end) unreachable(); }
  u8(): u8 { this.require(1); return unchecked(this.data[this.offset++]); }
  i8(): i8 { return <i8>this.u8(); }
  u16(): u16 { this.require(2); const value = load<u16>(this.data.dataStart + this.offset); this.offset += 2; return value; }
  i16(): i16 { return <i16>this.u16(); }
  u32(): u32 { this.require(4); const value = load<u32>(this.data.dataStart + this.offset); this.offset += 4; return value; }
  i32(): i32 { return <i32>this.u32(); }
  u64(): u64 { this.require(8); const value = load<u64>(this.data.dataStart + this.offset); this.offset += 8; return value; }
  i64(): i64 { return <i64>this.u64(); }
  f32(): f32 { this.require(4); const value = load<f32>(this.data.dataStart + this.offset); this.offset += 4; return value; }
  f64(): f64 { this.require(8); const value = load<f64>(this.data.dataStart + this.offset); this.offset += 8; return value; }
  skip(length: i32): void { this.require(length); this.offset += length; }
  varint(): u64 {
    let value: u64 = 0;
    let shift: i32 = 0;
    for (let i = 0; i < 10; ++i) {
      const byte = this.u8();
      value |= <u64>(byte & 0x7f) << shift;
      if ((byte & 0x80) == 0) return value;
      shift += 7;
    }
    unreachable();
    return 0;
  }
}

export class BinaryWriter {
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
  u8(value: u8): void { this.ensure(1); unchecked(this.data[this.offset++] = value); }
  u16(value: u16): void { this.ensure(2); store<u16>(this.data.dataStart + this.offset, value); this.offset += 2; }
  u32(value: u32): void { this.ensure(4); store<u32>(this.data.dataStart + this.offset, value); this.offset += 4; }
  u64(value: u64): void { this.ensure(8); store<u64>(this.data.dataStart + this.offset, value); this.offset += 8; }
  f32(value: f32): void { this.ensure(4); store<f32>(this.data.dataStart + this.offset, value); this.offset += 4; }
  f64(value: f64): void { this.ensure(8); store<f64>(this.data.dataStart + this.offset, value); this.offset += 8; }
  bytes(input: Uint8Array, start: i32, length: i32): void {
    this.ensure(length);
    memory.copy(this.data.dataStart + this.offset, input.dataStart + start, length);
    this.offset += length;
  }
  varint(value: u64): void {
    while (value >= 0x80) { this.u8(<u8>(value & 0x7f) | 0x80); value >>= 7; }
    this.u8(<u8>value);
  }
}
