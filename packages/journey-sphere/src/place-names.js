const HASH_SEED = 0x811c9dc5;

export function normalizePlaceName(name) {
  if (typeof name !== 'string') throw new TypeError('Place names must be strings.');
  const value = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!value) throw new TypeError('Place names must not be empty.');
  return value.toLocaleLowerCase('und');
}

export function placeBucket(name) {
  const value = normalizePlaceName(name);
  let hash = HASH_SEED;
  for (const character of value) {
    for (const byte of new TextEncoder().encode(character)) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).slice(-3).padStart(3, '0');
}

