/**
 * Sim Engine Core (S5-04) — fixed-timestep tick loop, active-robot
 * bookkeeping, and structured timeline emission. Three.js-agnostic; runs
 * in Node and the browser identically.
 *
 * The engine is event-type-agnostic: gate logic, AI, and stage culls live
 * in an `EventModule` (S5-05+). The engine owns determinism, the tick
 * cadence, the rng, and the timeline shape; the module owns "what happens
 * this tick".
 *
 * Determinism contract:
 * - One rng per sim, seeded from `opts.seed`. The engine never calls
 *   `rng()` itself — it is passed to the event module.
 * - Active poses iterated by id; the roster contract guarantees
 *   `roster[i].id === i` (RobotRosterEntry, S5-02).
 * - `dtSeconds` is a fixed `1 / CONFIG.sim.tickRateHz`. No real-time clock.
 * - No `Math.random`, no `Date.now()`, no `performance.now()` here.
 */

import { CONFIG } from '@/config';
import { createRng } from '@/sim/rng';
import { getStartPosition, type Arena } from '@/sim/arena';
import type { RobotRoster } from '@/sim/robot-roster';

/** Two minutes at the configured tick rate. Hard safety stop for runaway sims. */
const DEFAULT_MAX_TICKS_SECONDS = 120;

/** Floats-per-robot in a `PoseFrame.data` row: [active, x, y, z, yaw]. */
export const POSE_STRIDE = 5;

/**
 * Per-robot pose owned by the sim. The event module mutates these in place
 * during `tick()`; the engine snapshots them into `PoseFrame` rows.
 */
export interface RobotPose {
  readonly id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  active: boolean;
}

export type TimelineEvent =
  | {
      readonly type: 'simStart';
      readonly tick: 0;
      readonly seed: number;
      readonly arenaId: string;
      readonly rosterSize: number;
    }
  | {
      readonly type: 'elimination';
      readonly tick: number;
      readonly robotId: number;
      readonly reason: string;
    }
  | {
      readonly type: 'finish';
      readonly tick: number;
      readonly robotId: number;
      readonly place: number;
    }
  | {
      readonly type: 'simEnd';
      readonly tick: number;
      readonly winnerId: number | null;
      readonly reason: 'eventDone' | 'maxTicks';
    };

/**
 * Per-tick pose snapshot. `data` is laid out as
 * `[active, x, y, z, yaw]` per id, indexed by `id * POSE_STRIDE`.
 * `active` is `1` or `0`. Float32 keeps the renderer's eventual copy cheap.
 */
export interface PoseFrame {
  readonly tick: number;
  readonly data: Float32Array;
}

export interface TickContext {
  readonly tick: number;
  readonly dtSeconds: number;
  readonly poses: RobotPose[];
  readonly roster: RobotRoster;
  readonly arena: Arena;
  readonly rng: () => number;
}

export interface TickResult {
  readonly eliminations?: ReadonlyArray<{ readonly robotId: number; readonly reason: string }>;
  readonly finishes?: ReadonlyArray<{ readonly robotId: number }>;
}

export interface EventModule {
  /** Build initial poses from `arena.startGrid`. Engine assumes id-indexed. */
  init(ctx: { roster: RobotRoster; arena: Arena; rng: () => number }): RobotPose[];
  /** Advance one tick. Mutates `ctx.poses` in place; returns deltas. */
  tick(ctx: TickContext): TickResult;
  /** True once the event has produced a winner or all robots are out. */
  isDone(ctx: TickContext): boolean;
}

export interface SimOptions {
  readonly seed: number;
  readonly roster: RobotRoster;
  readonly arena: Arena;
  readonly eventModule: EventModule;
  /** Default: `CONFIG.sim.tickRateHz * 120`. */
  readonly maxTicks?: number;
  /** Default: `true`. Set `false` in tests that don't need pose history. */
  readonly recordPoseFrames?: boolean;
}

export interface SimResult {
  readonly ticks: number;
  readonly events: readonly TimelineEvent[];
  readonly poseFrames: readonly PoseFrame[];
  readonly finishOrder: readonly number[];
  readonly winnerId: number | null;
}

/**
 * Default `EventModule.init` helper. Places each robot at its arena start
 * grid slot, all active, facing +X (yaw = 0). Modules typically delegate
 * here unless they need a different starting layout.
 */
export function buildStartPoses(roster: RobotRoster, arena: Arena): RobotPose[] {
  const poses: RobotPose[] = new Array(roster.length);
  for (let i = 0; i < roster.length; i++) {
    const { x, z } = getStartPosition(arena, i);
    poses[i] = {
      id: i,
      x,
      y: 0,
      z,
      yaw: 0,
      active: true,
    };
  }
  return poses;
}

function snapshotPoses(tick: number, poses: readonly RobotPose[]): PoseFrame {
  const data = new Float32Array(poses.length * POSE_STRIDE);
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    const base = p.id * POSE_STRIDE;
    data[base] = p.active ? 1 : 0;
    data[base + 1] = p.x;
    data[base + 2] = p.y;
    data[base + 3] = p.z;
    data[base + 4] = p.yaw;
  }
  return { tick, data };
}

/**
 * Run a sim to completion. Pure with respect to `opts` — calling twice with
 * the same options produces byte-identical `events` and `poseFrames`.
 */
export function runSim(opts: SimOptions): SimResult {
  const dtSeconds = 1 / CONFIG.sim.tickRateHz;
  const maxTicks = opts.maxTicks ?? CONFIG.sim.tickRateHz * DEFAULT_MAX_TICKS_SECONDS;
  const recordPoseFrames = opts.recordPoseFrames ?? true;

  const rng = createRng(opts.seed);
  const events: TimelineEvent[] = [];
  const poseFrames: PoseFrame[] = [];
  const finishOrder: number[] = [];

  const poses = opts.eventModule.init({
    roster: opts.roster,
    arena: opts.arena,
    rng,
  });

  events.push({
    type: 'simStart',
    tick: 0,
    seed: opts.seed,
    arenaId: opts.arena.id,
    rosterSize: opts.roster.length,
  });

  let tick = 0;
  let endReason: 'eventDone' | 'maxTicks' = 'eventDone';

  while (tick < maxTicks) {
    const ctx: TickContext = {
      tick,
      dtSeconds,
      poses,
      roster: opts.roster,
      arena: opts.arena,
      rng,
    };

    if (opts.eventModule.isDone(ctx)) {
      break;
    }

    const result = opts.eventModule.tick(ctx);

    if (result.eliminations) {
      for (const e of result.eliminations) {
        const pose = poses[e.robotId];
        if (pose !== undefined && pose.active) {
          pose.active = false;
        }
        events.push({
          type: 'elimination',
          tick,
          robotId: e.robotId,
          reason: e.reason,
        });
      }
    }

    if (result.finishes) {
      for (const f of result.finishes) {
        const pose = poses[f.robotId];
        if (pose !== undefined && pose.active) {
          pose.active = false;
        }
        finishOrder.push(f.robotId);
        events.push({
          type: 'finish',
          tick,
          robotId: f.robotId,
          place: finishOrder.length,
        });
      }
    }

    if (recordPoseFrames) {
      poseFrames.push(snapshotPoses(tick, poses));
    }

    tick += 1;

    if (tick >= maxTicks) {
      endReason = 'maxTicks';
      break;
    }
  }

  const winnerId = finishOrder.length > 0 ? finishOrder[0] : null;
  events.push({
    type: 'simEnd',
    tick,
    winnerId,
    reason: endReason,
  });

  return {
    ticks: tick,
    events,
    poseFrames,
    finishOrder,
    winnerId,
  };
}
