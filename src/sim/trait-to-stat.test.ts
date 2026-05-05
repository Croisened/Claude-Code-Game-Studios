import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONFIG } from '@/config';
import {
  deriveStats,
  type RobotTraits,
  type SimStats,
  type SpeedSourceTrait,
} from '@/sim/trait-to-stat';

const ZERO_TRAITS: RobotTraits = {
  fullSend: 0,
  degen: 0,
  cipher: 0,
  doubter: 0,
  altruist: 0,
};

// id 0 from design/data/robots-traits.csv. See trait-to-stat-derivation.md §4.
const RHAPSODY_Z: RobotTraits = {
  fullSend: 90,
  degen: 5,
  cipher: 2,
  doubter: 1,
  altruist: 2,
};

// id 2 from the CSV. Almost-all-Degen profile.
const AACK_PAACK_1: RobotTraits = {
  fullSend: 1,
  degen: 96,
  cipher: 1,
  doubter: 1,
  altruist: 1,
};

const TOLERANCE = 1e-9;

function expectStatsClose(actual: SimStats, expected: SimStats): void {
  expect(actual.speed).toBeCloseTo(expected.speed, 9);
  expect(actual.acceleration).toBeCloseTo(expected.acceleration, 9);
  expect(actual.handling).toBeCloseTo(expected.handling, 9);
  expect(actual.pathfinding).toBeCloseTo(expected.pathfinding, 9);
  expect(actual.caution).toBeCloseTo(expected.caution, 9);
  expect(actual.chaos).toBeCloseTo(expected.chaos, 9);
  expect(actual.grace).toBeCloseTo(expected.grace, 9);
}

describe('deriveStats — output shape', () => {
  it('returns an object with the seven canonical stat fields in declared order (AC1, R4)', () => {
    const stats = deriveStats(ZERO_TRAITS);
    expect(Object.keys(stats)).toEqual([
      'speed',
      'acceleration',
      'handling',
      'pathfinding',
      'caution',
      'chaos',
      'grace',
    ]);
  });
});

describe('deriveStats — determinism (AC3)', () => {
  it('two calls with the same input produce deep-equal output', () => {
    for (const traits of [RHAPSODY_Z, AACK_PAACK_1, ZERO_TRAITS]) {
      const a = deriveStats(traits);
      const b = deriveStats(traits);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('returns a fresh object each call (R2)', () => {
    const a = deriveStats(RHAPSODY_Z);
    const b = deriveStats(RHAPSODY_Z);
    expect(a).not.toBe(b);
  });
});

describe('deriveStats — worked examples (AC4)', () => {
  it('Rhapsody Z (id 0) matches §4 worked example', () => {
    expectStatsClose(deriveStats(RHAPSODY_Z), {
      speed: 1.22,
      acceleration: 1.297,
      handling: 0.33,
      pathfinding: 0.314,
      caution: 0.01,
      chaos: 0.05,
      grace: 0.02,
    });
  });

  it('AACK PAACK 1 (id 2) matches §4 worked example', () => {
    expectStatsClose(deriveStats(AACK_PAACK_1), {
      speed: 0.508,
      acceleration: 0.407,
      handling: 0.503,
      pathfinding: 0.307,
      caution: 0.01,
      chaos: 0.96,
      grace: 0.01,
    });
  });
});

describe('deriveStats — boundary cases', () => {
  it('all-zero traits return CONFIG bases (AC5, E1)', () => {
    expectStatsClose(deriveStats(ZERO_TRAITS), {
      speed: 0.5,
      acceleration: 0.4,
      handling: 0.5,
      pathfinding: 0.3,
      caution: 0,
      chaos: 0,
      grace: 0,
    });
  });

  it('all-max traits (100 each) match §4 ceiling and prove subtractive coefficient signs (AC6, E2)', () => {
    const max: RobotTraits = {
      fullSend: 100,
      degen: 100,
      cipher: 100,
      doubter: 100,
      altruist: 100,
    };
    expectStatsClose(deriveStats(max), {
      speed: 1.3,
      acceleration: 1.1,
      handling: 0.8,
      pathfinding: 1.0,
      caution: 1.0,
      chaos: 1.0,
      grace: 1.0,
    });
  });

  it('fullSend = 200 produces speed = 2.10, proving no clamping (AC9, R7)', () => {
    const stats = deriveStats({ ...ZERO_TRAITS, fullSend: 200 });
    expect(stats.speed).toBeCloseTo(2.1, 9);
  });
});

describe('deriveStats — trait isolation (AC7, AC8)', () => {
  // Per §4 coefficient table, each trait affects exactly these stats:
  //   fullSend  → speed, acceleration, handling
  //   degen     → chaos
  //   cipher    → handling, pathfinding
  //   doubter   → acceleration, caution
  //   altruist  → grace

  function diffKeys(low: SimStats, high: SimStats): string[] {
    const keys: (keyof SimStats)[] = [
      'speed',
      'acceleration',
      'handling',
      'pathfinding',
      'caution',
      'chaos',
      'grace',
    ];
    return keys.filter((k) => Math.abs(low[k] - high[k]) > TOLERANCE);
  }

  it('fullSend affects only speed, acceleration, handling', () => {
    const low = deriveStats(ZERO_TRAITS);
    const high = deriveStats({ ...ZERO_TRAITS, fullSend: 50 });
    expect(diffKeys(low, high).sort()).toEqual(
      ['acceleration', 'handling', 'speed'].sort(),
    );
  });

  it('degen affects only chaos', () => {
    const low = deriveStats(ZERO_TRAITS);
    const high = deriveStats({ ...ZERO_TRAITS, degen: 50 });
    expect(diffKeys(low, high)).toEqual(['chaos']);
  });

  it('cipher affects only handling, pathfinding', () => {
    const low = deriveStats(ZERO_TRAITS);
    const high = deriveStats({ ...ZERO_TRAITS, cipher: 50 });
    expect(diffKeys(low, high).sort()).toEqual(['handling', 'pathfinding'].sort());
  });

  it('doubter affects only acceleration, caution', () => {
    const low = deriveStats(ZERO_TRAITS);
    const high = deriveStats({ ...ZERO_TRAITS, doubter: 50 });
    expect(diffKeys(low, high).sort()).toEqual(['acceleration', 'caution'].sort());
  });

  it('altruist affects only grace (AC7, R9)', () => {
    const low = deriveStats({ ...RHAPSODY_Z, altruist: 0 });
    const high = deriveStats({ ...RHAPSODY_Z, altruist: 80 });
    expect(diffKeys(low, high)).toEqual(['grace']);
    expect(high.grace - low.grace).toBeCloseTo(0.8, 9);
  });
});

describe('deriveStats — coefficient sourcing (AC10, R5)', () => {
  const originalSpeedBase = CONFIG.sim.traitToStat.speed.base;

  afterEach(() => {
    (CONFIG as { sim: { traitToStat: { speed: { base: number } } } }).sim.traitToStat.speed.base = originalSpeedBase;
  });

  it('reads coefficients from CONFIG at call time, not at module load', () => {
    const sentinel = 99;
    (CONFIG as { sim: { traitToStat: { speed: { base: number } } } }).sim.traitToStat.speed.base = sentinel;
    const stats = deriveStats(ZERO_TRAITS);
    expect(stats.speed).toBe(sentinel);
  });
});

describe('deriveStats — speedSourceTrait override', () => {
  // The trait-wheel feature picks one of the 5 traits per race to drive
  // `stat.speed`. With the default arg, behaviour is unchanged (covered by
  // the worked-example tests above). These tests confirm:
  //   - Each trait key produces the expected stat.speed.
  //   - Only stat.speed changes; the other six stats are unaffected.

  const k = CONFIG.sim.traitToStat;

  it('default arg matches no-arg behaviour for fullSend driver', () => {
    expect(deriveStats(RHAPSODY_Z)).toEqual(
      deriveStats(RHAPSODY_Z, { speedSourceTrait: 'fullSend' }),
    );
  });

  it.each<SpeedSourceTrait>(['fullSend', 'degen', 'cipher', 'doubter', 'altruist'])(
    'speedSourceTrait=%s drives stat.speed off the named trait',
    (trait) => {
      const stats = deriveStats(AACK_PAACK_1, { speedSourceTrait: trait });
      const expectedSpeed =
        k.speed.base + k.speed.fullSendCoeff * (AACK_PAACK_1[trait] / 100);
      expect(stats.speed).toBeCloseTo(expectedSpeed, 9);
    },
  );

  it('changing speedSourceTrait does not change other stats', () => {
    const otherKeys: (keyof SimStats)[] = [
      'acceleration',
      'handling',
      'pathfinding',
      'caution',
      'chaos',
      'grace',
    ];
    const baseline = deriveStats(RHAPSODY_Z);
    for (const trait of ['degen', 'cipher', 'doubter', 'altruist'] as SpeedSourceTrait[]) {
      const swapped = deriveStats(RHAPSODY_Z, { speedSourceTrait: trait });
      for (const key of otherKeys) {
        expect(swapped[key]).toBeCloseTo(baseline[key], 9);
      }
    }
  });

  it('AACK PAACK 1 with degen as speed driver is FAST (validates the player-agency feature)', () => {
    // AACK PAACK 1 has fullSend=1 (slow by default) but degen=96 (max chaos).
    // With degen driving speed, the same robot should now have stat.speed
    // near the top of the range (≈ Rhapsody Z's default speed).
    const aack = deriveStats(AACK_PAACK_1, { speedSourceTrait: 'degen' });
    const z = deriveStats(RHAPSODY_Z);
    expect(aack.speed).toBeGreaterThan(z.speed); // 1.268 > 1.22
  });
});

describe('deriveStats — module hygiene (AC11)', () => {
  it('does not invoke Math.random for any reasonable input', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const inputs: RobotTraits[] = [
        ZERO_TRAITS,
        RHAPSODY_Z,
        AACK_PAACK_1,
        { fullSend: 100, degen: 100, cipher: 100, doubter: 100, altruist: 100 },
      ];
      for (const t of inputs) deriveStats(t);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
