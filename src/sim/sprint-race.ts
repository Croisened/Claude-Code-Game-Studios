/**
 * Sprint Race Event Module (S5-05) — implements the `EventModule` contract
 * (`src/sim/engine.ts`) for the v1 `'sprint-race'` arena type.
 *
 * Owns:
 * - Per-tick robot motion (forward-only velocity along +X, derived from
 *   `stat.speed` modulated by `caution` and per-tick `chaos` jitter).
 * - Gate-crossing bookkeeping for the arena's gate sequence.
 * - Three-stage cull (e.g., 85 → 28 → 10 → 1 on arena-01) executed by
 *   closing each gate after `cullToCount` robots have crossed.
 * - Race-end semantics: the final gate emits `finish` events for crossers
 *   and `race_over` eliminations for the remaining active robots.
 *
 * Determinism (per design/gdd/sim-engine-core.md §3):
 * - Robots are iterated in id-ascending order in every motion + gate phase.
 * - `rng()` is called exactly once per active robot per tick (chaos jitter).
 * - Gate-crossings within a single tick are tie-broken by id-ascending order.
 *
 * Module state lives in closure; `createSprintRaceModule()` returns a
 * **single-use** module — call it once per `runSim`.
 */

import { CONFIG } from '@/config';
import { buildStartPoses, type EventModule, type RobotPose, type TickContext, type TickResult } from '@/sim/engine';
import { shuffledStartSlots, type Arena } from '@/sim/arena';
import type { RobotRoster } from '@/sim/robot-roster';

const ELIM_REASON_RACE_OVER = 'race_over';

/** Internal per-sim state captured in the closure of `createSprintRaceModule`. */
interface SprintRaceState {
  /** `gatesCrossed[id]` = number of gates this robot has fully passed. */
  readonly gatesCrossed: number[];
  /** `gateCrossings[g]` = robot ids that crossed gate `g`, in crossing order. */
  readonly gateCrossings: number[][];
  /** `gateClosed[g]` = true once gate `g` reached its `cullToCount`. */
  readonly gateClosed: boolean[];
  /** True once the final gate has closed (race ended). */
  finalGateClosed: boolean;
}

function initState(arena: Arena, rosterSize: number): SprintRaceState {
  return {
    gatesCrossed: new Array<number>(rosterSize).fill(0),
    gateCrossings: arena.gates.map(() => [] as number[]),
    gateClosed: arena.gates.map(() => false),
    finalGateClosed: false,
  };
}

function advanceMotion(ctx: TickContext): void {
  const k = CONFIG.sim.sprintRace;
  const dt = ctx.dtSeconds;
  const sepR = k.separationRadius;
  const sepRSq = sepR * sepR;
  const sepForce = k.separationForceMps;
  const laneEps = k.separationCoincidentLaneEps;
  const zBound = ctx.arena.width / 2 - k.lateralBoundMargin;

  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const stat = ctx.roster[id].stats;
    const cautionFactor = 1 - stat.caution * k.cautionScale;
    // rng() called once per active robot per tick — see module header.
    const jitter = 1 + (ctx.rng() * 2 - 1) * stat.chaos * k.chaosScale;
    const velocity = k.baseSpeedMps * stat.speed * cautionFactor * jitter;

    // Lateral separation push. Iterates id-sorted to preserve the engine's
    // determinism contract — pose state read here may be a mix of "this
    // tick" (j < id) and "last tick" (j > id) values, but the choice is
    // byte-stable across runs.
    let pushZ = 0;
    for (let j = 0; j < ctx.poses.length; j++) {
      if (j === id) continue;
      const other = ctx.poses[j];
      if (!other.active) continue;
      const dx = pose.x - other.x;
      const dz = pose.z - other.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= sepRSq) continue;
      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / sepR; // 0 at radius → 1 at zero distance
      if (Math.abs(dz) < laneEps) {
        // Same-lane catchup: zero radial Z component would let them phase
        // through. Tie-break by id so the choice is deterministic.
        pushZ += (id < j ? 1 : -1) * sepForce * falloff;
      } else {
        // Radial push, lateral component only — the X axis is reserved
        // for forward motion so the monotonic-X invariant holds.
        pushZ += (dz / dist) * sepForce * falloff;
      }
    }

    pose.x += velocity * dt;
    pose.z += pushZ * dt;
    if (pose.z > zBound) pose.z = zBound;
    else if (pose.z < -zBound) pose.z = -zBound;
  }
}

function processGates(
  ctx: TickContext,
  state: SprintRaceState,
): {
  finishes: { robotId: number }[];
  eliminations: { robotId: number; reason: string }[];
} {
  const finishes: { robotId: number }[] = [];
  const eliminations: { robotId: number; reason: string }[] = [];
  const finalGateIndex = ctx.arena.gates.length - 1;

  for (let g = 0; g < ctx.arena.gates.length; g++) {
    if (state.gateClosed[g]) continue;
    const gate = ctx.arena.gates[g];
    const isFinalGate = g === finalGateIndex;

    // Phase 1: enroll new crossers (id-sorted, capped by remaining capacity).
    for (let id = 0; id < ctx.poses.length; id++) {
      if (state.gateCrossings[g].length >= gate.cullToCount) break;
      const pose = ctx.poses[id];
      if (!pose.active) continue;
      if (state.gatesCrossed[id] !== g) continue;
      if (pose.x < gate.x) continue;
      state.gateCrossings[g].push(id);
      state.gatesCrossed[id] = g + 1;
      if (isFinalGate) {
        finishes.push({ robotId: id });
      }
    }

    // Phase 2: close gate if it reached capacity, and cull anyone still
    // behind it (active robots with gatesCrossed === g).
    if (state.gateCrossings[g].length >= gate.cullToCount) {
      state.gateClosed[g] = true;
      const reason = isFinalGate ? ELIM_REASON_RACE_OVER : `${gate.name}_closed`;
      for (let id = 0; id < ctx.poses.length; id++) {
        const pose = ctx.poses[id];
        if (!pose.active) continue;
        if (state.gatesCrossed[id] > g) continue;
        eliminations.push({ robotId: id, reason });
      }
      if (isFinalGate) {
        state.finalGateClosed = true;
      }
    }
  }

  return { finishes, eliminations };
}

/**
 * Create a Sprint Race `EventModule` instance. Single-use — pass to one
 * `runSim` call only. Calling `runSim` twice with the same module will see
 * stale internal state from the prior run.
 */
export function createSprintRaceModule(): EventModule {
  let state: SprintRaceState | null = null;

  function ensureState(arena: Arena, rosterSize: number): SprintRaceState {
    if (state === null) {
      state = initState(arena, rosterSize);
    }
    return state;
  }

  return {
    init(ctx: { roster: RobotRoster; arena: Arena; rng: () => number }): RobotPose[] {
      ensureState(ctx.arena, ctx.roster.length);
      // Seed-driven slot permutation. Robots that draw a back-row slot
      // have further to run; race-to-race outcomes vary with the seed
      // even when stat distributions stay constant.
      const slotForId = shuffledStartSlots(ctx.rng, ctx.roster.length);
      return buildStartPoses(ctx.roster, ctx.arena, slotForId);
    },

    tick(ctx: TickContext): TickResult {
      const s = ensureState(ctx.arena, ctx.poses.length);
      advanceMotion(ctx);
      return processGates(ctx, s);
    },

    isDone(ctx: TickContext): boolean {
      const s = ensureState(ctx.arena, ctx.poses.length);
      if (s.finalGateClosed) return true;
      // Defensive: if every robot is inactive but the final gate didn't
      // close (shouldn't happen on well-formed arenas), end the sim.
      for (let i = 0; i < ctx.poses.length; i++) {
        if (ctx.poses[i].active) return false;
      }
      return true;
    },
  };
}
