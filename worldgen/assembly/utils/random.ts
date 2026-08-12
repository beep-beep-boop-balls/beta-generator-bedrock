const MULTIPLIER: i64 = 0x5deece66d;
const ADDEND: i64 = 0xb;
const MASK: i64 = (<i64>1 << 48) - 1;
const DOUBLE_UNIT: f64 = 1.0 / 9007199254740992.0;

export class JavaRandom {
  private seed: i64 = 0;

  constructor(seed: i64 = 0) {
    this.setSeed(seed);
  }

  @inline setSeed(seed: i64): void {
    this.seed = (seed ^ MULTIPLIER) & MASK;
  }

  next(bits: i32): i32 {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK;
    return <i32>(this.seed >>> (48 - bits));
  }

  nextInt(bound: i32 = 0): i32 {
    if (bound == 0) return this.next(32);
    if (bound < 0) unreachable();
    const mask = bound - 1;
    if ((bound & mask) == 0) return <i32>((<i64>bound * <i64>this.next(31)) >> 31);
    let bits: i32;
    let value: i32;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (bits - value + mask < 0);
    return value;
  }

  nextLong(): i64 {
    return (<i64>this.next(32) << 32) + <i64>this.next(32);
  }

  nextDouble(): f64 {
    const high = <i64>this.next(26) << 27;
    const low = <i64>this.next(27);
    return <f64>(high + low) * DOUBLE_UNIT;
  }

  nextFloat(): f32 {
    return <f32>this.next(24) / <f32>(1 << 24);
  }

  nextBoolean(): bool {
    return this.next(1) != 0;
  }
}
