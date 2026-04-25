/**
 * Maze Generator — recursive-backtracker maze on a (cols × rows) cell grid,
 * with a deterministic seed-driven RNG. Used by Arena-02 (`maze-race`).
 *
 * Output is consumed by:
 *   - `createMazeRaceModule` (sim event module) — entrances + nextOnPath
 *     drive per-robot motion toward the finish.
 *   - `createMazeWalls` (renderer visual) — wall list becomes a Group of
 *     box meshes added to the scene.
 *   - The follow-leader camera's leader resolver — `distanceMap` lets the
 *     camera pick the robot closest to the finish (in cells), since maze
 *     paths aren't monotonic in any single world axis.
 *
 * Coordinates: right-handed, Y-up. Cell (col, row) maps to world (x, z)
 * with the grid centered on the origin. `+X` = column index direction,
 * `+Z` = row index direction.
 *
 * Determinism: `generateMazeLayout({ config, seed })` is pure — same seed +
 * same config → byte-identical layout. Uses `createRng` (`@/sim/rng`), not
 * `Math.random`.
 */

import { createRng } from '@/sim/rng';

export interface MazeConfig {
  /** World units per cell (square cells). */
  readonly cellSize: number;
  /** Number of columns (X axis). */
  readonly gridCols: number;
  /** Number of rows (Z axis). */
  readonly gridRows: number;
  /** How many distinct perimeter cells to use as starting entrances. */
  readonly entranceCount: number;
  /** Column index of the finish cell. */
  readonly finishCol: number;
  /** Row index of the finish cell. */
  readonly finishRow: number;
}

export interface MazeWall {
  /** World-space center of the wall segment. */
  readonly x: number;
  readonly z: number;
  /** Length along the wall's long axis. */
  readonly length: number;
  /** 'horizontal' = runs along world X (between two cells stacked in Z). */
  readonly orientation: 'horizontal' | 'vertical';
}

export interface MazeLayout {
  readonly config: MazeConfig;
  /** Visualizable wall segments after entrances have been knocked out. */
  readonly walls: readonly MazeWall[];
  /** Cell ids of the chosen entrances (perimeter cells). */
  readonly entrances: readonly number[];
  /** Cell id of the finish (`finishRow * gridCols + finishCol`). */
  readonly finishCellId: number;
  /** BFS distance from each cell to the finish, in cells. -1 = unreachable. */
  readonly distanceMap: readonly number[];
  /** `nextOnPath[cellId]` = next cell id toward finish, or -1 at finish/unreachable. */
  readonly nextOnPath: readonly number[];
  /**
   * Per-cell wall bitmask. Bit 1 = N wall, 2 = E, 4 = S, 8 = W. Used by
   * the maze-race motion loop to clamp robot positions to the corridor
   * after applying separation push (so neighbor avoidance can't shove
   * a robot through a wall).
   */
  readonly wallMask: Uint8Array;
}

/** Convert cell (col, row) to world (x, z), grid centered on origin. */
export function cellWorldPos(
  config: MazeConfig,
  col: number,
  row: number,
): { x: number; z: number } {
  return {
    x: (col - (config.gridCols - 1) / 2) * config.cellSize,
    z: (row - (config.gridRows - 1) / 2) * config.cellSize,
  };
}

/** World-space (x, z) of a cell id's center. */
export function cellIdWorldPos(
  layout: Pick<MazeLayout, 'config'>,
  cellId: number,
): { x: number; z: number } {
  const { gridCols } = layout.config;
  return cellWorldPos(layout.config, cellId % gridCols, Math.floor(cellId / gridCols));
}

/**
 * Map a world (x, z) to a cell id, or null if outside the grid. The grid
 * is centered on the origin; cell boundaries are at half-cellSize offsets.
 */
export function worldToCellId(
  layout: Pick<MazeLayout, 'config'>,
  x: number,
  z: number,
): number | null {
  const { cellSize, gridCols, gridRows } = layout.config;
  const col = Math.round(x / cellSize + (gridCols - 1) / 2);
  const row = Math.round(z / cellSize + (gridRows - 1) / 2);
  if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) return null;
  return row * gridCols + col;
}

/**
 * Outward-facing unit normal for an entrance cell — the direction the
 * staging area extends in (away from the maze interior). For corner
 * cells, prefers N/S over W/E so the choice matches `pickOuterWall`.
 */
export function entranceOuterDir(
  layout: Pick<MazeLayout, 'config'>,
  cellId: number,
): { x: number; z: number } {
  const { gridCols, gridRows } = layout.config;
  const col = cellId % gridCols;
  const row = Math.floor(cellId / gridCols);
  if (row === 0) return { x: 0, z: -1 };
  if (row === gridRows - 1) return { x: 0, z: 1 };
  if (col === 0) return { x: -1, z: 0 };
  if (col === gridCols - 1) return { x: 1, z: 0 };
  // Non-perimeter cell — caller passed something that isn't an entrance.
  // Fall back to N so the caller doesn't crash, but this is a logic bug.
  return { x: 0, z: -1 };
}

/**
 * Progress metric for a robot at world (x, z) — BFS distance from the
 * nearest grid cell to the finish, plus a sub-cell penalty in cell-units
 * for how far the robot is from that cell's center. Smooth and monotone
 * for the camera's leader rule, including for robots staged OUTSIDE the
 * grid (out-of-grid coordinates clamp to the nearest perimeter cell so
 * queue depth shows up as extra distance, not as a discontinuity).
 */
export function progressDistanceFromFinish(
  layout: MazeLayout,
  x: number,
  z: number,
): number {
  const { gridCols, gridRows, cellSize } = layout.config;
  const colF = x / cellSize + (gridCols - 1) / 2;
  const rowF = z / cellSize + (gridRows - 1) / 2;
  const col = Math.max(0, Math.min(gridCols - 1, Math.round(colF)));
  const row = Math.max(0, Math.min(gridRows - 1, Math.round(rowF)));
  const cellId = row * gridCols + col;
  const cellDist = layout.distanceMap[cellId];
  if (cellDist < 0) return Infinity;
  const cellPos = cellWorldPos(layout.config, col, row);
  const extra =
    (Math.abs(x - cellPos.x) + Math.abs(z - cellPos.z)) / cellSize;
  return cellDist + extra;
}

// Wall-bit encoding. Adjacent cells share a wall: cell.E is the same
// physical wall as next-cell.W. Both bits get flipped together when the
// generator carves a passage between two cells.
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const ALL_WALLS = N | E | S | W;
const DIRS: readonly number[] = [N, E, S, W];

function opposite(dir: number): number {
  if (dir === N) return S;
  if (dir === S) return N;
  if (dir === E) return W;
  return E;
}

function dCol(dir: number): number {
  if (dir === E) return 1;
  if (dir === W) return -1;
  return 0;
}

function dRow(dir: number): number {
  if (dir === S) return 1;
  if (dir === N) return -1;
  return 0;
}

function shuffleInPlace(arr: number[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function validateConfig(config: MazeConfig): void {
  const requiredPositiveInts: ReadonlyArray<readonly [string, number]> = [
    ['gridCols', config.gridCols],
    ['gridRows', config.gridRows],
    ['entranceCount', config.entranceCount],
  ];
  for (const [name, value] of requiredPositiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`MazeConfig.${name} must be a positive integer, got ${value}`);
    }
  }
  if (!(config.cellSize > 0)) {
    throw new Error(`MazeConfig.cellSize must be > 0, got ${config.cellSize}`);
  }
  if (config.gridCols < 3 || config.gridRows < 3) {
    throw new Error('MazeConfig grid must be at least 3x3 to have any interior cells');
  }
  const perimeterCount =
    2 * config.gridCols + 2 * config.gridRows - 4;
  if (config.entranceCount > perimeterCount) {
    throw new Error(
      `MazeConfig.entranceCount (${config.entranceCount}) exceeds perimeter cell count (${perimeterCount})`,
    );
  }
  if (
    config.finishCol < 0 ||
    config.finishCol >= config.gridCols ||
    config.finishRow < 0 ||
    config.finishRow >= config.gridRows
  ) {
    throw new Error(
      `MazeConfig.finish (${config.finishCol}, ${config.finishRow}) outside grid (${config.gridCols}x${config.gridRows})`,
    );
  }
}

function carvePassages(
  config: MazeConfig,
  rng: () => number,
): Uint8Array {
  const { gridCols, gridRows } = config;
  const total = gridCols * gridRows;
  const walls = new Uint8Array(total);
  walls.fill(ALL_WALLS);
  const visited = new Uint8Array(total);

  // Iterative recursive backtracker. Start at top-left for determinism;
  // any fixed start works since the maze is connected and the rng-driven
  // direction shuffle provides the variety.
  const stack: number[] = [0];
  visited[0] = 1;

  const dirsScratch: number[] = [N, E, S, W];

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const col = cur % gridCols;
    const row = Math.floor(cur / gridCols);

    dirsScratch[0] = N;
    dirsScratch[1] = E;
    dirsScratch[2] = S;
    dirsScratch[3] = W;
    shuffleInPlace(dirsScratch, rng);

    let advanced = false;
    for (let k = 0; k < 4; k++) {
      const d = dirsScratch[k];
      const nc = col + dCol(d);
      const nr = row + dRow(d);
      if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) continue;
      const next = nr * gridCols + nc;
      if (visited[next]) continue;
      walls[cur] = walls[cur] & ~d;
      walls[next] = walls[next] & ~opposite(d);
      visited[next] = 1;
      stack.push(next);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }

  return walls;
}

function listPerimeterCells(config: MazeConfig): number[] {
  const { gridCols, gridRows } = config;
  const cells: number[] = [];
  // Top row
  for (let c = 0; c < gridCols; c++) cells.push(c);
  // Bottom row
  for (let c = 0; c < gridCols; c++) cells.push((gridRows - 1) * gridCols + c);
  // Left + right columns (excluding corners already counted)
  for (let r = 1; r < gridRows - 1; r++) {
    cells.push(r * gridCols);
    cells.push(r * gridCols + (gridCols - 1));
  }
  return cells;
}

/**
 * Pick the outer wall bit for a perimeter cell. Corner cells have two
 * outer walls; we prefer N over S, then W over E, so the choice is
 * deterministic.
 */
function pickOuterWall(config: MazeConfig, cellId: number): number {
  const col = cellId % config.gridCols;
  const row = Math.floor(cellId / config.gridCols);
  if (row === 0) return N;
  if (row === config.gridRows - 1) return S;
  if (col === 0) return W;
  if (col === config.gridCols - 1) return E;
  throw new Error(`pickOuterWall: cell ${cellId} is not on the perimeter`);
}

function bfsFromFinish(
  config: MazeConfig,
  walls: Uint8Array,
  finishCellId: number,
): { distanceMap: number[]; nextOnPath: number[] } {
  const { gridCols, gridRows } = config;
  const total = gridCols * gridRows;
  const distanceMap = new Array<number>(total).fill(-1);
  const nextOnPath = new Array<number>(total).fill(-1);
  distanceMap[finishCellId] = 0;
  const queue: number[] = [finishCellId];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const col = cur % gridCols;
    const row = Math.floor(cur / gridCols);
    const wm = walls[cur];
    for (let k = 0; k < 4; k++) {
      const d = DIRS[k];
      if (wm & d) continue; // wall blocks
      const nc = col + dCol(d);
      const nr = row + dRow(d);
      if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) continue;
      const next = nr * gridCols + nc;
      if (distanceMap[next] !== -1) continue;
      distanceMap[next] = distanceMap[cur] + 1;
      // BFS guarantees the first discoverer is on a shortest path. The
      // neighbor's "next step toward finish" is whichever cell discovered it.
      nextOnPath[next] = cur;
      queue.push(next);
    }
  }

  return { distanceMap, nextOnPath };
}

function buildWallList(
  config: MazeConfig,
  walls: Uint8Array,
): MazeWall[] {
  const { gridCols, gridRows, cellSize } = config;
  const list: MazeWall[] = [];
  // Each cell emits its N wall and W wall; bottom-row cells additionally
  // emit S, right-col cells additionally emit E. This visits each unique
  // wall exactly once (no duplicates between adjacent cells).
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const id = r * gridCols + c;
      const wm = walls[id];
      const cw = cellWorldPos(config, c, r);
      if (wm & N) {
        list.push({
          x: cw.x,
          z: cw.z - cellSize / 2,
          length: cellSize,
          orientation: 'horizontal',
        });
      }
      if (wm & W) {
        list.push({
          x: cw.x - cellSize / 2,
          z: cw.z,
          length: cellSize,
          orientation: 'vertical',
        });
      }
      if (r === gridRows - 1 && (wm & S)) {
        list.push({
          x: cw.x,
          z: cw.z + cellSize / 2,
          length: cellSize,
          orientation: 'horizontal',
        });
      }
      if (c === gridCols - 1 && (wm & E)) {
        list.push({
          x: cw.x + cellSize / 2,
          z: cw.z,
          length: cellSize,
          orientation: 'vertical',
        });
      }
    }
  }
  return list;
}

export interface GenerateMazeOptions {
  readonly config: MazeConfig;
  readonly seed: number;
}

/** Build a deterministic maze layout for `config` from `seed`. */
export function generateMazeLayout(opts: GenerateMazeOptions): MazeLayout {
  validateConfig(opts.config);
  const rng = createRng(opts.seed);
  const config = opts.config;

  const walls = carvePassages(config, rng);

  // Pick entrances: shuffle perimeter cells with the same rng (so seed
  // drives both maze topology and entrance choices), take the first N.
  // Knock out their outer walls so robots can stand on the cell with no
  // wall behind them — visually obvious "openings" into the maze.
  const perimeter = listPerimeterCells(config);
  shuffleInPlace(perimeter, rng);
  const entrances = perimeter.slice(0, config.entranceCount);

  for (const cellId of entrances) {
    const outer = pickOuterWall(config, cellId);
    walls[cellId] = walls[cellId] & ~outer;
  }

  // Carve a small clearing around the finish so the post is visible from
  // every approach. This removes the inner walls between the finish cell
  // and its 4 neighbors. (The neighbors keep their walls toward THEIR
  // other neighbors, so the rest of the maze is undisturbed — only the
  // 4 walls touching the finish cell come down.)
  const finishCellId = config.finishRow * config.gridCols + config.finishCol;
  for (let k = 0; k < 4; k++) {
    const d = DIRS[k];
    if ((walls[finishCellId] & d) === 0) continue;
    const nc = config.finishCol + dCol(d);
    const nr = config.finishRow + dRow(d);
    if (nc < 0 || nc >= config.gridCols || nr < 0 || nr >= config.gridRows) continue;
    const neighborId = nr * config.gridCols + nc;
    walls[finishCellId] = walls[finishCellId] & ~d;
    walls[neighborId] = walls[neighborId] & ~opposite(d);
  }

  const { distanceMap, nextOnPath } = bfsFromFinish(config, walls, finishCellId);
  const wallList = buildWallList(config, walls);

  return Object.freeze({
    config,
    walls: Object.freeze(wallList),
    entrances: Object.freeze(entrances),
    finishCellId,
    distanceMap: Object.freeze(distanceMap),
    nextOnPath: Object.freeze(nextOnPath),
    wallMask: walls,
  });
}
