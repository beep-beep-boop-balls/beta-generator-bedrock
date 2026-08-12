export const enum BlockId {
  AIR = 0,
  STONE = 1,
  GRASS_BLOCK = 2,
  DIRT = 3,
  COBBLESTONE = 4,
  BEDROCK = 7,
  FLOWING_WATER = 8,
  WATER = 9,
  FLOWING_LAVA = 10,
  LAVA = 11,
  SAND = 12,
  GRAVEL = 13,
  GOLD_ORE = 14,
  IRON_ORE = 15,
  COAL_ORE = 16,
  LOG = 17,
  LEAVES = 18,
  LAPIS_ORE = 21,
  SANDSTONE = 24,
  SHORT_GRASS = 31,
  DEADBUSH = 32,
  DANDELION = 37,
  POPPY = 38,
  BROWN_MUSHROOM = 39,
  RED_MUSHROOM = 40,
  MOSSY_COBBLESTONE = 48,
  FIRE = 51,
  MOB_SPAWNER = 52,
  CHEST = 54,
  DIAMOND_ORE = 56,
  REDSTONE_ORE = 73,
  SNOW_LAYER = 78,
  ICE = 79,
  CACTUS = 81,
  CLAY = 82,
  REEDS = 83,
  PUMPKIN = 86,
  NETHERRACK = 87,
  SOUL_SAND = 88,
  GLOWSTONE = 89,
}

export const enum BlockKind {
  AIR,
  SOLID,
  WATER,
  LAVA,
  LEAVES,
  PLANT,
  SNOW,
}

@inline
export function blockKind(id: u8): BlockKind {
  if (id == BlockId.AIR) return BlockKind.AIR;
  if (id == BlockId.FLOWING_WATER || id == BlockId.WATER) return BlockKind.WATER;
  if (id == BlockId.FLOWING_LAVA || id == BlockId.LAVA) return BlockKind.LAVA;
  if (id == BlockId.LEAVES) return BlockKind.LEAVES;
  if (
    id == BlockId.SHORT_GRASS || id == BlockId.DEADBUSH || id == BlockId.DANDELION ||
    id == BlockId.POPPY || id == BlockId.BROWN_MUSHROOM || id == BlockId.RED_MUSHROOM ||
    id == BlockId.FIRE || id == BlockId.REEDS
  ) return BlockKind.PLANT;
  if (id == BlockId.SNOW_LAYER) return BlockKind.SNOW;
  return BlockKind.SOLID;
}

@inline
export function isSolidBlock(id: u8): bool {
  const kind = blockKind(id);
  return kind == BlockKind.SOLID || kind == BlockKind.LEAVES;
}

@inline
export function isLiquidBlock(id: u8): bool {
  const kind = blockKind(id);
  return kind == BlockKind.WATER || kind == BlockKind.LAVA;
}

@inline
export function isOpaqueBlock(id: u8): bool {
  return blockKind(id) == BlockKind.SOLID && id != BlockId.CHEST && id != BlockId.ICE && id != BlockId.CACTUS;
}

@inline
export function blocksSky(id: u8): bool {
  if (id == BlockId.CACTUS) return false;
  const kind = blockKind(id);
  return kind == BlockKind.SOLID || kind == BlockKind.WATER || kind == BlockKind.LAVA || kind == BlockKind.LEAVES;
}
