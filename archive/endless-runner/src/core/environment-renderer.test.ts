// @vitest-environment jsdom
/**
 * Environment Renderer — unit tests
 * GDD acceptance criteria: design/gdd/environment-renderer.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EnvironmentRenderer, LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';
import { GameStateManager, GameState } from './game-state-manager';
import { ENVIRONMENT_RENDERER_CONFIG } from '../config/environment-renderer.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEr(overrides: Partial<typeof ENVIRONMENT_RENDERER_CONFIG> = {}): {
  er: EnvironmentRenderer;
  gsm: GameStateManager;
  scene: THREE.Scene;
} {
  const scene = new THREE.Scene();
  const gsm   = new GameStateManager();
  const er    = new EnvironmentRenderer(scene, gsm, { ...ENVIRONMENT_RENDERER_CONFIG, ...overrides });
  return { er, gsm, scene };
}

/** Advance GSM to Running state. */
function startRun(gsm: GameStateManager): void {
  gsm.transition(GameState.MainMenu);
  gsm.transition(GameState.Running);
}

// Chunk Z positions from the GDD formula: -(i + 0.5) * chunkLength
function initialZ(i: number, chunkLength = ENVIRONMENT_RENDERER_CONFIG.chunkLength): number {
  return -(i + 0.5) * chunkLength;
}

let er:    EnvironmentRenderer;
let gsm:   GameStateManager;
let scene: THREE.Scene;

beforeEach(() => {
  ({ er, gsm, scene } = makeEr());
});
afterEach(() => {
  er.destroy();
});

// ── Lane constants ────────────────────────────────────────────────────────────

describe('lane constants', () => {
  it('LANE_LEFT is negative laneSpacing', () => {
    expect(LANE_LEFT).toBe(-ENVIRONMENT_RENDERER_CONFIG.laneSpacing);
  });

  it('LANE_CENTER is 0', () => {
    expect(LANE_CENTER).toBe(0);
  });

  it('LANE_RIGHT is positive laneSpacing', () => {
    expect(LANE_RIGHT).toBe(ENVIRONMENT_RENDERER_CONFIG.laneSpacing);
  });
});

// ── Chunk pool setup ──────────────────────────────────────────────────────────

describe('chunk pool setup', () => {
  it('adds chunkCount groups to the scene', () => {
    expect(scene.children.length).toBe(ENVIRONMENT_RENDERER_CONFIG.chunkCount);
  });

  it('positions chunks sequentially using the GDD formula', () => {
    const chunks = scene.children as THREE.Group[];
    for (let i = 0; i < ENVIRONMENT_RENDERER_CONFIG.chunkCount; i++) {
      expect(chunks[i].position.z).toBeCloseTo(initialZ(i));
    }
  });

  it('logs an error if pool coverage is below minimum', () => {
    er.destroy();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { er: smallEr } = makeEr({ chunkCount: 2, chunkLength: 10 }); // 20 units — below 60
    expect(error).toHaveBeenCalled();
    smallEr.destroy();
    error.mockRestore();
  });
});

// ── setScrollSpeed ────────────────────────────────────────────────────────────

describe('setScrollSpeed', () => {
  it('negative value is clamped to 0 and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startRun(gsm);
    er.setScrollSpeed(-5);
    // Update — chunks should not move backward
    const zBefore = (scene.children[0] as THREE.Group).position.z;
    er.update(16);
    const zAfter = (scene.children[0] as THREE.Group).position.z;
    expect(zAfter).toBeGreaterThanOrEqual(zBefore); // no backward movement
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('setScrollSpeed(0) stops all chunk movement', () => {
    startRun(gsm);
    er.setScrollSpeed(0);
    const zBefore = (scene.children[0] as THREE.Group).position.z;
    er.update(100);
    const zAfter = (scene.children[0] as THREE.Group).position.z;
    expect(zAfter).toBe(zBefore);
  });
});

// ── Scrolling behaviour ───────────────────────────────────────────────────────

describe('scrolling', () => {
  it('chunks do not move before Running state', () => {
    const zBefore = (scene.children[0] as THREE.Group).position.z;
    er.update(100);
    expect((scene.children[0] as THREE.Group).position.z).toBe(zBefore);
  });

  it('chunks move forward (+Z) during Running state', () => {
    startRun(gsm);
    er.setScrollSpeed(8);
    const zBefore = (scene.children[0] as THREE.Group).position.z;
    er.update(1000); // 1 second
    const zAfter = (scene.children[0] as THREE.Group).position.z;
    // Either moved forward or was recycled — it won't be at zBefore
    // z increases by scrollSpeed*delta = 8*1 = 8 per second (before any recycle)
    expect(zAfter).not.toBeCloseTo(zBefore);
  });

  it('chunks stop moving on → Dead', () => {
    startRun(gsm);
    er.setScrollSpeed(8);
    er.update(16);
    gsm.transition(GameState.Dead);
    const zBeforeDead = (scene.children[0] as THREE.Group).position.z;
    er.update(100); // further updates — should not move
    expect((scene.children[0] as THREE.Group).position.z).toBeCloseTo(zBeforeDead);
  });

  it('chunks stop moving on → ScoreScreen', () => {
    startRun(gsm);
    er.setScrollSpeed(8);
    er.update(16);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    const zFrozen = (scene.children[0] as THREE.Group).position.z;
    er.update(100);
    expect((scene.children[0] as THREE.Group).position.z).toBeCloseTo(zFrozen);
  });
});

// ── Delta clamp ───────────────────────────────────────────────────────────────

describe('delta clamp', () => {
  it('a 1-second spike is clamped to deltaClamp (0.1s)', () => {
    startRun(gsm);
    er.setScrollSpeed(8);
    const zBefore = (scene.children[0] as THREE.Group).position.z;
    er.update(1000); // 1000ms spike
    const zAfter = (scene.children[0] as THREE.Group).position.z;
    // Max movement = speed * clamp = 8 * 0.1 = 0.8 units (plus possible recycles)
    // Actual movement without clamp = 8 * 1.0 = 8.0 units
    // Verify the chunk didn't jump the full 8 units
    const rawMove  = zAfter - zBefore;
    const recycleAdjusted = rawMove +
      (rawMove < -50 ? ENVIRONMENT_RENDERER_CONFIG.chunkCount * ENVIRONMENT_RENDERER_CONFIG.chunkLength : 0);
    expect(Math.abs(recycleAdjusted)).toBeLessThan(1.0); // clamped: max 0.8 units
  });
});

// ── Chunk recycling ───────────────────────────────────────────────────────────

describe('chunk recycling', () => {
  it('a chunk that passes the recycle threshold is repositioned ahead', () => {
    // Use a small, fast config so we can trigger recycle easily.
    er.destroy();
    const { er: fastEr, gsm: fastGsm, scene: fastScene } = makeEr({
      chunkLength: 20,
      chunkCount: 4,
      recycleBuffer: 5,
      initialScrollSpeed: 8,
      deltaClamp: 10, // large clamp so we can drive chunks far in one update
    });
    fastGsm.transition(GameState.MainMenu);
    fastGsm.transition(GameState.Running);
    fastEr.setScrollSpeed(8);

    // First chunk starts at Z = -10 (center). Back face at Z = 0.
    // Needs to travel > recycleBuffer (5 units) past back face to recycle.
    // Drive it: 6 units forward → backFace goes to +6 > recycleBuffer(5) → recycles.
    fastEr.update(6000 / 8 * 1000); // time to travel 6 units at 8 u/s = 750ms

    const positions = (fastScene.children as THREE.Group[]).map(c => c.position.z);
    const totalSpan = ENVIRONMENT_RENDERER_CONFIG.chunkCount * ENVIRONMENT_RENDERER_CONFIG.chunkLength; // 80
    // At least one chunk should now be ahead (far negative Z relative to initial)
    expect(positions.some(z => z < -50)).toBe(true);

    fastEr.destroy();
  });
});

// ── Restart reset ─────────────────────────────────────────────────────────────

describe('restart reset', () => {
  it('chunks return to initial Z positions on ScoreScreen → Running', () => {
    startRun(gsm);
    er.setScrollSpeed(8);
    er.update(500); // scroll for a bit
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running); // restart

    const chunks = scene.children as THREE.Group[];
    for (let i = 0; i < ENVIRONMENT_RENDERER_CONFIG.chunkCount; i++) {
      expect(chunks[i].position.z).toBeCloseTo(initialZ(i));
    }
  });

  it('scrollSpeed resets to initialScrollSpeed on restart', () => {
    startRun(gsm);
    er.setScrollSpeed(20); // artificially fast
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running); // restart

    // Verify scrolling resumes at initialScrollSpeed by checking chunk movement
    // Use chunk[3] (initialZ=-70): won't recycle for ~8s at speed=8, safe for 1s test.
    const deepChunk = scene.children[3] as THREE.Group;
    const zBefore = deepChunk.position.z;
    // 10 × 100ms ticks = 1 simulated second (each tick respects deltaClamp=0.1s)
    for (let t = 0; t < 10; t++) er.update(100);
    const zAfter = deepChunk.position.z;
    const moved = zAfter - zBefore;
    // Should have moved ~initialScrollSpeed (8) units in 1 second, not 20
    expect(Math.abs(moved)).toBeCloseTo(ENVIRONMENT_RENDERER_CONFIG.initialScrollSpeed, 0);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('removes all chunks from the scene', () => {
    er.destroy();
    expect(scene.children.length).toBe(0);
  });
});
