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
import type { Arena, BridgeSpec, HammerSpec, PitZone } from '@/sim/arena';
import type { RobotRoster } from '@/sim/robot-roster';

const ELIM_REASON_PIT_FALL = 'pit_fall';
const ELIM_REASON_HAMMER_STRIKE = 'hammer_strike';
const ELIM_REASON_BRIDGE_FELL = 'bridge_fell';
const ELIM_REASON_RACE_OVER = 'race_over';

interface GauntletState {
  /**
   * Tick the FIRST robot crossed `bridge.xStart` (entered the bridge),
   * or `null` if no robot has entered yet. Drives the crumble line.
   */
  bridgeEnteredTick: number | null;
  /** True once a robot has crossed the finish line. */
  finished: boolean;
}

function initState(): GauntletState {
  return {
    bridgeEnteredTick: null,
    finished: false,
  };
}

/**
 * Returns true if the hammer is currently in its "down" (deadly) phase
 * at the given sim tick. Uses pure modular arithmetic — no rng — so
 * the renderer can read the same predicate to drive the visual
 * hammer mesh's rotation.
 */
function isHammerDown(hammer: HammerSpec, tick: number): boolean {
  const phase = ((tick % hammer.cycleTicks) + hammer.cycleTicks) % hammer.cycleTicks;
  return phase >= hammer.downStartTick && phase < hammer.downEndTick;
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
 * They make zero progress during a down phase but resume at full
 * speed the moment it cycles up. Mid-caution robots crawl through.
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

function advanceMotion(
  ctx: TickContext,
  hammers: readonly HammerSpec[],
  pitZones: readonly PitZone[],
  state: GauntletState,
): { eliminations: { robotId: number; reason: string }[]; finishes: { robotId: number }[] } {
  const k = CONFIG.sim.gauntletRace;
  const dt = ctx.dtSeconds;
  const arenaLength = ctx.arena.length;
  const halfWidth = ctx.arena.width / 2 - k.lateralBoundMargin;
  const sepR = k.separationRadius;
  const sepRSq = sepR * sepR;
  const sepForce = k.separationForceMps;
  const sepEps = k.separationCoincidentEps;

  const eliminations: { robotId: number; reason: string }[] = [];
  const finishes: { robotId: number }[] = [];

  // ---- Phase A: motion + chaos jitter + hammer-lookahead slowdown.
  // Each active robot consumes exactly ONE rng() draw here for jitter.
  // Pit-fall rolls happen in Phase B with a separate (conditional) draw.
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const stat = ctx.roster[id].stats;
    const cautionFactor = 1 - stat.caution * k.cautionScale;
    const jitter = 1 + (ctx.rng() * 2 - 1) * stat.chaos * k.chaosScale;
    const baseSpeed = k.baseSpeedMps * stat.speed * cautionFactor * jitter;
    const slow = hammerSlowdownFactor(hammers, pose.x, stat.caution, ctx.tick);
    const speed = baseSpeed * slow;

    // Forward motion along +X. Bounded by the finish line; robots do
    // not overshoot — finish detection handles the crossing.
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

    // Yaw points along +X (sprint convention). Forward-only motion in
    // gauntlet — no yaw variation in v1.
    pose.yaw = 0;
  }

  // ---- Phase B: pit-zone fall rolls. One additional rng() draw per
  // active robot CURRENTLY in a pit zone. Outside the zone: no draw.
  // Iteration order is id-ascending so the rng sequence is deterministic.
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    if (!inPitZone(pitZones, pose.x)) continue;
    const stat = ctx.roster[id].stats;
    const u = ctx.rng();
    const pFall = k.pitFallRatePerTick * (1 - stat.caution * k.cautionPitSafety);
    if (u < pFall) {
      eliminations.push({ robotId: id, reason: ELIM_REASON_PIT_FALL });
    }
  }

  // ---- Phase C: hammer-strike eliminations. Pure tick arithmetic;
  // no rng. A robot is hit if its pose.x is within `killRadius` of a
  // hammer that is currently DOWN. Use a small skip-list for already-
  // eliminated this tick (pit) so we don't double-emit.
  for (let h = 0; h < hammers.length; h++) {
    const hammer = hammers[h];
    if (!isHammerDown(hammer, ctx.tick)) continue;
    for (let id = 0; id < ctx.poses.length; id++) {
      const pose = ctx.poses[id];
      if (!pose.active) continue;
      if (eliminationsContains(eliminations, id)) continue;
      if (Math.abs(pose.x - hammer.x) < hammer.killRadius) {
        eliminations.push({ robotId: id, reason: ELIM_REASON_HAMMER_STRIKE });
      }
    }
  }

  // ---- Phase D: bridge crumble. The crumble line spawns at
  // `bridge.xStart` the moment the first active robot enters the
  // bridge, and advances at `crumbleSpeedMps` m/sec from there.
  // Robots whose pose.x < crumble line AND pose.x in [xStart, xEnd]
  // (still on the bridge) → eliminated `bridge_fell`.
  const bridge = ctx.arena.gauntletConfig?.bridge;
  if (bridge !== undefined) {
    if (state.bridgeEnteredTick === null) {
      for (let id = 0; id < ctx.poses.length; id++) {
        const pose = ctx.poses[id];
        if (!pose.active) continue;
        if (pose.x >= bridge.xStart) {
          state.bridgeEnteredTick = ctx.tick;
          break;
        }
      }
    }
    if (state.bridgeEnteredTick !== null) {
      const ticksSince = ctx.tick - state.bridgeEnteredTick;
      const crumbleX =
        bridge.xStart + bridge.crumbleSpeedMps * (ticksSince / CONFIG.sim.tickRateHz);
      for (let id = 0; id < ctx.poses.length; id++) {
        const pose = ctx.poses[id];
        if (!pose.active) continue;
        if (eliminationsContains(eliminations, id)) continue;
        if (pose.x < crumbleX && pose.x >= bridge.xStart && pose.x <= bridge.xEnd) {
          eliminations.push({ robotId: id, reason: ELIM_REASON_BRIDGE_FELL });
        }
      }
    }
  }

  // ---- Phase E: finish line. The first robot whose pose.x >=
  // arena.length wins. id-ascending tiebreak on same-tick crossings.
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    if (eliminationsContains(eliminations, id)) continue;
    if (pose.x >= arenaLength) {
      finishes.push({ robotId: id });
      state.finished = true;
      // Eliminate every other still-active, not-yet-this-tick-eliminated
      // robot with race_over. The first finisher's id is the winner;
      // others lose their chance.
      for (let j = 0; j < ctx.poses.length; j++) {
        if (j === id) continue;
        if (!ctx.poses[j].active) continue;
        if (eliminationsContains(eliminations, j)) continue;
        eliminations.push({ robotId: j, reason: ELIM_REASON_RACE_OVER });
      }
      break;
    }
  }

  return { eliminations, finishes };
}

function eliminationsContains(
  arr: readonly { robotId: number; reason: string }[],
  id: number,
): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].robotId === id) return true;
  }
  return false;
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
      // Reuse the engine's start-grid layout — gauntlets start like
      // sprint-races (id-deterministic for v1; can adopt seeded
      // permutation later via shuffledStartSlots).
      return buildStartPoses(ctx.roster, ctx.arena);
    },

    tick(ctx: TickContext): TickResult {
      const s = ensureState();
      if (!ctx.arena.gauntletConfig) {
        throw new Error('obstacle-gauntlet event module given non-gauntlet arena');
      }
      const { hammers, pitZones } = ctx.arena.gauntletConfig;
      return advanceMotion(ctx, hammers, pitZones, s);
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
