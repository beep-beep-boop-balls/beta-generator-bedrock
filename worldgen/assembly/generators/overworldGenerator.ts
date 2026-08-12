import { BiomeId, getBiomeId, soilBlockId, topBlockId } from "../biomes";
import { BlockId } from "../blocks";
import { Chunk } from "../chunk";
import { CaveCarver } from "../carvers/caveCarver";
import { Generator } from "./generator";
import { CactusPatchFeature, DeadBushPatchFeature, Feature, GrassPatchFeature, PlantPatchFeature, PumpkinPatchFeature, SpringFeature, SugarCanePatchFeature } from "../features/features";
import { DungeonFeature } from "../features/dungeonFeature";
import { LakeFeature } from "../features/lakeFeature";
import { LargeOakTreeFeature } from "../features/largeOakTreeFeature";
import { javaInt } from "../utils/math";
import { OctavePerlinNoise } from "../noise/octavePerlinNoise";
import { OctaveSimplexNoise } from "../noise/octaveSimplexNoise";
import { ClayOreFeature, OreFeature } from "../features/oreFeatures";
import { JavaRandom } from "../utils/random";
import { BirchTreeFeature, OakTreeFeature, PineTreeFeature, SpruceTreeFeature } from "../features/treeFeatures";
import { World } from "../world";

const TEMPERATURE_FREQUENCY: f64 = <f64><f32>0.025;
const DOWNFALL_FREQUENCY: f64 = <f64><f32>0.05;

export class OverworldGenerator extends Generator {
  private readonly seed: i64;
  private readonly random: JavaRandom;
  private readonly carver: CaveCarver;
  private readonly minLimit: OctavePerlinNoise;
  private readonly maxLimit: OctavePerlinNoise;
  private readonly selector: OctavePerlinNoise;
  private readonly sandGravel: OctavePerlinNoise;
  private readonly depth: OctavePerlinNoise;
  private readonly islandScale: OctavePerlinNoise;
  private readonly islandNoise: OctavePerlinNoise;
  private readonly forestNoise: OctavePerlinNoise;
  private readonly temperatureSampler: OctaveSimplexNoise;
  private readonly downfallSampler: OctaveSimplexNoise;
  private readonly weirdnessSampler: OctaveSimplexNoise;
  private biomes: Uint8Array | null = null;
  private temperatureMap: Float64Array | null = null;
  private downfallMap: Float64Array | null = null;
  private weirdnessMap: Float64Array | null = null;
  private heightMap: Float64Array | null = null;
  private sandBuffer: Float64Array | null = new Float64Array(256);
  private gravelBuffer: Float64Array | null = new Float64Array(256);
  private depthBuffer: Float64Array | null = new Float64Array(256);
  private scaleNoiseBuffer: Float64Array | null = null;
  private depthNoiseBuffer: Float64Array | null = null;
  private selectorBuffer: Float64Array | null = null;
  private lowBuffer: Float64Array | null = null;
  private highBuffer: Float64Array | null = null;

  constructor(seed: i64) {
    super();
    this.seed = seed;
    const random = new JavaRandom(seed);
    this.random = random;
    this.minLimit = new OctavePerlinNoise(random, 16);
    this.maxLimit = new OctavePerlinNoise(random, 16);
    this.selector = new OctavePerlinNoise(random, 8);
    this.sandGravel = new OctavePerlinNoise(random, 4);
    this.depth = new OctavePerlinNoise(random, 4);
    this.islandScale = new OctavePerlinNoise(random, 10);
    this.islandNoise = new OctavePerlinNoise(random, 16);
    this.forestNoise = new OctavePerlinNoise(random, 8);
    this.temperatureSampler = new OctaveSimplexNoise(new JavaRandom(seed * 9871), 4);
    this.downfallSampler = new OctaveSimplexNoise(new JavaRandom(seed * 39811), 4);
    this.weirdnessSampler = new OctaveSimplexNoise(new JavaRandom(seed * 543321), 2);
    this.carver = new CaveCarver(seed);
  }

  createRawChunk(world: World, chunkX: i32, chunkZ: i32): Chunk {
    this.random.setSeed(<i64>chunkX * 341873128712 + <i64>chunkZ * 132897987541);
    const chunk = new Chunk(chunkX, chunkZ);
    const biomes = this.getBiomesInArea(chunkX * 16, chunkZ * 16, 16, 16);
    this.buildTerrain(chunkX, chunkZ, chunk.blocks, changetype<Float64Array>(this.temperatureMap));
    this.buildSurfaces(chunkX, chunkZ, chunk.blocks, biomes);
    if (world.carversEnabled) this.carver.carve(chunkX, chunkZ, chunk);
    for (let i = 0; i < 256; ++i) unchecked(chunk.biomes[i] = biomes[i]);
    chunk.buildHeightMap();
    return chunk;
  }

  decorateTerrain(world: World, chunkX: i32, chunkZ: i32): void {
    world.getChunk(chunkX, chunkZ); world.getChunk(chunkX + 1, chunkZ); world.getChunk(chunkX, chunkZ + 1); world.getChunk(chunkX + 1, chunkZ + 1);
    const blockX = chunkX * 16, blockZ = chunkZ * 16;
    const biome = unchecked(this.getBiomesInArea(blockX + 16, blockZ + 16, 1, 1)[0]);
    this.random.setSeed(this.seed);
    const xOffset = (this.random.nextLong() / 2) * 2 + 1, zOffset = (this.random.nextLong() / 2) * 2 + 1;
    this.random.setSeed((<i64>chunkX * xOffset + <i64>chunkZ * zOffset) ^ this.seed);
    const waterLake = new LakeFeature(BlockId.WATER), lavaLake = new LakeFeature(BlockId.LAVA);
    const dungeon = new DungeonFeature(), clay = new ClayOreFeature(32);
    let fx: i32, fy: i32, fz: i32;
    if (this.random.nextInt(4) == 0) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16) + 8; waterLake.generate(world, this.random, fx, fy, fz); }
    if (this.random.nextInt(8) == 0) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(this.random.nextInt(120) + 8); fz = blockZ + this.random.nextInt(16) + 8; if (fy < 64 || this.random.nextInt(10) == 0) lavaLake.generate(world, this.random, fx, fy, fz); }
    for (let i = 0; i < 8; ++i) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16) + 8; dungeon.generate(world, this.random, fx, fy, fz); }
    for (let i = 0; i < 10; ++i) { fx = blockX + this.random.nextInt(16); fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16); clay.generate(world, this.random, fx, fy, fz); }
    this.generateOre(world, new OreFeature(BlockId.DIRT, 32), 20, 128, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.GRAVEL, 32), 10, 128, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.COAL_ORE, 16), 20, 128, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.IRON_ORE, 8), 20, 64, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.GOLD_ORE, 8), 2, 32, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.REDSTONE_ORE, 7), 8, 16, blockX, blockZ);
    this.generateOre(world, new OreFeature(BlockId.DIAMOND_ORE, 7), 1, 16, blockX, blockZ);
    const lapis = new OreFeature(BlockId.LAPIS_ORE, 6);
    fx = blockX + this.random.nextInt(16); fy = this.random.nextInt(16) + this.random.nextInt(16); fz = blockZ + this.random.nextInt(16); lapis.generate(world, this.random, fx, fy, fz);
    const treeSample = javaInt((this.forestNoise.generateNoise(<f64>blockX * 0.5, <f64>blockZ * 0.5) / 8.0 + this.random.nextDouble() * 4.0 + 4.0) / 3.0);
    let treeCount = this.random.nextInt(10) == 0 ? 1 : 0;
    if (biome == BiomeId.FOREST || biome == BiomeId.RAINFOREST || biome == BiomeId.TAIGA) treeCount += treeSample + 5;
    if (biome == BiomeId.SEASONAL_FOREST) treeCount += treeSample + 2;
    if (biome == BiomeId.DESERT || biome == BiomeId.TUNDRA || biome == BiomeId.PLAINS) treeCount -= 20;
    for (let i = 0; i < treeCount; ++i) {
      fx = blockX + this.random.nextInt(16) + 8; fz = blockZ + this.random.nextInt(16) + 8;
      this.getTreeFeature(biome).generate(world, this.random, fx, world.getHeight(fx, fz), fz);
    }
    let flowers = biome == BiomeId.SEASONAL_FOREST ? 4 : biome == BiomeId.PLAINS ? 3 : biome == BiomeId.FOREST || biome == BiomeId.TAIGA ? 2 : 0;
    const dandelion = new PlantPatchFeature(BlockId.DANDELION);
    for (let i = 0; i < flowers; ++i) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16) + 8; dandelion.generate(world, this.random, fx, fy, fz); }
    let grasses = biome == BiomeId.RAINFOREST || biome == BiomeId.PLAINS ? 10 : biome == BiomeId.FOREST || biome == BiomeId.SEASONAL_FOREST ? 2 : biome == BiomeId.TAIGA ? 1 : 0;
    const grass = new GrassPatchFeature(BlockId.SHORT_GRASS, 1), fern = new GrassPatchFeature(BlockId.SHORT_GRASS, 2);
    for (let i = 0; i < grasses; ++i) { const useFern = biome == BiomeId.RAINFOREST && this.random.nextInt(3) != 0; fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16) + 8; (useFern ? fern : grass).generate(world, this.random, fx, fy, fz); }
    if (biome == BiomeId.DESERT) { const dead = new DeadBushPatchFeature(BlockId.DEADBUSH); for (let i = 0; i < 2; ++i) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(128); fz = blockZ + this.random.nextInt(16) + 8; dead.generate(world, this.random, fx, fy, fz); } }
    if (this.random.nextInt(2) == 0) this.generatePlant(world, new PlantPatchFeature(BlockId.POPPY), blockX, blockZ);
    if (this.random.nextInt(4) == 0) this.generatePlant(world, new PlantPatchFeature(BlockId.BROWN_MUSHROOM), blockX, blockZ);
    if (this.random.nextInt(8) == 0) this.generatePlant(world, new PlantPatchFeature(BlockId.RED_MUSHROOM), blockX, blockZ);
    const cane = new SugarCanePatchFeature(); for (let i = 0; i < 10; ++i) this.generatePlant(world, cane, blockX, blockZ);
    if (this.random.nextInt(32) == 0) this.generatePlant(world, new PumpkinPatchFeature(), blockX, blockZ);
    if (biome == BiomeId.DESERT) { const cactus = new CactusPatchFeature(); for (let i = 0; i < 10; ++i) this.generatePlant(world, cactus, blockX, blockZ); }
    const waterSpring = new SpringFeature(BlockId.FLOWING_WATER), lavaSpring = new SpringFeature(BlockId.FLOWING_LAVA);
    for (let i = 0; i < 50; ++i) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(this.random.nextInt(120) + 8); fz = blockZ + this.random.nextInt(16) + 8; waterSpring.generate(world, this.random, fx, fy, fz); }
    for (let i = 0; i < 20; ++i) { fx = blockX + this.random.nextInt(16) + 8; fy = this.random.nextInt(this.random.nextInt(this.random.nextInt(112) + 8) + 8); fz = blockZ + this.random.nextInt(16) + 8; lavaSpring.generate(world, this.random, fx, fy, fz); }
    const temperatures = this.getTemperatures(null, blockX + 8, blockZ + 8, 16, 16);
    for (let x = blockX + 8; x < blockX + 24; ++x) for (let z = blockZ + 8; z < blockZ + 24; ++z) {
      const top = world.getTopSolidOrLiquidBlock(x, z), temperature = unchecked(temperatures[(x - blockX - 8) * 16 + z - blockZ - 8]) - (<f64>(top - 64) / 64.0) * 0.3;
      if (temperature < 0.5 && top > 0 && top < 128 && world.isAir(x, top, z) && world.isSolid(x, top - 1, z) && world.getBlock(x, top - 1, z) != BlockId.ICE) world.setBlock(x, top, z, <u8>BlockId.SNOW_LAYER);
    }
  }

  private generateOre(world: World, feature: OreFeature, count: i32, maxY: i32, blockX: i32, blockZ: i32): void {
    for (let i = 0; i < count; ++i) feature.generate(world, this.random, blockX + this.random.nextInt(16), this.random.nextInt(maxY), blockZ + this.random.nextInt(16));
  }

  private generatePlant(world: World, feature: Feature, blockX: i32, blockZ: i32): void {
    feature.generate(world, this.random, blockX + this.random.nextInt(16) + 8, this.random.nextInt(128), blockZ + this.random.nextInt(16) + 8);
  }

  private getTreeFeature(biome: u8): Feature {
    if (biome == BiomeId.FOREST) return this.random.nextInt(5) == 0 ? new BirchTreeFeature() : this.random.nextInt(3) == 0 ? this.preparedLargeOak() : new OakTreeFeature();
    if (biome == BiomeId.RAINFOREST) return this.random.nextInt(3) == 0 ? this.preparedLargeOak() : new OakTreeFeature();
    if (biome == BiomeId.TAIGA) return this.random.nextInt(3) == 0 ? new PineTreeFeature() : new SpruceTreeFeature();
    return this.random.nextInt(10) == 0 ? this.preparedLargeOak() : new OakTreeFeature();
  }

  private preparedLargeOak(): LargeOakTreeFeature { const tree = new LargeOakTreeFeature(); tree.prepare(1.0, 1.0, 1.0); return tree; }

  getBiomesInArea(x: i32, z: i32, width: i32, depth: i32): Uint8Array {
    const size = width * depth;
    if (this.biomes == null || this.biomes!.length < size) this.biomes = new Uint8Array(size);
    this.temperatureMap = this.temperatureSampler.sample(this.temperatureMap, <f64>x, <f64>z, width, width, TEMPERATURE_FREQUENCY, TEMPERATURE_FREQUENCY, 0.25);
    this.downfallMap = this.downfallSampler.sample(this.downfallMap, <f64>x, <f64>z, width, width, DOWNFALL_FREQUENCY, DOWNFALL_FREQUENCY, 1.0 / 3.0);
    this.weirdnessMap = this.weirdnessSampler.sample(this.weirdnessMap, <f64>x, <f64>z, width, width, 0.25, 0.25, 0.5882352941176471);
    const temperatures = changetype<Float64Array>(this.temperatureMap);
    const downfalls = changetype<Float64Array>(this.downfallMap);
    const weirdnesses = changetype<Float64Array>(this.weirdnessMap);
    const result = changetype<Uint8Array>(this.biomes);
    let index = 0;
    for (let i = 0; i < width; ++i) for (let j = 0; j < depth; ++j) {
      if (index >= temperatures.length || index >= downfalls.length || index >= weirdnesses.length) unreachable();
      const weirdness = unchecked(weirdnesses[index]) * 1.1 + 0.5;
      let temperature = (unchecked(temperatures[index]) * 0.15 + 0.7) * 0.99 + weirdness * 0.01;
      let downfall = (unchecked(downfalls[index]) * 0.15 + 0.5) * 0.998 + weirdness * 0.002;
      temperature = 1.0 - (1.0 - temperature) * (1.0 - temperature);
      if (temperature < 0.0) temperature = 0.0; else if (temperature > 1.0) temperature = 1.0;
      if (downfall < 0.0) downfall = 0.0; else if (downfall > 1.0) downfall = 1.0;
      unchecked(temperatures[index] = temperature); unchecked(downfalls[index] = downfall);
      unchecked(result[index] = getBiomeId(temperature, downfall));
      ++index;
    }
    return result;
  }

  getTemperatures(buffer: Float64Array | null, x: i32, z: i32, width: i32, depth: i32): Float64Array {
    buffer = this.temperatureSampler.sample(buffer, <f64>x, <f64>z, width, depth, TEMPERATURE_FREQUENCY, TEMPERATURE_FREQUENCY, 0.25);
    this.weirdnessMap = this.weirdnessSampler.sample(this.weirdnessMap, <f64>x, <f64>z, width, depth, 0.25, 0.25, 10.0 / 17.0);
    const weirdness = changetype<Float64Array>(this.weirdnessMap);
    for (let i = 0, size = width * depth; i < size; ++i) {
      const value = unchecked(weirdness[i]) * 1.1 + 0.5;
      let temperature = (unchecked(buffer[i]) * 0.15 + 0.7) * 0.99 + value * 0.01;
      temperature = 1.0 - (1.0 - temperature) * (1.0 - temperature);
      if (temperature < 0.0) temperature = 0.0; else if (temperature > 1.0) temperature = 1.0;
      unchecked(buffer[i] = temperature);
    }
    return buffer;
  }

  private generateHeightMap(): Float64Array {
    const sizeX = 5, sizeY = 17, sizeZ = 5;
    if (this.heightMap == null) this.heightMap = new Float64Array(425);
    const temperatures = changetype<Float64Array>(this.temperatureMap), downfalls = changetype<Float64Array>(this.downfallMap);
    const x = 0, y = 0, z = 0;
    return changetype<Float64Array>(this.heightMap);
  }

  private buildTerrain(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>, temperatures: Float64Array): void {
    const x = chunkX * 4, z = chunkZ * 4;
    this.scaleNoiseBuffer = this.islandScale.create2D(this.scaleNoiseBuffer, <f64>x, <f64>z, 5, 5, 1.121, 1.121);
    this.depthNoiseBuffer = this.islandNoise.create2D(this.depthNoiseBuffer, <f64>x, <f64>z, 5, 5, 200.0, 200.0);
    this.selectorBuffer = this.selector.create(this.selectorBuffer, <f64>x, 0.0, <f64>z, 5, 17, 5, 684.412 / 80.0, 684.412 / 160.0, 684.412 / 80.0);
    this.lowBuffer = this.minLimit.create(this.lowBuffer, <f64>x, 0.0, <f64>z, 5, 17, 5, 684.412, 684.412, 684.412);
    this.highBuffer = this.maxLimit.create(this.highBuffer, <f64>x, 0.0, <f64>z, 5, 17, 5, 684.412, 684.412, 684.412);
    if (this.heightMap == null) this.heightMap = new Float64Array(425);
    const heightMap = changetype<Float64Array>(this.heightMap), scaleNoise = changetype<Float64Array>(this.scaleNoiseBuffer), depthNoise = changetype<Float64Array>(this.depthNoiseBuffer);
    const selector = changetype<Float64Array>(this.selectorBuffer), lowNoise = changetype<Float64Array>(this.lowBuffer), highNoise = changetype<Float64Array>(this.highBuffer);
    const downfalls = changetype<Float64Array>(this.downfallMap);
    let index = 0, column = 0;
    for (let sx = 0; sx < 5; ++sx) for (let sz = 0; sz < 5; ++sz) {
      const climateX = sx * 3 + 1, climateZ = sz * 3 + 1;
      const temperature = unchecked(temperatures[climateX * 16 + climateZ]);
      let downfall = unchecked(downfalls[climateX * 16 + climateZ]) * temperature;
      downfall = 1.0 - downfall; downfall *= downfall; downfall *= downfall; downfall = 1.0 - downfall;
      let scale = (unchecked(scaleNoise[column]) + 256.0) / 512.0 * downfall;
      if (scale > 1.0) scale = 1.0;
      let depth = unchecked(depthNoise[column]) / 8000.0;
      if (depth < 0.0) depth = -depth * 0.3;
      depth = depth * 3.0 - 2.0;
      if (depth < 0.0) { depth /= 2.0; if (depth < -1.0) depth = -1.0; depth /= 1.4; depth /= 2.0; scale = 0.0; }
      else { if (depth > 1.0) depth = 1.0; depth /= 8.0; }
      if (scale < 0.0) scale = 0.0;
      scale += 0.5; depth = depth * 17.0 / 16.0;
      const elevation = 8.5 + depth * 4.0; ++column;
      for (let sy = 0; sy < 17; ++sy) {
        let offset = (<f64>sy - elevation) * 12.0 / scale;
        if (offset < 0.0) offset *= 4.0;
        const low = unchecked(lowNoise[index]) / 512.0, high = unchecked(highNoise[index]) / 512.0;
        const select = (unchecked(selector[index]) / 10.0 + 1.0) / 2.0;
        let density = select < 0.0 ? low : select > 1.0 ? high : low + (high - low) * select;
        density -= offset;
        if (sy > 13) { const fade = <f64>(<f32>(sy - 13) / <f32>3.0); density = density * (1.0 - fade) - 10.0 * fade; }
        unchecked(heightMap[index++] = density);
      }
    }
    for (let sx = 0; sx < 4; ++sx) for (let sz = 0; sz < 4; ++sz) for (let sy = 0; sy < 16; ++sy) {
      let c000 = unchecked(heightMap[(sx * 5 + sz) * 17 + sy]), c010 = unchecked(heightMap[(sx * 5 + sz + 1) * 17 + sy]);
      let c100 = unchecked(heightMap[((sx + 1) * 5 + sz) * 17 + sy]), c110 = unchecked(heightMap[((sx + 1) * 5 + sz + 1) * 17 + sy]);
      const d000 = (unchecked(heightMap[(sx * 5 + sz) * 17 + sy + 1]) - c000) * 0.125;
      const d010 = (unchecked(heightMap[(sx * 5 + sz + 1) * 17 + sy + 1]) - c010) * 0.125;
      const d100 = (unchecked(heightMap[((sx + 1) * 5 + sz) * 17 + sy + 1]) - c100) * 0.125;
      const d110 = (unchecked(heightMap[((sx + 1) * 5 + sz + 1) * 17 + sy + 1]) - c110) * 0.125;
      for (let subY = 0; subY < 8; ++subY) {
        let dx0 = c000, dx1 = c010; const step0 = (c100 - c000) * 0.25, step1 = (c110 - c010) * 0.25;
        for (let subX = 0; subX < 4; ++subX) {
          const lx = subX + sx * 4; let blockIndex = (lx << 11) | (sz * 4 << 7) | (sy * 8 + subY);
          let density = dx0; const dz = (dx1 - dx0) * 0.25;
          for (let subZ = 0; subZ < 4; ++subZ) {
            const by = sy * 8 + subY, lz = sz * 4 + subZ;
            let block: u8 = <u8>BlockId.AIR;
            if (by < 64) block = <u8>(unchecked(temperatures[lx * 16 + lz]) < 0.5 && by >= 63 ? BlockId.ICE : BlockId.WATER);
            if (density > 0.0) block = <u8>BlockId.STONE;
            unchecked(blocks[blockIndex] = block); blockIndex += 128; density += dz;
          }
          dx0 += step0; dx1 += step1;
        }
        c000 += d000; c010 += d010; c100 += d100; c110 += d110;
      }
    }
  }

  private buildSurfaces(chunkX: i32, chunkZ: i32, blocks: StaticArray<u8>, biomes: Uint8Array): void {
    this.sandBuffer = this.sandGravel.create(this.sandBuffer, <f64>(chunkX * 16), <f64>(chunkZ * 16), 0.0, 16, 16, 1, 1.0 / 32.0, 1.0 / 32.0, 1.0);
    this.gravelBuffer = this.sandGravel.create(this.gravelBuffer, <f64>(chunkX * 16), 109.0134, <f64>(chunkZ * 16), 16, 1, 16, 1.0 / 32.0, 1.0, 1.0 / 32.0);
    this.depthBuffer = this.depth.create(this.depthBuffer, <f64>(chunkX * 16), <f64>(chunkZ * 16), 0.0, 16, 16, 1, 1.0 / 16.0, 1.0 / 16.0, 1.0 / 16.0);
    const sand = changetype<Float64Array>(this.sandBuffer), gravel = changetype<Float64Array>(this.gravelBuffer), depths = changetype<Float64Array>(this.depthBuffer);
    for (let lx = 0; lx < 16; ++lx) for (let lz = 0; lz < 16; ++lz) {
      const biome = unchecked(biomes[lx + lz * 16]);
      const useSand = unchecked(sand[lx + lz * 16]) + this.random.nextDouble() * 0.2 > 0.0;
      const useGravel = unchecked(gravel[lx + lz * 16]) + this.random.nextDouble() * 0.2 > 3.0;
      const thickness = javaInt(unchecked(depths[lx + lz * 16]) / 3.0 + 3.0 + this.random.nextDouble() * 0.25);
      let remaining = -1, top = topBlockId(biome), soil = soilBlockId(biome);
      for (let y = 127; y >= 0; --y) {
        const index = (lz * 16 + lx) * 128 + y;
        if (y <= this.random.nextInt(5)) unchecked(blocks[index] = <u8>BlockId.BEDROCK);
        else {
          const block = unchecked(blocks[index]);
          if (block == BlockId.AIR) remaining = -1;
          else if (block == BlockId.STONE) {
            if (remaining == -1) {
              if (thickness <= 0) { top = <u8>BlockId.AIR; soil = <u8>BlockId.STONE; }
              else if (y >= 60 && y <= 65) {
                top = topBlockId(biome); soil = soilBlockId(biome);
                if (useGravel) { top = <u8>BlockId.AIR; soil = <u8>BlockId.GRAVEL; }
                if (useSand) { top = <u8>BlockId.SAND; soil = <u8>BlockId.SAND; }
              }
              if (y < 64 && top == BlockId.AIR) top = <u8>BlockId.WATER;
              remaining = thickness; unchecked(blocks[index] = y >= 63 ? top : soil);
            } else if (remaining > 0) {
              --remaining; unchecked(blocks[index] = soil);
              if (remaining == 0 && soil == BlockId.SAND) { remaining = this.random.nextInt(4); soil = <u8>BlockId.SANDSTONE; }
            }
          }
        }
      }
    }
  }
}
