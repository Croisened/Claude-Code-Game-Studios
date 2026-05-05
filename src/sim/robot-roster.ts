/**
 * Robot Roster Loader — converts the build artifact `public/traits.json`
 * (snake_case, produced by S4-03) into the in-memory `RobotRoster` shape
 * the sim and renderer consume.
 *
 * See design/gdd/robot-roster-loader.md for the full contract. Key rules:
 * - Async with an injectable IO seam (`traitsSource`) for Node tests / S5-06.
 * - Snake → camel mapping at this single boundary; no other module reads the
 *   snake_case JSON.
 * - Pre-derives `SimStats` via `deriveStats` (S5-01) at load time; the sim
 *   never re-derives.
 * - Integrity validation only (count + ID coverage + field presence). The
 *   build script owns business validation (sum ≤ 100, integer traits, etc.).
 * - Output is a frozen, id-sorted array; `roster[i].id === i`.
 */

import { CONFIG } from '@/config';
import {
  deriveStats,
  type RobotTraits,
  type SimStats,
  type SpeedSourceTrait,
} from '@/sim/trait-to-stat';

/**
 * `EXPECTED_ROBOT_COUNT` is bound to the CSV / NFT collection size on disk.
 * It is intentionally NOT sourced from `CONFIG.renderer.robotCount`, which is
 * a render-side performance fallback (range 10–85). The loader always ingests
 * the full roster regardless of how many robots the renderer ultimately draws.
 */
const EXPECTED_ROBOT_COUNT = 85;

const REQUIRED_FIELDS = [
  'id',
  'name',
  'full_send',
  'degen',
  'cipher',
  'doubter',
  'altruist',
] as const;

export interface RobotRosterEntry {
  readonly id: number;
  readonly name: string;
  readonly traits: RobotTraits;
  readonly stats: SimStats;
  readonly skinTexturePath: string;
}

export type RobotRoster = readonly RobotRosterEntry[];

export interface LoadRosterOptions {
  /**
   * Returns the parsed JSON payload. Default: fetches
   * `CONFIG.build.traitsJsonPath` via `fetch` and `.json()`. Override in
   * Node tests and the headless sim harness (S5-06).
   */
  readonly traitsSource?: () => Promise<unknown>;
}

interface RawRecord {
  id: unknown;
  name: unknown;
  full_send: unknown;
  degen: unknown;
  cipher: unknown;
  doubter: unknown;
  altruist: unknown;
}

function defaultTraitsSource(): Promise<unknown> {
  return fetch(CONFIG.build.traitsJsonPath).then((r) => r.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldFinite(record: Record<string, unknown>, field: string): boolean {
  const v = record[field];
  return typeof v === 'number' && Number.isFinite(v);
}

function validateRecord(record: unknown, index: number): RawRecord {
  if (!isRecord(record)) {
    throw new Error(`Roster entry at index ${index} must be an object, got ${typeof record}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) {
      const id = typeof record.id === 'number' ? record.id : 'unknown';
      throw new Error(`Roster entry at index ${index} (id=${id}) missing required field ${field}`);
    }
  }
  const numericFields: readonly string[] = ['id', 'full_send', 'degen', 'cipher', 'doubter', 'altruist'];
  for (const field of numericFields) {
    if (!fieldFinite(record, field)) {
      const id = typeof record.id === 'number' ? record.id : 'unknown';
      throw new Error(
        `Roster entry at index ${index} (id=${id}) missing required field ${field}`,
      );
    }
  }
  if (typeof record.name !== 'string' || record.name.length === 0) {
    const id = typeof record.id === 'number' ? record.id : 'unknown';
    throw new Error(`Roster entry at index ${index} (id=${id}) missing required field name`);
  }
  return record as unknown as RawRecord;
}

function validateIdCoverage(ids: readonly number[]): void {
  const seen = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const prior = seen.get(id);
    if (prior !== undefined) {
      throw new Error(`Roster has duplicate id ${id} (at indices ${prior}, ${i})`);
    }
    seen.set(id, i);
  }
  const missing: number[] = [];
  for (let id = 0; id < EXPECTED_ROBOT_COUNT; id++) {
    if (!seen.has(id)) missing.push(id);
  }
  const unexpected: number[] = [];
  for (const id of seen.keys()) {
    if (id < 0 || id >= EXPECTED_ROBOT_COUNT || !Number.isInteger(id)) {
      unexpected.push(id);
    }
  }
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Roster ids must be {0..${EXPECTED_ROBOT_COUNT - 1}}, got missing: [${missing.join(',')}], unexpected: [${unexpected.join(',')}]`,
    );
  }
}

function buildEntry(raw: RawRecord): RobotRosterEntry {
  const traits: RobotTraits = Object.freeze({
    fullSend: raw.full_send as number,
    degen: raw.degen as number,
    cipher: raw.cipher as number,
    doubter: raw.doubter as number,
    altruist: raw.altruist as number,
  });
  const stats = Object.freeze(deriveStats(traits));
  const id = raw.id as number;
  const skinTexturePath = CONFIG.renderer.skinTexturePathPattern.replace(
    '{id}',
    String(id),
  );
  return Object.freeze({
    id,
    name: raw.name as string,
    traits,
    stats,
    skinTexturePath,
  });
}

/**
 * Load the robot roster. See robot-roster-loader.md for the full contract.
 */
export async function loadRoster(opts: LoadRosterOptions = {}): Promise<RobotRoster> {
  const source = opts.traitsSource ?? defaultTraitsSource;
  let payload: unknown;
  try {
    payload = await source();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    const wrapped = new Error(`Failed to load roster: ${msg}`);
    (wrapped as Error & { cause?: unknown }).cause = cause;
    throw wrapped;
  }
  if (!Array.isArray(payload)) {
    throw new Error(`Roster JSON must be an array, got ${typeof payload}`);
  }
  if (payload.length !== EXPECTED_ROBOT_COUNT) {
    throw new Error(
      `Roster must have ${EXPECTED_ROBOT_COUNT} entries, got ${payload.length}`,
    );
  }
  const records = payload.map((rec, i) => validateRecord(rec, i));
  validateIdCoverage(records.map((r) => r.id as number));
  const entries = records.map(buildEntry);
  entries.sort((a, b) => a.id - b.id);
  return Object.freeze(entries);
}

/**
 * Return a new immutable roster with stats re-derived using the supplied
 * `speedSourceTrait`. Used by the trait-wheel feature: the base roster is
 * loaded once on app start, then re-derived per race once the wheel commits
 * a trait. Pure, synchronous, reuses raw `traits` references (frozen).
 */
export function withSpeedSource(
  roster: RobotRoster,
  speedSourceTrait: SpeedSourceTrait,
): RobotRoster {
  return Object.freeze(
    roster.map((entry) =>
      Object.freeze({
        ...entry,
        stats: Object.freeze(deriveStats(entry.traits, { speedSourceTrait })),
      }),
    ),
  );
}
