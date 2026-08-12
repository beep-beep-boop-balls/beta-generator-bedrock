import { BlockId } from "../blocks";
import { Feature, isWater } from "./features";
import { javaCos, javaFloor, javaSin } from "../utils/math";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

export class OreFeature implements Feature {
  private readonly minableBlockId: u8;
  constructor(minableBlockId: i32, private readonly numberOfBlocks: i32) { this.minableBlockId = <u8>minableBlockId; }

  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    const angle: f32 = random.nextFloat() * <f32>Math.PI;
    const spread = <f64>this.numberOfBlocks / 8.0;
    const startX = <f64>(x + 8) + <f64>javaSin(angle) * spread;
    const endX = <f64>(x + 8) - <f64>javaSin(angle) * spread;
    const startZ = <f64>(z + 8) + <f64>javaCos(angle) * spread;
    const endZ = <f64>(z + 8) - <f64>javaCos(angle) * spread;
    const startY = y + random.nextInt(3) + 2;
    const endY = y + random.nextInt(3) + 2;
    for (let i = 0; i <= this.numberOfBlocks; ++i) {
      const centerX = startX + (endX - startX) * <f64>i / <f64>this.numberOfBlocks;
      const centerY = <f64>startY + <f64>(endY - startY) * <f64>i / <f64>this.numberOfBlocks;
      const centerZ = startZ + (endZ - startZ) * <f64>i / <f64>this.numberOfBlocks;
      const multiplier = random.nextDouble() * <f64>this.numberOfBlocks / 16.0;
      const radius = (<f64>javaSin(<f32>(<f32>i * <f32>Math.PI / <f32>this.numberOfBlocks)) + 1.0) * multiplier + 1.0;
      const minX = javaFloor(centerX - radius / 2.0), maxX = javaFloor(centerX + radius / 2.0);
      const minY = javaFloor(centerY - radius / 2.0), maxY = javaFloor(centerY + radius / 2.0);
      const minZ = javaFloor(centerZ - radius / 2.0), maxZ = javaFloor(centerZ + radius / 2.0);
      for (let bx = minX; bx <= maxX; ++bx) {
        const dx = (<f64>bx + 0.5 - centerX) / (radius / 2.0);
        if (dx * dx >= 1.0) continue;
        for (let by = minY; by <= maxY; ++by) {
          const dy = (<f64>by + 0.5 - centerY) / (radius / 2.0);
          if (dx * dx + dy * dy >= 1.0) continue;
          for (let bz = minZ; bz <= maxZ; ++bz) {
            const dz = (<f64>bz + 0.5 - centerZ) / (radius / 2.0);
            if (dx * dx + dy * dy + dz * dz < 1.0 && world.getBlock(bx, by, bz) == BlockId.STONE) world.setBlock(bx, by, bz, this.minableBlockId);
          }
        }
      }
    }
    return true;
  }
}

export class ClayOreFeature implements Feature {
  constructor(private readonly numberOfBlocks: i32) {}

  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    if (!isWater(world, x, y, z)) return false;
    const angle: f32 = random.nextFloat() * <f32>Math.PI;
    const spread = <f64>this.numberOfBlocks / 8.0;
    const startX = <f64>(x + 8) + <f64>javaSin(angle) * spread;
    const endX = <f64>(x + 8) - <f64>javaSin(angle) * spread;
    const startZ = <f64>(z + 8) + <f64>javaCos(angle) * spread;
    const endZ = <f64>(z + 8) - <f64>javaCos(angle) * spread;
    const startY = y + random.nextInt(3) + 2, endY = y + random.nextInt(3) + 2;
    for (let i = 0; i <= this.numberOfBlocks; ++i) {
      const lerp = <f64>i / <f64>this.numberOfBlocks;
      const cx = startX + (endX - startX) * lerp, cy = <f64>startY + <f64>(endY - startY) * lerp, cz = startZ + (endZ - startZ) * lerp;
      const multiplier = random.nextDouble() * <f64>this.numberOfBlocks / 16.0;
      const radius = (<f64>javaSin(<f32>(<f32>i * <f32>Math.PI / <f32>this.numberOfBlocks)) + 1.0) * multiplier + 1.0;
      for (let bx = javaFloor(cx - radius / 2.0), maxX = javaFloor(cx + radius / 2.0); bx <= maxX; ++bx) {
        for (let by = javaFloor(cy - radius / 2.0), maxY = javaFloor(cy + radius / 2.0); by <= maxY; ++by) {
          for (let bz = javaFloor(cz - radius / 2.0), maxZ = javaFloor(cz + radius / 2.0); bz <= maxZ; ++bz) {
            const dx = (<f64>bx + 0.5 - cx) / (radius / 2.0), dy = (<f64>by + 0.5 - cy) / (radius / 2.0), dz = (<f64>bz + 0.5 - cz) / (radius / 2.0);
            if (dx * dx + dy * dy + dz * dz < 1.0 && world.getBlock(bx, by, bz) == BlockId.SAND) world.setBlock(bx, by, bz, <u8>BlockId.CLAY);
          }
        }
      }
    }
    return true;
  }
}
