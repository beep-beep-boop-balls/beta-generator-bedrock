import { BlockId } from "../blocks";
import { Feature } from "./features";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

@inline function iabs(value: i32): i32 { return value < 0 ? -value : value; }

class StandardTreeFeature implements Feature {
  constructor(private readonly baseHeight: i32, private readonly state: u8) {}
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    const height = random.nextInt(3) + this.baseHeight;
    if (y < 1 || y + height + 1 > 128) return false;
    let canPlace = true;
    for (let cy = y; cy <= y + 1 + height; ++cy) {
      let radius = cy == y ? 0 : cy >= y + 1 + height - 2 ? 2 : 1;
      for (let cx = x - radius; cx <= x + radius && canPlace; ++cx) for (let cz = z - radius; cz <= z + radius && canPlace; ++cz) {
        if (cy < 0 || cy >= 128) canPlace = false;
        else { const id = world.getBlock(cx, cy, cz); if (id != BlockId.AIR && id != BlockId.LEAVES) canPlace = false; }
      }
    }
    if (!canPlace) return false;
    const ground = world.getBlock(x, y - 1, z);
    if ((ground != BlockId.GRASS_BLOCK && ground != BlockId.DIRT) || y >= 128 - height - 1) return false;
    world.setBlock(x, y - 1, z, <u8>BlockId.DIRT);
    for (let leafY = y - 3 + height; leafY <= y + height; ++leafY) {
      const relativeY = leafY - (y + height), radius = 1 - <i32>(<f64>relativeY / 2.0);
      for (let leafX = x - radius; leafX <= x + radius; ++leafX) for (let leafZ = z - radius; leafZ <= z + radius; ++leafZ) {
        const dx = leafX - x, dz = leafZ - z;
        if ((iabs(dx) != radius || iabs(dz) != radius || (random.nextInt(2) != 0 && relativeY != 0)) && !world.isOpaque(leafX, leafY, leafZ)) world.setBlock(leafX, leafY, leafZ, <u8>BlockId.LEAVES, this.state);
      }
    }
    for (let trunkY = 0; trunkY < height; ++trunkY) {
      const id = world.getBlock(x, y + trunkY, z);
      if (id == BlockId.AIR || id == BlockId.LEAVES) world.setBlock(x, y + trunkY, z, <u8>BlockId.LOG, this.state);
    }
    return true;
  }
}

export class OakTreeFeature extends StandardTreeFeature { constructor() { super(4, 0); } }
export class BirchTreeFeature extends StandardTreeFeature { constructor() { super(5, 2); } }

export class PineTreeFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    const height = random.nextInt(5) + 7, bare = height - random.nextInt(2) - 3, canopy = height - bare, maxRadius = 1 + random.nextInt(canopy + 1);
    if (y < 1 || y + height + 1 > 128) return false;
    let canPlace = true;
    for (let cy = y; cy <= y + 1 + height && canPlace; ++cy) {
      const radius = cy - y < bare ? 0 : maxRadius;
      for (let cx = x - radius; cx <= x + radius && canPlace; ++cx) for (let cz = z - radius; cz <= z + radius && canPlace; ++cz) {
        if (cy < 0 || cy >= 128) canPlace = false; else { const id = world.getBlock(cx, cy, cz); if (id != BlockId.AIR && id != BlockId.LEAVES) canPlace = false; }
      }
    }
    const ground = world.getBlock(x, y - 1, z);
    if (!canPlace || (ground != BlockId.GRASS_BLOCK && ground != BlockId.DIRT) || y >= 128 - height - 1) return false;
    world.setBlock(x, y - 1, z, <u8>BlockId.DIRT);
    let radius = 0;
    for (let cy = y + height; cy >= y + bare; --cy) {
      for (let cx = x - radius; cx <= x + radius; ++cx) for (let cz = z - radius; cz <= z + radius; ++cz) {
        if ((iabs(cx - x) != radius || iabs(cz - z) != radius || radius <= 0) && !world.isOpaque(cx, cy, cz)) world.setBlock(cx, cy, cz, <u8>BlockId.LEAVES, 1);
      }
      if (radius >= 1 && cy == y + bare + 1) --radius; else if (radius < maxRadius) ++radius;
    }
    for (let trunkY = 0; trunkY < height - 1; ++trunkY) { const id = world.getBlock(x, y + trunkY, z); if (id == BlockId.AIR || id == BlockId.LEAVES) world.setBlock(x, y + trunkY, z, <u8>BlockId.LOG, 1); }
    return true;
  }
}

export class SpruceTreeFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    const height = random.nextInt(4) + 6, topBare = 1 + random.nextInt(2), leafOffset = height - topBare, maxRadius = 2 + random.nextInt(2);
    if (y < 1 || y + height + 1 > 128) return false;
    let canPlace = true;
    for (let cy = y; cy <= y + 1 + height && canPlace; ++cy) {
      const radius = cy - y < topBare ? 0 : maxRadius;
      for (let cx = x - radius; cx <= x + radius && canPlace; ++cx) for (let cz = z - radius; cz <= z + radius && canPlace; ++cz) {
        if (cy < 0 || cy >= 128) canPlace = false; else { const id = world.getBlock(cx, cy, cz); if (id != BlockId.AIR && id != BlockId.LEAVES) canPlace = false; }
      }
    }
    const ground = world.getBlock(x, y - 1, z);
    if (!canPlace || (ground != BlockId.GRASS_BLOCK && ground != BlockId.DIRT) || y >= 128 - height - 1) return false;
    world.setBlock(x, y - 1, z, <u8>BlockId.DIRT);
    let radius = random.nextInt(2), target = 1, step = 0;
    for (let h = 0; h <= leafOffset; ++h) {
      const leafY = y + height - h;
      for (let cx = x - radius; cx <= x + radius; ++cx) for (let cz = z - radius; cz <= z + radius; ++cz) if ((iabs(cx - x) != radius || iabs(cz - z) != radius || radius <= 0) && !world.isOpaque(cx, leafY, cz)) world.setBlock(cx, leafY, cz, <u8>BlockId.LEAVES, 1);
      if (radius >= target) { radius = step; step = 1; ++target; if (target > maxRadius) target = maxRadius; } else ++radius;
    }
    const variability = random.nextInt(3);
    for (let trunkY = 0; trunkY < height - variability; ++trunkY) { const id = world.getBlock(x, y + trunkY, z); if (id == BlockId.AIR || id == BlockId.LEAVES) world.setBlock(x, y + trunkY, z, <u8>BlockId.LOG, 1); }
    return true;
  }
}
