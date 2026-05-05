/**
 * Throwaway sweep — runs the gauntlet against the real roster across N seeds
 * and reports winner distribution. Not committed; produced for the speed
 * balance change documented in /Users/nathanialryan/.claude/plans/.
 *
 * Run with: npx tsx tests/playtest/gauntlet-winner-sweep.ts [seedCount]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoster } from '../../src/sim/robot-roster';
import { runSim } from '../../src/sim/engine';
import { createObstacleGauntletModule } from '../../src/sim/obstacle-gauntlet';
import type { Arena } from '../../src/sim/arena';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relPath), 'utf8'));
}

function arena03(): Arena {
  const p = readJson('assets/data/arenas/arena-03.json') as {
    id: string;
    type: 'obstacle-gauntlet';
    length: number;
    width: number;
    maxTicks: number;
    startGrid: { lanes: number; rows: number; laneSpacing: number; rowSpacing: number };
    gauntletConfig: {
      pitZones: Array<{ xStart: number; xEnd: number }>;
      hammers: Array<{ x: number; killRadius: number; cycleTicks: number; downStartTick: number; downEndTick: number }>;
      bridge: { xStart: number; xEnd: number };
    };
  };
  return Object.freeze({
    id: p.id,
    type: 'obstacle-gauntlet' as const,
    length: p.length,
    width: p.width,
    maxTicks: p.maxTicks,
    startGrid: Object.freeze({ ...p.startGrid }),
    gates: Object.freeze([]),
    gauntletConfig: Object.freeze({
      pitZones: Object.freeze(p.gauntletConfig.pitZones.map((z) => Object.freeze({ ...z }))),
      hammers: Object.freeze(p.gauntletConfig.hammers.map((h) => Object.freeze({ ...h }))),
      bridge: Object.freeze({ ...p.gauntletConfig.bridge }),
    }),
  });
}

async function main(): Promise<void> {
  const seedCount = Number(process.argv[2] ?? '50');
  const roster = await loadRoster({
    traitsSource: async () => readJson('public/traits.json'),
  });
  const arena = arena03();

  const winners = new Map<number, number>();
  const survivedAtFinish: number[] = [];
  const determinismFingerprints: string[] = [];
  const elimByReason = new Map<string, number>();
  let totalRobots = 0;

  for (let seed = 1; seed <= seedCount; seed++) {
    const result = runSim({
      seed,
      roster,
      arena,
      eventModule: createObstacleGauntletModule(),
      maxTicks: arena.maxTicks,
      recordPoseFrames: false,
    });
    if (result.winnerId !== null && result.winnerId !== undefined) {
      winners.set(result.winnerId, (winners.get(result.winnerId) ?? 0) + 1);
    }
    // Count robots eliminated for any reason OTHER than `race_over`
    // (race_over fires the tick the winner crosses; everyone alive at that
    // moment got swept). Pre-finish survivors = roster - (non-race_over elims).
    let nonRaceOverElims = 0;
    for (const e of result.events) {
      if (e.type === 'elimination' && e.reason !== 'race_over') {
        nonRaceOverElims++;
        elimByReason.set(e.reason, (elimByReason.get(e.reason) ?? 0) + 1);
      }
    }
    survivedAtFinish.push(roster.length - nonRaceOverElims);
    determinismFingerprints.push(`${result.winnerId}:${result.ticks}:${result.events.length}`);
    totalRobots = roster.length;
  }

  // Determinism: re-run seed 1 and confirm fingerprint matches.
  const replay = runSim({
    seed: 1,
    roster,
    arena,
    eventModule: createObstacleGauntletModule(),
    maxTicks: arena.maxTicks,
    recordPoseFrames: false,
  });
  const replayFp = `${replay.winnerId}:${replay.ticks}:${replay.events.length}`;
  const determOk = replayFp === determinismFingerprints[0];

  const sortedWinners = [...winners.entries()].sort((a, b) => b[1] - a[1]);
  const distinct = sortedWinners.length;
  const top = sortedWinners[0];
  const topPct = top ? Math.round((top[1] / seedCount) * 100) : 0;
  const meanSurvived = survivedAtFinish.reduce((a, b) => a + b, 0) / survivedAtFinish.length;
  const survivePct = Math.round((meanSurvived / totalRobots) * 100);

  console.log(`\nGauntlet sweep — ${seedCount} seeds, ${totalRobots}-robot roster\n`);
  console.log(`Distinct winners: ${distinct}`);
  console.log(`Top winner: id=${top?.[0]} name=${roster[top?.[0] ?? 0]?.name} won ${top?.[1]}/${seedCount} (${topPct}%)`);
  console.log(`Mean robots alive at finish (pre-race_over sweep): ${meanSurvived.toFixed(1)}/${totalRobots} (${survivePct}%)`);
  console.log(`Determinism check (seed 1 repeated): ${determOk ? 'PASS' : 'FAIL'} — ${replayFp} vs ${determinismFingerprints[0]}`);
  console.log(`Elimination breakdown across ${seedCount} races:`);
  for (const [reason, n] of [...elimByReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(16)} ${n}`);
  }
  console.log(`\nWinner table (id : wins : name):`);
  for (const [id, count] of sortedWinners) {
    console.log(`  ${String(id).padStart(2)} : ${String(count).padStart(2)} : ${roster[id]?.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
