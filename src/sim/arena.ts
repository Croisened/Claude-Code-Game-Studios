/**
 * Arena Loader — converts a hand-authored `assets/data/arenas/arena-NN.json`
 * file into the in-memory `Arena` shape consumed by the Sim Engine (S5-04)
 * and the Sprint Race Event Module (S5-05).
 *
 * See design/gdd/arena-loader.md for the full contract. Key rules:
 * - Async with an injectable IO seam (`arenaSource`) for Node tests / S5-06.
 * - Validates *shape* only — refuses data that would crash the sim or
 *   produce viewer-visible nonsense; taste is the arena author's problem.
 * - Output is frozen, including nested gates, startGrid, and individual Gate
 *   objects.
 * - Coordinate system: right-handed, Y-up; +X = race direction, +Z = lane
 *   axis. Meters.
 */

import { CONFIG } from '@/config';

const SUPPORTED_ARENA_TYPES = ['sprint-race', 'maze-race'] as const;
const REQUIRED_TOP_LEVEL_FIELDS_SPRINT = [
  'id',
  'type',
  'length',
  'width',
  'startGrid',
  'gates',
] as const;
const REQUIRED_TOP_LEVEL_FIELDS_MAZE = [
  'id',
  'type',
  'length',
  'width',
  'mazeConfig',
] as const;
const REQUIRED_GATE_FIELDS = ['name', 'x', 'cullToCount'] as const;
const REQUIRED_START_GRID_FIELDS = [
  'lanes',
  'rows',
  'laneSpacing',
  'rowSpacing',
] as const;
const REQUIRED_MAZE_CONFIG_FIELDS = [
  'cellSize',
  'gridCols',
  'gridRows',
  'entranceCount',
  'finishCol',
  'finishRow',
] as const;
const MIN_GATE_COUNT = 2;
const MIN_ROSTER_COVERAGE = 85;

export type ArenaType = (typeof SUPPORTED_ARENA_TYPES)[number];

export interface Gate {
  readonly name: string;
  readonly x: number;
  readonly cullToCount: number;
}

export interface StartGrid {
  readonly lanes: number;
  readonly rows: number;
  readonly laneSpacing: number;
  readonly rowSpacing: number;
}

export interface MazeArenaConfig {
  readonly cellSize: number;
  readonly gridCols: number;
  readonly gridRows: number;
  readonly entranceCount: number;
  readonly finishCol: number;
  readonly finishRow: number;
}

/**
 * Arena variants:
 * - `sprint-race` arenas have a `startGrid` and a non-empty `gates` array.
 *   `mazeConfig` is undefined.
 * - `maze-race` arenas have a `mazeConfig`. They synthesize a single-cell
 *   `startGrid` and an empty `gates` array so the rest of the codebase can
 *   read `arena.startGrid` and `arena.gates` without branching, but neither
 *   is consulted by the maze-race event module.
 *
 * `maxTicks` is an optional per-arena override of the engine's safety
 * cap on simulation length. If undefined, the engine falls back to its
 * default (`CONFIG.sim.tickRateHz × 120` = 2 minutes). Mazes typically
 * need a longer cap because winding paths + staging march can exceed
 * the sprint-race default.
 */
export interface Arena {
  readonly id: string;
  readonly type: ArenaType;
  readonly length: number;
  readonly width: number;
  readonly startGrid: StartGrid;
  readonly gates: readonly Gate[];
  readonly mazeConfig?: MazeArenaConfig;
  readonly maxTicks?: number;
}

export interface LoadArenaOptions {
  readonly arenaSource?: () => Promise<unknown>;
  /**
   * Override the arena JSON path. Ignored when `arenaSource` is supplied
   * (the test seam wins). Defaults to `CONFIG.arena.defaultArenaPath`.
   */
  readonly arenaPath?: string;
}

function defaultArenaSource(arenaPath?: string): Promise<unknown> {
  return fetch(arenaPath ?? CONFIG.arena.defaultArenaPath).then((r) => r.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Arena field ${path} must be a finite number, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function ensurePositive(value: number, path: string): number {
  if (value <= 0) {
    throw new Error(`Arena field ${path} must be > 0, got ${value}`);
  }
  return value;
}

function ensurePositiveInteger(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `Arena ${path} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function ensureNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Arena ${path} must be a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function validateStartGrid(raw: unknown, courseWidth: number): StartGrid {
  if (!isRecord(raw)) {
    throw new Error(
      `Arena field startGrid must be an object, got ${typeof raw}`,
    );
  }
  for (const field of REQUIRED_START_GRID_FIELDS) {
    if (!(field in raw)) {
      throw new Error(`Arena missing required field startGrid.${field}`);
    }
  }
  const lanes = ensurePositiveInteger(raw.lanes, 'startGrid.lanes');
  const rows = ensurePositiveInteger(raw.rows, 'startGrid.rows');
  const laneSpacing = ensurePositive(
    ensureFiniteNumber(raw.laneSpacing, 'startGrid.laneSpacing'),
    'startGrid.laneSpacing',
  );
  const rowSpacing = ensurePositive(
    ensureFiniteNumber(raw.rowSpacing, 'startGrid.rowSpacing'),
    'startGrid.rowSpacing',
  );
  const capacity = lanes * rows;
  if (capacity < MIN_ROSTER_COVERAGE) {
    throw new Error(
      `Arena start grid capacity (${capacity}) must be at least ${MIN_ROSTER_COVERAGE} (the v1 roster size)`,
    );
  }
  const gridWidth = (lanes - 1) * laneSpacing;
  if (gridWidth >= courseWidth) {
    throw new Error(
      `Arena start grid (${gridWidth}m wide) does not fit in arena width (${courseWidth}m)`,
    );
  }
  return Object.freeze({ lanes, rows, laneSpacing, rowSpacing });
}

function validateGate(raw: unknown, index: number): Gate {
  if (!isRecord(raw)) {
    throw new Error(
      `Arena gates[${index}] must be an object, got ${typeof raw}`,
    );
  }
  for (const field of REQUIRED_GATE_FIELDS) {
    if (!(field in raw)) {
      throw new Error(`Arena gates[${index}] missing required field ${field}`);
    }
  }
  const name = ensureNonEmptyString(raw.name, `gates[${index}].name`);
  const x = ensureFiniteNumber(raw.x, `gates[${index}].x`);
  const cullRaw = raw.cullToCount;
  if (
    typeof cullRaw !== 'number' ||
    !Number.isInteger(cullRaw) ||
    cullRaw < 1
  ) {
    throw new Error(
      `Arena gate '${name}' cullToCount must be a positive integer, got ${JSON.stringify(cullRaw)}`,
    );
  }
  return Object.freeze({ name, x, cullToCount: cullRaw });
}

function validateGates(
  raw: unknown,
  arenaLength: number,
  gridCapacity: number,
): readonly Gate[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Arena field gates must be an array, got ${typeof raw}`);
  }
  if (raw.length < MIN_GATE_COUNT) {
    throw new Error(
      `Arena must have at least ${MIN_GATE_COUNT} gates (one cull + finish), got ${raw.length}`,
    );
  }
  const gates = raw.map((g, i) => validateGate(g, i));
  // R7: ascending X, finish at length, first cull < grid capacity, strictly decreasing culls.
  if (gates[0].x <= 0) {
    throw new Error(`Arena first gate must have x > 0, got ${gates[0].x}`);
  }
  for (let i = 1; i < gates.length; i++) {
    if (gates[i].x <= gates[i - 1].x) {
      throw new Error(
        `Arena gates must be in strictly ascending x order; gate '${gates[i].name}' (x=${gates[i].x}) at index ${i} violates this`,
      );
    }
  }
  const finish = gates[gates.length - 1];
  if (finish.x !== arenaLength) {
    throw new Error(
      `Arena last gate (finish) must be at x = length (${arenaLength}), got ${finish.x}`,
    );
  }
  if (gates[0].cullToCount >= gridCapacity) {
    throw new Error(
      `Arena first gate cullToCount (${gates[0].cullToCount}) must be less than start grid capacity (${gridCapacity}); arena would cull no robots`,
    );
  }
  for (let i = 1; i < gates.length; i++) {
    if (gates[i].cullToCount >= gates[i - 1].cullToCount) {
      throw new Error(
        `Arena gate cullToCount must strictly decrease; gate '${gates[i - 1].name}' (${gates[i - 1].cullToCount}) does not exceed next gate '${gates[i].name}' (${gates[i].cullToCount})`,
      );
    }
  }
  // E20: unique gate names.
  const seenNames = new Map<string, number>();
  for (let i = 0; i < gates.length; i++) {
    const prior = seenNames.get(gates[i].name);
    if (prior !== undefined) {
      throw new Error(
        `Arena gate names must be unique; '${gates[i].name}' appears at indices ${prior}, ${i}`,
      );
    }
    seenNames.set(gates[i].name, i);
  }
  return Object.freeze(gates);
}

function isSupportedType(value: unknown): value is ArenaType {
  return (
    typeof value === 'string' &&
    (SUPPORTED_ARENA_TYPES as readonly string[]).includes(value)
  );
}

function validateMazeConfig(raw: unknown): MazeArenaConfig {
  if (!isRecord(raw)) {
    throw new Error(
      `Arena field mazeConfig must be an object, got ${typeof raw}`,
    );
  }
  for (const field of REQUIRED_MAZE_CONFIG_FIELDS) {
    if (!(field in raw)) {
      throw new Error(`Arena missing required field mazeConfig.${field}`);
    }
  }
  const cellSize = ensurePositive(
    ensureFiniteNumber(raw.cellSize, 'mazeConfig.cellSize'),
    'mazeConfig.cellSize',
  );
  const gridCols = ensurePositiveInteger(raw.gridCols, 'mazeConfig.gridCols');
  const gridRows = ensurePositiveInteger(raw.gridRows, 'mazeConfig.gridRows');
  if (gridCols < 3 || gridRows < 3) {
    throw new Error(
      `Arena mazeConfig grid must be at least 3x3, got ${gridCols}x${gridRows}`,
    );
  }
  const entranceCount = ensurePositiveInteger(
    raw.entranceCount,
    'mazeConfig.entranceCount',
  );
  const perimeter = 2 * gridCols + 2 * gridRows - 4;
  if (entranceCount > perimeter) {
    throw new Error(
      `Arena mazeConfig.entranceCount (${entranceCount}) exceeds perimeter cell count (${perimeter})`,
    );
  }
  const finishCol = ensureFiniteNumber(raw.finishCol, 'mazeConfig.finishCol');
  const finishRow = ensureFiniteNumber(raw.finishRow, 'mazeConfig.finishRow');
  if (
    !Number.isInteger(finishCol) ||
    finishCol < 0 ||
    finishCol >= gridCols ||
    !Number.isInteger(finishRow) ||
    finishRow < 0 ||
    finishRow >= gridRows
  ) {
    throw new Error(
      `Arena mazeConfig finish (${finishCol}, ${finishRow}) outside grid (${gridCols}x${gridRows})`,
    );
  }
  return Object.freeze({
    cellSize,
    gridCols,
    gridRows,
    entranceCount,
    finishCol,
    finishRow,
  });
}

function buildArena(payload: Record<string, unknown>): Arena {
  if (!('type' in payload)) {
    throw new Error('Arena missing required field type');
  }
  if (!isSupportedType(payload.type)) {
    throw new Error(
      `Arena type ${JSON.stringify(payload.type)} is not supported in v1 (supported: [${SUPPORTED_ARENA_TYPES.join(', ')}])`,
    );
  }
  const type: ArenaType = payload.type;

  const required =
    type === 'maze-race' ? REQUIRED_TOP_LEVEL_FIELDS_MAZE : REQUIRED_TOP_LEVEL_FIELDS_SPRINT;
  for (const field of required) {
    if (!(field in payload)) {
      throw new Error(`Arena missing required field ${field}`);
    }
  }
  const id = ensureNonEmptyString(payload.id, 'id');
  const length = ensurePositive(
    ensureFiniteNumber(payload.length, 'length'),
    'length',
  );
  const width = ensurePositive(
    ensureFiniteNumber(payload.width, 'width'),
    'width',
  );

  // Optional per-arena maxTicks override. Bounded so a typo in the JSON
  // can't blow out memory by recording 30-minute pose-frame histories.
  let maxTicks: number | undefined;
  if (payload.maxTicks !== undefined) {
    maxTicks = ensurePositiveInteger(payload.maxTicks, 'maxTicks');
    const HARD_CAP = 60 * 300; // 5 minutes at 60Hz — generous upper bound
    if (maxTicks > HARD_CAP) {
      throw new Error(
        `Arena maxTicks (${maxTicks}) exceeds the hard cap of ${HARD_CAP} ticks (5 minutes at 60Hz)`,
      );
    }
  }

  if (type === 'maze-race') {
    const mazeConfig = validateMazeConfig(payload.mazeConfig);
    // Synthesize stubs so downstream consumers can read fields uniformly;
    // they're never consulted by the maze-race event module.
    const startGrid: StartGrid = Object.freeze({
      lanes: 1,
      rows: 1,
      laneSpacing: 1,
      rowSpacing: 1,
    });
    const gates: readonly Gate[] = Object.freeze([]);
    return Object.freeze({
      id,
      type,
      length,
      width,
      startGrid,
      gates,
      mazeConfig,
      maxTicks,
    });
  }

  const startGrid = validateStartGrid(payload.startGrid, width);
  const gridCapacity = startGrid.lanes * startGrid.rows;
  const gates = validateGates(payload.gates, length, gridCapacity);
  return Object.freeze({ id, type, length, width, startGrid, gates, maxTicks });
}

/**
 * Load an arena from JSON. See arena-loader.md for the full contract.
 */
export async function loadArena(opts: LoadArenaOptions = {}): Promise<Arena> {
  const source = opts.arenaSource ?? (() => defaultArenaSource(opts.arenaPath));
  let payload: unknown;
  try {
    payload = await source();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    const wrapped = new Error(`Failed to load arena: ${msg}`);
    (wrapped as Error & { cause?: unknown }).cause = cause;
    throw wrapped;
  }
  if (!isRecord(payload)) {
    throw new Error(`Arena JSON must be an object, got ${typeof payload}`);
  }
  return buildArena(payload);
}

/**
 * World-space (x, z) for the start position of slot `slotId` on `arena`.
 * Order: row-major across lanes, packed back through rows. Lanes are
 * centered around z = 0; row 0 is at the start line (x = 0); subsequent
 * rows step backward along -X.
 *
 * Note: `slotId` is a *grid slot*, not necessarily a robot id. Sprint
 * races permute robot id → slot via `shuffledStartSlots` (S6-03 polish);
 * other event modules may pass `id` directly for the legacy
 * id-deterministic layout.
 */
export function getStartPosition(
  arena: Arena,
  slotId: number,
): { x: number; z: number } {
  const capacity = arena.startGrid.lanes * arena.startGrid.rows;
  if (
    typeof slotId !== 'number' ||
    !Number.isInteger(slotId) ||
    slotId < 0 ||
    slotId >= capacity
  ) {
    throw new Error(
      `getStartPosition: slotId must be an integer in [0, ${capacity}), got ${slotId}`,
    );
  }
  const { lanes, laneSpacing, rowSpacing } = arena.startGrid;
  const lane = slotId % lanes;
  const row = Math.floor(slotId / lanes);
  const z = (lane - (lanes - 1) / 2) * laneSpacing;
  const x = -row * rowSpacing;
  return { x, z };
}

/**
 * Build a length-`count` permutation of `[0..count-1]` using a Fisher-Yates
 * shuffle driven by the supplied seeded `rng`. Used by Sprint Race to map
 * robot id → starting grid slot, so race-to-race start positions vary
 * with the seed (a back-row draw means the robot has further to run).
 *
 * Determinism: same `rng` draws (i.e. same seed at the engine level) →
 * same permutation. The shuffle consumes exactly `count - 1` rng calls.
 *
 * Throws on negative or non-integer `count`. `count === 0` returns `[]`.
 */
export function shuffledStartSlots(
  rng: () => number,
  count: number,
): number[] {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error(
      `shuffledStartSlots: count must be a non-negative integer, got ${count}`,
    );
  }
  const slots = new Array<number>(count);
  for (let i = 0; i < count; i++) slots[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i];
    slots[i] = slots[j];
    slots[j] = tmp;
  }
  return slots;
}
