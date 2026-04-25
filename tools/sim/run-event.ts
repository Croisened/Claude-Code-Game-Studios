/**
 * Headless Sprint Race harness (S5-06).
 *
 * Loads the built `public/traits.json` roster + an arena JSON file, runs
 * one Sprint Race event through the Sim Engine Core (S5-04) + Sprint Race
 * Event Module (S5-05), and emits the resulting timeline + pose frames as
 * JSON. This is the artifact Sprint 6 will consume to drive the renderer.
 *
 * Usage:
 *   npx tsx tools/sim/run-event.ts --seed 42
 *   npx tsx tools/sim/run-event.ts --seed 42 --no-poses --pretty
 *   npx tsx tools/sim/run-event.ts --seed 42 --out production/session-state/sim.json
 *
 * stdout receives the deterministic JSON artifact. stderr receives a
 * one-line diagnostic (timing, byte count) — kept off stdout so two runs
 * with the same seed produce byte-identical stdout.
 *
 * Determinism contract (mirrors src/sim/engine.ts §3):
 * - `output.meta` contains only deterministic fields (seed, arenaId,
 *   rosterSize, ticks, poseFramesIncluded). No timestamps, no elapsed-ms.
 * - Float32Array pose data is serialized as `number[]` via `Array.from`
 *   so the JSON shape is portable.
 *
 * Imports `src/` via relative paths; tools/ is outside the project's
 * `tsconfig.include` (`["src"]`), so `tsc --noEmit` does not typecheck
 * this file. Vitest does run its sibling test file via vite's resolver.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRoster } from '../../src/sim/robot-roster';
import { loadArena } from '../../src/sim/arena';
import { runSim, type SimResult } from '../../src/sim/engine';
import { createSprintRaceModule } from '../../src/sim/sprint-race';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

export const DEFAULT_TRAITS_PATH = resolve(REPO_ROOT, 'public/traits.json');
export const DEFAULT_ARENA_PATH = resolve(
  REPO_ROOT,
  'assets/data/arenas/arena-01.json',
);

export interface BuildEventOptions {
  readonly seed: number;
  readonly rosterJson: unknown;
  readonly arenaJson: unknown;
  readonly includePoseFrames: boolean;
}

export interface SerializedPoseFrame {
  readonly tick: number;
  readonly data: number[];
}

export interface EventOutput {
  readonly meta: {
    readonly seed: number;
    readonly arenaId: string;
    readonly rosterSize: number;
    readonly ticks: number;
    readonly poseFramesIncluded: boolean;
  };
  readonly events: SimResult['events'];
  readonly finishOrder: SimResult['finishOrder'];
  readonly winnerId: SimResult['winnerId'];
  readonly poseFrames: SerializedPoseFrame[] | null;
}

/**
 * Pure (modulo loader I/O) function — calls into the loaders with
 * pre-parsed JSON, runs one race, returns a JSON-ready output object.
 * Test seam for `tools/sim/run-event.test.ts`.
 */
export async function buildEventOutput(
  opts: BuildEventOptions,
): Promise<EventOutput> {
  const roster = await loadRoster({
    traitsSource: () => Promise.resolve(opts.rosterJson),
  });
  const arena = await loadArena({
    arenaSource: () => Promise.resolve(opts.arenaJson),
  });

  const result = runSim({
    seed: opts.seed,
    roster,
    arena,
    eventModule: createSprintRaceModule(),
    recordPoseFrames: opts.includePoseFrames,
  });

  const poseFrames = opts.includePoseFrames
    ? result.poseFrames.map(
        (f): SerializedPoseFrame => ({
          tick: f.tick,
          data: Array.from(f.data),
        }),
      )
    : null;

  return {
    meta: {
      seed: opts.seed,
      arenaId: arena.id,
      rosterSize: roster.length,
      ticks: result.ticks,
      poseFramesIncluded: opts.includePoseFrames,
    },
    events: result.events,
    finishOrder: result.finishOrder,
    winnerId: result.winnerId,
    poseFrames,
  };
}

interface CliArgs {
  readonly seed: number;
  readonly arenaPath: string;
  readonly outPath: string | null;
  readonly includePoseFrames: boolean;
  readonly pretty: boolean;
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npx tsx tools/sim/run-event.ts --seed N [options]',
      '',
      '  --seed N         Required. Integer RNG seed.',
      '  --arena PATH     Default: assets/data/arenas/arena-01.json',
      '  --out PATH       Default: stdout. Path is resolved against repo root.',
      '  --no-poses       Skip per-tick pose frames (much smaller output).',
      '  --pretty         Pretty-print JSON (2-space indent).',
      '  -h, --help       Show this help.',
      '',
    ].join('\n'),
  );
}

export function parseCli(argv: readonly string[]): CliArgs {
  let seed: number | null = null;
  let arenaPath: string = DEFAULT_ARENA_PATH;
  let outPath: string | null = null;
  let includePoseFrames = true;
  let pretty = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--seed': {
        const v = argv[++i];
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          throw new Error(`--seed must be an integer, got ${JSON.stringify(v)}`);
        }
        seed = n;
        break;
      }
      case '--arena':
        arenaPath = resolve(REPO_ROOT, argv[++i]);
        break;
      case '--out':
        outPath = resolve(REPO_ROOT, argv[++i]);
        break;
      case '--no-poses':
        includePoseFrames = false;
        break;
      case '--pretty':
        pretty = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  if (seed === null) {
    throw new Error('--seed is required');
  }

  return { seed, arenaPath, outPath, includePoseFrames, pretty };
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCli(process.argv.slice(2));
  } catch (err) {
    printHelp();
    throw err;
  }

  const rosterJson: unknown = JSON.parse(
    readFileSync(DEFAULT_TRAITS_PATH, 'utf-8'),
  );
  const arenaJson: unknown = JSON.parse(readFileSync(args.arenaPath, 'utf-8'));

  const startMs = performance.now();
  const output = await buildEventOutput({
    seed: args.seed,
    rosterJson,
    arenaJson,
    includePoseFrames: args.includePoseFrames,
  });
  const elapsedMs = performance.now() - startMs;

  const json = args.pretty
    ? JSON.stringify(output, null, 2)
    : JSON.stringify(output);

  if (args.outPath !== null) {
    mkdirSync(dirname(args.outPath), { recursive: true });
    writeFileSync(args.outPath, json);
  } else {
    process.stdout.write(json);
    process.stdout.write('\n');
  }

  process.stderr.write(
    `[run-event] seed=${args.seed} arena=${output.meta.arenaId} ` +
      `ticks=${output.meta.ticks} winnerId=${String(output.winnerId)} ` +
      `elapsedMs=${elapsedMs.toFixed(1)} bytes=${json.length}` +
      (args.outPath !== null ? ` out=${args.outPath}` : '') +
      '\n',
  );
}

// Run only when executed directly via `tsx tools/sim/run-event.ts`.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[run-event] error: ${msg}\n`);
    process.exit(1);
  });
}
