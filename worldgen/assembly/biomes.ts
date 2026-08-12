import { BlockId } from "./blocks";
import { javaInt } from "./utils/math";

export const enum BiomeId {
  RAINFOREST = 0,
  SWAMPLAND = 1,
  SEASONAL_FOREST = 2,
  FOREST = 3,
  SAVANNA = 4,
  SHRUBLAND = 5,
  TAIGA = 6,
  DESERT = 7,
  PLAINS = 8,
  ICE_DESERT = 9,
  TUNDRA = 10,
  HELL = 11,
  SKY = 12,
}

const BIOME_LOOKUP = new StaticArray<u8>(4096);

@inline
export function topBlockId(biome: u8): u8 {
  return <u8>(biome == BiomeId.DESERT || biome == BiomeId.ICE_DESERT ? BlockId.SAND :
    biome == BiomeId.HELL ? BlockId.NETHERRACK : BlockId.GRASS_BLOCK);
}

@inline
export function soilBlockId(biome: u8): u8 {
  return <u8>(biome == BiomeId.DESERT || biome == BiomeId.ICE_DESERT ? BlockId.SAND :
    biome == BiomeId.HELL ? BlockId.NETHERRACK : BlockId.DIRT);
}

@inline
export function hasSnow(biome: u8): bool {
  return biome == BiomeId.TAIGA || biome == BiomeId.ICE_DESERT || biome == BiomeId.TUNDRA;
}

export function locateBiomeId(temperature: f64, downfall: f64): BiomeId {
  downfall *= temperature;
  if (temperature < 0.1) return BiomeId.TUNDRA;
  if (downfall < 0.2) {
    if (temperature < 0.5) return BiomeId.TUNDRA;
    return temperature < 0.95 ? BiomeId.SAVANNA : BiomeId.DESERT;
  }
  if (downfall > 0.5 && temperature < 0.7) return BiomeId.SWAMPLAND;
  if (temperature < 0.5) return BiomeId.TAIGA;
  if (temperature < 0.97) return downfall < 0.35 ? BiomeId.SHRUBLAND : BiomeId.FOREST;
  if (downfall < 0.45) return BiomeId.PLAINS;
  return downfall < 0.9 ? BiomeId.SEASONAL_FOREST : BiomeId.RAINFOREST;
}

for (let temperature: i32 = 0; temperature < 64; ++temperature) {
  for (let downfall: i32 = 0; downfall < 64; ++downfall) {
    unchecked(BIOME_LOOKUP[temperature + downfall * 64] = <u8>locateBiomeId(<f64>temperature / 63.0, <f64>downfall / 63.0));
  }
}

@inline
export function getBiomeId(temperature: f64, downfall: f64): u8 {
  const x = javaInt(temperature * 63.0);
  const y = javaInt(downfall * 63.0);
  return unchecked(BIOME_LOOKUP[x + y * 64]);
}
