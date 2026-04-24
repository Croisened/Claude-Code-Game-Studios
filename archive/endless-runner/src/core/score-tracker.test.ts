// @vitest-environment jsdom
/**
 * Score & Distance Tracker — unit tests
 * GDD acceptance criteria: design/gdd/score-and-distance-tracker.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameStateManager, GameState } from './game-state-manager';
import { ScoreTracker } from './score-tracker';
import { SCORE_TRACKER_CONFIG } from '../config/score-tracker.config';

// ── Setup ─────────────────────────────────────────────────────────────────────

let gsm:     GameStateManager;
let tracker: ScoreTracker;

beforeEach(() => {
  localStorage.clear();
  gsm     = new GameStateManager();
  tracker = new ScoreTracker(gsm, SCORE_TRACKER_CONFIG);
});

afterEach(() => {
  tracker.destroy();
  localStorage.clear();
});

function startRun(): void {
  gsm.transition(GameState.MainMenu);
  gsm.transition(GameState.Running);
}

function killRun(): void {
  gsm.transition(GameState.Dead);
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('distance starts at 0', () => {
    expect(tracker.distance).toBe(0);
  });

  it('finalScore starts at 0', () => {
    expect(tracker.finalScore).toBe(0);
  });

  it('personalBest starts at 0 with empty localStorage', () => {
    expect(tracker.personalBest).toBe(0);
  });

  it('isNewPersonalBest is false initially', () => {
    expect(tracker.isNewPersonalBest).toBe(false);
  });
});

// ── Distance accumulation ─────────────────────────────────────────────────────

describe('distance accumulation', () => {
  beforeEach(() => startRun());

  it('distance increments with forwardSpeed × deltaTime (within clamp)', () => {
    tracker.update(10, 16); // 10 units/s × 0.016s = 0.16m (under 50ms clamp)
    expect(tracker.distance).toBeCloseTo(10 * 0.016);
  });

  it('multiple unclamped updates accumulate correctly', () => {
    tracker.update(8, 16);
    tracker.update(8, 16);
    expect(tracker.distance).toBeCloseTo(8 * 0.016 * 2);
  });

  it('update is no-op before Running state', () => {
    const gsm2     = new GameStateManager();
    const tracker2 = new ScoreTracker(gsm2);
    tracker2.update(10, 1000);
    expect(tracker2.distance).toBe(0);
    tracker2.destroy();
  });

  it('update is no-op after Dead state', () => {
    tracker.update(10, 500);
    killRun();
    const distanceAtDeath = tracker.distance;
    tracker.update(10, 1000);
    expect(tracker.distance).toBe(distanceAtDeath);
  });

  it('zero forwardSpeed does not increment distance', () => {
    tracker.update(0, 1000);
    expect(tracker.distance).toBe(0);
  });
});

// ── Delta clamp ───────────────────────────────────────────────────────────────

describe('delta clamp', () => {
  beforeEach(() => startRun());

  it('deltaTime is capped at 0.05s — 2s spike does not cause phantom distance', () => {
    tracker.update(10, 2000); // 2s tab-return spike
    // Should be clamped to 10 × 0.05 = 0.5, not 10 × 2.0 = 20
    expect(tracker.distance).toBeCloseTo(0.5);
  });

  it('normal 16ms frame is not clamped', () => {
    tracker.update(10, 16);
    expect(tracker.distance).toBeCloseTo(10 * 0.016);
  });
});

// ── finalScore ────────────────────────────────────────────────────────────────

describe('finalScore', () => {
  it('is set when Dead state is entered', () => {
    startRun();
    // 200 × 16ms ticks at 10 units/s = 200 × 0.016 × 10 = 32m
    for (let i = 0; i < 200; i++) tracker.update(10, 16);
    killRun();
    expect(tracker.finalScore).toBeGreaterThan(0);
  });

  it('is floored to integer meters', () => {
    startRun();
    tracker.update(1, 16); // 0.016m — floor → 0
    killRun();
    expect(tracker.finalScore).toBe(0);
  });

  it('does not change after death even if update is called', () => {
    startRun();
    tracker.update(10, 1000);
    killRun();
    const locked = tracker.finalScore;
    tracker.update(99, 1000); // no-op
    expect(tracker.finalScore).toBe(locked);
  });

  it('resets to 0 on the next run start', () => {
    startRun();
    tracker.update(10, 1000);
    killRun();
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    expect(tracker.finalScore).toBe(0);
  });
});

// ── Distance reset ────────────────────────────────────────────────────────────

describe('distance reset', () => {
  it('resets to 0 at start of each new run', () => {
    startRun();
    tracker.update(10, 1000);
    killRun();
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    expect(tracker.distance).toBe(0);
  });
});

// ── Personal best (guest) ─────────────────────────────────────────────────────

describe('personal best — guest', () => {
  it('is updated when finalScore exceeds previous best', () => {
    startRun();
    // 200 × 16ms at 10 units/s = 32m
    for (let i = 0; i < 200; i++) tracker.update(10, 16);
    killRun();
    expect(tracker.personalBest).toBeGreaterThan(0);
    expect(tracker.isNewPersonalBest).toBe(true);
  });

  it('is persisted to localStorage with guest key', () => {
    startRun();
    for (let i = 0; i < 200; i++) tracker.update(10, 16); // 32m
    killRun();
    const stored = localStorage.getItem('neon_fugitive_pb_guest');
    expect(stored).not.toBeNull();
    expect(parseInt(stored!, 10)).toBeGreaterThan(0);
  });

  it('is NOT updated when finalScore equals personalBest', () => {
    // Seed localStorage with a high value
    localStorage.setItem('neon_fugitive_pb_guest', '1000');
    const tracker2 = new ScoreTracker(gsm, SCORE_TRACKER_CONFIG);
    const gsm2 = new GameStateManager();
    const t2   = new ScoreTracker(gsm2, SCORE_TRACKER_CONFIG);
    gsm2.transition(GameState.MainMenu);
    gsm2.transition(GameState.Running);
    t2.update(10, 16); // tiny distance — certainly < 1000
    gsm2.transition(GameState.Dead);
    expect(t2.isNewPersonalBest).toBe(false);
    expect(localStorage.getItem('neon_fugitive_pb_guest')).toBe('1000'); // unchanged
    t2.destroy();
    tracker2.destroy();
  });

  it('is NOT updated when finalScore is 0', () => {
    localStorage.setItem('neon_fugitive_pb_guest', '500');
    const gsm2 = new GameStateManager();
    const t2   = new ScoreTracker(gsm2, SCORE_TRACKER_CONFIG);
    gsm2.transition(GameState.MainMenu);
    gsm2.transition(GameState.Running);
    // Kill immediately with 0 distance
    gsm2.transition(GameState.Dead);
    expect(t2.isNewPersonalBest).toBe(false);
    expect(localStorage.getItem('neon_fugitive_pb_guest')).toBe('500');
    t2.destroy();
  });

  it('is loaded from localStorage on next run start', () => {
    localStorage.setItem('neon_fugitive_pb_guest', '42');
    const gsm2 = new GameStateManager();
    const t2   = new ScoreTracker(gsm2, SCORE_TRACKER_CONFIG);
    gsm2.transition(GameState.MainMenu);
    gsm2.transition(GameState.Running);
    expect(t2.personalBest).toBe(42);
    t2.destroy();
  });
});

// ── Personal best — token ID ──────────────────────────────────────────────────

describe('personal best — token ID', () => {
  it('uses tokenId key when wallet is connected', () => {
    tracker.setTokenId('token123');
    startRun();
    for (let i = 0; i < 200; i++) tracker.update(10, 16); // 32m
    killRun();
    const stored = localStorage.getItem('neon_fugitive_pb_token123');
    expect(stored).not.toBeNull();
    expect(parseInt(stored!, 10)).toBeGreaterThan(0);
  });

  it('reverts to guest key when tokenId is set to null', () => {
    tracker.setTokenId('token123');
    tracker.setTokenId(null);
    startRun();
    for (let i = 0; i < 200; i++) tracker.update(10, 16); // 32m
    killRun();
    expect(localStorage.getItem('neon_fugitive_pb_guest')).not.toBeNull();
    expect(localStorage.getItem('neon_fugitive_pb_token123')).toBeNull();
  });
});

// ── localStorage failure ──────────────────────────────────────────────────────

describe('localStorage failure', () => {
  it('silently handles localStorage write failure', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    startRun();
    for (let i = 0; i < 200; i++) tracker.update(10, 16); // 32m
    expect(() => killRun()).not.toThrow();
    localStorage.setItem = original;
  });

  it('silently handles localStorage read failure and returns 0', () => {
    const original = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => { throw new Error('SecurityError'); };
    expect(() => startRun()).not.toThrow();
    expect(tracker.personalBest).toBe(0);
    localStorage.getItem = original;
  });
});
