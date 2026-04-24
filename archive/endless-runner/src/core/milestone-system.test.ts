// @vitest-environment jsdom
/**
 * Milestone System — unit tests
 * GDD acceptance criteria: design/gdd/distance-milestone-badges.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { GameStateManager, GameState } from './game-state-manager';
import { ScoreTracker } from './score-tracker';
import { MilestoneSystem } from './milestone-system';
import { MILESTONE_SYSTEM_CONFIG } from '../config/milestone-system.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

let gsm:   GameStateManager;
let scene: THREE.Scene;
let tracker: ScoreTracker;
let ms:    MilestoneSystem;

const CONFIG = MILESTONE_SYSTEM_CONFIG;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  gsm     = new GameStateManager();
  scene   = new THREE.Scene();
  tracker = new ScoreTracker(gsm);
  ms      = new MilestoneSystem(scene, tracker, gsm, CONFIG);
});

afterEach(() => {
  ms.destroy();
  tracker.destroy();
  vi.useRealTimers();
  localStorage.clear();
});

function startRun(): void {
  gsm.transition(GameState.MainMenu);
  gsm.transition(GameState.Running);
}

function setDistance(meters: number): void {
  vi.spyOn(tracker, 'distance', 'get').mockReturnValue(meters);
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('highestIndex starts at -1 with empty localStorage', () => {
    expect(ms.highestIndex).toBe(-1);
  });

  it('highestName is null when no milestone reached', () => {
    expect(ms.highestName).toBeNull();
  });

  it('nextName is the first milestone name when none reached', () => {
    expect(ms.nextName).toBe('Outer Grid');
  });

  it('nextThreshold is 500 when none reached', () => {
    expect(ms.nextThreshold).toBe(500);
  });
});

// ── Milestone unlock ──────────────────────────────────────────────────────────

describe('milestone unlock', () => {
  beforeEach(() => startRun());

  it('crossing 500m sets highestIndex to 0', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestIndex).toBe(0);
  });

  it('highestName is "Outer Grid" after crossing 500m', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestName).toBe('Outer Grid');
  });

  it('crossing 1000m sets highestIndex to 1', () => {
    setDistance(1000);
    ms.update(16);
    expect(ms.highestIndex).toBe(1);
  });

  it('crossing 2500m sets highestIndex to 2', () => {
    setDistance(2500);
    ms.update(16);
    expect(ms.highestIndex).toBe(2);
  });

  it('crossing 5000m sets highestIndex to 3 ("The Core")', () => {
    setDistance(5000);
    ms.update(16);
    expect(ms.highestIndex).toBe(3);
    expect(ms.highestName).toBe('The Core');
  });

  it('only one milestone unlocks per frame on a lag spike', () => {
    // Spike from 0 to 1100m — crosses 500m and 1000m thresholds
    setDistance(1100);
    ms.update(16);
    // Should settle on the highest applicable (index 1 = 1000m)
    expect(ms.highestIndex).toBe(1);
  });

  it('already-crossed threshold does NOT re-unlock', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestIndex).toBe(0);
    // Simulate same distance next frame
    ms.update(16);
    expect(ms.highestIndex).toBe(0); // unchanged
  });

  it('highestIndex does not change after → Dead', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestIndex).toBe(0);
    gsm.transition(GameState.Dead);
    setDistance(1000); // distance doesn't matter — system is locked
    ms.update(16);
    expect(ms.highestIndex).toBe(0);
  });

  it('boundary: exactly at threshold (>=) qualifies', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestIndex).toBe(0);
  });

  it('nextName is null when at max tier (The Core)', () => {
    setDistance(5000);
    ms.update(16);
    expect(ms.nextName).toBeNull();
  });

  it('nextThreshold is null when at max tier', () => {
    setDistance(5000);
    ms.update(16);
    expect(ms.nextThreshold).toBeNull();
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  beforeEach(() => startRun());

  it('writes highestIndex to localStorage on new unlock', () => {
    setDistance(500);
    ms.update(16);
    const stored = localStorage.getItem(CONFIG.guestStorageKey);
    expect(stored).toBe('0');
  });

  it('loads highestIndex from localStorage on construction', () => {
    localStorage.setItem(CONFIG.guestStorageKey, '2');
    const ms2 = new MilestoneSystem(scene, tracker, gsm, CONFIG);
    expect(ms2.highestIndex).toBe(2);
    ms2.destroy();
  });

  it('highestIndex persists across run restarts (reloads from localStorage)', () => {
    setDistance(500);
    ms.update(16);
    expect(ms.highestIndex).toBe(0);

    // Restart
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    setDistance(0);
    ms.update(16);
    expect(ms.highestIndex).toBe(0); // still 0, not reset
  });

  it('guest player uses guestStorageKey', () => {
    setDistance(500);
    ms.update(16);
    expect(localStorage.getItem(CONFIG.guestStorageKey)).toBe('0');
  });

  it('named player uses prefixed storage key', () => {
    ms.setPlayerId('42');
    setDistance(500);
    ms.update(16);
    const key = `${CONFIG.storageKeyPrefix}42`;
    expect(localStorage.getItem(key)).toBe('0');
    expect(localStorage.getItem(CONFIG.guestStorageKey)).toBeNull();
  });

  it('silently handles localStorage write failure', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => {
      setDistance(500);
      ms.update(16);
    }).not.toThrow();
    localStorage.setItem = original;
  });
});

// ── Lightning VFX timing ──────────────────────────────────────────────────────

describe('lightning trigger', () => {
  beforeEach(() => startRun());

  it('does not fire at 0m on run start', () => {
    const bolts = (ms as unknown as { _bolts: Array<{ delay: number; elapsed: number }> })._bolts;
    setDistance(0);
    ms.update(16);
    expect(bolts.every(b => b.delay === -1 && b.elapsed === -1)).toBe(true);
  });

  it('fires at 1000m crossing', () => {
    const bolts = (ms as unknown as { _bolts: Array<{ delay: number; elapsed: number }> })._bolts;
    setDistance(999);
    ms.update(16); // previousDistance = 999
    setDistance(1001);
    ms.update(16); // crosses 1000m threshold
    // bolt[0] fires immediately (delay=0 → -1, elapsed starts)
    // bolt[1] still pending
    expect(bolts[0].elapsed).toBeGreaterThanOrEqual(0);
  });

  it('does not fire again at same 1000m threshold', () => {
    const bolts = (ms as unknown as { _bolts: Array<{ delay: number; elapsed: number }> })._bolts;
    setDistance(999);
    ms.update(16);
    setDistance(1001);
    ms.update(16); // fires
    // Now simulate a few more frames at same distance — no re-trigger
    const elapsedAfterFire = bolts[0].elapsed;
    ms.update(16);
    // elapsed should have increased (bolt fading), not reset
    expect(bolts[0].elapsed).toBeGreaterThan(elapsedAfterFire);
  });

  it('fires at 2000m crossing independently', () => {
    const bolts = (ms as unknown as { _bolts: Array<{ delay: number; elapsed: number }> })._bolts;
    setDistance(1999);
    ms.update(16);
    setDistance(2001);
    ms.update(16);
    expect(bolts[0].elapsed).toBeGreaterThanOrEqual(0);
  });

  it('bolts are hidden after Dead transition', () => {
    setDistance(1001);
    ms.update(16); // trigger lightning
    gsm.transition(GameState.Dead);
    const bolts = (ms as unknown as { _bolts: Array<{ mesh: { visible: boolean } }> })._bolts;
    expect(bolts.every(b => !b.mesh.visible)).toBe(true);
  });
});

// ── Scene integration ─────────────────────────────────────────────────────────

describe('scene integration', () => {
  it('adds 3 bolt meshes to the scene on construction', () => {
    // Count MeshBasicMaterial objects added by MilestoneSystem
    const meshCount = scene.children.filter(c => c instanceof THREE.Mesh).length;
    expect(meshCount).toBe(CONFIG.lightningBoltCount);
  });

  it('removes bolt meshes from scene on destroy', () => {
    ms.destroy();
    const meshCount = scene.children.filter(c => c instanceof THREE.Mesh).length;
    expect(meshCount).toBe(0);
  });
});
