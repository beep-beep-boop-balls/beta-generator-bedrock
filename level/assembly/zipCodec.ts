import { BinaryWriter } from "./binary";

export function localZipHeader(nameLength: i32, size: i32, checksum: u32): Uint8Array {
  const writer = new BinaryWriter(30);
  writer.u32(0x04034b50); writer.u16(20); writer.u16(0x0800); writer.u16(0); writer.u16(0); writer.u16(0);
  writer.u32(checksum); writer.u32(size); writer.u32(size); writer.u16(<u16>nameLength); writer.u16(0);
  return writer.data.slice(0, writer.offset);
}

export function centralZipHeader(nameLength: i32, size: i32, checksum: u32, offset: i32): Uint8Array {
  const writer = new BinaryWriter(46);
  writer.u32(0x02014b50); writer.u16(20); writer.u16(20); writer.u16(0x0800); writer.u16(0); writer.u16(0); writer.u16(0);
  writer.u32(checksum); writer.u32(size); writer.u32(size); writer.u16(<u16>nameLength); writer.u16(0); writer.u16(0);
  writer.u16(0); writer.u16(0); writer.u32(0); writer.u32(offset);
  return writer.data.slice(0, writer.offset);
}

export function endOfCentralDirectory(count: i32, centralSize: i32, centralOffset: i32): Uint8Array {
  const writer = new BinaryWriter(22);
  writer.u32(0x06054b50); writer.u16(0); writer.u16(0); writer.u16(<u16>count); writer.u16(<u16>count);
  writer.u32(centralSize); writer.u32(centralOffset); writer.u16(0);
  return writer.data.slice(0, writer.offset);
}
