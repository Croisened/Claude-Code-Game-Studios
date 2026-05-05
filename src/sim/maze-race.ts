/**
 * Maze Race Event Module — implements the `EventModule` contract for
 * Arena-02 (`'maze-race'`). Pre-built maze layout (walls + per-cell
 * shortest-path successor toward the finish) is supplied at construction
 * by the host, since the renderer + camera also need to read it.
 *
 * Per-tick motion: every active robot looks up the *next cell* on its
 * shortest path to the finish and steers toward that cell's center at
 * `baseSpeed * stat.speed * (1 - caution * cautionScale) * jitter`.
 * When the robot enters within `cellArrivalRadius` of the target, it
 * advances to the next cell in the path. The finish cell is the path
 * terminator — entering it triggers a `finish` event.
 *
 * Determinism (mirrors `sprint-race.ts`):
 * - Robots iterated in id-ascending order in every motion phase.
 * - `rng()` called exactly once per active robot per tick (chaos jitter).
 * - Race ends once the first robot reaches the finish; remaining actives
 *   are eliminated with `race_over`.
 *
 * The module is single-use — call `createMazeRaceModule(...)` once per
 * `runSim`.
 */

import { CONFIG } from '@/config';
import type { EventModule, RobotPose, TickContext, TickResult } from '@/sim/engine';
import type { Arena } from '@/sim/arena';
import type { RobotRoster } from '@/sim/robot-roster';
import {
  cellIdWorldPos,
  entranceOuterDir,
  type MazeLayout,
  worldToCellId,
} from '@/sim/maze';

// Wall-mask bits — must match the encoding inside `maze.ts`.
const WALL_N = 1;
const WALL_E = 2;
const WALL_S = 4;
const WALL_W = 8;

// Staging-area geometry. Robots queue OUTSIDE each entrance in a 3-wide
// grid. Front of queue spawns just outside the entrance opening; back
// rows have several meters of "staging march" before they reach the
// maze. Lucky front-of-queue draws are part of the race.
const STAGING_LANES = 3;            // robots wide
const STAGING_PAD = 0.8;            // metres from cell-edge to first row
const STAGING_LANE_GAP = 1.6;       // lateral spacing between lanes
const STAGING_ROW_GAP = 2.2;        // depth spacing between rows

const ELIM_REASON_RACE_OVER = 'race_over';

interface MazeRaceState {
  /** Current target cell id per robot (cell they are steering toward). */
  readonly targetCellId: number[];
  /**
   * Cell id the robot just left (-1 = none, e.g. spawning from staging).
   * Used by the wrong-turn rule to exclude immediate back-tracking from
   * mistake candidates, preventing 1-cell oscillation at junctions.
   */
  readonly prevCellId: number[];
  /**
   * **Lever 5** — ticks remaining in the wrong-turn recovery window per
   * robot. While > 0, the robot's effective `pMistake` is reduced by
   * `recoveryBonusFactor`. Decrements once per tick during motion,
   * regardless of whether an arrival fires. Set to `recoveryBonusTicks`
   * the moment a robot picks a non-optimal candidate.
   */
  readonly recoveryTicks: number[];
  /**
   * **Lever 2** — tick of the first finish, or `null` while no robot
   * has reached the finish cell. The race stays "open" for
   * `finishGraceTicks` more ticks after this so trailing robots can
   * co-finish before the field is culled with `race_over`.
   */
  finishTick: number | null;
}

export interface MazeRaceOptions {
  readonly layout: MazeLayout;
}

function initState(layout: MazeLayout, rosterSize: number): MazeRaceState {
  return {
    targetCellId: new Array<number>(rosterSize).fill(layout.finishCellId),
    prevCellId: new Array<number>(rosterSize).fill(-1),
    recoveryTicks: new Array<number>(rosterSize).fill(0),
    finishTick: null,
  };
}

/**
 * Cell id of the neighbor in direction `dir` (one of WALL_N/E/S/W bits),
 * or -1 if the neighbor is outside the grid. Used by the wrong-turn rule
 * when enumerating open neighbors at a junction.
 */
function neighborCellId(
  layout: MazeLayout,
  cellId: number,
  dir: number,
): number {
  const { gridCols, gridRows } = layout.config;
  const col = cellId % gridCols;
  const row = Math.floor(cellId / gridCols);
  let nc = col;
  let nr = row;
  if (dir === WALL_N) nr -= 1;
  else if (dir === WALL_S) nr += 1;
  else if (dir === WALL_W) nc -= 1;
  else if (dir === WALL_E) nc += 1;
  if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) return -1;
  return nr * gridCols + nc;
}

const DIRS = [WALL_N, WALL_E, WALL_S, WALL_W] as const;

interface PickResult {
  readonly cellId: number;
  /** True iff `cellId` was a non-optimal candidate (wrong turn or feint). */
  readonly tookMistake: boolean;
}

/**
 * Pick the next cell id to head for from `arrivedCellId`. Consumes one
 * `rng()` draw. Encodes the wrong-turn behavior plus Sprint 7 levers
 * 3 (chaos feint) and 5 (recovery bonus).
 *
 * Single combined roll `u ∈ [0, 1)` partitioned as:
 *   - `[0, pMistake)`             → pathfinding mistake (Cipher-driven)
 *   - `[pMistake, pMistake+pFeint)` → chaos feint (Degen-driven, Lever 3)
 *   - `[pMistake+pFeint, 1)`      → optimal direction
 *
 * `pMistake` is multiplied by `(1 - recoveryBonusFactor)` while the
 * robot is in its post-mistake recovery window (Lever 5). The chaos
 * feint is **not** dampened by recovery — it's a separate mechanism
 * representing degen-driven impulsiveness, not a navigation mistake.
 *
 * Junctions with no non-prev alternative (corridors, dead-ends) skip
 * the candidate selection and always take optimal — but the rng()
 * draw still happens to keep the per-arrival rng count constant
 * across robots.
 */
function pickNextCell(
  layout: MazeLayout,
  arrivedCellId: number,
  prevCellId: number,
  pathfinding: number,
  chaos: number,
  recoveryActive: boolean,
  rng: () => number,
): PickResult {
  const optimal = layout.nextOnPath[arrivedCellId];
  if (optimal === -1) return { cellId: -1, tookMistake: false };
  const wm = layout.wallMask[arrivedCellId];

  // Enumerate open, in-grid neighbors that are NOT the optimal direction
  // and NOT the cell we just left. These are the "mistake candidates".
  const candidates: number[] = [];
  for (let k = 0; k < 4; k++) {
    const d = DIRS[k];
    if (wm & d) continue;
    const nb = neighborCellId(layout, arrivedCellId, d);
    if (nb === -1) continue;
    if (nb === optimal) continue;
    if (nb === prevCellId) continue;
    candidates.push(nb);
  }

  const u = rng();
  if (candidates.length === 0) return { cellId: optimal, tookMistake: false };

  const k = CONFIG.sim.mazeRace;
  const recoveryFactor = recoveryActive ? 1 - k.recoveryBonusFactor : 1;
  const pMistake = (1 - pathfinding) * k.mistakeMaxRate * recoveryFactor;
  const pFeint = chaos * k.chaosFeintScale;
  // Cap the combined "off-optimal" rate at 1 so we don't overflow the
  // [0, 1) roll. Saturated cases pick optimal with probability 0.
  const pOff = Math.min(1, pMistake + pFeint);

  if (u >= pOff) return { cellId: optimal, tookMistake: false };
  // Remap `[0, pOff)` to `[0, candidates.length)` for candidate
  // selection. Single rng() draw per arrival.
  const idx = Math.min(
    candidates.length - 1,
    Math.floor((u / pOff) * candidates.length),
  );
  return { cellId: candidates[idx], tookMistake: true };
}

function buildStartPoses(
  roster: RobotRoster,
  layout: MazeLayout,
  rng: () => number,
  state: MazeRaceState,
): RobotPose[] {
  // Distribute the roster across the entrance cells round-robin after
  // a single id-permutation. Two effects:
  //   1. With 85 robots / 10 entrances, ≈8-9 robots per entrance. The
  //      shuffle keeps any given robot's entrance assignment dependent
  //      on the seed (so re-racing yields fresh starting positions).
  //   2. Round-robin (rather than blocks of 9 sequential ids per
  //      entrance) avoids id-clustering effects in the start spread.
  const ids: number[] = new Array(roster.length);
  for (let i = 0; i < roster.length; i++) ids[i] = i;
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }

  const entrances = layout.entrances;
  const cellSize = layout.config.cellSize;
  const poses: RobotPose[] = new Array(roster.length);
  const counts = new Array<number>(entrances.length).fill(0);

  for (let k = 0; k < ids.length; k++) {
    const robotId = ids[k];
    const entranceIdx = k % entrances.length;
    const entranceCellId = entrances[entranceIdx];
    const cellPos = cellIdWorldPos(layout, entranceCellId);
    // Outward-facing normal points AWAY from the maze interior. The
    // staging area extends along this direction in fixed-spacing rows.
    const normal = entranceOuterDir(layout, entranceCellId);
    // Tangent runs along the wall edge (perpendicular to normal in the
    // XZ plane). Rotating the normal 90° CCW gives `(-z, x)`.
    const tanX = -normal.z;
    const tanZ = normal.x;

    const slot = counts[entranceIdx]++;
    const depthRow = Math.floor(slot / STAGING_LANES);
    // Lane offset spans the staging width: with STAGING_LANES=3,
    // lane ∈ {-1, 0, +1}. Front-of-row, center-lane is the luckiest spot.
    const lane = (slot % STAGING_LANES) - (STAGING_LANES - 1) / 2;

    const depth = cellSize / 2 + STAGING_PAD + depthRow * STAGING_ROW_GAP;
    const lateral = lane * STAGING_LANE_GAP;
    const x = cellPos.x + normal.x * depth + tanX * lateral;
    const z = cellPos.z + normal.z * depth + tanZ * lateral;

    // Robots face into the maze on spawn (motion vector = -normal).
    // yaw convention: yaw = atan2(-mz, mx), so for motion (-nx, -nz)
    // we get yaw = atan2(nz, -nx).
    const yaw = Math.atan2(normal.z, -normal.x);

    poses[robotId] = {
      id: robotId,
      x,
      y: 0,
      z,
      yaw,
      active: true,
    };
    // The robot's first target is its entrance cell. Once it arrives
    // there, the per-tick arrival logic advances along `nextOnPath`.
    state.targetCellId[robotId] = entranceCellId;
  }

  return poses;
}

function advanceMotion(
  ctx: TickContext,
  layout: MazeLayout,
  state: MazeRaceState,
): void {
  const k = CONFIG.sim.mazeRace;
  const dt = ctx.dtSeconds;
  const arrivalSq = k.cellArrivalRadius * k.cellArrivalRadius;
  const sepR = k.separationRadius;
  const sepRSq = sepR * sepR;
  const sepForce = k.separationForceMps;
  const sepEps = k.separationCoincidentEps;
  const blockDist = k.forwardBlockDist;
  const blockLatRSq = k.forwardBlockLateralRadius * k.forwardBlockLateralRadius;
  const cellSize = layout.config.cellSize;
  const halfCorridor = cellSize / 2 - k.wallMargin;

  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const stat = ctx.roster[id].stats;
    const cautionFactor = 1 - stat.caution * k.cautionScale;
    // rng() called once per active robot per tick — see module header.
    const jitter = 1 + (ctx.rng() * 2 - 1) * stat.chaos * k.chaosScale;
    const speed = k.baseSpeedMps * stat.speed * cautionFactor * jitter;

    // Lever 5: decrement the recovery-window counter once per tick.
    // Floor at 0; pickNextCell reads "recoveryTicks > 0" for the
    // recovery-active flag. Decrementing every tick (not just on
    // arrivals) gives a real-time-bounded window that doesn't depend
    // on how dense the local junction graph is.
    if (state.recoveryTicks[id] > 0) state.recoveryTicks[id] -= 1;

    // Resolve the current target cell. If the robot has reached its
    // target, advance to the next cell — picking optimally most of the
    // time, but rolling for a wrong-turn mistake based on `pathfinding`.
    let targetCellId = state.targetCellId[id];
    {
      const targetPos = cellIdWorldPos(layout, targetCellId);
      const dx0 = targetPos.x - pose.x;
      const dz0 = targetPos.z - pose.z;
      if (dx0 * dx0 + dz0 * dz0 <= arrivalSq) {
        // Snap pose to the cell center on arrival so the next leg
        // starts from a clean grid position. Without the snap, slight
        // float drift accumulates over the path.
        pose.x = targetPos.x;
        pose.z = targetPos.z;
        if (targetCellId === layout.finishCellId) {
          // Robot has arrived at the finish cell. The processFinish
          // phase emits the finish event (Lever 2: may co-finish if
          // within the grace window).
          continue;
        }
        const pick = pickNextCell(
          layout,
          targetCellId,
          state.prevCellId[id],
          stat.pathfinding,
          stat.chaos,
          state.recoveryTicks[id] > 0,
          ctx.rng,
        );
        if (pick.cellId === -1) {
          // Disconnected cell — shouldn't happen in a perfect maze, but
          // be safe: stop moving this robot.
          continue;
        }
        // Lever 5: arming the recovery window. Set immediately AFTER
        // a non-optimal pick so the next ~recoveryBonusTicks ticks see
        // a reduced pMistake. We arm regardless of whether the robot
        // had recovery active at the time of this pick — a second
        // mistake during recovery refreshes the window.
        if (pick.tookMistake) {
          state.recoveryTicks[id] = k.recoveryBonusTicks;
        }
        // Update prev BEFORE overwriting targetCellId. After this, the
        // robot is "at" `targetCellId` and headed toward `pick.cellId`,
        // so its next arrival decision will see prev = the cell it
        // just left = the current `targetCellId`.
        state.prevCellId[id] = targetCellId;
        state.targetCellId[id] = pick.cellId;
        targetCellId = pick.cellId;
      }
    }

    // Primary motion: steer toward target cell center.
    const targetPos = cellIdWorldPos(layout, targetCellId);
    const dx = targetPos.x - pose.x;
    const dz = targetPos.z - pose.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);
    if (distToTarget === 0) continue;
    const nx = dx / distToTarget;
    const nz = dz / distToTarget;

    // Single neighbor scan: accumulates Boids separation push AND
    // computes the forward-block factor in the same loop. id-ascending
    // iteration preserves determinism — pose state mutates per-id but
    // we only read others' state.
    let pushX = 0;
    let pushZ = 0;
    let blockFactor = 1;
    for (let j = 0; j < ctx.poses.length; j++) {
      if (j === id) continue;
      const other = ctx.poses[j];
      if (!other.active) continue;
      const odx = pose.x - other.x;
      const odz = pose.z - other.z;
      const distSq = odx * odx + odz * odz;

      // Separation: full 2D radial push when within sepR.
      if (distSq < sepRSq) {
        if (distSq < sepEps * sepEps) {
          // Coincident: deterministic id-based tiebreak so they
          // nudge apart along +X / -X within a tick.
          pushX += (id < j ? 1 : -1) * sepForce;
        } else {
          const dist = Math.sqrt(distSq);
          const falloff = 1 - dist / sepR;
          pushX += (odx / dist) * sepForce * falloff;
          pushZ += (odz / dist) * sepForce * falloff;
        }
      }

      // Forward-block: if the neighbor sits in our motion direction
      // within blockDist AND inside the lateral lane, scale our step
      // toward zero proportional to forward proximity. Lets robots
      // queue through narrow corridors instead of piling in.
      const fdx = -odx; // pose → other
      const fdz = -odz;
      const forwardDot = fdx * nx + fdz * nz;
      if (forwardDot <= 0 || forwardDot >= blockDist) continue;
      const latX = fdx - forwardDot * nx;
      const latZ = fdz - forwardDot * nz;
      if (latX * latX + latZ * latZ > blockLatRSq) continue;
      const prox = forwardDot / blockDist; // ∈ (0, 1)
      if (prox < blockFactor) blockFactor = prox;
    }

    const step = Math.min(speed * dt * blockFactor, distToTarget);
    pose.x += nx * step + pushX * dt;
    pose.z += nz * step + pushZ * dt;

    // Wall corridor clamp. The separation push can shove a robot toward
    // a wall; without clamping it would phase through. Clamp position
    // to within `halfCorridor` of the current cell's center along any
    // axis with a wall. Robots staged outside the grid skip this — they
    // have free movement until they enter their entrance cell.
    const cellId = worldToCellId(layout, pose.x, pose.z);
    if (cellId !== null) {
      const wm = layout.wallMask[cellId];
      const cellPos = cellIdWorldPos(layout, cellId);
      if (wm & WALL_N && pose.z < cellPos.z - halfCorridor) {
        pose.z = cellPos.z - halfCorridor;
      }
      if (wm & WALL_S && pose.z > cellPos.z + halfCorridor) {
        pose.z = cellPos.z + halfCorridor;
      }
      if (wm & WALL_W && pose.x < cellPos.x - halfCorridor) {
        pose.x = cellPos.x - halfCorridor;
      }
      if (wm & WALL_E && pose.x > cellPos.x + halfCorridor) {
        pose.x = cellPos.x + halfCorridor;
      }
    }

    // Yaw follows the *steering* direction (not the post-push movement
    // direction) so a robot being shoved sideways still appears to face
    // forward toward its target. This matches viewer expectation that
    // the robot "looks where it's going", not "looks where it slides".
    pose.yaw = Math.atan2(-nz, nx);
  }
}

function processFinish(
  ctx: TickContext,
  layout: MazeLayout,
  state: MazeRaceState,
): {
  finishes: { robotId: number }[];
  eliminations: { robotId: number; reason: string }[];
} {
  const finishes: { robotId: number }[] = [];
  const eliminations: { robotId: number; reason: string }[] = [];

  const finishPos = cellIdWorldPos(layout, layout.finishCellId);
  const k = CONFIG.sim.mazeRace;
  const arrivalSq = k.cellArrivalRadius * k.cellArrivalRadius;

  // Lever 2: collect every active robot inside the finish cell's
  // arrival radius this tick, in id-ascending order. The engine
  // assigns places in the order we push to `finishes`, so id-ascending
  // gives the deterministic same-tick tiebreak. The first finisher
  // wins (engine.winnerId = finishOrder[0]); same-tick co-finishers
  // get place 2, 3, …
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const dx = finishPos.x - pose.x;
    const dz = finishPos.z - pose.z;
    if (dx * dx + dz * dz > arrivalSq) continue;
    finishes.push({ robotId: id });
    if (state.finishTick === null) {
      state.finishTick = ctx.tick;
    }
  }

  // Lever 2: cull the remaining field with race_over only when the
  // grace window (in ticks since first finish) has elapsed. If
  // `finishGraceTicks` is 0 the cull happens the same tick as the
  // first finish — equivalent to pre-S7-02 behaviour.
  if (
    state.finishTick !== null &&
    ctx.tick >= state.finishTick + k.finishGraceTicks
  ) {
    for (let j = 0; j < ctx.poses.length; j++) {
      if (!ctx.poses[j].active) continue;
      // Skip robots that just finished THIS tick — they're in the
      // `finishes` list and the engine flips them inactive after this
      // function returns. Without the skip we'd emit both `finish` and
      // `elimination` for the same robot on the same tick.
      let isFinishingThisTick = false;
      for (let f = 0; f < finishes.length; f++) {
        if (finishes[f].robotId === j) {
          isFinishingThisTick = true;
          break;
        }
      }
      if (isFinishingThisTick) continue;
      eliminations.push({ robotId: j, reason: ELIM_REASON_RACE_OVER });
    }
  }

  return { finishes, eliminations };
}

/**
 * Create a Maze Race `EventModule` instance. Pass once to `runSim`.
 * `opts.layout` is the deterministic maze produced by
 * `generateMazeLayout({ seed, config })` — the same `seed` should be
 * passed to `runSim`.
 */
export function createMazeRaceModule(opts: MazeRaceOptions): EventModule {
  const { layout } = opts;
  let state: MazeRaceState | null = null;

  function ensureState(rosterSize: number): MazeRaceState {
    if (state === null) state = initState(layout, rosterSize);
    return state;
  }

  return {
    init(ctx: { roster: RobotRoster; arena: Arena; rng: () => number }): RobotPose[] {
      const s = ensureState(ctx.roster.length);
      // buildStartPoses also writes each robot's initial target cell
      // (the entrance cell they queue at) into `s.targetCellId`. Robots
      // start outside the grid in the staging area, so we cannot rely on
      // a position-based fallback to determine the first target.
      return buildStartPoses(ctx.roster, layout, ctx.rng, s);
    },

    tick(ctx: TickContext): TickResult {
      const s = ensureState(ctx.poses.length);
      advanceMotion(ctx, layout, s);
      return processFinish(ctx, layout, s);
    },

    isDone(ctx: TickContext): boolean {
      const s = ensureState(ctx.poses.length);
      // Lever 2: we stay "not done" until the grace window expires AND
      // either the cull has fired or no actives remain. The engine
      // checks `isDone` BEFORE calling `tick`, so reporting done as
      // soon as the cull tick arrives causes the cull to be skipped.
      // We require either: (a) all robots inactive, or (b) finishTick
      // set AND tick has advanced past the grace window AND the field
      // has actually been culled (no actives remain). Condition (b)
      // collapses to (a) once the cull fires, so just check (a).
      for (let i = 0; i < ctx.poses.length; i++) {
        if (ctx.poses[i].active) return false;
      }
      return true;
    },
  };
}
