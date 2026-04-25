import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildEventOutput,
  parseCli,
  DEFAULT_TRAITS_PATH,
  DEFAULT_ARENA_PATH,
  REPO_ROOT,
  type EventOutput,
} from './run-event';

function readFixtures(): { rosterJson: unknown; arenaJson: unknown } {
  return {
    rosterJson: JSON.parse(readFileSync(DEFAULT_TRAITS_PATH, 'utf-8')),
    arenaJson: JSON.parse(readFileSync(DEFAULT_ARENA_PATH, 'utf-8')),
  };
}

describe('buildEventOutput — happy path on real fixtures', () => {
  it('produces a winner and a complete elimination accounting', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const out = await buildEventOutput({
      seed: 42,
      rosterJson,
      arenaJson,
      includePoseFrames: false,
    });
    expect(out.meta.arenaId).toBe('arena-01');
    expect(out.meta.rosterSize).toBe(85);
    expect(out.winnerId).not.toBeNull();
    expect(out.finishOrder).toHaveLength(1);
    const elims = out.events.filter((e) => e.type === 'elimination');
    const finishes = out.events.filter((e) => e.type === 'finish');
    expect(elims.length + finishes.length).toBe(85);
  });

  it('omits pose frames when includePoseFrames is false', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const out = await buildEventOutput({
      seed: 1,
      rosterJson,
      arenaJson,
      includePoseFrames: false,
    });
    expect(out.poseFrames).toBeNull();
    expect(out.meta.poseFramesIncluded).toBe(false);
  });

  it('serializes pose frames as plain number arrays when enabled', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const out = await buildEventOutput({
      seed: 1,
      rosterJson,
      arenaJson,
      includePoseFrames: true,
    });
    expect(out.poseFrames).not.toBeNull();
    if (out.poseFrames === null) return;
    expect(out.poseFrames.length).toBeGreaterThan(0);
    expect(Array.isArray(out.poseFrames[0].data)).toBe(true);
    // 85 robots × 5 floats per robot.
    expect(out.poseFrames[0].data.length).toBe(85 * 5);
  });
});

describe('buildEventOutput — determinism (sprint AC)', () => {
  it('two runs with the same seed produce byte-identical JSON', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const a = await buildEventOutput({
      seed: 42,
      rosterJson,
      arenaJson,
      includePoseFrames: true,
    });
    const b = await buildEventOutput({
      seed: 42,
      rosterJson,
      arenaJson,
      includePoseFrames: true,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different outputs', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const a = await buildEventOutput({
      seed: 42,
      rosterJson,
      arenaJson,
      includePoseFrames: false,
    });
    const b = await buildEventOutput({
      seed: 43,
      rosterJson,
      arenaJson,
      includePoseFrames: false,
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('buildEventOutput — output shape', () => {
  it('meta contains only deterministic fields', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const out = await buildEventOutput({
      seed: 7,
      rosterJson,
      arenaJson,
      includePoseFrames: false,
    });
    const metaKeys = Object.keys(out.meta).sort();
    expect(metaKeys).toEqual(
      ['arenaId', 'poseFramesIncluded', 'rosterSize', 'seed', 'ticks'].sort(),
    );
  });

  it('top-level keys match the contract', async () => {
    const { rosterJson, arenaJson } = readFixtures();
    const out: EventOutput = await buildEventOutput({
      seed: 7,
      rosterJson,
      arenaJson,
      includePoseFrames: true,
    });
    const keys = Object.keys(out).sort();
    expect(keys).toEqual(
      ['events', 'finishOrder', 'meta', 'poseFrames', 'winnerId'].sort(),
    );
  });
});

describe('parseCli', () => {
  it('parses --seed and applies defaults', () => {
    const args = parseCli(['--seed', '42']);
    expect(args.seed).toBe(42);
    expect(args.arenaPath).toBe(DEFAULT_ARENA_PATH);
    expect(args.outPath).toBeNull();
    expect(args.includePoseFrames).toBe(true);
    expect(args.pretty).toBe(false);
  });

  it('parses all flags together', () => {
    const args = parseCli([
      '--seed',
      '7',
      '--arena',
      'assets/data/arenas/arena-01.json',
      '--out',
      'production/session-state/out.json',
      '--no-poses',
      '--pretty',
    ]);
    expect(args.seed).toBe(7);
    expect(args.arenaPath).toMatch(/arena-01\.json$/);
    expect(args.outPath).toMatch(/out\.json$/);
    expect(args.includePoseFrames).toBe(false);
    expect(args.pretty).toBe(true);
  });

  it('throws on missing --seed', () => {
    expect(() => parseCli([])).toThrow(/--seed is required/);
  });

  it('throws on non-integer --seed', () => {
    expect(() => parseCli(['--seed', 'abc'])).toThrow(/--seed must be an integer/);
    expect(() => parseCli(['--seed', '3.5'])).toThrow(/--seed must be an integer/);
  });

  it('throws on unknown args', () => {
    expect(() => parseCli(['--seed', '1', '--bogus'])).toThrow(/unknown arg/);
  });
});

describe('CLI integration — npx tsx tools/sim/run-event.ts (sprint AC)', () => {
  it('runs end-to-end with --seed 42 --no-poses, exits 0, emits parseable JSON', () => {
    const stdout = execFileSync(
      'npx',
      ['tsx', 'tools/sim/run-event.ts', '--seed', '42', '--no-poses'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const parsed: EventOutput = JSON.parse(stdout);
    expect(parsed.meta.seed).toBe(42);
    expect(parsed.meta.arenaId).toBe('arena-01');
    expect(parsed.winnerId).not.toBeNull();
    expect(parsed.poseFrames).toBeNull();
  }, 10_000);

  it('two CLI invocations with the same seed produce byte-identical stdout', () => {
    const a = execFileSync(
      'npx',
      ['tsx', 'tools/sim/run-event.ts', '--seed', '42', '--no-poses'],
      { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const b = execFileSync(
      'npx',
      ['tsx', 'tools/sim/run-event.ts', '--seed', '42', '--no-poses'],
      { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(a).toBe(b);
  }, 15_000);
});
