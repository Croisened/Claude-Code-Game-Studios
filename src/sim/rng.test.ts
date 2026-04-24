import { describe, it, expect } from 'vitest';
import { createRng } from '@/sim/rng';

const SEEDS_FOR_RANGE_CHECK = [0, 1, 42, 65535, 0xffffffff];

function take(rng: () => number, n: number): number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = rng();
  return out;
}

describe('createRng', () => {
  it('returns a function', () => {
    expect(typeof createRng(0)).toBe('function');
  });

  it('outputs values in [0, 1) across diverse seeds (10k samples each)', () => {
    for (const seed of SEEDS_FOR_RANGE_CHECK) {
      const rng = createRng(seed);
      for (let i = 0; i < 10_000; i++) {
        const x = rng();
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
      }
    }
  });

  it('produces identical sequences for the same seed', () => {
    const a = take(createRng(42), 100);
    const b = take(createRng(42), 100);
    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const a = take(createRng(1), 100);
    const b = take(createRng(2), 100);
    expect(a).not.toEqual(b);
  });

  it('keeps independent state across instances with the same seed', () => {
    // Reference: a single rng called 100 times.
    const reference = take(createRng(7), 100);

    // Instance A: collect first 50, then next 50 separately.
    const a = createRng(7);
    const aFirst50 = take(a, 50);
    const aNext50 = take(a, 50);

    expect(aFirst50).toEqual(reference.slice(0, 50));
    expect(aNext50).toEqual(reference.slice(50, 100));

    // Instance B created AFTER A advanced still starts from seed 7's beginning.
    const bFirst50 = take(createRng(7), 50);
    expect(bFirst50).toEqual(reference.slice(0, 50));
  });

  it('matches V8-verified mulberry32 reference values for seed=0 (strict equality)', () => {
    const rng = createRng(0);
    expect(rng()).toBe(0.26642920868471265);
    expect(rng()).toBe(0.0003297457005828619);
    expect(rng()).toBe(0.2232720274478197);
  });

  it('coerces negative seed to its uint32 wrap', () => {
    expect(take(createRng(-1), 10)).toEqual(take(createRng(0xffffffff), 10));
  });

  it('coerces NaN, Infinity, -Infinity to seed 0', () => {
    const baseline = take(createRng(0), 10);
    expect(take(createRng(NaN), 10)).toEqual(baseline);
    expect(take(createRng(Infinity), 10)).toEqual(baseline);
    expect(take(createRng(-Infinity), 10)).toEqual(baseline);
  });

  it('coerces float seed to truncated integer', () => {
    expect(take(createRng(3.7), 10)).toEqual(take(createRng(3), 10));
    expect(take(createRng(0.5), 10)).toEqual(take(createRng(0), 10));
  });

  it('never outputs exactly 1.0 across 100k calls (sanity check)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100_000; i++) {
      expect(rng()).toBeLessThan(1);
    }
  });
});
