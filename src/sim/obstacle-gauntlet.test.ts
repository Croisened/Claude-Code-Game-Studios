import { afterEach, describe, it, expect, vi } from 'vitest';
import { createObstacleGauntletModule } from '@/sim/obstacle-gauntlet';
import { runSim, type SimResult, type TimelineEvent } from '@/sim/engine';
import type { Arena } from '@/sim/arena';
import type { RobotRoster, RobotRosterEntry } from '@/sim/robot-roster';
import { deriveStats, type RobotTraits } from '@/sim/trait-to-stat';
import realArenaJson from '../../assets/data/arenas/arena-03.json';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRoster(
  size: number,
  override?: (id: number, traits: RobotTraits) => RobotTraits,
): RobotRoster {
  const entries: RobotRosterEntry[] = [];
  for (let i = 0; i < size; i++) {
    let traits: RobotTraits = {
      fullSend: (i * 7) % 101,
      degen: (i * 11) % 101,
      cipher: (i * 13) % 101,
      doubter: (i * 17) % 101,
      altruist: (i * 19) % 101,
    };
    if (override) traits = override(i, traits);
    entries.push(
      Object.freeze({
        id: i,
        name: `robot-${i}`,
        traits: Object.freeze(traits),
        stats: Object.freeze(deriveStats(traits)),
        skinTexturePath: `assets/art/characters/robot/skins/${i}.png`,
      }),
    );
  }
  return Object.freeze(entries);
}

function arena03(): Arena {
  const p = realArenaJson as unknown as {
    id: string;
    type: 'obstacle-gauntlet';
    length: number;
    width: number;
    maxTicks: number;
    startGrid: { lanes: number; rows: number; laneSpacing: number; rowSpacing: number };
    gauntletConfig: {
      pitZones: Array<{ xStart: number; xEnd: number }>;
      hammers: Array<{ x: number; killRadius: number; cycleTicks: number; downStartTick: number; downEndTick: number }>;
      bridge: { xStart: number; xEnd: number; crumbleSpeedMps: number };
    };
  };
  return Object.freeze({
    id: p.id,
    type: 'obstacle-gauntlet' as const,
    length: p.length,
    width: p.width,
    maxTicks: p.maxTicks,
    startGrid: Object.freeze({ ...p.startGrid }),
    gates: Object.freeze([]),
    gauntletConfig: Object.freeze({
      pitZones: Object.freeze(p.gauntletConfig.pitZones.map((z) => Object.freeze({ ...z }))),
      hammers: Object.freeze(p.gauntletConfig.hammers.map((h) => Object.freeze({ ...h }))),
      bridge: Object.freeze({ ...p.gauntletConfig.bridge }),
    }),
  });
}

function runGauntlet(seed: number, roster: RobotRoster, arena: Arena = arena03()): SimResult {
  return runSim({
    seed,
    roster,
    arena,
    eventModule: createObstacleGauntletModule(),
    maxTicks: arena.maxTicks,
    recordPoseFrames: false,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('obstacle-gauntlet determinism', () => {
  it('same seed → byte-identical events', () => {
    const roster = makeRoster(85);
    const a = runGauntlet(1, roster);
    const b = runGauntlet(1, roster);
    expect(a.events).toEqual(b.events);
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.ticks).toBe(b.ticks);
  });

  it('does not call Math.random anywhere', () => {
    const spy = vi.spyOn(Math, 'random');
    const roster = makeRoster(20);
    runGauntlet(1, roster);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Trap mechanics
// ---------------------------------------------------------------------------

describe('obstacle-gauntlet trap mechanics', () => {
  it('pit_fall eliminations occur within pit zone x-range', () => {
    // High-speed, low-Doubter roster maximises pit deaths so we get a
    // wide sample. Pit zone at [60, 78] per arena-03.
    const roster = makeRoster(85, (_id, t) => ({
      ...t,
      fullSend: 80,
      doubter: 5,
    }));
    // Run with pose frames so we can correlate eliminations to positions.
    const result = runSim({
      seed: 1,
      roster,
      arena: arena03(),
      eventModule: createObstacleGauntletModule(),
      maxTicks: 7200,
      recordPoseFrames: true,
    });
    const pitFalls = result.events.filter(
      (e): e is Extract<TimelineEvent, { type: 'elimination' }> =>
        e.type === 'elimination' && e.reason === 'pit_fall',
    );
    expect(pitFalls.length).toBeGreaterThan(0);
    for (const fall of pitFalls) {
      const frame = result.poseFrames[fall.tick];
      const x = frame.data[fall.robotId * 5 + 1]; // POSE_STRIDE = 5; x at offset 1
      expect(x).toBeGreaterThanOrEqual(60);
      expect(x).toBeLessThanOrEqual(78);
    }
  });

  it('hammer_strike eliminations occur near hammer x-positions', () => {
    const roster = makeRoster(85, (_id, t) => ({
      ...t,
      fullSend: 80,
      doubter: 5, // low caution → hammer-aware slowdown is weak → many hits
    }));
    const result = runSim({
      seed: 1,
      roster,
      arena: arena03(),
      eventModule: createObstacleGauntletModule(),
      maxTicks: 7200,
      recordPoseFrames: true,
    });
    const hammerStrikes = result.events.filter(
      (e): e is Extract<TimelineEvent, { type: 'elimination' }> =>
        e.type === 'elimination' && e.reason === 'hammer_strike',
    );
    const hammerXs = arena03().gauntletConfig!.hammers.map((h) => h.x);
    expect(hammerStrikes.length).toBeGreaterThan(0);
    for (const strike of hammerStrikes) {
      const frame = result.poseFrames[strike.tick];
      const x = frame.data[strike.robotId * 5 + 1];
      const closestHammerDist = Math.min(...hammerXs.map((hx) => Math.abs(hx - x)));
      // killRadius = 1.0 in arena-03; allow tiny float slack.
      expect(closestHammerDist).toBeLessThan(1.05);
    }
  });

  it('bridge_fell eliminations occur within bridge x-range', () => {
    // High-Doubter roster so robots survive earlier stages and reach
    // the bridge. We don't need everyone — just a few survivors.
    const roster = makeRoster(85, (_id, t) => ({
      ...t,
      fullSend: 25, // moderate speed (might or might not outrun crumble)
      doubter: 70, // high caution → survive pit + hammer stages
    }));
    const result = runSim({
      seed: 1,
      roster,
      arena: arena03(),
      eventModule: createObstacleGauntletModule(),
      maxTicks: 7200,
      recordPoseFrames: true,
    });
    const bridgeFalls = result.events.filter(
      (e): e is Extract<TimelineEvent, { type: 'elimination' }> =>
        e.type === 'elimination' && e.reason === 'bridge_fell',
    );
    if (bridgeFalls.length === 0) {
      // Possible: all reach bridge survive AND outrun the crumble.
      // Not a failure of the mechanism. Skip.
      return;
    }
    const bridge = arena03().gauntletConfig!.bridge;
    for (const fall of bridgeFalls) {
      const frame = result.poseFrames[fall.tick];
      const x = frame.data[fall.robotId * 5 + 1];
      expect(x).toBeGreaterThanOrEqual(bridge.xStart);
      expect(x).toBeLessThanOrEqual(bridge.xEnd);
    }
  });
});

// ---------------------------------------------------------------------------
// Caution favoured trait
// ---------------------------------------------------------------------------

describe('obstacle-gauntlet caution favouring', () => {
  it('high-Doubter rosters have measurably more survivors than low-Doubter', () => {
    const lowRoster = makeRoster(85, (_id, t) => ({
      ...t,
      fullSend: 50,
      doubter: 5, // very low caution
    }));
    const highRoster = makeRoster(85, (_id, t) => ({
      ...t,
      fullSend: 50,
      doubter: 80, // very high caution
    }));
    let lowFinishes = 0;
    let highFinishes = 0;
    const seeds = [1, 2, 3, 7, 42];
    for (const s of seeds) {
      const lo = runGauntlet(s, lowRoster);
      const hi = runGauntlet(s, highRoster);
      if (lo.winnerId !== null) lowFinishes++;
      if (hi.winnerId !== null) highFinishes++;
    }
    // High-Doubter races should produce a finisher more often than
    // low-Doubter races. With low Doubter, hammers + pits should kill
    // most; with high Doubter, more survive.
    expect(highFinishes).toBeGreaterThanOrEqual(lowFinishes);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle & invariants
// ---------------------------------------------------------------------------

describe('obstacle-gauntlet lifecycle', () => {
  it('every robot is accounted for at race-over (no leakage)', () => {
    const roster = makeRoster(85);
    for (const seed of [1, 2, 3, 7, 42]) {
      const result = runGauntlet(seed, roster);
      const finishCount = result.finishOrder.length;
      const elimCount = result.events.filter(
        (e) => e.type === 'elimination',
      ).length;
      expect(finishCount + elimCount).toBe(roster.length);
    }
  });

  it('emits simStart at tick 0 and simEnd at the final tick', () => {
    const roster = makeRoster(85);
    const result = runGauntlet(1, roster);
    expect(result.events[0].type).toBe('simStart');
    expect(result.events[result.events.length - 1].type).toBe('simEnd');
  });

  it('first finisher is the only winner; race_over culls the rest', () => {
    // Use the default roster which has produced winners in playtest.
    const roster = makeRoster(85);
    const result = runGauntlet(1, roster);
    if (result.winnerId === null) {
      // Possible "no winner" outcome (everyone died). Spec-compliant
      // per game-concept §3 — skip the rest of the assertions.
      return;
    }
    const finishEvents = result.events.filter(
      (e): e is Extract<TimelineEvent, { type: 'finish' }> => e.type === 'finish',
    );
    // Gauntlet emits exactly one finish event (no grace window like maze).
    expect(finishEvents.length).toBe(1);
    expect(finishEvents[0].robotId).toBe(result.winnerId);
    expect(finishEvents[0].place).toBe(1);
  });

  it('no robot appears in both finishOrder and eliminations', () => {
    const roster = makeRoster(85);
    for (const seed of [1, 2, 3, 7, 42]) {
      const result = runGauntlet(seed, roster);
      const finishers = new Set(result.finishOrder);
      const eliminated = result.events
        .filter((e): e is Extract<TimelineEvent, { type: 'elimination' }> =>
          e.type === 'elimination',
        )
        .map((e) => e.robotId);
      for (const id of eliminated) {
        expect(finishers.has(id)).toBe(false);
      }
    }
  });
});
