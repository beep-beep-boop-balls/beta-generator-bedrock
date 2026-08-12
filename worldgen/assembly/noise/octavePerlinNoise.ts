import { JavaRandom } from "../utils/random";
import { PerlinNoise } from "./perlinNoise";

export class OctavePerlinNoise {
  private readonly octaves: Array<PerlinNoise>;

  constructor(random: JavaRandom, octaveCount: i32) {
    this.octaves = new Array<PerlinNoise>(octaveCount);
    for (let i = 0; i < octaveCount; ++i) this.octaves[i] = new PerlinNoise(random);
  }

  generateNoise(x: f64, y: f64): f64 {
    let value = 0.0, amplitude = 1.0;
    for (let i = 0, count = this.octaves.length; i < count; ++i) {
      value += unchecked(this.octaves[i]).generateNoise(x * amplitude, y * amplitude) / amplitude;
      amplitude /= 2.0;
    }
    return value;
  }

  create(buffer: Float64Array | null, xStart: f64, yStart: f64, zStart: f64, xSize: i32, ySize: i32, zSize: i32, xFrequency: f64, yFrequency: f64, zFrequency: f64): Float64Array {
    const size = xSize * ySize * zSize;
    if (buffer == null || buffer.length < size) buffer = new Float64Array(size);
    else buffer.fill(0.0);
    let multiplier = 1.0;
    for (let i = 0, count = this.octaves.length; i < count; ++i) {
      unchecked(this.octaves[i]).sample(buffer, xStart, yStart, zStart, xSize, ySize, zSize, xFrequency * multiplier, yFrequency * multiplier, zFrequency * multiplier, multiplier);
      multiplier /= 2.0;
    }
    return buffer;
  }

  create2D(buffer: Float64Array | null, xStart: f64, zStart: f64, xSize: i32, zSize: i32, xFrequency: f64, zFrequency: f64): Float64Array {
    return this.create(buffer, xStart, 10.0, zStart, xSize, 1, zSize, xFrequency, 1.0, zFrequency);
  }
}
