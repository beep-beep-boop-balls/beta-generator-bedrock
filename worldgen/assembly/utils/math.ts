const SIN_TABLE_LENGTH: i32 = 65536;
const SIN_TABLE = new StaticArray<f32>(SIN_TABLE_LENGTH);

for (let i: i32 = 0; i < SIN_TABLE_LENGTH; ++i) {
  unchecked(SIN_TABLE[i] = <f32>Math.sin(<f64>i * Math.PI * 2.0 / <f64>SIN_TABLE_LENGTH));
}

@inline
export function javaInt(value: f64): i32 {
  if (isNaN(value)) return 0;
  if (value <= -2147483648.0) return i32.MIN_VALUE;
  if (value >= 2147483647.0) return i32.MAX_VALUE;
  return <i32>value;
}

@inline
export function javaFloor(value: f64): i32 {
  const integer = javaInt(value);
  return value < <f64>integer ? integer - 1 : integer;
}

@inline
export function javaSin(value: f32): f32 {
  return unchecked(SIN_TABLE[javaInt(<f64>(value * <f32>10430.378)) & 65535]);
}

@inline
export function javaCos(value: f32): f32 {
  return unchecked(SIN_TABLE[javaInt(<f64>(value * <f32>10430.378 + <f32>16384.0)) & 65535]);
}

@inline
export function javaSqrt(value: f32): f32 {
  return <f32>Math.sqrt(<f64>value);
}

@inline
export function javaAbs(value: f32): f32 {
  return value >= <f32>0.0 ? value : -value;
}

@inline
export function absMax(a: f64, b: f64): f64 {
  if (a < 0.0) a = -a;
  if (b < 0.0) b = -b;
  return a > b ? a : b;
}

@inline
export function floorDiv16(value: i32): i32 {
  return value >= 0 ? value >> 4 : -((15 - value) >> 4);
}

@inline
export function floorMod16(value: i32): i32 {
  return value & 15;
}

@inline
export function chunkKey(chunkX: i32, chunkZ: i32): i64 {
  return (<i64>chunkX << 32) | <i64><u32>chunkZ;
}
