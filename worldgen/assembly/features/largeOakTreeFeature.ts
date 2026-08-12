import { BlockId } from "../blocks";
import { Feature } from "./features";
import { javaFloor, javaInt } from "../utils/math";
import { JavaRandom } from "../utils/random";
import { World } from "../world";

const MINOR_AXES: StaticArray<i32> = [2, 0, 0, 1, 2, 1];

class Branch {
  constructor(public x: i32, public y: i32, public z: i32, public baseY: i32) {}
}

export class LargeOakTreeFeature implements Feature {
  private originX: i32 = 0; private originY: i32 = 0; private originZ: i32 = 0;
  private readonly treeRandom: JavaRandom = new JavaRandom();
  private world: World | null = null;
  private branches: Array<Branch> = [];
  private branchLengthScale: f64 = 1.0;
  private foliageClusterHeight: i32 = 4;
  private foliageDensity: f64 = 1.0;
  private height: i32 = 0;
  private maxTrunkHeight: i32 = 12;
  private trunkHeight: i32 = 0;

  prepare(heightScale: f64, branchScale: f64, foliageDensity: f64): void {
    this.maxTrunkHeight = javaInt(heightScale * 12.0);
    if (heightScale > 0.5) this.foliageClusterHeight = 5;
    this.branchLengthScale = branchScale; this.foliageDensity = foliageDensity;
  }

  generate(world: World, random: JavaRandom, x: i32, y: i32, z: i32): bool {
    this.world = world; this.treeRandom.setSeed(random.nextLong()); this.originX = x; this.originY = y; this.originZ = z;
    if (this.height == 0) this.height = 5 + this.treeRandom.nextInt(this.maxTrunkHeight);
    if (!this.canPlace()) return false;
    this.makeBranches(); this.placeFoliage(); this.placeTrunk(); this.placeBranches(); return true;
  }

  private makeBranches(): void {
    this.trunkHeight = javaInt(<f64>this.height * 0.618); if (this.trunkHeight >= this.height) this.trunkHeight = this.height - 1;
    let count = javaInt(1.382 + Math.pow(this.foliageDensity * <f64>this.height / 13.0, 2.0)); if (count < 1) count = 1;
    const branches = new Array<Branch>();
    let y = this.originY + this.height - this.foliageClusterHeight, level = y - this.originY;
    const trunkTop = this.originY + this.trunkHeight;
    branches.push(new Branch(this.originX, y, this.originZ, trunkTop)); --y;
    while (level >= 0) {
      const shape = this.getTreeShape(level);
      if (shape >= 0.0) for (let candidate = 0; candidate < count; ++candidate) {
        const length = this.branchLengthScale * <f64>shape * (<f64>this.treeRandom.nextFloat() + 0.328), angle = <f64>this.treeRandom.nextFloat() * 2.0 * 3.14159;
        const bx = javaFloor(length * Math.sin(angle) + <f64>this.originX + 0.5), bz = javaFloor(length * Math.cos(angle) + <f64>this.originZ + 0.5);
        if (this.tryBranch(bx, y, bz, bx, y + this.foliageClusterHeight, bz) != -1) continue;
        const distance = Math.sqrt(Math.pow(<f64>Math.abs(this.originX - bx), 2.0) + Math.pow(<f64>Math.abs(this.originZ - bz), 2.0));
        const slopedY = <f64>y - distance * 0.381;
        const baseY = slopedY > <f64>trunkTop ? trunkTop : javaInt(slopedY);
        if (this.tryBranch(this.originX, baseY, this.originZ, bx, y, bz) == -1) branches.push(new Branch(bx, y, bz, baseY));
      }
      --y; --level;
    }
    this.branches = branches;
  }

  private getTreeShape(level: i32): f32 {
    if (<f32>level < <f32>this.height * <f32>0.3) return <f32>-1.618;
    const radius: f32 = <f32>(<f64>this.height / 2.0), offset: f32 = <f32>(<f64>this.height / 2.0 - <f64>level);
    let shape: f32 = offset == 0.0 ? radius : Math.abs(offset) >= radius ? 0 : <f32>Math.sqrt(<f64>(radius * radius - offset * offset));
    return <f32>(shape * <f32>0.5);
  }

  private clusterShape(level: i32): f32 { return level >= 0 && level < this.foliageClusterHeight ? level != 0 && level != this.foliageClusterHeight - 1 ? 3 : 2 : -1; }

  private placeCluster(x: i32, y: i32, z: i32, radius: f32): void {
    const bound = javaInt(<f64>radius + 0.618), world = changetype<World>(this.world);
    for (let dx = -bound; dx <= bound; ++dx) for (let dz = -bound; dz <= bound; ++dz) {
      const distance = Math.sqrt(Math.pow(<f64>(Math.abs(dx) + 0.5), 2.0) + Math.pow(<f64>(Math.abs(dz) + 0.5), 2.0));
      if (distance > radius) continue;
      const id = world.getBlock(x + dx, y, z + dz); if (id == BlockId.AIR || id == BlockId.LEAVES) world.setBlock(x + dx, y, z + dz, <u8>BlockId.LEAVES);
    }
  }

  private placeFoliage(): void { for (let i = 0; i < this.branches.length; ++i) { const b = unchecked(this.branches[i]); for (let y = b.y; y < b.y + this.foliageClusterHeight; ++y) this.placeCluster(b.x, y, b.z, this.clusterShape(y - b.y)); } }

  private placeLine(x1: i32, y1: i32, z1: i32, x2: i32, y2: i32, z2: i32, block: u8): void {
    const delta: StaticArray<i32> = [x2 - x1, y2 - y1, z2 - z1];
    let major = 0; for (let axis = 0; axis < 3; ++axis) if (Math.abs(unchecked(delta[axis])) > Math.abs(unchecked(delta[major]))) major = axis;
    if (unchecked(delta[major]) == 0) return;
    const minorA = unchecked(MINOR_AXES[major]), minorB = unchecked(MINOR_AXES[major + 3]), step = unchecked(delta[major]) > 0 ? 1 : -1;
    const ratioA = <f64>unchecked(delta[minorA]) / <f64>unchecked(delta[major]), ratioB = <f64>unchecked(delta[minorB]) / <f64>unchecked(delta[major]);
    const start: StaticArray<i32> = [x1, y1, z1]; const point = new StaticArray<i32>(3);
    for (let offset = 0, end = unchecked(delta[major]) + step; offset != end; offset += step) {
      unchecked(point[major] = javaFloor(<f64>start[major] + <f64>offset + 0.5));
      unchecked(point[minorA] = javaFloor(<f64>start[minorA] + <f64>offset * ratioA + 0.5));
      unchecked(point[minorB] = javaFloor(<f64>start[minorB] + <f64>offset * ratioB + 0.5));
      changetype<World>(this.world).setBlock(unchecked(point[0]), unchecked(point[1]), unchecked(point[2]), block);
    }
  }

  private placeTrunk(): void { this.placeLine(this.originX, this.originY, this.originZ, this.originX, this.originY + this.trunkHeight, this.originZ, <u8>BlockId.LOG); }
  private placeBranches(): void { for (let i = 0; i < this.branches.length; ++i) { const b = unchecked(this.branches[i]); if (b.baseY - this.originY >= <f64>this.height * 0.2) this.placeLine(this.originX, b.baseY, this.originZ, b.x, b.y, b.z, <u8>BlockId.LOG); } }

  private tryBranch(x1: i32, y1: i32, z1: i32, x2: i32, y2: i32, z2: i32): i32 {
    const delta: StaticArray<i32> = [x2 - x1, y2 - y1, z2 - z1];
    let major = 0; for (let axis = 0; axis < 3; ++axis) if (Math.abs(unchecked(delta[axis])) > Math.abs(unchecked(delta[major]))) major = axis;
    if (unchecked(delta[major]) == 0) return -1;
    const minorA = unchecked(MINOR_AXES[major]), minorB = unchecked(MINOR_AXES[major + 3]), step = unchecked(delta[major]) > 0 ? 1 : -1;
    const ratioA = <f64>unchecked(delta[minorA]) / <f64>unchecked(delta[major]), ratioB = <f64>unchecked(delta[minorB]) / <f64>unchecked(delta[major]);
    const start: StaticArray<i32> = [x1, y1, z1]; const point = new StaticArray<i32>(3);
    let offset = 0, end = unchecked(delta[major]) + step;
    for (; offset != end; offset += step) {
      unchecked(point[major] = start[major] + offset); unchecked(point[minorA] = javaFloor(<f64>start[minorA] + <f64>offset * ratioA)); unchecked(point[minorB] = javaFloor(<f64>start[minorB] + <f64>offset * ratioB));
      const id = changetype<World>(this.world).getBlock(unchecked(point[0]), unchecked(point[1]), unchecked(point[2])); if (id != BlockId.AIR && id != BlockId.LEAVES) break;
    }
    return offset == end ? -1 : offset < 0 ? -offset : offset;
  }

  private canPlace(): bool {
    const world = changetype<World>(this.world), ground = world.getBlock(this.originX, this.originY - 1, this.originZ);
    if (ground != BlockId.GRASS_BLOCK && ground != BlockId.DIRT) return false;
    const obstruction = this.tryBranch(this.originX, this.originY, this.originZ, this.originX, this.originY + this.height - 1, this.originZ);
    if (obstruction == -1) return true; if (obstruction < 6) return false; this.height = obstruction; return true;
  }
}
