import { javaInt } from "../utils/math";
import { JavaRandom } from "../utils/random";

const GRAD_X: StaticArray<i8> = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y: StaticArray<i8> = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];
const F2: f64 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2: f64 = (3.0 - Math.sqrt(3.0)) / 6.0;

export class SimplexNoise {
  private readonly permutations: StaticArray<u8> = new StaticArray<u8>(512);
  private readonly xCoord: f64;
  private readonly yCoord: f64;

  constructor(random: JavaRandom) {
    this.xCoord = random.nextDouble() * 256.0;
    this.yCoord = random.nextDouble() * 256.0;
    random.nextDouble();
    for (let i = 0; i < 256; ++i) unchecked(this.permutations[i] = <u8>i);
    for (let i = 0; i < 256; ++i) {
      const j = random.nextInt(256 - i) + i;
      const swap = unchecked(this.permutations[i]);
      unchecked(this.permutations[i] = this.permutations[j]);
      unchecked(this.permutations[j] = swap);
      unchecked(this.permutations[i + 256] = this.permutations[i]);
    }
  }

  @inline
  private static dot(gradient: i32, dx: f64, dy: f64): f64 {
    return <f64>unchecked(GRAD_X[gradient]) * dx + <f64>unchecked(GRAD_Y[gradient]) * dy;
  }

  @inline
  static wrap(value: f64): i32 {
    return value > 0.0 ? javaInt(value) : javaInt(value) - 1;
  }

  sample(buffer: Float64Array, x: f64, z: f64, width: i32, depth: i32, xFrequency: f64, zFrequency: f64, amplitude: f64): void {
    let counter = 0;
    for (let x1 = 0; x1 < width; ++x1) {
      const x2 = (x + <f64>x1) * xFrequency + this.xCoord;
      for (let z1 = 0; z1 < depth; ++z1) {
        const z2 = (z + <f64>z1) * zFrequency + this.yCoord;
        const s = (x2 + z2) * F2;
        const i = SimplexNoise.wrap(x2 + s);
        const j = SimplexNoise.wrap(z2 + s);
        const t = <f64>(i + j) * G2;
        const x4 = x2 - (<f64>i - t);
        const z4 = z2 - (<f64>j - t);
        const i1 = x4 > z4 ? 1 : 0;
        const j1 = x4 > z4 ? 0 : 1;
        const x5 = x4 - <f64>i1 + G2;
        const z5 = z4 - <f64>j1 + G2;
        const x6 = x4 - 1.0 + 2.0 * G2;
        const z6 = z4 - 1.0 + 2.0 * G2;
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = unchecked(this.permutations[ii + this.permutations[jj]]) % 12;
        const gi1 = unchecked(this.permutations[ii + i1 + this.permutations[jj + j1]]) % 12;
        const gi2 = unchecked(this.permutations[ii + 1 + this.permutations[jj + 1]]) % 12;

        let t0 = 0.5 - x4 * x4 - z4 * z4;
        let n0 = 0.0;
        if (t0 >= 0.0) { t0 *= t0; n0 = t0 * t0 * SimplexNoise.dot(gi0, x4, z4); }
        let t1 = 0.5 - x5 * x5 - z5 * z5;
        let n1 = 0.0;
        if (t1 >= 0.0) { t1 *= t1; n1 = t1 * t1 * SimplexNoise.dot(gi1, x5, z5); }
        let t2 = 0.5 - x6 * x6 - z6 * z6;
        let n2 = 0.0;
        if (t2 >= 0.0) { t2 *= t2; n2 = t2 * t2 * SimplexNoise.dot(gi2, x6, z6); }
        unchecked(buffer[counter] += 70.0 * (n0 + n1 + n2) * amplitude);
        ++counter;
      }
    }
  }
}
