import { describe, it, expect } from 'vitest';
import { createSprintRaceModule } from '@/sim/sprint-race';
import { runSim, type SimResult } from '@/sim/engine';
import type { Arena } from '@/sim/arena';
import type { RobotRoster, RobotRosterEntry } from '@/sim/robot-roster';
import { deriveStats, type RobotTraits } from '@/sim/trait-to-stat';
import realArenaJson from '../../assets/data/arenas/arena-01.json';

// ---------------------------------------------------------------------------
// Roster + arena fixtures
// ---------------------------------------------------------------------------

/**
 * Synthetic 85-robot roster with id-derived traits so robots have a wide
 * spread of stats (and thus distinguishable finishing order).
 */
function makeRoster(size: number): RobotRoster {
  const entries: RobotRosterEntry[] = [];
  for (let i = 0; i < size; i++) {
    // Spread traits across the 0..100 range based on id.
    const fullSend = (i * 7) % 101;
    const degen = (i * 11) % 101;
    const cipher = (i * 13) % 101;
    const doubter = (i * 17) % 101;
    const altruist = (i * 19) % 101;
    const traits: RobotTraits = Object.freeze({
      fullSend,
      degen,
      cipher,
      doubter,
      altruist,
    });
    const stats = Object.freeze(deriveStats(traits));
    entries.push(
      Object.freeze({
        id: i,
        name: `robot-${i}`,
        traits,
        stats,
        skinTexturePath: `assets/art/characters/robot/skins/${i}.png`,
      }),
    );
  }
  return Object.freeze(entries);
}

interface ArenaPayload {
  id: string;
  type: string;
  length: number;
  width: number;
  startGrid: { lanes: number; rows: number; laneSpacing: number; rowSpacing: number };
  gates: Array<{ name: string; x: number; cullToCount: number }>;
}

function arena01(): Arena {
  const p = realArenaJson as ArenaPayload;
  return Object.freeze({
    id: p.id,
    type: 'sprint-race' as const,
    length: p.length,
    width: p.width,
    startGrid: Object.freeze({ ...p.startGrid }),
    gates: Object.freeze(p.gates.map((g) => Object.freeze({ ...g }))),
  });
}

/** 10-capacity test arena: 5 lanes × 2 rows, gates with 5/3/1 culls. */
function smallArena(): Arena {
  return Object.freeze({
    id: 'test-small',
    type: 'sprint-race' as const,
    length: 30,
    width: 20,
    startGrid: Object.freeze({ lanes: 5, rows: 2, laneSpacing: 2.0, rowSpacing: 2.0 }),
    gates: Object.freeze([
      Object.freeze({ name: 'gate_a', x: 10, cullToCount: 5 }),
      Object.freeze({ name: 'gate_b', x: 20, cullToCount: 3 }),
      Object.freeze({ name: 'finish', x: 30, cullToCount: 1 }),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function poseFramesHash(frames: SimResult['poseFrames']): string {
  const parts: string[] = [];
  for (const f of frames) {
    let acc = 0;
    for (let i = 0; i < f.data.length; i++) acc += f.data[i] * (i + 1);
    parts.push(`${f.tick}:${acc.toFixed(8)}`);
  }
  return parts.join('|');
}

describe('createSprintRaceModule — full race on arena-01 (AC: end-to-end)', () => {
  it('runs to completion and produces exactly one winner', () => {
    const result = runSim({
      seed: 42,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    expect(result.winnerId).not.toBeNull();
    expect(result.finishOrder).toHaveLength(1);
    const last = result.events[result.events.length - 1];
    expect(last.type).toBe('simEnd');
    if (last.type === 'simEnd') {
      expect(last.reason).toBe('eventDone');
      expect(last.winnerId).toBe(result.winnerId);
    }
  });

  it('three-stage cull totals match the arena schedule (85 → 28 → 10 → 1)', () => {
    const result = runSim({
      seed: 42,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    const elims = result.events.filter(
      (e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination',
    );
    const finishes = result.events.filter(
      (e): e is Extract<typeof e, { type: 'finish' }> => e.type === 'finish',
    );
    // Total accounted-for robots = eliminations + finishes = roster size.
    expect(elims.length + finishes.length).toBe(85);
    // 1 robot finishes (cullToCount=1 on finish gate); 84 eliminated.
    expect(finishes.length).toBe(1);
    expect(elims.length).toBe(84);
    // Cull breakdown by reason.
    const byReason = new Map<string, number>();
    for (const e of elims) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    expect(byReason.get('gate_a_closed')).toBe(85 - 28); // 57
    expect(byReason.get('gate_b_closed')).toBe(28 - 10); // 18
    expect(byReason.get('race_over')).toBe(10 - 1); // 9
  });

  it('completes in well under the 7,200-tick safety stop', () => {
    const result = runSim({
      seed: 42,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    // 240 m at ~6 m/s avg ≈ 40 s ≈ 2,400 ticks at 60 Hz. Generous bound.
    expect(result.ticks).toBeLessThan(4000);
  });
});

describe('createSprintRaceModule — determinism', () => {
  it('produces byte-identical events across two runs with the same seed', () => {
    const a = runSim({
      seed: 7,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    const b = runSim({
      seed: 7,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.winnerId).toBe(b.winnerId);
  });

  it('produces different outcomes for different seeds', () => {
    const a = runSim({
      seed: 1,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
    });
    const b = runSim({
      seed: 2,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
    });
    const samePoses = poseFramesHash(a.poseFrames) === poseFramesHash(b.poseFrames);
    const sameFinish = a.winnerId === b.winnerId && JSON.stringify(a.finishOrder) === JSON.stringify(b.finishOrder);
    expect(samePoses && sameFinish).toBe(false);
  });

  it('seed-driven slot shuffle yields different starting positions per seed', () => {
    // Direct check on the shuffle output: same roster, different seed →
    // different (x, z) for at least some robots on the very first frame.
    const a = runSim({
      seed: 1,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
    });
    const b = runSim({
      seed: 2,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
    });
    const stride = 5;
    const f0a = a.poseFrames[0].data;
    const f0b = b.poseFrames[0].data;
    let differs = 0;
    for (let id = 0; id < 85; id++) {
      const ax = f0a[id * stride + 1];
      const az = f0a[id * stride + 3];
      const bx = f0b[id * stride + 1];
      const bz = f0b[id * stride + 3];
      if (ax !== bx || az !== bz) differs++;
    }
    // Most robots should land in different slots between seeds.
    expect(differs).toBeGreaterThan(60);
  });
});

describe('createSprintRaceModule — gate ordering', () => {
  it('elimination ticks are non-decreasing across the gate sequence', () => {
    const result = runSim({
      seed: 42,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    const elims = result.events.filter(
      (e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination',
    );
    // Group by reason, assert per-reason same tick (single-tick cull),
    // and that gate_a tick < gate_b tick < race_over tick.
    const ticksByReason: Record<string, number[]> = {};
    for (const e of elims) {
      ticksByReason[e.reason] = ticksByReason[e.reason] ?? [];
      ticksByReason[e.reason].push(e.tick);
    }
    for (const [reason, ticks] of Object.entries(ticksByReason)) {
      const allSame = ticks.every((t) => t === ticks[0]);
      expect(allSame, `eliminations for ${reason} should fire on a single tick`).toBe(true);
    }
    expect(ticksByReason['gate_a_closed'][0]).toBeLessThan(ticksByReason['gate_b_closed'][0]);
    expect(ticksByReason['gate_b_closed'][0]).toBeLessThan(ticksByReason['race_over'][0]);
  });

  it('the winner is always among the first robots through gate_a (top 28)', () => {
    const result = runSim({
      seed: 42,
      roster: makeRoster(85),
      arena: arena01(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    expect(result.winnerId).not.toBeNull();
    if (result.winnerId === null) return;
    const winner = result.winnerId;
    // The winner cannot be in the first cull batch.
    const firstCullIds = result.events
      .filter((e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination' && e.reason === 'gate_a_closed')
      .map((e) => e.robotId);
    expect(firstCullIds).not.toContain(winner);
  });
});

describe('createSprintRaceModule — small arena (algorithm clarity)', () => {
  it('5/3/1 cull schedule on a 10-robot field accounts for every robot', () => {
    const result = runSim({
      seed: 5,
      roster: makeRoster(10),
      arena: smallArena(),
      eventModule: createSprintRaceModule(),
      recordPoseFrames: false,
    });
    const elims = result.events.filter(
      (e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination',
    );
    const finishes = result.events.filter(
      (e): e is Extract<typeof e, { type: 'finish' }> => e.type === 'finish',
    );
    expect(elims.length + finishes.length).toBe(10);
    expect(finishes).toHaveLength(1);
    const byReason = new Map<string, number>();
    for (const e of elims) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    expect(byReason.get('gate_a_closed')).toBe(10 - 5);
    expect(byReason.get('gate_b_closed')).toBe(5 - 3);
    expect(byReason.get('race_over')).toBe(3 - 1);
  });
});

describe('createSprintRaceModule — motion invariants', () => {
  it('robots only move forward (+X); position is monotonic non-decreasing', () => {
    const result = runSim({
      seed: 3,
      roster: makeRoster(10),
      arena: smallArena(),
      eventModule: createSprintRaceModule(),
    });
    const stride = 5;
    // For each robot, scan x across pose frames; must be non-decreasing.
    for (let id = 0; id < 10; id++) {
      let prevX = -Infinity;
      for (const frame of result.poseFrames) {
        const x = frame.data[id * stride + 1];
        const active = frame.data[id * stride] === 1;
        if (!active) break; // once inactive, motion may freeze (still non-decreasing)
        expect(x).toBeGreaterThanOrEqual(prevX);
        prevX = x;
      }
    }
  });

  it('lane (z) stays within the arena lateral bounds (separation push is clamped)', () => {
    const result = runSim({
      seed: 3,
      roster: makeRoster(10),
      arena: smallArena(),
      eventModule: createSprintRaceModule(),
    });
    const stride = 5;
    const arena = smallArena();
    const bound = arena.width / 2;
    for (let id = 0; id < 10; id++) {
      for (const frame of result.poseFrames) {
        const z = frame.data[id * stride + 3];
        expect(z).toBeGreaterThanOrEqual(-bound);
        expect(z).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('separation force decongests same-lane catchups (z spreads from start)', () => {
    // Two robots seeded directly behind each other in the same lane should
    // end up on different sides within a few seconds of sim time.
    const arena: Arena = Object.freeze({
      id: 'sep-test',
      type: 'sprint-race' as const,
      length: 100,
      width: 20,
      startGrid: Object.freeze({ lanes: 1, rows: 2, laneSpacing: 2.0, rowSpacing: 1.5 }),
      gates: Object.freeze([
        Object.freeze({ name: 'finish', x: 100, cullToCount: 1 }),
      ]),
    });
    const result = runSim({
      seed: 11,
      roster: makeRoster(2),
      arena,
      eventModule: createSprintRaceModule(),
    });
    const stride = 5;
    // After ~120 ticks (~2 s), each robot's |z| should have grown well
    // past the coincident-lane epsilon — i.e., the tiebreak nudge worked.
    const sample = result.poseFrames[Math.min(120, result.poseFrames.length - 1)];
    const z0 = sample.data[0 * stride + 3];
    const z1 = sample.data[1 * stride + 3];
    expect(Math.abs(z0 - z1)).toBeGreaterThan(0.5);
  });
});

describe('createSprintRaceModule — single-use contract', () => {
  it('reusing the same module instance across two runs is unsupported', () => {
    // Documented as single-use; this test pins the behavior so the contract
    // is observable. If we ever support reuse, this test should change with it.
    const mod = createSprintRaceModule();
    const a = runSim({
      seed: 1,
      roster: makeRoster(10),
      arena: smallArena(),
      eventModule: mod,
      recordPoseFrames: false,
    });
    expect(a.finishOrder).toHaveLength(1);
    // Second run with the same instance: state is stale (final gate already
    // closed), so isDone returns true on tick 0 and the sim ends without
    // running a race.
    const b = runSim({
      seed: 1,
      roster: makeRoster(10),
      arena: smallArena(),
      eventModule: mod,
      recordPoseFrames: false,
    });
    expect(b.ticks).toBe(0);
    expect(b.finishOrder).toHaveLength(0);
  });
});
