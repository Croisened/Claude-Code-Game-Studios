import { describe, it, expect, vi } from 'vitest';
import { CONFIG } from '@/config';
import { deriveStats } from '@/sim/trait-to-stat';
import {
  loadRoster,
  type LoadRosterOptions,
  type RobotRosterEntry,
} from '@/sim/robot-roster';
import realTraitsJson from '../../public/traits.json';

interface RawRecord {
  id: number;
  name: string;
  full_send: number;
  degen: number;
  cipher: number;
  doubter: number;
  altruist: number;
}

const REAL_TRAITS: readonly RawRecord[] = realTraitsJson as RawRecord[];

function staticSource(payload: unknown): LoadRosterOptions {
  return { traitsSource: () => Promise.resolve(payload) };
}

function fixture(): RawRecord[] {
  return REAL_TRAITS.map((r) => ({ ...r }));
}

describe('loadRoster — happy path', () => {
  it('loads all 85 entries from the real public/traits.json (AC3)', async () => {
    const roster = await loadRoster(staticSource(fixture()));
    expect(roster).toHaveLength(85);
    for (let i = 0; i < 85; i++) {
      expect(roster[i].id).toBe(i);
      const e = roster[i];
      expect(e.traits).toEqual({
        fullSend: REAL_TRAITS[i].full_send,
        degen: REAL_TRAITS[i].degen,
        cipher: REAL_TRAITS[i].cipher,
        doubter: REAL_TRAITS[i].doubter,
        altruist: REAL_TRAITS[i].altruist,
      });
      expect(e.stats).toEqual(deriveStats(e.traits));
      const expectedPath = CONFIG.renderer.skinTexturePathPattern.replace(
        '{id}',
        String(i),
      );
      expect(e.skinTexturePath).toBe(expectedPath);
    }
  });

  it('Rhapsody Z (id 0) matches the §4 worked example exactly (AC4)', async () => {
    const roster = await loadRoster(staticSource(fixture()));
    const z = roster[0];
    expect(z.id).toBe(0);
    expect(z.name).toBe('Rhapsody Z');
    expect(z.traits).toEqual({
      fullSend: 90,
      degen: 5,
      cipher: 2,
      doubter: 1,
      altruist: 2,
    });
    expect(z.stats.speed).toBeCloseTo(1.22, 9);
    expect(z.stats.acceleration).toBeCloseTo(1.297, 9);
    expect(z.stats.handling).toBeCloseTo(0.33, 9);
    expect(z.stats.pathfinding).toBeCloseTo(0.314, 9);
    expect(z.stats.caution).toBeCloseTo(0.01, 9);
    expect(z.stats.chaos).toBeCloseTo(0.05, 9);
    expect(z.stats.grace).toBeCloseTo(0.02, 9);
    expect(z.skinTexturePath).toBe('assets/art/characters/robot/skins/0.png');
  });

  it('two loads produce JSON-identical rosters (AC5, R10)', async () => {
    const a = await loadRoster(staticSource(fixture()));
    const b = await loadRoster(staticSource(fixture()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('entries expose camelCase trait keys only (AC6)', async () => {
    const roster = await loadRoster(staticSource(fixture()));
    expect(Object.keys(roster[0].traits)).toEqual([
      'fullSend',
      'degen',
      'cipher',
      'doubter',
      'altruist',
    ]);
  });
});

describe('loadRoster — output is frozen (AC7)', () => {
  it('roster, entry, traits, and stats are all frozen', async () => {
    const roster = await loadRoster(staticSource(fixture()));
    expect(Object.isFrozen(roster)).toBe(true);
    expect(Object.isFrozen(roster[0])).toBe(true);
    expect(Object.isFrozen(roster[0].traits)).toBe(true);
    expect(Object.isFrozen(roster[0].stats)).toBe(true);
  });

  it('attempting to mutate an entry throws in strict mode', async () => {
    const roster = await loadRoster(staticSource(fixture()));
    expect(() => {
      (roster[0] as { id: number }).id = 999;
    }).toThrow(TypeError);
  });
});

describe('loadRoster — integrity validation', () => {
  it('rejects on wrong row count (AC8, E3)', async () => {
    const truncated = fixture().slice(0, 3);
    await expect(loadRoster(staticSource(truncated))).rejects.toThrow(/85.*3|3.*85/);
  });

  it('rejects when a record is missing a required field (AC9, E4)', async () => {
    const broken = fixture();
    const target = broken.find((r) => r.id === 42)!;
    delete (target as Partial<RawRecord>).cipher;
    await expect(loadRoster(staticSource(broken))).rejects.toThrow(/42.*cipher|cipher.*42/);
  });

  it('rejects on non-finite trait value (AC10, E5)', async () => {
    const broken = fixture();
    const target = broken.find((r) => r.id === 12)!;
    target.degen = NaN;
    await expect(loadRoster(staticSource(broken))).rejects.toThrow(/12.*degen|degen.*12/);
  });

  it('rejects on duplicate id (AC11, E7)', async () => {
    const broken = fixture();
    broken[8].id = 7;
    await expect(loadRoster(staticSource(broken))).rejects.toThrow(/duplicate id 7/);
  });

  it('rejects when ids do not cover {0..84} (AC12, E8)', async () => {
    const broken = fixture();
    const target = broken.find((r) => r.id === 50)!;
    target.id = 100;
    await expect(loadRoster(staticSource(broken))).rejects.toThrow(/missing.*50|50.*missing/);
    await expect(loadRoster(staticSource(broken))).rejects.toThrow(/unexpected.*100|100.*unexpected/);
  });

  it('rejects when payload is not an array (AC13, E2)', async () => {
    await expect(loadRoster(staticSource({}))).rejects.toThrow(/array/);
  });

  it('propagates traitsSource rejection with cause attached (AC14, E1)', async () => {
    const boom = new Error('boom');
    const opts: LoadRosterOptions = {
      traitsSource: () => Promise.reject(boom),
    };
    try {
      await loadRoster(opts);
      throw new Error('loader should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Failed to load roster: boom/);
      expect((err as Error & { cause?: unknown }).cause).toBe(boom);
    }
  });
});

describe('loadRoster — forward compatibility (AC15, E9)', () => {
  it('ignores extra fields on records', async () => {
    const augmented = fixture().map((r) => ({
      ...r,
      nft_address: '0xDEADBEEF',
    }));
    const roster = await loadRoster(staticSource(augmented));
    expect(roster).toHaveLength(85);
    expect(roster[0]).not.toHaveProperty('nft_address');
    expect((roster[0] as RobotRosterEntry & { nft_address?: string }).nft_address).toBeUndefined();
  });
});

describe('loadRoster — module hygiene (AC16)', () => {
  it('does not invoke Math.random during a successful load', async () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      await loadRoster(staticSource(fixture()));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('loadRoster — concurrency (AC17, E10)', () => {
  it('two simultaneous loads succeed independently', async () => {
    const opts = staticSource(fixture());
    const [a, b] = await Promise.all([loadRoster(opts), loadRoster(opts)]);
    expect(a).not.toBe(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
