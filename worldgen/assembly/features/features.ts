import { BlockId } from "../blocks";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

export interface Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool;
}

@inline export function isWater(world: World, x: i32, y: i32, z: i32): bool {
  const id = world.getBlock(x, y, z);
  return id == BlockId.FLOWING_WATER || id == BlockId.WATER;
}

export function canPlantGrow(world: World, blockId: u8, x: i32, y: i32, z: i32): bool {
  const below = world.getBlock(x, y - 1, z);
  if (blockId == BlockId.DEADBUSH) return below == BlockId.SAND;
  if (blockId == BlockId.BROWN_MUSHROOM || blockId == BlockId.RED_MUSHROOM) {
    return y >= 0 && y < 128 && !world.canSeeSky(x, y, z) && world.isOpaque(x, y - 1, z);
  }
  return world.canSeeSky(x, y, z) && (below == BlockId.GRASS_BLOCK || below == BlockId.DIRT);
}

export function canCactusGrow(world: World, x: i32, y: i32, z: i32): bool {
  if (world.isSolid(x - 1, y, z) || world.isSolid(x + 1, y, z) || world.isSolid(x, y, z - 1) || world.isSolid(x, y, z + 1)) return false;
  const below = world.getBlock(x, y - 1, z);
  return below == BlockId.CACTUS || below == BlockId.SAND;
}

export function canSugarCaneGrow(world: World, x: i32, y: i32, z: i32): bool {
  const below = world.getBlock(x, y - 1, z);
  return below == BlockId.REEDS ||
    ((below == BlockId.GRASS_BLOCK || below == BlockId.DIRT) &&
      (isWater(world, x - 1, y - 1, z) || isWater(world, x + 1, y - 1, z) ||
       isWater(world, x, y - 1, z - 1) || isWater(world, x, y - 1, z + 1)));
}

export class PlantPatchFeature implements Feature {
  private readonly plantBlockId: u8;
  constructor(plantBlockId: i32) { this.plantBlockId = <u8>plantBlockId; }
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    for (let i = 0; i < 64; ++i) {
      const gx = x + random.nextInt(8) - random.nextInt(8);
      const gy = y + random.nextInt(4) - random.nextInt(4);
      const gz = z + random.nextInt(8) - random.nextInt(8);
      if (world.isAir(gx, gy, gz) && canPlantGrow(world, this.plantBlockId, gx, gy, gz)) world.setBlock(gx, gy, gz, this.plantBlockId);
    }
    return true;
  }
}

export class CactusPatchFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    for (let i = 0; i < 10; ++i) {
      const gx = x + random.nextInt(8) - random.nextInt(8);
      const gy = y + random.nextInt(4) - random.nextInt(4);
      const gz = z + random.nextInt(8) - random.nextInt(8);
      if (!world.isAir(gx, gy, gz)) continue;
      const height = 1 + random.nextInt(random.nextInt(3) + 1);
      for (let h = 0; h < height; ++h) if (canCactusGrow(world, gx, gy + h, gz)) world.setBlock(gx, gy + h, gz, <u8>BlockId.CACTUS);
    }
    return true;
  }
}

export class DeadBushPatchFeature implements Feature {
  private readonly deadBushBlockId: u8;
  constructor(deadBushBlockId: i32) { this.deadBushBlockId = <u8>deadBushBlockId; }
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    while (true) {
      const id = world.getBlock(x, y, z);
      if ((id != BlockId.AIR && id != BlockId.LEAVES) || y <= 0) {
        for (let i = 0; i < 4; ++i) {
          const gx = x + random.nextInt(8) - random.nextInt(8);
          const gy = y + random.nextInt(4) - random.nextInt(4);
          const gz = z + random.nextInt(8) - random.nextInt(8);
          if (world.isAir(gx, gy, gz) && canPlantGrow(world, this.deadBushBlockId, gx, gy, gz)) world.setBlock(gx, gy, gz, this.deadBushBlockId);
        }
        return true;
      }
      --y;
    }
  }
}

export class GrassPatchFeature implements Feature {
  private readonly blockId: u8;
  private readonly blockState: u8;
  constructor(blockId: i32, blockState: i32) { this.blockId = <u8>blockId; this.blockState = <u8>blockState; }
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    while (true) {
      const id = world.getBlock(x, y, z);
      if ((id != BlockId.AIR && id != BlockId.LEAVES) || y <= 0) {
        for (let i = 0; i < 128; ++i) {
          const gx = x + random.nextInt(8) - random.nextInt(8);
          const gy = y + random.nextInt(4) - random.nextInt(4);
          const gz = z + random.nextInt(8) - random.nextInt(8);
          if (world.isAir(gx, gy, gz) && canPlantGrow(world, this.blockId, gx, gy, gz)) world.setBlock(gx, gy, gz, this.blockId, this.blockState);
        }
        return true;
      }
      --y;
    }
  }
}

export class SugarCanePatchFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    for (let i = 0; i < 20; ++i) {
      const gx = x + random.nextInt(4) - random.nextInt(4);
      const gz = z + random.nextInt(4) - random.nextInt(4);
      if (!world.isAir(gx, y, gz)) continue;
      if (isWater(world, gx - 1, y - 1, gz) || isWater(world, gx + 1, y - 1, gz) || isWater(world, gx, y - 1, gz - 1) || isWater(world, gx, y - 1, gz + 1)) {
        const height = 2 + random.nextInt(random.nextInt(3) + 1);
        for (let h = 0; h < height; ++h) if (canSugarCaneGrow(world, gx, y + h, gz)) world.setBlock(gx, y + h, gz, <u8>BlockId.REEDS);
      }
    }
    return true;
  }
}

export class NetherFirePatchFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    for (let attempt = 0; attempt < 64; ++attempt) {
      const gx = x + random.nextInt(8) - random.nextInt(8);
      const gy = y + random.nextInt(4) - random.nextInt(4);
      const gz = z + random.nextInt(8) - random.nextInt(8);
      if (world.isAir(gx, gy, gz) && world.getBlock(gx, gy - 1, gz) == BlockId.NETHERRACK) world.setBlock(gx, gy, gz, <u8>BlockId.FIRE);
    }
    return true;
  }
}

export class NetherLavaSpringFeature implements Feature {
  private readonly lavaBlockId: u8;
  constructor(lavaBlockId: i32) { this.lavaBlockId = <u8>lavaBlockId; }
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    if (world.getBlock(x, y + 1, z) != BlockId.NETHERRACK) return false;
    const target = world.getBlock(x, y, z);
    if (target != BlockId.AIR && target != BlockId.NETHERRACK) return false;
    let netherrack = 0, air = 0;
    let id = world.getBlock(x - 1, y, z); if (id == BlockId.NETHERRACK) ++netherrack; if (id == BlockId.AIR) ++air;
    id = world.getBlock(x + 1, y, z); if (id == BlockId.NETHERRACK) ++netherrack; if (id == BlockId.AIR) ++air;
    id = world.getBlock(x, y, z - 1); if (id == BlockId.NETHERRACK) ++netherrack; if (id == BlockId.AIR) ++air;
    id = world.getBlock(x, y, z + 1); if (id == BlockId.NETHERRACK) ++netherrack; if (id == BlockId.AIR) ++air;
    id = world.getBlock(x, y - 1, z); if (id == BlockId.NETHERRACK) ++netherrack; if (id == BlockId.AIR) ++air;
    if (netherrack == 4 && air == 1) world.setBlock(x, y, z, this.lavaBlockId);
    return true;
  }
}

export class GlowstoneClusterFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    if (!world.isAir(x, y, z) || world.getBlock(x, y + 1, z) != BlockId.NETHERRACK) return false;
    world.setBlock(x, y, z, <u8>BlockId.GLOWSTONE);
    for (let attempt = 0; attempt < 1500; ++attempt) {
      const gx = x + random.nextInt(8) - random.nextInt(8), gy = y - random.nextInt(12), gz = z + random.nextInt(8) - random.nextInt(8);
      if (!world.isAir(gx, gy, gz)) continue;
      let neighbors = 0;
      if (world.getBlock(gx - 1, gy, gz) == BlockId.GLOWSTONE) ++neighbors;
      if (world.getBlock(gx + 1, gy, gz) == BlockId.GLOWSTONE) ++neighbors;
      if (world.getBlock(gx, gy - 1, gz) == BlockId.GLOWSTONE) ++neighbors;
      if (world.getBlock(gx, gy + 1, gz) == BlockId.GLOWSTONE) ++neighbors;
      if (world.getBlock(gx, gy, gz - 1) == BlockId.GLOWSTONE) ++neighbors;
      if (world.getBlock(gx, gy, gz + 1) == BlockId.GLOWSTONE) ++neighbors;
      if (neighbors == 1) world.setBlock(gx, gy, gz, <u8>BlockId.GLOWSTONE);
    }
    return true;
  }
}

export class PumpkinPatchFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    for (let i = 0; i < 64; ++i) {
      const gx = x + random.nextInt(8) - random.nextInt(8), gy = y + random.nextInt(4) - random.nextInt(4), gz = z + random.nextInt(8) - random.nextInt(8);
      if (world.isAir(gx, gy, gz) && world.getBlock(gx, gy - 1, gz) == BlockId.GRASS_BLOCK && world.isSolid(gx, gy - 1, gz)) world.setBlock(gx, gy, gz, <u8>BlockId.PUMPKIN, <u8>random.nextInt(4));
    }
    return true;
  }
}

export class SpringFeature implements Feature {
  private readonly liquidBlockId: u8;
  constructor(liquidBlockId: i32) { this.liquidBlockId = <u8>liquidBlockId; }
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    if (world.getBlock(x, y + 1, z) != BlockId.STONE || world.getBlock(x, y - 1, z) != BlockId.STONE) return false;
    const target = world.getBlock(x, y, z);
    if (target != BlockId.AIR && target != BlockId.STONE) return false;
    let stone = 0, air = 0;
    if (world.getBlock(x - 1, y, z) == BlockId.STONE) ++stone; if (world.isAir(x - 1, y, z)) ++air;
    if (world.getBlock(x + 1, y, z) == BlockId.STONE) ++stone; if (world.isAir(x + 1, y, z)) ++air;
    if (world.getBlock(x, y, z - 1) == BlockId.STONE) ++stone; if (world.isAir(x, y, z - 1)) ++air;
    if (world.getBlock(x, y, z + 1) == BlockId.STONE) ++stone; if (world.isAir(x, y, z + 1)) ++air;
    if (stone == 3 && air == 1) world.setBlock(x, y, z, this.liquidBlockId);
    return true;
  }
}
