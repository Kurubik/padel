/**
 * Deterministic, seedable PRNG (mulberry32) so simulation and bot decisions are
 * reproducible in tests and identical on every client for a given server seed.
 */
export type Rng = {
  next(): number;
  range(min: number, max: number): number;
  int(minInclusive: number, maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  state(): number;
};

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    state: () => s >>> 0,
  };
}

/** Deterministic hash used to derive per-room / per-shot seeds from strings. */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261 >>> 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
