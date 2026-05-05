/**
 * Obstacle Gauntlet Event Module — implements the `EventModule`
 * contract for Arena-03 (`'obstacle-gauntlet'`). Linear course with
 * three trap types laid out in fixed order: pit zones → hammers →
 * crumbling bridge → finish line. Doubter-driven `stat.caution` is
 * the counter to all three stages.
 *
 * Per-tick motion: forward-velocity along +X (mirrors sprint-race),
 * with a hammer-lookahead slowdown layered on top — robots predict
 * the hammer phase at their arrival time and brake if the hammer
 * would be down. Caution scales the magnitude of the slowdown.
 *
 * Determinism (mirrors sprint-race + maze-race):
 * - Robots iterated id-ascending in every motion phase.
 * - `rng()` called exactly once per active robot per tick for chaos
 *   jitter, plus optionally one additional draw per active robot in
 *   a pit zone for the per-tick fall roll. The pit-fall draw is
 *   conditional but deterministic given (seed, arena) — robots in
 *   the same zone in the same id order get the same draws.
 * - Hammers and bridge crumble derive from `tick` arithmetic. No rng.
 * - Race ends when the first robot crosses x = arena.length.
 *   Remaining actives at that point are eliminated `race_over`.
 *
 * The module is single-use — call `createObstacleGauntletModule(...)`
 * once per `runSim`.
 */

import { CONFIG } from '@/config';
import {
  buildStartPoses,
  type EventModule,
  type RobotPose,
  type TickContext,
  type TickResult,
} from '@/sim/engine';
import { shuffledStartSlots, type Arena, type HammerSpec, type PitZone } from '@/sim/arena';
import { hammerHeadZ, isHammerDown } from '@/sim/hammer-geometry';
import type { RobotRoster } from '@/sim/robot-roster';

const ELIM_REASON_PIT_FALL = 'pit_fall';
const ELIM_REASON_HAMMER_STRIKE = 'hammer_strike';
const ELIM_REASON_BRIDGE_FELL = 'bridge_fell';
const ELIM_REASON_RACE_OVER = 'race_over';

interface GauntletState {
  /**
   * World-space X of the bridge crumble line. The crumble trails the
   * leading on-bridge robot by `CONFIG.sim.gauntletRace.bridgeTrailMeters`,
   * monotonically advancing — once a plank position is "crumbled" it
   * stays crumbled. `null` until the first robot enters the bridge.
   * Robots whose pose.x is below this AND on the bridge are eliminated
   * with `bridge_fell`.
   */
  crumbleX: number | null;
  /** True once a robot has crossed the finish line. */
  finished: boolean;
}

function initState(): GauntletState {
  return {
    crumbleX: null,
    finished: false,
  };
}

interface Elimination {
  robotId: number;
  reason: string;
}

/**
 * Compute hammer-lookahead speed multiplier for a single robot. The
 * rule: if any hammer ahead within `hammerLookaheadM` is **currently
 * down** at the present sim tick, brake. Caution scales the brake
 * strength: high-Doubter robots fully stop and wait; low-Doubter
 * robots barrel through. Multiple down hammers in lookahead produce
 * the strictest (smallest) multiplier.
 *
 * The "currently down" predicate (rather than predicted-down-at-
 * arrival) avoids a feedback loop: predicting arrival from current
 * speed means slowing down moves the predicted arrival forward,
 * which can hold the slowdown predicate true indefinitely. Reading
 * current state instead lets robots accelerate the moment the
 * hammer cycles up.
 *
 * Floor at 0 — max-caution robots fully stop and wait for the cycle.
 */
function hammerSlowdownFactor(
  hammers: readonly HammerSpec[],
  poseX: number,
  caution: number,
  currentTick: number,
): number {
  const k = CONFIG.sim.gauntletRace;
  let factor = 1;
  for (let i = 0; i < hammers.length; i++) {
    const hammer = hammers[i];
    const dx = hammer.x - poseX;
    if (dx <= 0 || dx > k.hammerLookaheadM) continue;
    if (isHammerDown(hammer, currentTick)) {
      const candidate = 1 - caution * k.cautionHammerSlowdown;
      if (candidate < factor) factor = candidate;
    }
  }
  return Math.max(0, factor);
}

/**
 * Returns true if `pose.x` is inside any pit zone. The zones are
 * iterated linearly — for the typical 1–3 pit zones per gauntlet,
 * this is cheaper than building a sorted index.
 */
function inPitZone(pitZones: readonly PitZone[], poseX: number): boolean {
  for (let i = 0; i < pitZones.length; i++) {
    const z = pitZones[i];
    if (poseX >= z.xStart && poseX <= z.xEnd) return true;
  }
  return false;
}

// ---- Phase A: motion + chaos jitter + hammer-lookahead slowdown.
// Each active robot consumes exactly ONE rng() draw here for jitter.
// Pit-fall rolls happen in Phase B with a separate (conditional) draw.
function phaseMotion(
  ctx: TickContext,
  hammers: readonly HammerSpec[],
): void {
  const k = CONFIG.sim.gauntletRace;
  const dt = ctx.dtSeconds;
  const halfWidth = ctx.arena.width / 2 - k.lateralBoundMargin;
  const sepR = k.separationRadius;
  const sepRSq = sepR * sepR;
  const sepForce = k.separationForceMps;
  const sepEps = k.separationCoincidentEps;

  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const stat = ctx.roster[id].stats;
    const cautionFactor = 1 - stat.caution * k.cautionScale;
    const jitter = 1 + (ctx.rng() * 2 - 1) * stat.chaos * k.chaosScale;
    // Linear remap of stat.speed from [0, 1] to [minSpeedStat, 1]. A hard
    // Math.max would clamp everyone below the floor to the same speed,
    // bunching the back of the pack into a wall; the remap preserves the
    // relative spread (each robot's natural speed rank is kept) while
    // lifting low and mid stats up. stat.speed = 1 still maps to 1, so
    // the top end is unchanged.
    const speedStat = k.minSpeedStat + (1 - k.minSpeedStat) * stat.speed;
    const baseSpeed = k.baseSpeedMps * speedStat * cautionFactor * jitter;
    const slow = hammerSlowdownFactor(hammers, pose.x, stat.caution, ctx.tick);
    const speed = baseSpeed * slow;

    pose.x += speed * dt;

    // Boids-style lateral separation. Same id-ascending pattern as
    // sprint/maze for determinism. Pushes only along z to keep robots
    // inside the corridor.
    let pushZ = 0;
    for (let j = 0; j < ctx.poses.length; j++) {
      if (j === id) continue;
      const other = ctx.poses[j];
      if (!other.active) continue;
      const odx = pose.x - other.x;
      const odz = pose.z - other.z;
      const distSq = odx * odx + odz * odz;
      if (distSq >= sepRSq) continue;
      if (Math.abs(odz) < sepEps) {
        pushZ += (id < j ? 1 : -1) * sepForce;
        continue;
      }
      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / sepR;
      pushZ += (odz / dist) * sepForce * falloff;
    }
    pose.z += pushZ * dt;
    if (pose.z > halfWidth) pose.z = halfWidth;
    if (pose.z < -halfWidth) pose.z = -halfWidth;

    pose.yaw = 0;
  }
}

// ---- Phase B: pit-zone fall rolls. One additional rng() draw per
// active robot CURRENTLY in a pit zone. Outside the zone: no draw.
// Iteration order is id-ascending so the rng sequence is deterministic.
function phasePitFalls(
  ctx: TickContext,
  pitZones: readonly PitZone[],
  eliminations: Elimination[],
  eliminated: Set<number>,
): void {
  const k = CONFIG.sim.gauntletRace;
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    if (!inPitZone(pitZones, pose.x)) continue;
    const stat = ctx.roster[id].stats;
    const u = ctx.rng();
    const pFall = k.pitFallRatePerTick * (1 - stat.caution * k.cautionPitSafety);
    if (u < pFall) {
      eliminations.push({ robotId: id, reason: ELIM_REASON_PIT_FALL });
      eliminated.add(id);
    }
  }
}

// ---- Phase C: hammer-strike eliminations. Kill zone: 2D XZ circle of
// `killRadius` centred on the hammer head's world-space XZ position.
// `isHammerDown` is a fast broad-phase gate — head Z is only computed
// during the designated down window.
function phaseHammers(
  ctx: TickContext,
  hammers: readonly HammerSpec[],
  eliminations: Elimination[],
  eliminated: Set<number>,
): void {
  for (let h = 0; h < hammers.length; h++) {
    const hammer = hammers[h];
    if (!isHammerDown(hammer, ctx.tick)) continue;
    const headZ = hammerHeadZ(hammer, ctx.tick);
    const rSq = hammer.killRadius * hammer.killRadius;
    for (let id = 0; id < ctx.poses.length; id++) {
      const pose = ctx.poses[id];
      if (!pose.active) continue;
      if (eliminated.has(id)) continue;
      const dx = pose.x - hammer.x;
      const dz = pose.z - headZ;
      if (dx * dx + dz * dz < rSq) {
        eliminations.push({ robotId: id, reason: ELIM_REASON_HAMMER_STRIKE });
        eliminated.add(id);
      }
    }
  }
}

// ---- Phase D: bridge crumble. The crumble line tracks the leading
// on-bridge robot, trailing them by `bridgeTrailMeters`. Monotonic —
// once a position is crumbled it stays crumbled. By construction the
// leader can never be caught, so leaders always finish; only stragglers
// fall. Returns the new crumble X if it advanced this tick (so the
// engine can emit a `bridge_crumble` event), or undefined otherwise.
function phaseBridge(
  ctx: TickContext,
  state: GauntletState,
  eliminations: Elimination[],
  eliminated: Set<number>,
): number | undefined {
  const bridge = ctx.arena.gauntletConfig?.bridge;
  if (bridge === undefined) return undefined;

  const k = CONFIG.sim.gauntletRace;
  const previousCrumbleX = state.crumbleX;

  let leaderOnBridgeX = Number.NEGATIVE_INFINITY;
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    if (
      pose.x >= bridge.xStart &&
      pose.x <= bridge.xEnd &&
      pose.x > leaderOnBridgeX
    ) {
      leaderOnBridgeX = pose.x;
    }
  }
  if (leaderOnBridgeX > Number.NEGATIVE_INFINITY) {
    const desiredCrumbleX = leaderOnBridgeX - k.bridgeTrailMeters;
    state.crumbleX =
      state.crumbleX === null
        ? desiredCrumbleX
        : Math.max(state.crumbleX, desiredCrumbleX);
  }
  if (state.crumbleX !== null) {
    for (let id = 0; id < ctx.poses.length; id++) {
      const pose = ctx.poses[id];
      if (!pose.active) continue;
      if (eliminated.has(id)) continue;
      if (
        pose.x < state.crumbleX &&
        pose.x >= bridge.xStart &&
        pose.x <= bridge.xEnd
      ) {
        eliminations.push({ robotId: id, reason: ELIM_REASON_BRIDGE_FELL });
        eliminated.add(id);
      }
    }
  }

  if (state.crumbleX !== null && state.crumbleX !== previousCrumbleX) {
    return state.crumbleX;
  }
  return undefined;
}

// ---- Phase E: finish line. The first robot whose pose.x >=
// arena.length wins. id-ascending tiebreak on same-tick crossings.
function phaseFinish(
  ctx: TickContext,
  state: GauntletState,
  eliminations: Elimination[],
  eliminated: Set<number>,
  finishes: { robotId: number }[],
): void {
  const arenaLength = ctx.arena.length;
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    if (eliminated.has(id)) continue;
    if (pose.x >= arenaLength) {
      finishes.push({ robotId: id });
      state.finished = true;
      // Eliminate every other still-active, not-yet-this-tick-eliminated
      // robot with race_over. The first finisher's id is the winner;
      // others lose their chance.
      for (let j = 0; j < ctx.poses.length; j++) {
        if (j === id) continue;
        if (!ctx.poses[j].active) continue;
        if (eliminated.has(j)) continue;
        eliminations.push({ robotId: j, reason: ELIM_REASON_RACE_OVER });
        eliminated.add(j);
      }
      return;
    }
  }
}

export function createObstacleGauntletModule(): EventModule {
  let state: GauntletState | null = null;

  function ensureState(): GauntletState {
    if (state === null) state = initState();
    return state;
  }

  return {
    init(ctx: { roster: RobotRoster; arena: Arena; rng: () => number }): RobotPose[] {
      ensureState();
      // Seed-driven slot permutation — same pattern as sprint-race.
      // A robot drawing a back-row slot has more course to traverse and
      // arrives at the pit zone behind the pack; viewer-side variance
      // prevents the same robot from always being at the front of the
      // first cull. Determinism preserved: same seed → same shuffle.
      const slotForId = shuffledStartSlots(ctx.rng, ctx.roster.length);
      return buildStartPoses(ctx.roster, ctx.arena, slotForId);
    },

    tick(ctx: TickContext): TickResult {
      const s = ensureState();
      if (!ctx.arena.gauntletConfig) {
        throw new Error('obstacle-gauntlet event module given non-gauntlet arena');
      }
      const { hammers, pitZones } = ctx.arena.gauntletConfig;
      const eliminations: Elimination[] = [];
      const finishes: { robotId: number }[] = [];
      const eliminated = new Set<number>();

      phaseMotion(ctx, hammers);
      phasePitFalls(ctx, pitZones, eliminations, eliminated);
      phaseHammers(ctx, hammers, eliminations, eliminated);
      const crumbleAdvance = phaseBridge(ctx, s, eliminations, eliminated);
      phaseFinish(ctx, s, eliminations, eliminated, finishes);

      return crumbleAdvance !== undefined
        ? { eliminations, finishes, bridgeCrumbleX: crumbleAdvance }
        : { eliminations, finishes };
    },

    isDone(ctx: TickContext): boolean {
      ensureState();
      // Stop only when no actives remain — the engine flips finishers/
      // eliminated to inactive after each tick. Mirrors sprint-race.
      for (let i = 0; i < ctx.poses.length; i++) {
        if (ctx.poses[i].active) return false;
      }
      return true;
    },
  };
}
