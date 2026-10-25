/** Small seeded random number generator (mulberry32): same seed, same sequence. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const weighted = <T>(items: readonly T[], weights: readonly number[]): T => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { next, weighted, int };
}

/** Stable seed from a string, so each brand gets its own sequence. */
export function seedFrom(text: string, base: number): number {
  let h = base >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 2654435761) >>> 0;
  return h;
}
