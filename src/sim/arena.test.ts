import { describe, it, expect, vi } from 'vitest';
import {
  loadArena,
  getStartPosition,
  type Arena,
  type LoadArenaOptions,
} from '@/sim/arena';
import realArenaJson from '../../assets/data/arenas/arena-01.json';

interface ArenaPayload {
  id: string;
  type: string;
  length: number;
  width: number;
  startGrid: {
    lanes: number;
    rows: number;
    laneSpacing: number;
    rowSpacing: number;
  };
  gates: Array<{ name: string; x: number; cullToCount: number }>;
}

const REAL_PAYLOAD = realArenaJson as ArenaPayload;

function fixture(): ArenaPayload {
  return {
    id: REAL_PAYLOAD.id,
    type: REAL_PAYLOAD.type,
    length: REAL_PAYLOAD.length,
    width: REAL_PAYLOAD.width,
    startGrid: { ...REAL_PAYLOAD.startGrid },
    gates: REAL_PAYLOAD.gates.map((g) => ({ ...g })),
  };
}

function staticSource(payload: unknown): LoadArenaOptions {
  return { arenaSource: () => Promise.resolve(payload) };
}

describe('loadArena — happy path (AC3, AC4)', () => {
  it('loads the real arena-01.json from disk fixture', async () => {
    const arena = await loadArena(staticSource(fixture()));
    expect(arena.id).toBe('arena-01');
    expect(arena.type).toBe('sprint-race');
    expect(arena.length).toBe(240);
    expect(arena.width).toBe(40);
    expect(arena.startGrid).toEqual({
      lanes: 17,
      rows: 5,
      laneSpacing: 2.0,
      rowSpacing: 2.0,
    });
    expect(arena.gates).toHaveLength(3);
    expect(arena.gates[0]).toEqual({ name: 'gate_a', x: 80, cullToCount: 28 });
    expect(arena.gates[1]).toEqual({ name: 'gate_b', x: 160, cullToCount: 10 });
    expect(arena.gates[2]).toEqual({ name: 'finish', x: 240, cullToCount: 1 });
  });

  it('produces deep-equal arenas across two loads (AC5)', async () => {
    const a = await loadArena(staticSource(fixture()));
    const b = await loadArena(staticSource(fixture()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('loadArena — output is frozen (AC6)', () => {
  it('arena, startGrid, gates array, and individual gates are all frozen', async () => {
    const arena = await loadArena(staticSource(fixture()));
    expect(Object.isFrozen(arena)).toBe(true);
    expect(Object.isFrozen(arena.startGrid)).toBe(true);
    expect(Object.isFrozen(arena.gates)).toBe(true);
    expect(Object.isFrozen(arena.gates[0])).toBe(true);
  });

  it('mutation throws TypeError in strict mode', async () => {
    const arena = await loadArena(staticSource(fixture()));
    expect(() => {
      (arena as { length: number }).length = 999;
    }).toThrow(TypeError);
  });
});

describe('getStartPosition (AC7, AC8, AC9)', () => {
  async function loadArena01(): Promise<Arena> {
    return loadArena(staticSource(fixture()));
  }

  it('id 0 is the leftmost front-row position (AC7)', async () => {
    const p = getStartPosition(await loadArena01(), 0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(-16, 9);
  });

  it('id 8 is the centerline front-row position (AC7)', async () => {
    const p = getStartPosition(await loadArena01(), 8);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('id 17 is the leftmost second-row position (AC7)', async () => {
    const p = getStartPosition(await loadArena01(), 17);
    expect(p.x).toBeCloseTo(-2, 9);
    expect(p.z).toBeCloseTo(-16, 9);
  });

  it('id 84 is the rightmost back-row position (AC7)', async () => {
    const p = getStartPosition(await loadArena01(), 84);
    expect(p.x).toBeCloseTo(-8, 9);
    expect(p.z).toBeCloseTo(16, 9);
  });

  it('covers the full roster with no duplicate positions (AC8)', async () => {
    const arena = await loadArena01();
    const seen = new Set<string>();
    for (let id = 0; id < 85; id++) {
      const p = getStartPosition(arena, id);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      expect(p.x).toBeLessThanOrEqual(0);
      expect(p.z).toBeGreaterThanOrEqual(-16);
      expect(p.z).toBeLessThanOrEqual(16);
      const key = `${p.x},${p.z}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(85);
  });

  it('rejects out-of-range robotId (AC9)', async () => {
    const arena = await loadArena01();
    expect(() => getStartPosition(arena, -1)).toThrow(/getStartPosition.*-1/);
    expect(() => getStartPosition(arena, 85)).toThrow(/getStartPosition.*85/);
    expect(() => getStartPosition(arena, 1.5)).toThrow(/getStartPosition.*1\.5/);
    expect(() => getStartPosition(arena, NaN)).toThrow(/getStartPosition.*NaN/);
  });
});

describe('loadArena — IO and structural validation', () => {
  it('propagates source rejection with cause attached (AC10, E1)', async () => {
    const boom = new Error('boom');
    const opts: LoadArenaOptions = {
      arenaSource: () => Promise.reject(boom),
    };
    try {
      await loadArena(opts);
      throw new Error('loader should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Failed to load arena: boom/);
      expect((err as Error & { cause?: unknown }).cause).toBe(boom);
    }
  });

  it('rejects non-object payloads (AC11, E2)', async () => {
    await expect(loadArena(staticSource([1, 2, 3]))).rejects.toThrow(/object/);
    await expect(loadArena(staticSource('hello'))).rejects.toThrow(/object/);
    await expect(loadArena(staticSource(null))).rejects.toThrow(/object/);
  });

  it('rejects when each top-level field is missing in turn (AC12, E3)', async () => {
    const fields = ['id', 'type', 'length', 'width', 'startGrid', 'gates'] as const;
    for (const field of fields) {
      const broken = fixture() as unknown as Record<string, unknown>;
      delete broken[field];
      await expect(loadArena(staticSource(broken))).rejects.toThrow(
        new RegExp(`missing required field ${field}`),
      );
    }
  });

  it('rejects unsupported type (AC13, E4)', async () => {
    const broken = fixture();
    broken.type = 'maze-run';
    await expect(loadArena(staticSource(broken))).rejects.toThrow(/maze-run.*sprint-race|sprint-race.*maze-run/);
  });
});

describe('loadArena — numeric validation', () => {
  it('rejects non-finite numerics (AC14, E5)', async () => {
    const a = fixture();
    a.length = NaN;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/length.*finite|finite.*length/);

    const b = fixture();
    b.width = Infinity;
    await expect(loadArena(staticSource(b))).rejects.toThrow(/width.*finite|finite.*width/);

    const c = fixture();
    (c.gates[0] as { x: unknown }).x = 'eighty';
    await expect(loadArena(staticSource(c))).rejects.toThrow(/gates\[0\]\.x.*finite|finite.*gates\[0\]\.x/);
  });

  it('rejects non-positive geometry (AC15, E6)', async () => {
    const a = fixture();
    a.length = 0;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/> 0/);

    const b = fixture();
    b.width = -10;
    await expect(loadArena(staticSource(b))).rejects.toThrow(/> 0/);
  });
});

describe('loadArena — gate validation (AC16)', () => {
  it('rejects empty gates array (E7)', async () => {
    const a = fixture();
    a.gates = [];
    await expect(loadArena(staticSource(a))).rejects.toThrow(/at least 2 gates/);
  });

  it('rejects gates length 1 (E7)', async () => {
    const a = fixture();
    a.gates = [{ name: 'finish', x: 240, cullToCount: 1 }];
    await expect(loadArena(staticSource(a))).rejects.toThrow(/at least 2 gates/);
  });

  it('rejects non-ascending gate X (E8)', async () => {
    const a = fixture();
    a.gates[1].x = 80; // same as gate_a
    await expect(loadArena(staticSource(a))).rejects.toThrow(/strictly ascending|ascending/);
  });

  it('rejects finish at wrong X (E9)', async () => {
    const a = fixture();
    a.gates[2].x = 200; // length is 240
    await expect(loadArena(staticSource(a))).rejects.toThrow(/finish.*x = length|length.*finish/);
  });

  it('rejects first gate at x=0 (E10)', async () => {
    const a = fixture();
    a.gates[0].x = 0;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/first gate.*x > 0/);
  });

  it('rejects culls not strictly decreasing (E11)', async () => {
    const a = fixture();
    a.gates[1].cullToCount = 28; // same as gate_a
    await expect(loadArena(staticSource(a))).rejects.toThrow(/strictly decrease/);
  });
});

describe('loadArena — cull threshold validation (AC17, AC18)', () => {
  it('rejects cullToCount = 0 (E12)', async () => {
    const a = fixture();
    a.gates[2].cullToCount = 0;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/positive integer/);
  });

  it('rejects negative cullToCount (E12)', async () => {
    const a = fixture();
    a.gates[2].cullToCount = -1;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/positive integer/);
  });

  it('rejects fractional cullToCount (E12)', async () => {
    const a = fixture();
    a.gates[1].cullToCount = 1.5;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/positive integer/);
  });

  it('rejects first-gate cull >= grid capacity (E13, AC18)', async () => {
    const a = fixture();
    a.gates[0].cullToCount = 85; // capacity is 17*5 = 85
    await expect(loadArena(staticSource(a))).rejects.toThrow(/cull no robots/);
  });
});

describe('loadArena — startGrid validation (AC19)', () => {
  it('rejects capacity < 85 (E14)', async () => {
    const a = fixture();
    a.startGrid.lanes = 10;
    a.startGrid.rows = 5; // 50 < 85
    await expect(loadArena(staticSource(a))).rejects.toThrow(/at least 85/);
  });

  it('rejects grid wider than course (E15)', async () => {
    const a = fixture();
    a.startGrid.lanes = 30;
    a.startGrid.rows = 3; // 90 capacity, but (30-1)*2 = 58 > width 40
    await expect(loadArena(staticSource(a))).rejects.toThrow(/does not fit/);
  });

  it('rejects non-integer lanes (E16)', async () => {
    const a = fixture();
    (a.startGrid as { lanes: unknown }).lanes = 17.5;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/positive integer/);
  });

  it('rejects zero rows (E16)', async () => {
    const a = fixture();
    a.startGrid.rows = 0;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/positive integer/);
  });

  it('rejects non-positive spacing (E17)', async () => {
    const a = fixture();
    a.startGrid.laneSpacing = 0;
    await expect(loadArena(staticSource(a))).rejects.toThrow(/> 0/);

    const b = fixture();
    b.startGrid.rowSpacing = -1;
    await expect(loadArena(staticSource(b))).rejects.toThrow(/> 0/);
  });
});

describe('loadArena — forward compat + name validation (AC20, AC21)', () => {
  it('ignores extra top-level fields (AC20, E18)', async () => {
    const augmented = { ...fixture(), theme: 'neon', weather: 'rain' };
    const arena = await loadArena(staticSource(augmented));
    expect((arena as Arena & { theme?: string }).theme).toBeUndefined();
    expect((arena as Arena & { weather?: string }).weather).toBeUndefined();
  });

  it('rejects empty arena id (AC21, E19)', async () => {
    const a = fixture();
    a.id = '';
    await expect(loadArena(staticSource(a))).rejects.toThrow(/non-empty string/);
  });

  it('rejects empty gate name (AC21, E19)', async () => {
    const a = fixture();
    a.gates[0].name = '';
    await expect(loadArena(staticSource(a))).rejects.toThrow(/non-empty string/);
  });

  it('rejects duplicate gate names (AC21, E20)', async () => {
    const a = fixture();
    a.gates[1].name = 'gate_a';
    await expect(loadArena(staticSource(a))).rejects.toThrow(/unique.*gate_a|gate_a.*unique/);
  });
});

describe('loadArena — module hygiene + concurrency (AC22, AC23)', () => {
  it('does not invoke Math.random during a successful load (AC22)', async () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      await loadArena(staticSource(fixture()));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('two simultaneous loads succeed independently (AC23)', async () => {
    const opts = staticSource(fixture());
    const [a, b] = await Promise.all([loadArena(opts), loadArena(opts)]);
    expect(a).not.toBe(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
