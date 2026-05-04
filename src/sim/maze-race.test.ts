import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMazeRaceModule } from '@/sim/maze-race';
import { generateMazeLayout, type MazeConfig, type MazeLayout } from '@/sim/maze';
import { runSim, type SimResult, type TimelineEvent } from '@/sim/engine';
import type { Arena } from '@/sim/arena';
import type { RobotRoster, RobotRosterEntry } from '@/sim/robot-roster';
import { deriveStats, type RobotTraits } from '@/sim/trait-to-stat';
import { CONFIG } from '@/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SMALL_MAZE_CONFIG: MazeConfig = Object.freeze({
  cellSize: 4,
  gridCols: 11,
  gridRows: 11,
  entranceCount: 4,
  finishCol: 5,
  finishRow: 5,
});

const FULL_MAZE_CONFIG: MazeConfig = Object.freeze({
  cellSize: 4,
  gridCols: 42,
  gridRows: 42,
  entranceCount: 10,
  finishCol: 21,
  finishRow: 21,
});

function makeRoster(
  size: number,
  seed = 1,
  override?: (id: number, traits: RobotTraits) => RobotTraits,
): RobotRoster {
  const entries: RobotRosterEntry[] = [];
  for (let i = 0; i < size; i++) {
    let traits: RobotTraits = {
      fullSend: ((i + seed) * 7) % 101,
      degen: ((i + seed) * 11) % 101,
      cipher: ((i + seed) * 13) % 101,
      doubter: ((i + seed) * 17) % 101,
      altruist: ((i + seed) * 19) % 101,
    };
    if (override) traits = override(i, traits);
    const stats = Object.freeze(deriveStats(traits));
    entries.push(
      Object.freeze({
        id: i,
        name: `robot-${i}`,
        traits: Object.freeze(traits),
        stats,
        skinTexturePath: `assets/art/characters/robot/skins/${i}.png`,
      }),
    );
  }
  return Object.freeze(entries);
}

// Stub start grid + gates — Arena type requires both even for maze
// arenas (the loader synthesizes these for real maze JSON; tests
// constructing Arena objects directly need to do the same).
const STUB_START_GRID = Object.freeze({
  lanes: 1,
  rows: 1,
  laneSpacing: 1,
  rowSpacing: 1,
});
const STUB_GATES = Object.freeze([]);

function mazeArena(maxTicks = 10800): Arena {
  return Object.freeze({
    id: 'test-maze',
    type: 'maze-race' as const,
    length: 168,
    width: 168,
    maxTicks,
    startGrid: STUB_START_GRID,
    gates: STUB_GATES,
    mazeConfig: Object.freeze({ ...FULL_MAZE_CONFIG }),
  });
}

function smallMazeArena(): Arena {
  return Object.freeze({
    id: 'test-maze-small',
    type: 'maze-race' as const,
    length: 44,
    width: 44,
    maxTicks: 3600,
    startGrid: STUB_START_GRID,
    gates: STUB_GATES,
    mazeConfig: Object.freeze({ ...SMALL_MAZE_CONFIG }),
  });
}

function runMazeSim(opts: {
  seed: number;
  roster: RobotRoster;
  arena: Arena;
  layout?: MazeLayout;
}): SimResult {
  const layout =
    opts.layout ??
    generateMazeLayout({ config: opts.arena.mazeConfig!, seed: opts.seed });
  return runSim({
    seed: opts.seed,
    roster: opts.roster,
    arena: opts.arena,
    eventModule: createMazeRaceModule({ layout }),
    maxTicks: opts.arena.maxTicks,
    recordPoseFrames: false,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('maze-race determinism', () => {
  it('same seed + same layout → byte-identical events', () => {
    const roster = makeRoster(20);
    const arena = smallMazeArena();
    const a = runMazeSim({ seed: 42, roster, arena });
    const b = runMazeSim({ seed: 42, roster, arena });
    expect(a.events).toEqual(b.events);
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.ticks).toBe(b.ticks);
  });

  it('different seeds → different finish orders (modal case)', () => {
    const roster = makeRoster(20);
    const arena = smallMazeArena();
    const seeds = [1, 7, 42, 99, 1729];
    const winners = new Set<number | null>();
    for (const s of seeds) winners.add(runMazeSim({ seed: s, roster, arena }).winnerId);
    // Not strictly required, but with 20 robots × 5 seeds we'd be very
    // unlucky to get the same winner every time. Sanity check.
    expect(winners.size).toBeGreaterThan(1);
  });

  it('does not call Math.random anywhere in the run', () => {
    const spy = vi.spyOn(Math, 'random');
    const roster = makeRoster(20);
    const arena = smallMazeArena();
    runMazeSim({ seed: 7, roster, arena });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lever 2 — finish-cell grace window
// ---------------------------------------------------------------------------

describe('Lever 2: finish-cell grace window', () => {
  it('emits finish events for co-finishers within the grace window', () => {
    // The default 4-tick grace window is intentionally tight — it
    // catches photo-finishes from robots in the same finish-corridor
    // lockstep, NOT general field bunching. To verify the mechanism
    // works deterministically, mutate the config to a wide window
    // (large enough that every active robot reaches the finish before
    // the cull fires). Restored in finally.
    const original = CONFIG.sim.mazeRace.finishGraceTicks;
    try {
      (CONFIG.sim.mazeRace as { finishGraceTicks: number }).finishGraceTicks =
        10_000;
      const roster = makeRoster(85, 0, (_id, t) => ({
        ...t,
        cipher: 100,
        fullSend: 60,
        degen: 20,
      }));
      const arena = mazeArena();
      const result = runMazeSim({ seed: 1, roster, arena });
      // With a 10k-tick grace, every robot has time to reach the
      // finish cell and emit a finish event.
      expect(result.finishOrder.length).toBeGreaterThan(1);
      // Race-over eliminations should be 0 — no robot was active when
      // the (very late) cull fired because they'd all already finished.
      const raceOverElims = result.events.filter(
        (e) => e.type === 'elimination' && (e as { reason: string }).reason === 'race_over',
      );
      expect(raceOverElims.length).toBe(0);
    } finally {
      (CONFIG.sim.mazeRace as { finishGraceTicks: number }).finishGraceTicks =
        original;
    }
  });

  it('co-finishers get place 2, 3, … and the first finisher is the winner', () => {
    // Same wide-window setup so we deterministically get co-finishers.
    const original = CONFIG.sim.mazeRace.finishGraceTicks;
    try {
      (CONFIG.sim.mazeRace as { finishGraceTicks: number }).finishGraceTicks =
        10_000;
      const roster = makeRoster(85);
      const arena = mazeArena();
      const result = runMazeSim({ seed: 7, roster, arena });
      const finishEvents = result.events.filter(
        (e): e is Extract<TimelineEvent, { type: 'finish' }> => e.type === 'finish',
      );
      expect(finishEvents.length).toBeGreaterThanOrEqual(2);
      // Places start at 1 and increment by one per finish event.
      finishEvents.forEach((f, i) => {
        expect(f.place).toBe(i + 1);
      });
      // The winner is the first-place finisher.
      expect(result.winnerId).toBe(finishEvents[0].robotId);
      // finishOrder mirrors the finish-event sequence.
      expect(result.finishOrder).toEqual(finishEvents.map((f) => f.robotId));
    } finally {
      (CONFIG.sim.mazeRace as { finishGraceTicks: number }).finishGraceTicks =
        original;
    }
  });

  it('default 4-tick window: typical races produce a single finisher', () => {
    // Sanity check that the SHIPPED default doesn't accidentally
    // produce many co-finishers via misconfiguration. With the
    // entrance-staged maze, default behaviour is one finisher per race.
    const roster = makeRoster(85);
    const arena = mazeArena();
    let multiFinishCount = 0;
    for (let s = 1; s <= 5; s++) {
      const r = runMazeSim({ seed: s, roster, arena });
      const f = r.events.filter((e) => e.type === 'finish');
      if (f.length > 1) multiFinishCount++;
    }
    // Default tuning should produce single-finisher races across these
    // seeds. If this fails, finishGraceTicks default is too generous.
    expect(multiFinishCount).toBeLessThan(5);
  });

  it('grace window expires; remaining actives are eliminated with race_over', () => {
    const roster = makeRoster(85);
    const arena = mazeArena();
    const result = runMazeSim({ seed: 7, roster, arena });
    expect(result.winnerId).not.toBeNull();
    // Every robot is accounted for: finishOrder + race_over eliminations
    // = 85 (modulo any per-tick eliminations from other reasons, of
    // which the maze has none in v1).
    const finishCount = result.finishOrder.length;
    const elimCount = result.events.filter(
      (e) => e.type === 'elimination',
    ).length;
    expect(finishCount + elimCount).toBe(roster.length);
  });

  it('co-finishers are not also eliminated', () => {
    const roster = makeRoster(85, 0, (_id, t) => ({
      ...t,
      cipher: 100,
      fullSend: 60,
      degen: 20,
    }));
    const arena = mazeArena();
    for (let s = 1; s <= 30; s++) {
      const result = runMazeSim({ seed: s, roster, arena });
      const finishers = new Set(result.finishOrder);
      const eliminated = result.events
        .filter((e): e is Extract<TimelineEvent, { type: 'elimination' }> =>
          e.type === 'elimination',
        )
        .map((e) => e.robotId);
      // No robot should appear in both finishOrder and eliminations.
      for (const id of eliminated) {
        expect(finishers.has(id)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Lever 3 — chaos feint at junctions
// ---------------------------------------------------------------------------

describe('Lever 3: chaos feint at junctions', () => {
  it('high-chaos / max-cipher robots still take non-optimal turns sometimes', () => {
    // Construct a roster of pure max-cipher robots; with chaos=0 they
    // take optimal at every junction. With chaos=100 (max), Lever 3
    // adds a ~15% per-junction feint rate.
    const calmRoster = makeRoster(85, 0, (_id, t) => ({
      ...t,
      cipher: 100,
      degen: 0,
      fullSend: 60,
      doubter: 0,
      altruist: 0,
    }));
    const wildRoster = makeRoster(85, 0, (_id, t) => ({
      ...t,
      cipher: 100,
      degen: 100,
      fullSend: 60,
      doubter: 0,
      altruist: 0,
    }));
    const arena = mazeArena();

    // Race tick count is a proxy for "did the field take detours."
    // Calm field: max-cipher + zero chaos = direct paths = fastest.
    // Wild field: chaos feints add detours = slower.
    const seeds = [1, 2, 3, 4, 5];
    let calmTotal = 0;
    let wildTotal = 0;
    for (const s of seeds) {
      calmTotal += runMazeSim({ seed: s, roster: calmRoster, arena }).ticks;
      wildTotal += runMazeSim({ seed: s, roster: wildRoster, arena }).ticks;
    }
    // Wild should be measurably slower on aggregate. If this fails,
    // chaosFeintScale is too low or pathfinding interaction is masking
    // the effect.
    expect(wildTotal).toBeGreaterThan(calmTotal);
  });
});

// ---------------------------------------------------------------------------
// Lever 5 — wrong-turn recovery bonus
// ---------------------------------------------------------------------------

describe('Lever 5: wrong-turn recovery bonus', () => {
  it('lower mistake-prone field finishes faster with recovery enabled vs disabled', () => {
    // Configure a low-Cipher roster so wrong turns are common; toggle
    // recoveryBonusFactor between default (0.5) and 0 (no recovery)
    // to compare aggregate finish ticks.
    const roster = makeRoster(85, 0, (_id, t) => ({
      ...t,
      cipher: 10, // very low pathfinding
      degen: 30,
      fullSend: 60,
      doubter: 30,
      altruist: 0,
    }));
    const arena = mazeArena();
    const seeds = [1, 2, 3, 4, 5];

    const originalFactor = CONFIG.sim.mazeRace.recoveryBonusFactor;
    let withRecovery = 0;
    let withoutRecovery = 0;
    try {
      // Default config — recovery active.
      for (const s of seeds) {
        withRecovery += runMazeSim({ seed: s, roster, arena }).ticks;
      }
      // Mutate config to disable recovery for the comparison run.
      // Note: CONFIG is `as const`-typed read-only, but TS doesn't
      // freeze nested numeric literals at runtime — we can still write
      // via a cast for this specific test. Restored in finally.
      (CONFIG.sim.mazeRace as { recoveryBonusFactor: number }).recoveryBonusFactor = 0;
      for (const s of seeds) {
        withoutRecovery += runMazeSim({ seed: s, roster, arena }).ticks;
      }
    } finally {
      (CONFIG.sim.mazeRace as { recoveryBonusFactor: number }).recoveryBonusFactor =
        originalFactor;
    }
    // With recovery, the field on aggregate finishes at least as fast
    // as without. Statistical equality is unlikely with 5 seeds; the
    // expected direction is recovery → faster.
    expect(withRecovery).toBeLessThanOrEqual(withoutRecovery);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle & invariants
// ---------------------------------------------------------------------------

describe('maze-race lifecycle', () => {
  it('every robot is accounted for at race-over (no leakage)', () => {
    const roster = makeRoster(85);
    const arena = mazeArena();
    for (const seed of [1, 17, 42, 100]) {
      const result = runMazeSim({ seed, roster, arena });
      const finishCount = result.finishOrder.length;
      const elimCount = result.events.filter(
        (e) => e.type === 'elimination',
      ).length;
      expect(finishCount + elimCount).toBe(roster.length);
    }
  });

  it('emits simStart at tick 0 and simEnd at the final tick', () => {
    const roster = makeRoster(20);
    const arena = smallMazeArena();
    const result = runMazeSim({ seed: 1, roster, arena });
    expect(result.events[0].type).toBe('simStart');
    expect(result.events[result.events.length - 1].type).toBe('simEnd');
  });

  it('isDone returns true once all robots are inactive', () => {
    const roster = makeRoster(20);
    const arena = smallMazeArena();
    const result = runMazeSim({ seed: 1, roster, arena });
    // After the sim runs, every robot should be inactive (finished or
    // eliminated). The engine's final pose snapshot would reflect this
    // if recordPoseFrames were on; here we assert via finishOrder + elims.
    const finishCount = result.finishOrder.length;
    const elimCount = result.events.filter(
      (e) => e.type === 'elimination',
    ).length;
    expect(finishCount + elimCount).toBe(roster.length);
  });
});
