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
  /** True once the first robot crosses into the finish cell. */
  finished: boolean;
}

export interface MazeRaceOptions {
  readonly layout: MazeLayout;
}

function initState(layout: MazeLayout, rosterSize: number): MazeRaceState {
  return {
    targetCellId: new Array<number>(rosterSize).fill(layout.finishCellId),
    prevCellId: new Array<number>(rosterSize).fill(-1),
    finished: false,
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

/**
 * Pick the next cell id to head for from `arrivedCellId`. Consumes one
 * `rng()` draw. Encodes the wrong-turn behavior:
 *
 *   - With probability `(1 - pathfinding) * mistakeMaxRate`, pick a
 *     random non-optimal, non-prev open neighbor (a "wrong turn").
 *   - Otherwise pick `nextOnPath[arrivedCellId]` (the BFS-shortest
 *     direction toward the finish, even if that means doubling back
 *     after a previous mistake — that's how robots recover).
 *
 * Cipher-trait-driven `stat.pathfinding` ranges roughly [0.3, 1.0]; with
 * `mistakeMaxRate = 0.3` that yields a 0–21% per-junction mistake rate.
 * Junctions with no non-prev alternative (corridors, dead-ends) skip the
 * roll and always take optimal — there is no other choice.
 */
function pickNextCell(
  layout: MazeLayout,
  arrivedCellId: number,
  prevCellId: number,
  pathfinding: number,
  rng: () => number,
): number {
  const optimal = layout.nextOnPath[arrivedCellId];
  if (optimal === -1) return -1;
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
  if (candidates.length === 0) return optimal;
  const pMistake =
    (1 - pathfinding) * CONFIG.sim.mazeRace.mistakeMaxRate;
  if (u >= pMistake) return optimal;
  // Reuse `u` as the candidate selector by remapping `[0, pMistake)` to
  // `[0, candidates.length)`. Single rng() draw per arrival keeps the
  // engine's "deterministic per seed" contract clean.
  const idx = Math.min(
    candidates.length - 1,
    Math.floor((u / pMistake) * candidates.length),
  );
  return candidates[idx];
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
          // phase emits the finish event and ends the race.
          continue;
        }
        const nextId = pickNextCell(
          layout,
          targetCellId,
          state.prevCellId[id],
          stat.pathfinding,
          ctx.rng,
        );
        if (nextId === -1) {
          // Disconnected cell — shouldn't happen in a perfect maze, but
          // be safe: stop moving this robot.
          continue;
        }
        // Update prev BEFORE overwriting targetCellId. After this, the
        // robot is "at" `targetCellId` and headed toward `nextId`, so
        // its next arrival decision will see prev = the cell it just
        // left = the current `targetCellId`.
        state.prevCellId[id] = targetCellId;
        state.targetCellId[id] = nextId;
        targetCellId = nextId;
      }
    }

    // Primary motion: steer toward target cell center.
    const targetPos = cellIdWorldPos(layout, targetCellId);
    const dx = targetPos.x - pose.x;
    const dz = targetPos.z - pose.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);
    if (distToTarget === 0) continue;
    const step = Math.min(speed * dt, distToTarget);
    const nx = dx / distToTarget;
    const nz = dz / distToTarget;

    // Boids-style separation push from neighbors. Iterates id-sorted to
    // preserve determinism (mirrors sprint-race's separation rule). We
    // use full 2D radial push because maze motion is multi-axial.
    let pushX = 0;
    let pushZ = 0;
    for (let j = 0; j < ctx.poses.length; j++) {
      if (j === id) continue;
      const other = ctx.poses[j];
      if (!other.active) continue;
      const odx = pose.x - other.x;
      const odz = pose.z - other.z;
      const distSq = odx * odx + odz * odz;
      if (distSq >= sepRSq) continue;
      if (distSq < sepEps * sepEps) {
        // Coincident: deterministic id-based tiebreak so they nudge
        // apart along +X / -X within a tick.
        pushX += (id < j ? 1 : -1) * sepForce;
        continue;
      }
      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / sepR;
      pushX += (odx / dist) * sepForce * falloff;
      pushZ += (odz / dist) * sepForce * falloff;
    }

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
  if (state.finished) return { finishes, eliminations };

  const finishPos = cellIdWorldPos(layout, layout.finishCellId);
  const arrivalSq =
    CONFIG.sim.mazeRace.cellArrivalRadius * CONFIG.sim.mazeRace.cellArrivalRadius;

  // Id-ascending tiebreak — first id in the loop wins ties.
  for (let id = 0; id < ctx.poses.length; id++) {
    const pose = ctx.poses[id];
    if (!pose.active) continue;
    const dx = finishPos.x - pose.x;
    const dz = finishPos.z - pose.z;
    if (dx * dx + dz * dz > arrivalSq) continue;
    finishes.push({ robotId: id });
    state.finished = true;
    // Eliminate everyone else still active so the engine stops them.
    for (let j = 0; j < ctx.poses.length; j++) {
      if (j === id) continue;
      if (!ctx.poses[j].active) continue;
      eliminations.push({ robotId: j, reason: ELIM_REASON_RACE_OVER });
    }
    break;
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
      if (s.finished) return true;
      for (let i = 0; i < ctx.poses.length; i++) {
        if (ctx.poses[i].active) return false;
      }
      return true;
    },
  };
}
