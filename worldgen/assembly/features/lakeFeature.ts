import { BlockId } from "../blocks";
import { Feature } from "./features";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

@inline function maskIndex(x: i32, z: i32, y: i32): i32 { return (x * 16 + z) * 8 + y; }

export class LakeFeature implements Feature {
  private readonly liquidBlockId: u8;
  constructor(liquidBlockId: i32) { this.liquidBlockId = <u8>liquidBlockId; }

  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    x -= 8; z -= 8;
    while (y > 0 && world.isAir(x, y, z)) --y;
    y -= 4;
    const mask = new StaticArray<bool>(2048);
    const blobCount = random.nextInt(4) + 4;
    for (let i = 0; i < blobCount; ++i) {
      const radiusX = random.nextDouble() * 6.0 + 3.0, radiusY = random.nextDouble() * 4.0 + 2.0, radiusZ = random.nextDouble() * 6.0 + 3.0;
      const centerX = random.nextDouble() * (14.0 - radiusX) + 1.0 + radiusX / 2.0;
      const centerY = random.nextDouble() * (4.0 - radiusY) + 2.0 + radiusY / 2.0;
      const centerZ = random.nextDouble() * (14.0 - radiusZ) + 1.0 + radiusZ / 2.0;
      for (let dx = 1; dx < 15; ++dx) for (let dz = 1; dz < 15; ++dz) for (let dy = 1; dy < 7; ++dy) {
        const nx = (<f64>dx - centerX) / (radiusX / 2.0), ny = (<f64>dy - centerY) / (radiusY / 2.0), nz = (<f64>dz - centerZ) / (radiusZ / 2.0);
        if (nx * nx + ny * ny + nz * nz < 1.0) unchecked(mask[maskIndex(dx, dz, dy)] = true);
      }
    }
    for (let dx = 0; dx < 16; ++dx) for (let dz = 0; dz < 16; ++dz) for (let dy = 0; dy < 8; ++dy) {
      const edge = !unchecked(mask[maskIndex(dx, dz, dy)]) &&
        ((dx < 15 && unchecked(mask[maskIndex(dx + 1, dz, dy)])) || (dx > 0 && unchecked(mask[maskIndex(dx - 1, dz, dy)])) ||
         (dz < 15 && unchecked(mask[maskIndex(dx, dz + 1, dy)])) || (dz > 0 && unchecked(mask[maskIndex(dx, dz - 1, dy)])) ||
         (dy < 7 && unchecked(mask[maskIndex(dx, dz, dy + 1)])) || (dy > 0 && unchecked(mask[maskIndex(dx, dz, dy - 1)])));
      if (!edge) continue;
      if (dy >= 4 && world.isLiquid(x + dx, y + dy, z + dz)) return false;
      if (dy < 4 && !world.isSolid(x + dx, y + dy, z + dz) && world.getBlock(x + dx, y + dy, z + dz) != this.liquidBlockId) return false;
    }
    for (let dx = 0; dx < 16; ++dx) for (let dz = 0; dz < 16; ++dz) for (let dy = 0; dy < 8; ++dy) if (unchecked(mask[maskIndex(dx, dz, dy)])) world.setBlock(x + dx, y + dy, z + dz, dy >= 4 ? <u8>BlockId.AIR : this.liquidBlockId);
    for (let dx = 0; dx < 16; ++dx) for (let dz = 0; dz < 16; ++dz) for (let dy = 4; dy < 8; ++dy) if (unchecked(mask[maskIndex(dx, dz, dy)]) && world.getBlock(x + dx, y + dy - 1, z + dz) == BlockId.DIRT && world.canSeeSky(x + dx, y + dy, z + dz)) world.setBlock(x + dx, y + dy - 1, z + dz, <u8>BlockId.GRASS_BLOCK);
    if (this.liquidBlockId == BlockId.FLOWING_LAVA || this.liquidBlockId == BlockId.LAVA) {
      for (let dx = 0; dx < 16; ++dx) for (let dz = 0; dz < 16; ++dz) for (let dy = 0; dy < 8; ++dy) {
        const edge = !unchecked(mask[maskIndex(dx, dz, dy)]) &&
          ((dx < 15 && unchecked(mask[maskIndex(dx + 1, dz, dy)])) || (dx > 0 && unchecked(mask[maskIndex(dx - 1, dz, dy)])) ||
           (dz < 15 && unchecked(mask[maskIndex(dx, dz + 1, dy)])) || (dz > 0 && unchecked(mask[maskIndex(dx, dz - 1, dy)])) ||
           (dy < 7 && unchecked(mask[maskIndex(dx, dz, dy + 1)])) || (dy > 0 && unchecked(mask[maskIndex(dx, dz, dy - 1)])));
        if (edge && (dy < 4 || random.nextInt(2) != 0) && world.isSolid(x + dx, y + dy, z + dz)) world.setBlock(x + dx, y + dy, z + dz, <u8>BlockId.STONE);
      }
    }
    return true;
  }
}
