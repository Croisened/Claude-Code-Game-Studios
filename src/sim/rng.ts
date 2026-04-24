/**
 * Seedable PRNG (`mulberry32`) — the sole source of stochastic decisions
 * in the Robo Rhapsody Sim.
 *
 * See design/gdd/seedable-prng.md for the full contract. Forbidden:
 * `Math.random()` anywhere else in `src/`, module-level RNG instances,
 * external entropy sources of any kind.
 *
 * Reference: Tommy Ettinger's mulberry32. Public domain.
 */

/**
 * Create a deterministic PRNG seeded by `seed`. Returns a closure that
 * yields the next `number` in `[0, 1)` on each call.
 *
 * Same seed → identical sequence. Two RNGs created with the same seed are
 * independent — advancing one does not affect the other.
 *
 * Seed coercion: any number is mapped to a uint32 via `>>> 0`. Negative
 * seeds wrap; floats truncate; `NaN` / `Infinity` / `-Infinity` all become
 * `0`. Documented behavior, not an error condition.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
