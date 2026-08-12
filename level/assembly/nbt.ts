import { BinaryReader, BinaryWriter } from "./binary";

export const NBT_END: u8 = 0;
export const NBT_BYTE: u8 = 1;
export const NBT_SHORT: u8 = 2;
export const NBT_INT: u8 = 3;
export const NBT_LONG: u8 = 4;
export const NBT_FLOAT: u8 = 5;
export const NBT_DOUBLE: u8 = 6;
export const NBT_BYTE_ARRAY: u8 = 7;
export const NBT_STRING: u8 = 8;
export const NBT_LIST: u8 = 9;
export const NBT_COMPOUND: u8 = 10;
export const NBT_INT_ARRAY: u8 = 11;
export const NBT_LONG_ARRAY: u8 = 12;

export class NbtNode {
  type: u8;
  integer: i64 = 0;
  decimal: f64 = 0;
  text: string = "";
  bytes: Uint8Array | null = null;
  integers: Int32Array | null = null;
  longs: Int64Array | null = null;
  elementType: u8 = 0;
  children: Array<NbtNode> | null = null;
  names: Array<string> | null = null;

  constructor(type: u8) { this.type = type; }
}

export class NamedNbt {
  name: string;
  node: NbtNode;
  bytesRead: i32;
  constructor(name: string, node: NbtNode, bytesRead: i32) { this.name = name; this.node = node; this.bytesRead = bytesRead; }
}

function readString(reader: BinaryReader): string {
  const length = reader.u16();
  reader.require(length);
  const result = String.UTF8.decodeUnsafe(reader.data.dataStart + reader.offset, length, false);
  reader.offset += length;
  return result;
}

function writeString(writer: BinaryWriter, value: string): void {
  const length = String.UTF8.byteLength(value);
  writer.u16(<u16>length);
  writer.ensure(length);
  String.UTF8.encodeUnsafe(changetype<usize>(value), value.length, writer.data.dataStart + writer.offset, false);
  writer.offset += length;
}

function readPayload(reader: BinaryReader, type: u8): NbtNode {
  const node = new NbtNode(type);
  if (type == NBT_BYTE) node.integer = reader.i8();
  else if (type == NBT_SHORT) node.integer = reader.i16();
  else if (type == NBT_INT) node.integer = reader.i32();
  else if (type == NBT_LONG) node.integer = reader.i64();
  else if (type == NBT_FLOAT) node.decimal = reader.f32();
  else if (type == NBT_DOUBLE) node.decimal = reader.f64();
  else if (type == NBT_BYTE_ARRAY) {
    const length = reader.i32(); if (length < 0) unreachable();
    node.bytes = reader.data.slice(reader.offset, reader.offset + length); reader.skip(length);
  } else if (type == NBT_STRING) node.text = readString(reader);
  else if (type == NBT_LIST) {
    node.elementType = reader.u8();
    const length = reader.i32(); if (length < 0) unreachable();
    const children = new Array<NbtNode>();
    for (let i = 0; i < length; ++i) children.push(readPayload(reader, node.elementType));
    node.children = children;
  } else if (type == NBT_COMPOUND) {
    const names = new Array<string>(), children = new Array<NbtNode>();
    while (true) {
      const childType = reader.u8();
      if (childType == NBT_END) break;
      names.push(readString(reader)); children.push(readPayload(reader, childType));
    }
    node.names = names; node.children = children;
  } else if (type == NBT_INT_ARRAY) {
    const length = reader.i32(); if (length < 0) unreachable();
    const values = new Int32Array(length);
    for (let i = 0; i < length; ++i) unchecked(values[i] = reader.i32());
    node.integers = values;
  } else if (type == NBT_LONG_ARRAY) {
    const length = reader.i32(); if (length < 0) unreachable();
    const values = new Int64Array(length);
    for (let i = 0; i < length; ++i) unchecked(values[i] = reader.i64());
    node.longs = values;
  } else unreachable();
  return node;
}

function writePayload(writer: BinaryWriter, node: NbtNode): void {
  const type = node.type;
  if (type == NBT_BYTE) writer.u8(<u8>node.integer);
  else if (type == NBT_SHORT) writer.u16(<u16>node.integer);
  else if (type == NBT_INT) writer.u32(<u32>node.integer);
  else if (type == NBT_LONG) writer.u64(<u64>node.integer);
  else if (type == NBT_FLOAT) writer.f32(<f32>node.decimal);
  else if (type == NBT_DOUBLE) writer.f64(node.decimal);
  else if (type == NBT_BYTE_ARRAY) {
    const values = changetype<Uint8Array>(node.bytes); writer.u32(values.length); writer.bytes(values, 0, values.length);
  } else if (type == NBT_STRING) writeString(writer, node.text);
  else if (type == NBT_LIST) {
    const children = changetype<Array<NbtNode>>(node.children);
    writer.u8(node.elementType); writer.u32(children.length);
    for (let i = 0; i < children.length; ++i) writePayload(writer, unchecked(children[i]));
  } else if (type == NBT_COMPOUND) {
    const names = changetype<Array<string>>(node.names), children = changetype<Array<NbtNode>>(node.children);
    for (let i = 0; i < children.length; ++i) {
      const child = unchecked(children[i]); if (child.type == NBT_END) continue;
      writer.u8(child.type); writeString(writer, unchecked(names[i])); writePayload(writer, child);
    }
    writer.u8(NBT_END);
  } else if (type == NBT_INT_ARRAY) {
    const values = changetype<Int32Array>(node.integers); writer.u32(values.length);
    for (let i = 0; i < values.length; ++i) writer.u32(unchecked(values[i]));
  } else if (type == NBT_LONG_ARRAY) {
    const values = changetype<Int64Array>(node.longs); writer.u32(values.length);
    for (let i = 0; i < values.length; ++i) writer.u64(unchecked(values[i]));
  } else unreachable();
}

export function readNbt(data: Uint8Array, offset: i32): NamedNbt {
  const reader = new BinaryReader(data, offset, -1);
  const type = reader.u8();
  if (type == NBT_END) return new NamedNbt("", new NbtNode(type), 1);
  const name = readString(reader);
  return new NamedNbt(name, readPayload(reader, type), reader.offset - offset);
}

export function writeNbt(node: NbtNode, name: string): Uint8Array {
  const writer = new BinaryWriter();
  writer.u8(node.type); writeString(writer, name); writePayload(writer, node);
  return writer.data.slice(0, writer.offset);
}

export function makeIntegerNode(type: u8, value: i64): NbtNode { const node = new NbtNode(type); node.integer = value; return node; }
export function makeDecimalNode(type: u8, value: f64): NbtNode { const node = new NbtNode(type); node.decimal = value; return node; }
export function makeStringNode(type: u8, value: string): NbtNode { const node = new NbtNode(type); node.text = value; return node; }
export function makeBytesNode(type: u8, value: Uint8Array): NbtNode { const node = new NbtNode(type); node.bytes = value; return node; }
export function makeIntsNode(type: u8, value: Int32Array): NbtNode { const node = new NbtNode(type); node.integers = value; return node; }
export function makeLongsNode(type: u8, value: Int64Array): NbtNode { const node = new NbtNode(type); node.longs = value; return node; }
export function makeContainerNode(type: u8, elementType: u8): NbtNode { const node = new NbtNode(type); node.elementType = elementType; node.children = new Array<NbtNode>(); if (type == NBT_COMPOUND) node.names = new Array<string>(); return node; }
export function addChild(parent: NbtNode, name: string, child: NbtNode): void { changetype<Array<NbtNode>>(parent.children).push(child); if (parent.type == NBT_COMPOUND) changetype<Array<string>>(parent.names).push(name); }
