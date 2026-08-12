import { BiomeId } from "../biomes";
import { BlockId } from "../blocks";
import { CaveCarver } from "../carvers/caveCarver";
import { Chunk } from "../chunk";
import { Feature, GlowstoneClusterFeature, NetherFirePatchFeature, NetherLavaSpringFeature, PlantPatchFeature } from "../features/features";
import { Generator } from "./generator";
import { javaInt } from "../utils/math";
import { OctavePerlinNoise } from "../noise/octavePerlinNoise";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

const HEIGHT_MODIFIERS = new StaticArray<f64>(17);
for (let y = 0; y < 17; ++y) { unchecked(HEIGHT_MODIFIERS[y] = Math.cos(<f64>y * Math.PI * 6.0 / 17.0) * 2.0); let edge = y > 8.5 ? 16 - y : y; if (edge < 4) { edge = 4 - edge; unchecked(HEIGHT_MODIFIERS[y] -= <f64>(edge * edge * edge * 10)); } }

export class HellGenerator extends Generator {
  private readonly random: JavaRandom;
  private readonly carver: CaveCarver;
  private readonly minLimit: OctavePerlinNoise; private readonly maxLimit: OctavePerlinNoise; private readonly selector: OctavePerlinNoise;
  private readonly sandGravel: OctavePerlinNoise; private readonly surfaceDepth: OctavePerlinNoise; private readonly scale: OctavePerlinNoise; private readonly depth: OctavePerlinNoise;
  private heightMap: Float64Array | null = null; private soulBuffer: Float64Array | null = new Float64Array(256); private gravelBuffer: Float64Array | null = new Float64Array(256); private surfaceBuffer: Float64Array | null = new Float64Array(256);
  private selectorBuffer: Float64Array | null = null; private lowBuffer: Float64Array | null = null; private highBuffer: Float64Array | null = null; private scaleBuffer: Float64Array | null = null; private depthBuffer: Float64Array | null = null;

  constructor(private readonly seed: i64) {
    super(); const random = new JavaRandom(seed); this.random = random;
    this.minLimit = new OctavePerlinNoise(random, 16); this.maxLimit = new OctavePerlinNoise(random, 16); this.selector = new OctavePerlinNoise(random, 8);
    this.sandGravel = new OctavePerlinNoise(random, 4); this.surfaceDepth = new OctavePerlinNoise(random, 4); this.scale = new OctavePerlinNoise(random, 10); this.depth = new OctavePerlinNoise(random, 16);
    this.carver = new CaveCarver(seed, true);
  }

  createRawChunk(world: World, chunkX: i32, chunkZ: i32): Chunk {
    this.random.setSeed(<i64>chunkX * 341873128712 + <i64>chunkZ * 132897987541);
    const chunk = new Chunk(chunkX, chunkZ); this.buildTerrain(chunkX, chunkZ, chunk.blocks); this.buildSurfaces(chunkX, chunkZ, chunk.blocks); if (world.carversEnabled) this.carver.carve(chunkX, chunkZ, chunk);
    for (let i = 0; i < 256; ++i) unchecked(chunk.biomes[i] = <u8>BiomeId.HELL); chunk.buildHeightMap(); return chunk;
  }

  getBiomesInArea(x: i32, z: i32, width: i32, depth: i32): Uint8Array { const result = new Uint8Array(width * depth); result.fill(<u8>BiomeId.HELL); return result; }
  getTemperatures(buffer: Float64Array | null, x: i32, z: i32, width: i32, depth: i32): Float64Array { if (buffer == null || changetype<Float64Array>(buffer).length < width * depth) buffer = new Float64Array(width * depth); changetype<Float64Array>(buffer).fill(1.0, 0, width * depth); return changetype<Float64Array>(buffer); }

  private buildTerrain(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>): void {
    const x = chunkX * 4, z = chunkZ * 4;
    this.scaleBuffer = this.scale.create(this.scaleBuffer, x, 0, z, 5, 1, 5, 1, 0, 1); this.depthBuffer = this.depth.create(this.depthBuffer, x, 0, z, 5, 1, 5, 100, 0, 100);
    this.selectorBuffer = this.selector.create(this.selectorBuffer, x, 0, z, 5, 17, 5, 684.412 / 80.0, 2053.236 / 60.0, 684.412 / 80.0);
    this.lowBuffer = this.minLimit.create(this.lowBuffer, x, 0, z, 5, 17, 5, 684.412, 2053.236, 684.412); this.highBuffer = this.maxLimit.create(this.highBuffer, x, 0, z, 5, 17, 5, 684.412, 2053.236, 684.412);
    if (this.heightMap == null) this.heightMap = new Float64Array(425); const map = changetype<Float64Array>(this.heightMap), low = changetype<Float64Array>(this.lowBuffer), high = changetype<Float64Array>(this.highBuffer), select = changetype<Float64Array>(this.selectorBuffer);
    let index = 0; for (let sx = 0; sx < 5; ++sx) for (let sz = 0; sz < 5; ++sz) for (let sy = 0; sy < 17; ++sy) { const a = unchecked(low[index]) / 512.0, b = unchecked(high[index]) / 512.0, t = (unchecked(select[index]) / 10.0 + 1.0) / 2.0; let density = (t < 0 ? a : t > 1 ? b : a + (b - a) * t) - unchecked(HEIGHT_MODIFIERS[sy]); if (sy > 13) { const fade = <f64>(<f32>(sy - 13) / <f32>3); density = density * (1.0 - fade) - 10.0 * fade; } unchecked(map[index++] = density); }
    for (let sx = 0; sx < 4; ++sx) for (let sz = 0; sz < 4; ++sz) for (let sy = 0; sy < 16; ++sy) {
      let c00 = unchecked(map[(sx * 5 + sz) * 17 + sy]), c01 = unchecked(map[(sx * 5 + sz + 1) * 17 + sy]), c10 = unchecked(map[((sx + 1) * 5 + sz) * 17 + sy]), c11 = unchecked(map[((sx + 1) * 5 + sz + 1) * 17 + sy]);
      const dy00 = (unchecked(map[(sx * 5 + sz) * 17 + sy + 1]) - c00) * .125, dy01 = (unchecked(map[(sx * 5 + sz + 1) * 17 + sy + 1]) - c01) * .125, dy10 = (unchecked(map[((sx + 1) * 5 + sz) * 17 + sy + 1]) - c10) * .125, dy11 = (unchecked(map[((sx + 1) * 5 + sz + 1) * 17 + sy + 1]) - c11) * .125;
      for (let yy = 0; yy < 8; ++yy) { let x0 = c00, x1 = c01; const dx0 = (c10 - c00) * .25, dx1 = (c11 - c01) * .25; for (let xx = 0; xx < 4; ++xx) { let p = ((sx * 4 + xx) << 11) | (sz * 4 << 7) | (sy * 8 + yy), density = x0; const dz = (x1 - x0) * .25; for (let zz = 0; zz < 4; ++zz) { const by = sy * 8 + yy; unchecked(blocks[p] = density > 0 ? <u8>BlockId.NETHERRACK : by < 32 ? <u8>BlockId.LAVA : <u8>BlockId.AIR); p += 128; density += dz; } x0 += dx0; x1 += dx1; } c00 += dy00; c01 += dy01; c10 += dy10; c11 += dy11; }
    }
  }

  private buildSurfaces(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>): void {
    const bx = chunkX * 16, bz = chunkZ * 16;
    this.soulBuffer = this.sandGravel.create(this.soulBuffer, bx, bz, 0, 16, 16, 1, 1.0 / 32.0, 1.0 / 32.0, 1); this.gravelBuffer = this.sandGravel.create(this.gravelBuffer, bx, 109.0134, bz, 16, 1, 16, 1.0 / 32.0, 1, 1.0 / 32.0); this.surfaceBuffer = this.surfaceDepth.create(this.surfaceBuffer, bx, bz, 0, 16, 16, 1, 1.0 / 16.0, 1.0 / 16.0, 1.0 / 16.0);
    const soul = changetype<Float64Array>(this.soulBuffer), gravel = changetype<Float64Array>(this.gravelBuffer), depth = changetype<Float64Array>(this.surfaceBuffer);
    for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) { const col = x + z * 16, useSoul = unchecked(soul[col]) + this.random.nextDouble() * .2 > 0, useGravel = unchecked(gravel[col]) + this.random.nextDouble() * .2 > 0, thickness = javaInt(unchecked(depth[col]) / 3 + 3 + this.random.nextDouble() * .25); let remaining = -1, top: u8 = <u8>BlockId.NETHERRACK, soil: u8 = <u8>BlockId.NETHERRACK;
      for (let y = 127; y >= 0; --y) { const p = (z * 16 + x) * 128 + y; if (y >= 127 - this.random.nextInt(5) || y <= this.random.nextInt(5)) { unchecked(blocks[p] = <u8>BlockId.BEDROCK); continue; } const id = unchecked(blocks[p]); if (id == BlockId.AIR) remaining = -1; else if (id == BlockId.NETHERRACK) { if (remaining == -1) { if (thickness <= 0) { top = <u8>BlockId.AIR; soil = <u8>BlockId.NETHERRACK; } else if (y >= 60 && y <= 65) { top = useGravel ? <u8>BlockId.GRAVEL : <u8>BlockId.NETHERRACK; soil = <u8>BlockId.NETHERRACK; if (useSoul) top = soil = <u8>BlockId.SOUL_SAND; } if (y < 64 && top == BlockId.AIR) top = <u8>BlockId.LAVA; remaining = thickness; unchecked(blocks[p] = y >= 63 ? top : soil); } else if (remaining > 0) { --remaining; unchecked(blocks[p] = soil); } } }
    }
  }

  decorateTerrain(world: World, chunkX: i32, chunkZ: i32): void {
    world.getChunk(chunkX, chunkZ); world.getChunk(chunkX + 1, chunkZ); world.getChunk(chunkX, chunkZ + 1); world.getChunk(chunkX + 1, chunkZ + 1); this.restoreRandom(chunkX, chunkZ);
    const bx = chunkX * 16, bz = chunkZ * 16, lava = new NetherLavaSpringFeature(BlockId.FLOWING_LAVA), fire = new NetherFirePatchFeature(), glow = new GlowstoneClusterFeature();
    for (let i = 0; i < 8; ++i) this.place(world, bx, bz, 120, 4, lava);
    let count = this.random.nextInt(this.random.nextInt(10) + 1) + 1; for (let i = 0; i < count; ++i) this.place(world, bx, bz, 120, 4, fire);
    count = this.random.nextInt(this.random.nextInt(10) + 1); for (let i = 0; i < count; ++i) this.place(world, bx, bz, 120, 4, glow);
    for (let i = 0; i < 10; ++i) this.place(world, bx, bz, 128, 0, glow);
    this.random.nextInt(1); this.place(world, bx, bz, 128, 0, new PlantPatchFeature(BlockId.BROWN_MUSHROOM));
    this.random.nextInt(1); this.place(world, bx, bz, 128, 0, new PlantPatchFeature(BlockId.RED_MUSHROOM));
  }
  private place(world: World, bx: i32, bz: i32, yBound: i32, yOffset: i32, feature: Feature): void { const x = bx + this.random.nextInt(16) + 8, y = this.random.nextInt(yBound) + yOffset, z = bz + this.random.nextInt(16) + 8; feature.generate(world, this.random, x, y, z); }
  private restoreRandom(chunkX: i32, chunkZ: i32): void { this.random.setSeed(<i64>chunkX * 341873128712 + <i64>chunkZ * 132897987541); for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) { this.random.nextDouble(); this.random.nextDouble(); this.random.nextDouble(); for (let y = 127; y >= 0; --y) if (y < 127 - this.random.nextInt(5)) this.random.nextInt(5); } }
}
