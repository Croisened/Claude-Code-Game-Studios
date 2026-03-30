// @vitest-environment jsdom
/**
 * Runner System — unit tests
 * GDD acceptance criteria: design/gdd/runner-system.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { GameStateManager, GameState } from './game-state-manager';
import { InputSystem } from './input-system';
import { EnvironmentRenderer, LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';
import { RunnerSystem } from './runner-system';
import { RUNNER_SYSTEM_CONFIG } from '../config/runner-system.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fresh instances wired together for each test */
let gsmInst:   GameStateManager;
let inputInst: InputSystem;
let robot:     THREE.Object3D;
let er:        EnvironmentRenderer;
let rs:        RunnerSystem;

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup',   { code, bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  gsmInst   = new GameStateManager();
  inputInst = new InputSystem(window);
  robot     = new THREE.Object3D();
  er        = new EnvironmentRenderer(new THREE.Scene(), gsmInst);
  rs        = new RunnerSystem(robot, er, gsmInst, inputInst, RUNNER_SYSTEM_CONFIG);
});

afterEach(() => {
  rs.destroy();
  inputInst.destroy();
  vi.useRealTimers();
});

/** Puts GSM + RunnerSystem into Running state via the valid transition path. */
function startRun(): void {
  gsmInst.transition(GameState.MainMenu);
  gsmInst.transition(GameState.Running);
}

// ── GSM integration ───────────────────────────────────────────────────────────

describe('GSM integration', () => {
  it('robot snaps to LANE_CENTER on → Running', () => {
    robot.position.x = LANE_LEFT;
    startRun();
    expect(robot.position.x).toBe(LANE_CENTER);
  });

  it('robot Y resets to groundY on → Running', () => {
    robot.position.y = 5;
    startRun();
    expect(robot.position.y).toBe(RUNNER_SYSTEM_CONFIG.groundY);
  });

  it('currentSpeed resets to initialScrollSpeed on → Running', () => {
    startRun();
    expect(rs.currentSpeed).toBe(RUNNER_SYSTEM_CONFIG.initialScrollSpeed);
  });

  it('update is a no-op before → Running', () => {
    const speedBefore = rs.currentSpeed;
    rs.update(1000);
    expect(rs.currentSpeed).toBe(speedBefore);
  });

  it('update is a no-op after → Dead', () => {
    startRun();
    rs.update(16);
    gsmInst.transition(GameState.Dead);
    const speedAtDeath = rs.currentSpeed;
    rs.update(1000);
    expect(rs.currentSpeed).toBe(speedAtDeath);
  });
});

// ── Lane changes ──────────────────────────────────────────────────────────────

describe('lane changes', () => {
  beforeEach(() => startRun());

  it('ArrowLeft from center moves to LANE_LEFT', () => {
    press('ArrowLeft');
    expect(robot.position.x).toBe(LANE_LEFT);
  });

  it('ArrowRight from center moves to LANE_RIGHT', () => {
    press('ArrowRight');
    expect(robot.position.x).toBe(LANE_RIGHT);
  });

  it('ArrowLeft from LANE_LEFT is ignored', () => {
    press('ArrowLeft');
    press('ArrowLeft');
    expect(robot.position.x).toBe(LANE_LEFT);
  });

  it('ArrowRight from LANE_RIGHT is ignored', () => {
    press('ArrowRight');
    press('ArrowRight');
    expect(robot.position.x).toBe(LANE_RIGHT);
  });

  it('can traverse all three lanes left-to-right', () => {
    press('ArrowLeft');
    expect(robot.position.x).toBe(LANE_LEFT);
    press('ArrowRight');
    expect(robot.position.x).toBe(LANE_CENTER);
    press('ArrowRight');
    expect(robot.position.x).toBe(LANE_RIGHT);
  });

  it('lane change is valid while airborne', () => {
    press('Space');
    rs.update(16);
    press('ArrowLeft');
    expect(robot.position.x).toBe(LANE_LEFT);
  });

  it('no movement when Dead', () => {
    gsmInst.transition(GameState.Dead);
    const xAtDeath = robot.position.x;
    press('ArrowLeft');
    expect(robot.position.x).toBe(xAtDeath);
  });
});

// ── Jump ──────────────────────────────────────────────────────────────────────

describe('jump', () => {
  beforeEach(() => startRun());

  it('JUMP moves robot above groundY after one update', () => {
    press('Space');
    rs.update(16);
    expect(robot.position.y).toBeGreaterThan(RUNNER_SYSTEM_CONFIG.groundY);
  });

  it('robot returns to groundY after full jump arc', () => {
    press('Space');
    for (let i = 0; i < 125; i++) rs.update(16);
    expect(robot.position.y).toBe(RUNNER_SYSTEM_CONFIG.groundY);
  });

  it('no double-jump — second JUMP while airborne has no effect', () => {
    const { jumpForce, gravity } = RUNNER_SYSTEM_CONFIG;
    const theoreticalPeak = (jumpForce * jumpForce) / (2 * gravity);

    press('Space');
    rs.update(16);
    press('Space'); // should be ignored
    let peakY = 0;
    for (let i = 0; i < 125; i++) {
      rs.update(16);
      if (robot.position.y > peakY) peakY = robot.position.y;
    }
    // A second jump would have doubled the velocity; peak would far exceed theoretical
    expect(peakY).toBeLessThan(theoreticalPeak * 1.15);
  });

  it('peak height is approximately jumpForce² / (2 × gravity)', () => {
    const { jumpForce, gravity } = RUNNER_SYSTEM_CONFIG;
    const theoreticalPeak = (jumpForce * jumpForce) / (2 * gravity);

    press('Space');
    let peakY = 0;
    for (let i = 0; i < 125; i++) {
      rs.update(16);
      if (robot.position.y > peakY) peakY = robot.position.y;
    }
    // Allow 15% tolerance for discrete integration error
    expect(peakY).toBeGreaterThan(theoreticalPeak * 0.85);
    expect(peakY).toBeLessThan(theoreticalPeak * 1.15);
  });
});

// ── Slide ─────────────────────────────────────────────────────────────────────

describe('slide', () => {
  beforeEach(() => startRun());

  it('SLIDE while airborne is ignored — robot stays airborne', () => {
    press('Space');
    rs.update(16);
    press('ArrowDown');
    rs.update(16);
    // Robot should still be airborne; slide would have snapped to ground
    expect(robot.position.y).toBeGreaterThan(0);
  });

  it('SLIDE auto-reverts after slideDuration — JUMP then works', () => {
    press('ArrowDown');
    vi.advanceTimersByTime(RUNNER_SYSTEM_CONFIG.slideDuration + 1);
    press('Space');
    rs.update(16);
    expect(robot.position.y).toBeGreaterThan(RUNNER_SYSTEM_CONFIG.groundY);
  });

  it('second SLIDE while already sliding is ignored', () => {
    press('ArrowDown');
    vi.advanceTimersByTime(RUNNER_SYSTEM_CONFIG.slideDuration / 2);
    press('ArrowDown'); // should not reset the timer
    vi.advanceTimersByTime(RUNNER_SYSTEM_CONFIG.slideDuration / 2 + 1);
    // Original timer fired; JUMP should now work
    press('Space');
    rs.update(16);
    expect(robot.position.y).toBeGreaterThan(0);
  });
});

// ── JUMP cancels slide ────────────────────────────────────────────────────────

describe('JUMP cancels slide', () => {
  beforeEach(() => startRun());

  it('JUMP while sliding initiates a jump', () => {
    press('ArrowDown');
    press('Space');
    rs.update(16);
    expect(robot.position.y).toBeGreaterThan(RUNNER_SYSTEM_CONFIG.groundY);
  });

  it('slide timer is cancelled when JUMP overrides slide', () => {
    press('ArrowDown');
    press('Space');
    vi.advanceTimersByTime(RUNNER_SYSTEM_CONFIG.slideDuration + 1);
    for (let i = 0; i < 125; i++) rs.update(16);
    // Robot landed cleanly; stale timer must not have interfered
    expect(robot.position.y).toBe(RUNNER_SYSTEM_CONFIG.groundY);
  });
});

// ── Speed ramp ────────────────────────────────────────────────────────────────

describe('speed ramp', () => {
  beforeEach(() => startRun());

  it('currentSpeed starts at initialScrollSpeed', () => {
    expect(rs.currentSpeed).toBe(RUNNER_SYSTEM_CONFIG.initialScrollSpeed);
  });

  it('speed increases after update', () => {
    const before = rs.currentSpeed;
    rs.update(1000);
    expect(rs.currentSpeed).toBeGreaterThan(before);
  });

  it('speed never exceeds maxSpeed', () => {
    for (let i = 0; i < 500; i++) rs.update(100);
    expect(rs.currentSpeed).toBeLessThanOrEqual(RUNNER_SYSTEM_CONFIG.maxSpeed);
  });

  it('speed eventually reaches maxSpeed', () => {
    for (let i = 0; i < 500; i++) rs.update(100);
    expect(rs.currentSpeed).toBe(RUNNER_SYSTEM_CONFIG.maxSpeed);
  });
});

// ── setSpeed ──────────────────────────────────────────────────────────────────

describe('setSpeed', () => {
  beforeEach(() => startRun());

  it('overrides currentSpeed', () => {
    rs.setSpeed(20);
    expect(rs.currentSpeed).toBe(20);
  });

  it('clamps negative speed to 0', () => {
    rs.setSpeed(-5);
    expect(rs.currentSpeed).toBe(0);
  });
});

// ── Collision ─────────────────────────────────────────────────────────────────

describe('collision', () => {
  beforeEach(() => startRun());

  it('notifyCollision fires the listener', () => {
    const handler = vi.fn();
    rs.onCollisionDetected(handler);
    rs.notifyCollision();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('notifyCollision fires at most once per run', () => {
    const handler = vi.fn();
    rs.onCollisionDetected(handler);
    rs.notifyCollision();
    rs.notifyCollision();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('collisionFired resets on → Running restart', () => {
    const handler = vi.fn();
    rs.onCollisionDetected(handler);
    rs.notifyCollision();
    gsmInst.transition(GameState.Dead);
    gsmInst.transition(GameState.ScoreScreen);
    gsmInst.transition(GameState.Running);
    rs.notifyCollision();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('notifyCollision is a no-op in Dead state', () => {
    const handler = vi.fn();
    rs.onCollisionDetected(handler);
    gsmInst.transition(GameState.Dead);
    rs.notifyCollision();
    expect(handler).not.toHaveBeenCalled();
  });
});
