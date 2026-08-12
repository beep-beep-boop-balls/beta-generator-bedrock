import { JavaRandom } from "../utils/random";
import { SimplexNoise } from "./simplexNoise";

export class OctaveSimplexNoise {
  private readonly octaves: Array<SimplexNoise>;

  constructor(random: JavaRandom, octaveCount: i32) {
    this.octaves = new Array<SimplexNoise>(octaveCount);
    for (let i = 0; i < octaveCount; ++i) this.octaves[i] = new SimplexNoise(random);
  }

  sample(buffer: Float64Array | null, x: f64, z: f64, width: i32, depth: i32, xFrequency: f64, zFrequency: f64, frequencyScaler: f64, amplitudeScaler: f64 = 0.5): Float64Array {
    xFrequency /= 1.5;
    zFrequency /= 1.5;
    const size = width * depth;
    if (buffer == null || buffer.length < size) buffer = new Float64Array(size);
    else buffer.fill(0.0);
    let amplitudeDivisor = 1.0;
    let frequencyMultiplier = 1.0;
    for (let i = 0, count = this.octaves.length; i < count; ++i) {
      unchecked(this.octaves[i]).sample(buffer, x, z, width, depth, xFrequency * frequencyMultiplier, zFrequency * frequencyMultiplier, 0.55 / amplitudeDivisor);
      frequencyMultiplier *= frequencyScaler;
      amplitudeDivisor *= amplitudeScaler;
    }
    return buffer;
  }
}
