import { describe, it, expect, vi } from 'vitest';
import {
  runSim,
  buildStartPoses,
  POSE_STRIDE,
  type EventModule,
  type RobotPose,
  type SimResult,
  type TickContext,
  type TickResult,
} from '@/sim/engine';
import type { Arena } from '@/sim/arena';
import type { RobotRoster, RobotRosterEntry } from '@/sim/robot-roster';
import type { RobotTraits, SimStats } from '@/sim/trait-to-stat';

// ---------------------------------------------------------------------------
// Test fixtures — small, fully synthetic, frozen
// ---------------------------------------------------------------------------

const TEST_ROSTER_SIZE = 10;
const FINISH_LINE_X = 50;

function makeTraits(): RobotTraits {
  return { fullSend: 50, degen: 50, cipher: 50, doubter: 50, altruist: 50 };
}

function makeStats(): SimStats {
  return {
    speed: 1,
    acceleration: 1,
    handling: 1,
    pathfinding: 1,
    caution: 0.5,
    chaos: 0.5,
    grace: 0.5,
  };
}

function makeRoster(size = TEST_ROSTER_SIZE): RobotRoster {
  const entries: RobotRosterEntry[] = [];
  for (let i = 0; i < size; i++) {
    entries.push(
      Object.freeze({
        id: i,
        name: `robot-${i}`,
        traits: Object.freeze(makeTraits()),
        stats: Object.freeze(makeStats()),
        skinTexturePath: `assets/art/characters/robot/skins/${i}.png`,
      }),
    );
  }
  return Object.freeze(entries);
}

function makeArena(): Arena {
  // 5 lanes * 2 rows = 10 capacity, matching TEST_ROSTER_SIZE.
  return Object.freeze({
    id: 'test-arena',
    type: 'sprint-race' as const,
    length: FINISH_LINE_X,
    width: 20,
    startGrid: Object.freeze({
      lanes: 5,
      rows: 2,
      laneSpacing: 2.0,
      rowSpacing: 2.0,
    }),
    gates: Object.freeze([
      Object.freeze({ name: 'finish', x: FINISH_LINE_X, cullToCount: 1 }),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Stub event module — exercises every engine code path deterministically
// ---------------------------------------------------------------------------

/**
 * A minimal EventModule for engine tests. Each tick, every active robot
 * advances along +X by (speed * stat-jitter * dt). Robots that cross
 * `finishLineX` finish (in id-sorted order each tick). After tick 60,
 * the slowest-x active robot is eliminated each tick to exercise the
 * elimination path. The module uses `rng` for jitter so determinism is
 * end-to-end seeded.
 */
function makeStubModule(opts: { finishLineX: number; cullStartTick?: number }): EventModule {
  const cullStartTick = opts.cullStartTick ?? 60;
  return {
    init: (ctx) => buildStartPoses(ctx.roster, ctx.arena),
    tick: (ctx: TickContext): TickResult => {
      const finishes: { robotId: number }[] = [];
      // Iterate in id order — single source of truth for determinism.
      for (let i = 0; i < ctx.poses.length; i++) {
        const p = ctx.poses[i];
        if (!p.active) continue;
        const stat = ctx.roster[i].stats;
        // rng() called exactly once per active robot per tick.
        const jitter = 0.95 + ctx.rng() * 0.1;
        p.x += stat.speed * jitter * ctx.dtSeconds * 10;
        if (p.x >= opts.finishLineX) {
          finishes.push({ robotId: i });
        }
      }
      const eliminations: { robotId: number; reason: string }[] = [];
      if (ctx.tick >= cullStartTick && finishes.length === 0) {
        // Find slowest active robot (lowest x); break ties by lowest id.
        let slowestId = -1;
        let slowestX = Infinity;
        for (let i = 0; i < ctx.poses.length; i++) {
          const p = ctx.poses[i];
          if (!p.active) continue;
          if (p.x < slowestX) {
            slowestX = p.x;
            slowestId = i;
          }
        }
        if (slowestId !== -1) {
          eliminations.push({ robotId: slowestId, reason: 'slowest' });
        }
      }
      return { eliminations, finishes };
    },
    isDone: (ctx) => {
      // Done when at least one finish has been recorded AND no actives remain
      // that could still finish, OR when only one active remains (winner).
      let activeCount = 0;
      for (const p of ctx.poses) if (p.active) activeCount++;
      return activeCount === 0;
    },
  };
}

function neverDoneModule(): EventModule {
  return {
    init: (ctx) => buildStartPoses(ctx.roster, ctx.arena),
    tick: () => ({}),
    isDone: () => false,
  };
}

function poseFramesHash(frames: SimResult['poseFrames']): string {
  // Stable, cheap hash — sum-of-squared float bits per frame, joined.
  const parts: string[] = [];
  for (const f of frames) {
    let acc = 0;
    for (let i = 0; i < f.data.length; i++) {
      // Multiply by index to keep position-sensitive.
      acc += f.data[i] * (i + 1);
    }
    parts.push(`${f.tick}:${acc.toFixed(8)}`);
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSim — determinism (AC: same seed → same outcome)', () => {
  it('produces byte-identical events and pose frames for the same seed', () => {
    const a = runSim({
      seed: 42,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const b = runSim({
      seed: 42,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(poseFramesHash(a.poseFrames)).toBe(poseFramesHash(b.poseFrames));
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.ticks).toBe(b.ticks);
  });

  it('produces different finish orders for different seeds', () => {
    const a = runSim({
      seed: 42,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const b = runSim({
      seed: 43,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    // Same arena + module + roster, but different seeds must change something.
    // Either pose data or event order — at least one must differ.
    const samePoses = poseFramesHash(a.poseFrames) === poseFramesHash(b.poseFrames);
    const sameEvents = JSON.stringify(a.events) === JSON.stringify(b.events);
    expect(samePoses && sameEvents).toBe(false);
  });
});

describe('runSim — termination', () => {
  it('terminates via eventModule.isDone and emits simEnd with reason "eventDone"', () => {
    const result = runSim({
      seed: 1,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const last = result.events[result.events.length - 1];
    expect(last.type).toBe('simEnd');
    if (last.type === 'simEnd') {
      expect(last.reason).toBe('eventDone');
    }
  });

  it('hits maxTicks safety stop when isDone never returns true', () => {
    const result = runSim({
      seed: 1,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: neverDoneModule(),
      maxTicks: 5,
      recordPoseFrames: false,
    });
    expect(result.ticks).toBe(5);
    const last = result.events[result.events.length - 1];
    expect(last.type).toBe('simEnd');
    if (last.type === 'simEnd') {
      expect(last.reason).toBe('maxTicks');
      expect(last.winnerId).toBeNull();
    }
  });
});

describe('runSim — timeline event ordering', () => {
  it('first event is simStart at tick 0; last event is simEnd', () => {
    const result = runSim({
      seed: 7,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const first = result.events[0];
    const last = result.events[result.events.length - 1];
    expect(first.type).toBe('simStart');
    if (first.type === 'simStart') {
      expect(first.tick).toBe(0);
      expect(first.seed).toBe(7);
      expect(first.arenaId).toBe('test-arena');
      expect(first.rosterSize).toBe(TEST_ROSTER_SIZE);
    }
    expect(last.type).toBe('simEnd');
  });

  it('all event tick numbers are monotonic non-decreasing', () => {
    const result = runSim({
      seed: 11,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    let prev = -1;
    for (const e of result.events) {
      expect(e.tick).toBeGreaterThanOrEqual(prev);
      prev = e.tick;
    }
  });

  it('finish places are 1-indexed and consecutive', () => {
    const result = runSim({
      seed: 13,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const finishes = result.events.filter(
      (e): e is Extract<typeof e, { type: 'finish' }> => e.type === 'finish',
    );
    finishes.forEach((f, i) => {
      expect(f.place).toBe(i + 1);
    });
    // finishOrder mirrors the finish events.
    expect(result.finishOrder).toEqual(finishes.map((f) => f.robotId));
  });
});

describe('runSim — pose frames', () => {
  it('records one pose frame per tick when recordPoseFrames is true', () => {
    const result = runSim({
      seed: 1,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    expect(result.poseFrames.length).toBe(result.ticks);
    for (let i = 0; i < result.poseFrames.length; i++) {
      expect(result.poseFrames[i].tick).toBe(i);
    }
  });

  it('skips pose-frame recording when recordPoseFrames is false', () => {
    const result = runSim({
      seed: 1,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: neverDoneModule(),
      maxTicks: 10,
      recordPoseFrames: false,
    });
    expect(result.poseFrames).toHaveLength(0);
  });

  it('lays out pose data as [active, x, y, z, yaw] per id', () => {
    const result = runSim({
      seed: 1,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    const frame0 = result.poseFrames[0];
    expect(frame0.data.length).toBe(TEST_ROSTER_SIZE * POSE_STRIDE);
    // After tick 0 every robot has advanced along +X past start (start x ≤ 0).
    for (let id = 0; id < TEST_ROSTER_SIZE; id++) {
      const base = id * POSE_STRIDE;
      expect(frame0.data[base]).toBe(1); // active flag
      expect(frame0.data[base + 2]).toBe(0); // y
    }
  });
});

describe('runSim — entropy hygiene', () => {
  it('does not call Math.random anywhere in the engine', () => {
    const spy = vi.spyOn(Math, 'random');
    runSim({
      seed: 99,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X }),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('runSim — elimination semantics', () => {
  it('emits elimination events with correct robotId and reason', () => {
    const result = runSim({
      seed: 5,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X, cullStartTick: 1 }),
    });
    const elims = result.events.filter(
      (e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination',
    );
    expect(elims.length).toBeGreaterThan(0);
    for (const e of elims) {
      expect(e.reason).toBe('slowest');
      expect(e.robotId).toBeGreaterThanOrEqual(0);
      expect(e.robotId).toBeLessThan(TEST_ROSTER_SIZE);
    }
  });

  it('a robot eliminated by the module is marked inactive in subsequent pose frames', () => {
    const result = runSim({
      seed: 5,
      roster: makeRoster(),
      arena: makeArena(),
      eventModule: makeStubModule({ finishLineX: FINISH_LINE_X, cullStartTick: 1 }),
    });
    const firstElim = result.events.find(
      (e): e is Extract<typeof e, { type: 'elimination' }> => e.type === 'elimination',
    );
    expect(firstElim).toBeDefined();
    if (!firstElim) return;
    // Frame at the same tick reflects the elimination already.
    const frame = result.poseFrames[firstElim.tick];
    expect(frame).toBeDefined();
    const activeFlag = frame.data[firstElim.robotId * POSE_STRIDE];
    expect(activeFlag).toBe(0);
  });
});

describe('buildStartPoses helper', () => {
  it('places each robot at its arena start grid slot, all active', () => {
    const arena = makeArena();
    const poses: RobotPose[] = buildStartPoses(makeRoster(), arena);
    expect(poses).toHaveLength(TEST_ROSTER_SIZE);
    for (let i = 0; i < poses.length; i++) {
      expect(poses[i].id).toBe(i);
      expect(poses[i].active).toBe(true);
      expect(poses[i].y).toBe(0);
      expect(poses[i].yaw).toBe(0);
    }
  });

  it('honors slotForId — robot identity stays, but (x, z) follows the permuted slot', () => {
    const arena = makeArena();
    const roster = makeRoster();
    // Slot permutation: reverse order. Robot 0 takes the last slot,
    // robot N-1 takes slot 0.
    const slotForId = roster.map((_, i) => roster.length - 1 - i);
    const permuted = buildStartPoses(roster, arena, slotForId);
    const identity = buildStartPoses(roster, arena);

    for (let i = 0; i < roster.length; i++) {
      // Identity preserved on the pose itself.
      expect(permuted[i].id).toBe(i);
      // Pose at slot[i] should match the identity build at slot[slotForId[i]].
      expect(permuted[i].x).toBeCloseTo(identity[slotForId[i]].x, 9);
      expect(permuted[i].z).toBeCloseTo(identity[slotForId[i]].z, 9);
    }
  });

  it('throws when slotForId length disagrees with roster length', () => {
    const arena = makeArena();
    const roster = makeRoster();
    expect(() =>
      buildStartPoses(roster, arena, roster.slice(0, roster.length - 1).map((_, i) => i)),
    ).toThrow(/slotForId length/);
  });

  it('default behavior unchanged when slotForId is omitted', () => {
    const arena = makeArena();
    const a = buildStartPoses(makeRoster(), arena);
    const b = buildStartPoses(makeRoster(), arena, undefined);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].z).toBe(b[i].z);
    }
  });
});
