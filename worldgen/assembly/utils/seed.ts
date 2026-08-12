export function javaStringHashCode(value: string): i32 {
  let hash: i32 = 0;
  for (let index = 0; index < value.length; ++index) hash = hash * 31 + value.charCodeAt(index);
  return hash;
}

function decimalSeed(value: string): i64 {
  let index = 0;
  let negative = false;
  if (value.length == 0) return i64.MIN_VALUE;
  const first = value.charCodeAt(0);
  if (first == 43 || first == 45) {
    negative = first == 45;
    if (++index == value.length) return i64.MIN_VALUE;
  }
  const limit = negative ? i64.MIN_VALUE : -i64.MAX_VALUE;
  const multiplyLimit = limit / 10;
  let result: i64 = 0;
  while (index < value.length) {
    const digit = value.charCodeAt(index++) - 48;
    if (digit < 0 || digit > 9 || result < multiplyLimit) return i64.MIN_VALUE;
    result *= 10;
    if (result < limit + digit) return i64.MIN_VALUE;
    result -= digit;
  }
  return negative ? result : -result;
}

export function parseBetaSeed(value: string, randomSeed: i64): i64 {
  if (value.length == 0) return randomSeed;
  const parsed = decimalSeed(value);
  if (parsed != i64.MIN_VALUE || value == "-9223372036854775808") return parsed == 0 ? randomSeed : parsed;
  return javaStringHashCode(value);
}
