function checkedCoordinate(value, name) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
  return value;
}

export function blockRangeToChunkRange({ minX = -16, maxX = 31, minZ = -16, maxZ = 31 } = {}) {
  minX = checkedCoordinate(minX, "minX");
  maxX = checkedCoordinate(maxX, "maxX");
  minZ = checkedCoordinate(minZ, "minZ");
  maxZ = checkedCoordinate(maxZ, "maxZ");
  [minX, maxX] = [Math.min(minX, maxX), Math.max(minX, maxX)];
  [minZ, maxZ] = [Math.min(minZ, maxZ), Math.max(minZ, maxZ)];
  const minChunkX = Math.floor(minX / 16);
  const maxChunkX = Math.floor(maxX / 16);
  const minChunkZ = Math.floor(minZ / 16);
  const maxChunkZ = Math.floor(maxZ / 16);
  for (const [name, value] of Object.entries({ minChunkX, maxChunkX, minChunkZ, maxChunkZ })) {
    if (value < -0x80000000 || value > 0x7fffffff) throw new RangeError(`${name} is outside the supported 32-bit chunk range`);
  }
  const chunksX = maxChunkX - minChunkX + 1;
  const chunksZ = maxChunkZ - minChunkZ + 1;
  return {
    minChunkX, maxChunkX, minChunkZ, maxChunkZ,
    minBlockX: minChunkX * 16,
    maxBlockX: maxChunkX * 16 + 15,
    minBlockZ: minChunkZ * 16,
    maxBlockZ: maxChunkZ * 16 + 15,
    chunksX, chunksZ, chunkCount: chunksX * chunksZ,
  };
}

export function blockRadiusToChunkRange(radius = 16) {
  radius = checkedCoordinate(radius, "radius");
  if (radius < 0) throw new RangeError("radius must be zero or greater");
  return blockRangeToChunkRange({ minX: -radius, maxX: radius, minZ: -radius, maxZ: radius });
}
