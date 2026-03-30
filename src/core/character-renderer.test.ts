// @vitest-environment jsdom
/**
 * Character Renderer — unit tests
 * GDD acceptance criteria: design/gdd/character-renderer.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CharacterRenderer } from './character-renderer';
import { GameStateManager, GameState } from './game-state-manager';
import { CHARACTER_RENDERER_CONFIG } from '../config/character-renderer.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function makeGsm(): GameStateManager {
  return new GameStateManager();
}

/** Advance GSM through Loading → MainMenu → Running → Dead for convenience. */
function reachDead(gsm: GameStateManager): void {
  gsm.transition(GameState.MainMenu);
  gsm.transition(GameState.Running);
  gsm.transition(GameState.Dead);
}

// Each test gets fresh instances; fake timers reset between tests.
let scene: THREE.Scene;
let gsm:   GameStateManager;
let cr:    CharacterRenderer;

beforeEach(() => {
  vi.useFakeTimers();
  scene = makeScene();
  gsm   = makeGsm();
  cr    = new CharacterRenderer(scene, gsm);
});

afterEach(() => {
  cr.destroy();
  vi.useRealTimers();
});

// ── Scene integration ─────────────────────────────────────────────────────────

describe('scene integration', () => {
  it('adds the robot mesh to the scene on construction', () => {
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it('robot starts hidden (not visible before MainMenu)', () => {
    expect((cr.robotObject3D as THREE.Mesh).visible).toBe(false);
  });
});

// ── robotObject3D stability ───────────────────────────────────────────────────

describe('robotObject3D stability', () => {
  it('robotObject3D is the same reference across state transitions', () => {
    const ref = cr.robotObject3D;
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    expect(cr.robotObject3D).toBe(ref);
  });
});

// ── Visibility by state ───────────────────────────────────────────────────────

describe('visibility by state', () => {
  it('becomes visible on → MainMenu', () => {
    gsm.transition(GameState.MainMenu);
    expect((cr.robotObject3D as THREE.Mesh).visible).toBe(true);
  });

  it('stays visible on → Running', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    expect((cr.robotObject3D as THREE.Mesh).visible).toBe(true);
  });

  it('stays visible on → Dead', () => {
    reachDead(gsm);
    expect((cr.robotObject3D as THREE.Mesh).visible).toBe(true);
  });

  it('hidden on → Loading (initial state hidden)', () => {
    // Still in Loading; robot should be hidden
    expect((cr.robotObject3D as THREE.Mesh).visible).toBe(false);
  });
});

// ── applyTexture ──────────────────────────────────────────────────────────────

describe('applyTexture', () => {
  it('applies a valid texture to the material', () => {
    const texture = new THREE.Texture();
    cr.applyTexture(texture);
    const mat = (cr.robotObject3D as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBe(texture);
  });

  it('sets texture colorSpace to SRGBColorSpace', () => {
    const texture = new THREE.Texture();
    cr.applyTexture(texture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('null texture logs a warning and keeps the current texture', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalTexture = new THREE.Texture();
    cr.applyTexture(originalTexture);
    cr.applyTexture(null);
    const mat = (cr.robotObject3D as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBe(originalTexture);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('applies texture mid-run without throwing', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    const texture = new THREE.Texture();
    expect(() => cr.applyTexture(texture)).not.toThrow();
  });
});

// ── deathAnimationComplete ────────────────────────────────────────────────────

describe('deathAnimationComplete', () => {
  it('fires after deathDuration ms on → Dead', () => {
    const listener = vi.fn();
    cr.onDeathComplete(listener);
    reachDead(gsm);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('fires exactly once per death', () => {
    const listener = vi.fn();
    cr.onDeathComplete(listener);
    reachDead(gsm);
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration * 2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not fire if cancelled by restart before timer expires', () => {
    const listener = vi.fn();
    cr.onDeathComplete(listener);
    reachDead(gsm);
    // Partial time passes, then restart
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration / 2);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running); // restart cancels death timer
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration);
    expect(listener).not.toHaveBeenCalled();
  });

  it('listener error does not prevent other listeners from firing', () => {
    const thrower = vi.fn(() => { throw new Error('boom'); });
    const after   = vi.fn();
    cr.onDeathComplete(thrower);
    cr.onDeathComplete(after);
    reachDead(gsm);
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration);
    expect(after).toHaveBeenCalledOnce();
  });

  it('offDeathComplete removes a listener', () => {
    const listener = vi.fn();
    cr.onDeathComplete(listener);
    cr.offDeathComplete(listener);
    reachDead(gsm);
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('removes the mesh from the scene', () => {
    const childCount = scene.children.length;
    cr.destroy();
    expect(scene.children.length).toBeLessThan(childCount);
  });

  it('unsubscribes from GSM — no deathComplete fires after destroy', () => {
    const listener = vi.fn();
    cr.onDeathComplete(listener);
    cr.destroy();
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    vi.advanceTimersByTime(CHARACTER_RENDERER_CONFIG.deathDuration);
    expect(listener).not.toHaveBeenCalled();
  });
});
