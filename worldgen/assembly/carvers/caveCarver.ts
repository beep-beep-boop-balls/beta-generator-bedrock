import { BlockId } from "../blocks";
import { Chunk } from "../chunk";
import { javaCos, javaFloor, javaInt, javaSin } from "../utils/math";
import { JavaRandom } from "../utils/random";

const CARVER_RADIUS = 8;

export class CaveCarver {
  private readonly random: JavaRandom = new JavaRandom();
  constructor(private readonly worldSeed: i64, private readonly nether: bool = false) {}

  carve(chunkX: i32, chunkZ: i32, chunk: Chunk): void {
    this.random.setSeed(this.worldSeed);
    const xOffset = (this.random.nextLong() / 2) * 2 + 1;
    const zOffset = (this.random.nextLong() / 2) * 2 + 1;
    for (let currentX = chunkX - CARVER_RADIUS; currentX <= chunkX + CARVER_RADIUS; ++currentX) for (let currentZ = chunkZ - CARVER_RADIUS; currentZ <= chunkZ + CARVER_RADIUS; ++currentZ) {
      this.random.setSeed((<i64>currentX * xOffset + <i64>currentZ * zOffset) ^ this.worldSeed);
      this.carveSourceChunk(currentX, currentZ, chunkX, chunkZ, chunk);
    }
  }

  private carveRoom(chunkX: i32, chunkZ: i32, chunk: Chunk, x: f64, y: f64, z: f64): void {
    this.carveTunnel(chunkX, chunkZ, chunk, x, y, z, <f32>(1.0 + <f32>(this.random.nextFloat() * 6.0)), 0, 0, -1, -1, 0.5);
  }

  private carveTunnel(chunkX: i32, chunkZ: i32, chunk: Chunk, offsetX: f64, offsetY: f64, offsetZ: f64, tunnelRadius: f32, yaw: f32, pitch: f32, tunnelStep: i32, tunnelLength: i32, verticalScale: f64): void {
    const chunkBlockX = chunkX * 16, chunkBlockZ = chunkZ * 16;
    const centerX = chunkBlockX + 8, centerZ = chunkBlockZ + 8;
    let yawSpeed: f32 = 0, pitchSpeed: f32 = 0;
    const caveRandom = new JavaRandom(this.random.nextLong());
    if (tunnelLength <= 0) { const range = CARVER_RADIUS * 16 - 16; tunnelLength = range - caveRandom.nextInt(javaInt(<f64>range / 4.0)); }
    let starting = false;
    if (tunnelStep == -1) { tunnelStep = javaInt(<f64>tunnelLength / 2.0); starting = true; }
    const branchStep = caveRandom.nextInt(javaInt(<f64>tunnelLength / 2.0)) + javaInt(<f64>tunnelLength / 4.0);
    const largeRoom = caveRandom.nextInt(6) == 0;
    for (; tunnelStep < tunnelLength; ++tunnelStep) {
      const horizontalRadius = 1.5 + <f64><f32>(javaSin(<f32>(<f32>tunnelStep * <f32>Math.PI / <f32>tunnelLength)) * tunnelRadius);
      const verticalRadius = horizontalRadius * verticalScale;
      const cosPitch = javaCos(pitch), sinPitch = javaSin(pitch);
      offsetX += <f32>(javaCos(yaw) * cosPitch); offsetY += sinPitch; offsetZ += <f32>(javaSin(yaw) * cosPitch);
      pitch = <f32>(pitch * (largeRoom ? <f32>0.92 : <f32>0.7));
      pitch = <f32>(pitch + <f32>(pitchSpeed * <f32>0.1)); yaw = <f32>(yaw + <f32>(yawSpeed * <f32>0.1));
      pitchSpeed = <f32>(pitchSpeed * <f32>0.9); yawSpeed = <f32>(yawSpeed * <f32>0.75);
      pitchSpeed = <f32>(pitchSpeed + <f32>(<f32>(<f32>(caveRandom.nextFloat() - caveRandom.nextFloat()) * caveRandom.nextFloat()) * <f32>2.0));
      yawSpeed = <f32>(yawSpeed + <f32>(<f32>(<f32>(caveRandom.nextFloat() - caveRandom.nextFloat()) * caveRandom.nextFloat()) * <f32>4.0));
      if (!starting && tunnelStep == branchStep && tunnelRadius > 1.0) {
        this.carveTunnel(chunkX, chunkZ, chunk, offsetX, offsetY, offsetZ, <f32>(caveRandom.nextFloat() * <f32>0.5 + <f32>0.5), <f32>(yaw - <f32>(<f32>Math.PI * <f32>0.5)), <f32>(pitch / <f32>3.0), tunnelStep, tunnelLength, 1.0);
        this.carveTunnel(chunkX, chunkZ, chunk, offsetX, offsetY, offsetZ, <f32>(caveRandom.nextFloat() * <f32>0.5 + <f32>0.5), <f32>(yaw + <f32>(<f32>Math.PI * <f32>0.5)), <f32>(pitch / <f32>3.0), tunnelStep, tunnelLength, 1.0);
        return;
      }
      if (!starting && caveRandom.nextInt(4) == 0) continue;
      const distX = offsetX - <f64>centerX, distZ = offsetZ - <f64>centerZ, remaining = tunnelLength - tunnelStep;
      const boundRadius = <f32>(tunnelRadius + <f32>2.0 + <f32>16.0);
      if (distX * distX + distZ * distZ - <f64>(remaining * remaining) > <f64>(boundRadius * boundRadius)) return;
      if (offsetX < <f64>centerX - 16.0 - horizontalRadius * 2.0 || offsetZ < <f64>centerZ - 16.0 - horizontalRadius * 2.0 || offsetX > <f64>centerX + 16.0 + horizontalRadius * 2.0 || offsetZ > <f64>centerZ + 16.0 + horizontalRadius * 2.0) continue;
      let xMin = javaFloor(offsetX - horizontalRadius) - chunkBlockX - 1, xMax = javaFloor(offsetX + horizontalRadius) - chunkBlockX + 1;
      let yMin = javaFloor(offsetY - verticalRadius) - 1, yMax = javaFloor(offsetY + verticalRadius) + 1;
      let zMin = javaFloor(offsetZ - horizontalRadius) - chunkBlockZ - 1, zMax = javaFloor(offsetZ + horizontalRadius) - chunkBlockZ + 1;
      if (xMin < 0) xMin = 0; if (xMax > 16) xMax = 16; if (yMin < 1) yMin = 1; if (yMax > 120) yMax = 120; if (zMin < 0) zMin = 0; if (zMax > 16) zMax = 16;
      let liquid = false;
      for (let bx = xMin; !liquid && bx < xMax; ++bx) for (let bz = zMin; !liquid && bz < zMax; ++bz) for (let by = yMax + 1; !liquid && by >= yMin - 1; --by) if (by >= 0 && by < 128) {
        const id = chunk.getBlock(bx, by, bz), liquidA = this.nether ? BlockId.FLOWING_LAVA : BlockId.FLOWING_WATER, liquidB = this.nether ? BlockId.LAVA : BlockId.WATER;
        if (id == liquidA || id == liquidB) liquid = true;
        if (by != yMin - 1 && bx != xMin && bx != xMax - 1 && bz != zMin && bz != zMax - 1) by = yMin;
      }
      if (liquid) continue;
      for (let bx = xMin; bx < xMax; ++bx) {
        const localX = (<f64>(bx + chunkBlockX) + 0.5 - offsetX) / horizontalRadius;
        for (let bz = zMin; bz < zMax; ++bz) {
          const localZ = (<f64>(bz + chunkBlockZ) + 0.5 - offsetZ) / horizontalRadius;
          let grass = false;
          if (localX * localX + localZ * localZ >= 1.0) continue;
          for (let by = yMax - 1; by >= yMin; --by) {
            const localY = (<f64>by + 0.5 - offsetY) / verticalRadius;
            if (localY <= -0.7 || localX * localX + localY * localY + localZ * localZ >= 1.0) continue;
            const carvedY = by + 1, id = chunk.getBlock(bx, carvedY, bz);
            if (id == BlockId.GRASS_BLOCK) grass = true;
            const canCarve = this.nether ? id == BlockId.NETHERRACK || id == BlockId.DIRT || id == BlockId.GRASS_BLOCK : id == BlockId.STONE || id == BlockId.DIRT || id == BlockId.GRASS_BLOCK;
            if (!canCarve) continue;
            if (!this.nether && by < 10) chunk.setBlock(bx, carvedY, bz, <u8>BlockId.FLOWING_LAVA);
            else { chunk.setBlock(bx, carvedY, bz, <u8>BlockId.AIR); if (!this.nether && grass && chunk.getBlock(bx, by, bz) == BlockId.DIRT) chunk.setBlock(bx, by, bz, <u8>BlockId.GRASS_BLOCK); }
          }
        }
      }
      if (starting) break;
    }
  }

  private carveSourceChunk(sourceX: i32, sourceZ: i32, centerX: i32, centerZ: i32, chunk: Chunk): void {
    const range = this.nether ? 10 : 40, chance = this.nether ? 5 : 15;
    let caveCount = this.random.nextInt(this.random.nextInt(this.random.nextInt(range) + 1) + 1);
    if (this.random.nextInt(chance) != 0) caveCount = 0;
    for (let i = 0; i < caveCount; ++i) {
      const caveX = sourceX * 16 + this.random.nextInt(16), caveY = this.nether ? this.random.nextInt(128) : this.random.nextInt(this.random.nextInt(120) + 8), caveZ = sourceZ * 16 + this.random.nextInt(16);
      let branches = 1;
      if (this.random.nextInt(4) == 0) { this.carveRoom(centerX, centerZ, chunk, caveX, caveY, caveZ); branches += this.random.nextInt(4); }
      for (let branch = 0; branch < branches; ++branch) {
        const yaw = <f32>(<f32>(this.random.nextFloat() * <f32>Math.PI) * <f32>2.0);
        const pitch = <f32>(<f32>(<f32>(this.random.nextFloat() - <f32>0.5) * <f32>2.0) / <f32>8.0);
        const radius = <f32>(<f32>(this.random.nextFloat() * <f32>2.0) + this.random.nextFloat());
        this.carveTunnel(centerX, centerZ, chunk, caveX, caveY, caveZ, this.nether ? radius * 2.0 : radius, yaw, pitch, 0, 0, this.nether ? 0.5 : 1.0);
      }
    }
  }
}
