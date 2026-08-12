import { BlockId } from "../blocks";
import { Feature } from "./features";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

export class DungeonFeature implements Feature {
  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    const height = 3, radiusX = random.nextInt(2) + 2, radiusZ = random.nextInt(2) + 2;
    let openings = 0;
    for (let cx = x - radiusX - 1; cx <= x + radiusX + 1; ++cx) for (let cy = y - 1; cy <= y + height + 1; ++cy) for (let cz = z - radiusZ - 1; cz <= z + radiusZ + 1; ++cz) {
      if ((cy == y - 1 || cy == y + height + 1) && !world.isSolid(cx, cy, cz)) return false;
      const wall = cx == x - radiusX - 1 || cx == x + radiusX + 1 || cz == z - radiusZ - 1 || cz == z + radiusZ + 1;
      if (wall && cy == y && world.isAir(cx, cy, cz) && world.isAir(cx, cy + 1, cz)) ++openings;
    }
    if (openings < 1 || openings > 5) return false;
    for (let cx = x - radiusX - 1; cx <= x + radiusX + 1; ++cx) for (let cy = y + height; cy >= y - 1; --cy) for (let cz = z - radiusZ - 1; cz <= z + radiusZ + 1; ++cz) {
      const inside = cx != x - radiusX - 1 && cy != y - 1 && cz != z - radiusZ - 1 && cx != x + radiusX + 1 && cy != y + height + 1 && cz != z + radiusZ + 1;
      if (inside || (cy >= 0 && !world.isSolid(cx, cy - 1, cz))) world.setBlock(cx, cy, cz, <u8>BlockId.AIR);
      else if (world.isSolid(cx, cy, cz)) world.setBlock(cx, cy, cz, <u8>(cy == y - 1 && random.nextInt(4) != 0 ? BlockId.MOSSY_COBBLESTONE : BlockId.COBBLESTONE));
    }
    for (let i = 0; i < 2; ++i) for (let j = 0; j < 3; ++j) {
      const chestX = x + random.nextInt(radiusX * 2 + 1) - radiusX, chestZ = z + random.nextInt(radiusZ * 2 + 1) - radiusZ;
      if (!world.isAir(chestX, y, chestZ)) continue;
      let neighbors = 0;
      if (world.isSolid(chestX - 1, y, chestZ)) ++neighbors; if (world.isSolid(chestX + 1, y, chestZ)) ++neighbors;
      if (world.isSolid(chestX, y, chestZ - 1)) ++neighbors; if (world.isSolid(chestX, y, chestZ + 1)) ++neighbors;
      if (neighbors != 1) continue;
      world.setBlock(chestX, y, chestZ, <u8>BlockId.CHEST);
      for (let k = 0; k < 8; ++k) if (DungeonFeature.consumeChestRoll(random)) random.nextInt(27);
    }
    world.setBlock(x, y, z, <u8>BlockId.MOB_SPAWNER);
    random.nextInt(4);
    return true;
  }

  static consumeChestRoll(random: JavaRandom): bool {
    const chance = random.nextInt(11);
    if (chance == 0 || chance == 2 || chance == 6 || chance == 10) return true;
    if (chance == 1 || chance == 3 || chance == 4 || chance == 5) { random.nextInt(4); return true; }
    if (chance == 7) return random.nextInt(100) == 0;
    if (chance == 8) { if (random.nextInt(2) != 0) return false; random.nextInt(4); return true; }
    if (chance == 9) { if (random.nextInt(10) != 0) return false; random.nextInt(2); return true; }
    return false;
  }
}
