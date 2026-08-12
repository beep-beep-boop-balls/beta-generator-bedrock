import { BiomeId } from "../biomes";
import { BlockId } from "../blocks";
import { CaveCarver } from "../carvers/caveCarver";
import { Chunk } from "../chunk";
import { DungeonFeature } from "../features/dungeonFeature";
import { Feature, PlantPatchFeature, PumpkinPatchFeature, SpringFeature, SugarCanePatchFeature } from "../features/features";
import { Generator } from "./generator";
import { LakeFeature } from "../features/lakeFeature";
import { LargeOakTreeFeature } from "../features/largeOakTreeFeature";
import { javaInt } from "../utils/math";
import { OctavePerlinNoise } from "../noise/octavePerlinNoise";
import { ClayOreFeature, OreFeature } from "../features/oreFeatures";
import { JavaRandom } from "../utils/random";
import { OakTreeFeature } from "../features/treeFeatures";
import { World } from "../world";

export class SkyGenerator extends Generator {
  private readonly random: JavaRandom; private readonly carver: CaveCarver;
  private readonly minLimit: OctavePerlinNoise; private readonly maxLimit: OctavePerlinNoise; private readonly selector: OctavePerlinNoise; private readonly surfaceDepth: OctavePerlinNoise; private readonly islandScale: OctavePerlinNoise; private readonly islandNoise: OctavePerlinNoise; private readonly forestNoise: OctavePerlinNoise;
  private heightMap: Float64Array | null = null; private surfaceBuffer: Float64Array | null = new Float64Array(256); private scaleBuffer: Float64Array | null = null; private depthBuffer: Float64Array | null = null; private selectorBuffer: Float64Array | null = null; private lowBuffer: Float64Array | null = null; private highBuffer: Float64Array | null = null;

  constructor(private readonly seed: i64) {
    super(); const random = new JavaRandom(seed); this.random = random;
    this.minLimit = new OctavePerlinNoise(random, 16); this.maxLimit = new OctavePerlinNoise(random, 16); this.selector = new OctavePerlinNoise(random, 8);
    new OctavePerlinNoise(random, 4); this.surfaceDepth = new OctavePerlinNoise(random, 4); this.islandScale = new OctavePerlinNoise(random, 10); this.islandNoise = new OctavePerlinNoise(random, 16); this.forestNoise = new OctavePerlinNoise(random, 8); this.carver = new CaveCarver(seed);
  }

  createRawChunk(world: World, chunkX: i32, chunkZ: i32): Chunk {
    this.random.setSeed(<i64>chunkX * 341873128712 + <i64>chunkZ * 132897987541); const chunk = new Chunk(chunkX, chunkZ); this.buildTerrain(chunkX, chunkZ, chunk.blocks); this.buildSurfaces(chunkX, chunkZ, chunk.blocks); if (world.carversEnabled) this.carver.carve(chunkX, chunkZ, chunk); for (let i = 0; i < 256; ++i) unchecked(chunk.biomes[i] = <u8>BiomeId.SKY); chunk.buildHeightMap(); return chunk;
  }

  getBiomesInArea(x: i32, z: i32, width: i32, depth: i32): Uint8Array { const result = new Uint8Array(width * depth); result.fill(<u8>BiomeId.SKY); return result; }
  getTemperatures(buffer: Float64Array | null, x: i32, z: i32, width: i32, depth: i32): Float64Array { if (buffer == null || changetype<Float64Array>(buffer).length < width * depth) buffer = new Float64Array(width * depth); changetype<Float64Array>(buffer).fill(0.5, 0, width * depth); return changetype<Float64Array>(buffer); }

  private buildTerrain(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>): void {
    const x = chunkX * 2, z = chunkZ * 2;
    this.scaleBuffer = this.islandScale.create2D(this.scaleBuffer, x, z, 3, 3, 1.121, 1.121); this.depthBuffer = this.islandNoise.create2D(this.depthBuffer, x, z, 3, 3, 200, 200);
    this.selectorBuffer = this.selector.create(this.selectorBuffer, x, 0, z, 3, 33, 3, 1368.824 / 80.0, 684.412 / 160.0, 1368.824 / 80.0); this.lowBuffer = this.minLimit.create(this.lowBuffer, x, 0, z, 3, 33, 3, 1368.824, 684.412, 1368.824); this.highBuffer = this.maxLimit.create(this.highBuffer, x, 0, z, 3, 33, 3, 1368.824, 684.412, 1368.824);
    if (this.heightMap == null) this.heightMap = new Float64Array(297); const map = changetype<Float64Array>(this.heightMap), low = changetype<Float64Array>(this.lowBuffer), high = changetype<Float64Array>(this.highBuffer), select = changetype<Float64Array>(this.selectorBuffer);
    let p: i32 = 0; for (let sx: i32 = 0; sx < 3; ++sx) for (let sz: i32 = 0; sz < 3; ++sz) for (let sy: i32 = 0; sy < 33; ++sy) { const a = unchecked(low[p]) / 512.0, b = unchecked(high[p]) / 512.0, t = (unchecked(select[p]) / 10.0 + 1.0) / 2.0; let d = (t < 0 ? a : t > 1 ? b : a + (b - a) * t) - 8.0; if (sy > 1) { const fade: f64 = <f64><f32>(sy - 1) / <f64><f32>3.1e1; d = d * (1.0 - fade) - 30.0 * fade; } if (sy < 8) { const fade: f64 = <f64><f32>(8.0 - <f32>sy) / <f64><f32>7.0; d = d * (1.0 - fade) - 30.0 * fade; } unchecked(map[p++] = d); }
    for (let sx = 0; sx < 2; ++sx) for (let sz = 0; sz < 2; ++sz) for (let sy = 0; sy < 32; ++sy) { let c00 = unchecked(map[(sx * 3 + sz) * 33 + sy]), c01 = unchecked(map[(sx * 3 + sz + 1) * 33 + sy]), c10 = unchecked(map[((sx + 1) * 3 + sz) * 33 + sy]), c11 = unchecked(map[((sx + 1) * 3 + sz + 1) * 33 + sy]); const dy00 = (unchecked(map[(sx * 3 + sz) * 33 + sy + 1]) - c00) * .25, dy01 = (unchecked(map[(sx * 3 + sz + 1) * 33 + sy + 1]) - c01) * .25, dy10 = (unchecked(map[((sx + 1) * 3 + sz) * 33 + sy + 1]) - c10) * .25, dy11 = (unchecked(map[((sx + 1) * 3 + sz + 1) * 33 + sy + 1]) - c11) * .25;
      for (let yy = 0; yy < 4; ++yy) { let x0 = c00, x1 = c01; const dx0 = (c10 - c00) * .125, dx1 = (c11 - c01) * .125; for (let xx = 0; xx < 8; ++xx) { let index = ((sx * 8 + xx) << 11) | (sz * 8 << 7) | (sy * 4 + yy), d = x0; const dz = (x1 - x0) * .125; for (let zz = 0; zz < 8; ++zz) { unchecked(blocks[index] = d > 0 ? <u8>BlockId.STONE : <u8>BlockId.AIR); index += 128; d += dz; } x0 += dx0; x1 += dx1; } c00 += dy00; c01 += dy01; c10 += dy10; c11 += dy11; }
    }
  }

  private buildSurfaces(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>): void {
    this.surfaceBuffer = this.surfaceDepth.create(this.surfaceBuffer, chunkX * 16, chunkZ * 16, 0, 16, 16, 1, 1.0 / 16.0, 1.0 / 16.0, 1.0 / 16.0); const depth = changetype<Float64Array>(this.surfaceBuffer);
    for (let x = 0; x < 16; ++x) for (let z = 0; z < 16; ++z) { const thickness = javaInt(unchecked(depth[x + z * 16]) / 3 + 3 + this.random.nextDouble() * .25); let remaining = -1, top: u8 = <u8>BlockId.GRASS_BLOCK, soil: u8 = <u8>BlockId.DIRT; for (let y = 127; y >= 0; --y) { const p = (z * 16 + x) * 128 + y, id = unchecked(blocks[p]); if (id == BlockId.AIR) remaining = -1; else if (id == BlockId.STONE) { if (remaining == -1) { if (thickness <= 0) { top = <u8>BlockId.AIR; soil = <u8>BlockId.STONE; } remaining = thickness; unchecked(blocks[p] = top); } else if (remaining > 0) { --remaining; unchecked(blocks[p] = soil); } } } }
  }

  decorateTerrain(world: World, chunkX: i32, chunkZ: i32): void {
    world.getChunk(chunkX, chunkZ); world.getChunk(chunkX + 1, chunkZ); world.getChunk(chunkX, chunkZ + 1); world.getChunk(chunkX + 1, chunkZ + 1);
    const bx = chunkX * 16, bz = chunkZ * 16; this.random.setSeed(this.seed); const xo = (this.random.nextLong() / 2) * 2 + 1, zo = (this.random.nextLong() / 2) * 2 + 1; this.random.setSeed((<i64>chunkX * xo + <i64>chunkZ * zo) ^ this.seed);
    if (this.random.nextInt(4) == 0) this.place(world, bx, bz, 0, new LakeFeature(BlockId.WATER), true);
    if (this.random.nextInt(8) == 0) { const x = bx + this.random.nextInt(16) + 8, y = this.random.nextInt(this.random.nextInt(120) + 8), z = bz + this.random.nextInt(16) + 8; if (y < 64 || this.random.nextInt(10) == 0) new LakeFeature(BlockId.LAVA).generate(world, this.random, x, y, z); }
    this.placeMany(world, bx, bz, 8, 0, new DungeonFeature(), true);
    this.oreMany(world, bx, bz, 10, 0, new ClayOreFeature(32)); this.oreMany(world, bx, bz, 20, 0, new OreFeature(BlockId.DIRT, 32)); this.oreMany(world, bx, bz, 10, 0, new OreFeature(BlockId.GRAVEL, 32)); this.oreMany(world, bx, bz, 20, 0, new OreFeature(BlockId.COAL_ORE, 16)); this.oreMany(world, bx, bz, 20, 1, new OreFeature(BlockId.IRON_ORE, 8)); this.oreMany(world, bx, bz, 2, 2, new OreFeature(BlockId.GOLD_ORE, 8)); this.oreMany(world, bx, bz, 8, 3, new OreFeature(BlockId.REDSTONE_ORE, 7)); this.oreMany(world, bx, bz, 1, 3, new OreFeature(BlockId.DIAMOND_ORE, 7)); this.oreMany(world, bx, bz, 1, 4, new OreFeature(BlockId.LAPIS_ORE, 6));
    javaInt((this.forestNoise.generateNoise(<f64>bx * .5, <f64>bz * .5) / 8 + this.random.nextDouble() * 4 + 4) / 3);
    const trees = this.random.nextInt(10) == 0 ? 1 : 0; for (let i = 0; i < trees; ++i) { const x = bx + this.random.nextInt(16) + 8, z = bz + this.random.nextInt(16) + 8; let tree: Feature; if (this.random.nextInt(10) == 0) { const large = new LargeOakTreeFeature(); large.prepare(1, 1, 1); tree = large; } else tree = new OakTreeFeature(); tree.generate(world, this.random, x, world.getHeight(x, z), z); }
    this.placeMany(world, bx, bz, 2, 0, new PlantPatchFeature(BlockId.DANDELION), true);
    if (this.random.nextInt(2) == 0) this.place(world, bx, bz, 0, new PlantPatchFeature(BlockId.POPPY), true); if (this.random.nextInt(4) == 0) this.place(world, bx, bz, 0, new PlantPatchFeature(BlockId.BROWN_MUSHROOM), true); if (this.random.nextInt(8) == 0) this.place(world, bx, bz, 0, new PlantPatchFeature(BlockId.RED_MUSHROOM), true);
    this.placeMany(world, bx, bz, 10, 0, new SugarCanePatchFeature(), true); if (this.random.nextInt(32) == 0) this.place(world, bx, bz, 0, new PumpkinPatchFeature(), true);
    this.placeMany(world, bx, bz, 50, 5, new SpringFeature(BlockId.FLOWING_WATER), true); this.placeMany(world, bx, bz, 20, 6, new SpringFeature(BlockId.FLOWING_LAVA), true);
    for (let x = bx + 8; x < bx + 24; ++x) for (let z = bz + 8; z < bz + 24; ++z) { const top = world.getTopSolidOrLiquidBlock(x, z), temperature = .5 - (<f64>(top - 64) / 64.0) * .3; if (temperature < .5 && top > 0 && top < 128 && world.isAir(x, top, z) && world.isSolid(x, top - 1, z) && world.getBlock(x, top - 1, z) != BlockId.ICE) world.setBlock(x, top, z, <u8>BlockId.SNOW_LAYER); }
  }

  private randomY(mode: i32): i32 { if (mode == 0) return this.random.nextInt(128); if (mode == 1) return this.random.nextInt(64); if (mode == 2) return this.random.nextInt(32); if (mode == 3) return this.random.nextInt(16); if (mode == 4) return this.random.nextInt(16) + this.random.nextInt(16); if (mode == 5) return this.random.nextInt(this.random.nextInt(120) + 8); return this.random.nextInt(this.random.nextInt(this.random.nextInt(112) + 8) + 8); }
  private place(world: World, bx: i32, bz: i32, mode: i32, feature: Feature, plusEight: bool): void { const add = plusEight ? 8 : 0, x = bx + this.random.nextInt(16) + add, y = this.randomY(mode), z = bz + this.random.nextInt(16) + add; feature.generate(world, this.random, x, y, z); }
  private placeMany(world: World, bx: i32, bz: i32, count: i32, mode: i32, feature: Feature, plusEight: bool): void { for (let i = 0; i < count; ++i) this.place(world, bx, bz, mode, feature, plusEight); }
  private oreMany(world: World, bx: i32, bz: i32, count: i32, mode: i32, feature: Feature): void { this.placeMany(world, bx, bz, count, mode, feature, false); }
}
