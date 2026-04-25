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

const SUPPORTED_ARENA_TYPES = ['sprint-race'] as const;
const REQUIRED_TOP_LEVEL_FIELDS = [
  'id',
  'type',
  'length',
  'width',
  'startGrid',
  'gates',
] as const;
const REQUIRED_GATE_FIELDS = ['name', 'x', 'cullToCount'] as const;
const REQUIRED_START_GRID_FIELDS = [
  'lanes',
  'rows',
  'laneSpacing',
  'rowSpacing',
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

export interface Arena {
  readonly id: string;
  readonly type: ArenaType;
  readonly length: number;
  readonly width: number;
  readonly startGrid: StartGrid;
  readonly gates: readonly Gate[];
}

export interface LoadArenaOptions {
  readonly arenaSource?: () => Promise<unknown>;
}

function defaultArenaSource(): Promise<unknown> {
  return fetch(CONFIG.arena.defaultArenaPath).then((r) => r.json());
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

function buildArena(payload: Record<string, unknown>): Arena {
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in payload)) {
      throw new Error(`Arena missing required field ${field}`);
    }
  }
  const id = ensureNonEmptyString(payload.id, 'id');
  if (!isSupportedType(payload.type)) {
    throw new Error(
      `Arena type ${JSON.stringify(payload.type)} is not supported in v1 (supported: [${SUPPORTED_ARENA_TYPES.join(', ')}])`,
    );
  }
  const type = payload.type;
  const length = ensurePositive(
    ensureFiniteNumber(payload.length, 'length'),
    'length',
  );
  const width = ensurePositive(
    ensureFiniteNumber(payload.width, 'width'),
    'width',
  );
  const startGrid = validateStartGrid(payload.startGrid, width);
  const gridCapacity = startGrid.lanes * startGrid.rows;
  const gates = validateGates(payload.gates, length, gridCapacity);
  return Object.freeze({ id, type, length, width, startGrid, gates });
}

/**
 * Load an arena from JSON. See arena-loader.md for the full contract.
 */
export async function loadArena(opts: LoadArenaOptions = {}): Promise<Arena> {
  const source = opts.arenaSource ?? defaultArenaSource;
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
 * World-space (x, z) for the start position of robot `id` on `arena`.
 * Order: row-major across lanes, packed back through rows. Lanes are
 * centered around z = 0; row 0 is at the start line (x = 0); subsequent
 * rows step backward along -X.
 */
export function getStartPosition(
  arena: Arena,
  robotId: number,
): { x: number; z: number } {
  const capacity = arena.startGrid.lanes * arena.startGrid.rows;
  if (
    typeof robotId !== 'number' ||
    !Number.isInteger(robotId) ||
    robotId < 0 ||
    robotId >= capacity
  ) {
    throw new Error(
      `getStartPosition: robotId must be an integer in [0, ${capacity}), got ${robotId}`,
    );
  }
  const { lanes, laneSpacing, rowSpacing } = arena.startGrid;
  const lane = robotId % lanes;
  const row = Math.floor(robotId / lanes);
  const z = (lane - (lanes - 1) / 2) * laneSpacing;
  const x = -row * rowSpacing;
  return { x, z };
}
