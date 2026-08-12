import { javaInt } from "../utils/math";
import { JavaRandom } from "../utils/random";

function fillAxisCache(coords: Float64Array, mods: Int32Array, fades: Float64Array, start: f64, size: i32, frequency: f64, offset: f64): void {
  for (let index = 0; index < size; ++index) {
    let coord = (start + <f64>index) * frequency + offset;
    let integer = javaInt(coord);
    if (coord < <f64>integer) --integer;
    unchecked(mods[index] = integer & 255);
    coord -= <f64>integer;
    unchecked(coords[index] = coord);
    unchecked(fades[index] = coord * coord * coord * (coord * (coord * 6.0 - 15.0) + 10.0));
  }
}

export class PerlinNoise {
  private readonly permutations: StaticArray<u8> = new StaticArray<u8>(512);
  private readonly xCoord: f64;
  private readonly yCoord: f64;
  private readonly zCoord: f64;
  private xCoords: Float64Array = new Float64Array(0);
  private xMods: Int32Array = new Int32Array(0);
  private xFades: Float64Array = new Float64Array(0);
  private yCoords: Float64Array = new Float64Array(0);
  private yMods: Int32Array = new Int32Array(0);
  private yFades: Float64Array = new Float64Array(0);
  private zCoords: Float64Array = new Float64Array(0);
  private zMods: Int32Array = new Int32Array(0);
  private zFades: Float64Array = new Float64Array(0);

  constructor(random: JavaRandom) {
    this.xCoord = random.nextDouble() * 256.0;
    this.yCoord = random.nextDouble() * 256.0;
    this.zCoord = random.nextDouble() * 256.0;
    for (let i = 0; i < 256; ++i) unchecked(this.permutations[i] = <u8>i);
    for (let i = 0; i < 256; ++i) {
      const j = random.nextInt(256 - i) + i;
      const swap = unchecked(this.permutations[i]);
      unchecked(this.permutations[i] = this.permutations[j]);
      unchecked(this.permutations[j] = swap);
      unchecked(this.permutations[i + 256] = this.permutations[i]);
    }
  }

  @inline private lerp(t: f64, a: f64, b: f64): f64 { return a + t * (b - a); }

  @inline private grad2D(hash: i32, x: f64, y: f64): f64 {
    const h = hash & 15;
    const u = <f64>(1 - ((h & 8) >> 3)) * x;
    const v = h < 4 ? 0.0 : h != 12 && h != 14 ? y : x;
    return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
  }

  @inline private grad3D(hash: i32, x: f64, y: f64, z: f64): f64 {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h != 12 && h != 14 ? z : x;
    return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
  }

  private ensureCacheSizes(xSize: i32, ySize: i32, zSize: i32): void {
    if (this.xCoords.length < xSize) { this.xCoords = new Float64Array(xSize); this.xMods = new Int32Array(xSize); this.xFades = new Float64Array(xSize); }
    if (this.yCoords.length < ySize) { this.yCoords = new Float64Array(ySize); this.yMods = new Int32Array(ySize); this.yFades = new Float64Array(ySize); }
    if (this.zCoords.length < zSize) { this.zCoords = new Float64Array(zSize); this.zMods = new Int32Array(zSize); this.zFades = new Float64Array(zSize); }
  }

  generateNoise(x: f64, y: f64, z: f64 = 0.0): f64 {
    x += this.xCoord; y += this.yCoord; z += this.zCoord;
    let xInt = javaInt(x), yInt = javaInt(y), zInt = javaInt(z);
    if (x < <f64>xInt) --xInt;
    if (y < <f64>yInt) --yInt;
    if (z < <f64>zInt) --zInt;
    const xMod = xInt & 255, yMod = yInt & 255, zMod = zInt & 255;
    x -= <f64>xInt; y -= <f64>yInt; z -= <f64>zInt;
    const sx = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    const sy = y * y * y * (y * (y * 6.0 - 15.0) + 10.0);
    const sz = z * z * z * (z * (z * 6.0 - 15.0) + 10.0);
    const a = unchecked(this.permutations[xMod]) + yMod;
    const aa = unchecked(this.permutations[a]) + zMod;
    const ab = unchecked(this.permutations[a + 1]) + zMod;
    const b = unchecked(this.permutations[xMod + 1]) + yMod;
    const ba = unchecked(this.permutations[b]) + zMod;
    const bb = unchecked(this.permutations[b + 1]) + zMod;
    return this.lerp(sz,
      this.lerp(sy,
        this.lerp(sx, this.grad3D(unchecked(this.permutations[aa]), x, y, z), this.grad3D(unchecked(this.permutations[ba]), x - 1.0, y, z)),
        this.lerp(sx, this.grad3D(unchecked(this.permutations[ab]), x, y - 1.0, z), this.grad3D(unchecked(this.permutations[bb]), x - 1.0, y - 1.0, z))),
      this.lerp(sy,
        this.lerp(sx, this.grad3D(unchecked(this.permutations[aa + 1]), x, y, z - 1.0), this.grad3D(unchecked(this.permutations[ba + 1]), x - 1.0, y, z - 1.0)),
        this.lerp(sx, this.grad3D(unchecked(this.permutations[ab + 1]), x, y - 1.0, z - 1.0), this.grad3D(unchecked(this.permutations[bb + 1]), x - 1.0, y - 1.0, z - 1.0))));
  }

  sample(buffer: Float64Array, xStart: f64, yStart: f64, zStart: f64, xSize: i32, ySize: i32, zSize: i32, xFrequency: f64, yFrequency: f64, zFrequency: f64, inverseAmplitude: f64): void {
    let counter = 0;
    const amplitude = 1.0 / inverseAmplitude;
    this.ensureCacheSizes(xSize, ySize, zSize);
    fillAxisCache(this.xCoords, this.xMods, this.xFades, xStart, xSize, xFrequency, this.xCoord);
    fillAxisCache(this.zCoords, this.zMods, this.zFades, zStart, zSize, zFrequency, this.zCoord);
    if (ySize == 1) {
      for (let xi = 0; xi < xSize; ++xi) {
        const xc = unchecked(this.xCoords[xi]), xm = unchecked(this.xMods[xi]), xf = unchecked(this.xFades[xi]);
        for (let zi = 0; zi < zSize; ++zi) {
          const zc = unchecked(this.zCoords[zi]), zm = unchecked(this.zMods[zi]), zf = unchecked(this.zFades[zi]);
          const a = unchecked(this.permutations[xm]);
          const aa = unchecked(this.permutations[a]) + zm;
          const b = unchecked(this.permutations[xm + 1]);
          const ba = unchecked(this.permutations[b]) + zm;
          const x0 = this.lerp(xf, this.grad2D(unchecked(this.permutations[aa]), xc, zc), this.grad3D(unchecked(this.permutations[ba]), xc - 1.0, 0.0, zc));
          const x1 = this.lerp(xf, this.grad3D(unchecked(this.permutations[aa + 1]), xc, 0.0, zc - 1.0), this.grad3D(unchecked(this.permutations[ba + 1]), xc - 1.0, 0.0, zc - 1.0));
          unchecked(buffer[counter] += this.lerp(zf, x0, x1) * amplitude); ++counter;
        }
      }
      return;
    }
    fillAxisCache(this.yCoords, this.yMods, this.yFades, yStart, ySize, yFrequency, this.yCoord);
    let oldY = -1, x00 = 0.0, x10 = 0.0, x01 = 0.0, x11 = 0.0;
    for (let xi = 0; xi < xSize; ++xi) {
      const xc = unchecked(this.xCoords[xi]), xm = unchecked(this.xMods[xi]), xf = unchecked(this.xFades[xi]);
      for (let zi = 0; zi < zSize; ++zi) {
        const zc = unchecked(this.zCoords[zi]), zm = unchecked(this.zMods[zi]), zf = unchecked(this.zFades[zi]);
        for (let yi = 0; yi < ySize; ++yi) {
          const yc = unchecked(this.yCoords[yi]), ym = unchecked(this.yMods[yi]), yf = unchecked(this.yFades[yi]);
          if (yi == 0 || ym != oldY) {
            oldY = ym;
            const a = unchecked(this.permutations[xm]) + ym, aa = unchecked(this.permutations[a]) + zm, ab = unchecked(this.permutations[a + 1]) + zm;
            const b = unchecked(this.permutations[xm + 1]) + ym, ba = unchecked(this.permutations[b]) + zm, bb = unchecked(this.permutations[b + 1]) + zm;
            x00 = this.lerp(xf, this.grad3D(unchecked(this.permutations[aa]), xc, yc, zc), this.grad3D(unchecked(this.permutations[ba]), xc - 1.0, yc, zc));
            x10 = this.lerp(xf, this.grad3D(unchecked(this.permutations[ab]), xc, yc - 1.0, zc), this.grad3D(unchecked(this.permutations[bb]), xc - 1.0, yc - 1.0, zc));
            x01 = this.lerp(xf, this.grad3D(unchecked(this.permutations[aa + 1]), xc, yc, zc - 1.0), this.grad3D(unchecked(this.permutations[ba + 1]), xc - 1.0, yc, zc - 1.0));
            x11 = this.lerp(xf, this.grad3D(unchecked(this.permutations[ab + 1]), xc, yc - 1.0, zc - 1.0), this.grad3D(unchecked(this.permutations[bb + 1]), xc - 1.0, yc - 1.0, zc - 1.0));
          }
          unchecked(buffer[counter] += this.lerp(zf, this.lerp(yf, x00, x10), this.lerp(yf, x01, x11)) * amplitude); ++counter;
        }
      }
    }
  }
}
