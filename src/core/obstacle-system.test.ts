// @vitest-environment jsdom
/**
 * Obstacle System — unit tests
 * GDD acceptance criteria: design/gdd/obstacle-system.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { GameStateManager, GameState } from './game-state-manager';
import { InputSystem } from './input-system';
import { EnvironmentRenderer, LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';
import { RunnerSystem } from './runner-system';
import { ObstacleSystem } from './obstacle-system';
import { OBSTACLE_SYSTEM_CONFIG, OBSTACLE_TYPE_REGISTRY } from '../config/obstacle-system.config';
import { RUNNER_SYSTEM_CONFIG } from '../config/runner-system.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

let gsm:   GameStateManager;
let input: InputSystem;
let robot: THREE.Object3D;
let er:    EnvironmentRenderer;
let rs:    RunnerSystem;
let scene: THREE.Scene;
let os:    ObstacleSystem;

beforeEach(() => {
  vi.useFakeTimers();
  gsm   = new GameStateManager();
  input = new InputSystem(window);
  robot = new THREE.Object3D();
  scene = new THREE.Scene();
  er    = new EnvironmentRenderer(scene, gsm);
  rs    = new RunnerSystem(robot, er, gsm, input, RUNNER_SYSTEM_CONFIG);
  os    = new ObstacleSystem(scene, robot, gsm, rs);
});

afterEach(() => {
  os.destroy();
  rs.destroy();
  input.destroy();
  vi.useRealTimers();
});

function startRun(): void {
  gsm.transition(GameState.MainMenu);
  gsm.transition(GameState.Running);
}

/** Access the internal pool for white-box tests */
type PoolSlot = { active: boolean; mesh: THREE.Mesh; typeIndex: number };
function pool(): PoolSlot[] {
  return (os as unknown as { _pool: PoolSlot[] })._pool;
}

/** Returns the first active pool slot, or undefined */
function firstActive(): PoolSlot | undefined {
  return pool().find(p => p.active);
}

// ── Pool allocation ───────────────────────────────────────────────────────────

describe('pool allocation', () => {
  it('pre-allocates correct total count (sum of all poolSizes)', () => {
    const total = OBSTACLE_TYPE_REGISTRY.reduce((s, t) => s + t.poolSize, 0);
    expect(pool().length).toBe(total);
  });

  it('all obstacles are inactive at startup', () => {
    expect(os.activeCount).toBe(0);
  });

  it('pool has 6 slots total (3 Barrier + 3 Drone)', () => {
    expect(pool().length).toBe(6);
  });
});

// ── Spawn ─────────────────────────────────────────────────────────────────────

describe('spawn', () => {
  beforeEach(() => startRun());

  it('no obstacle spawns before spawnInterval elapses', () => {
    os.update((OBSTACLE_SYSTEM_CONFIG.spawnInterval - 0.1) * 1000);
    expect(os.activeCount).toBe(0);
  });

  it('one obstacle spawns after spawnInterval elapses', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    expect(os.activeCount).toBe(1);
  });

  it('spawned obstacle is placed at Z = −spawnDistance', () => {
    // Freeze movement so spawn Z can be checked without drift
    vi.spyOn(rs, 'currentSpeed', 'get').mockReturnValue(0);
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    expect(firstActive()!.mesh.position.z).toBe(-OBSTACLE_SYSTEM_CONFIG.spawnDistance);
  });

  it('spawned obstacle X is a valid lane', () => {
    const VALID_LANES = new Set([LANE_LEFT, LANE_CENTER, LANE_RIGHT]);
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    expect(VALID_LANES.has(firstActive()!.mesh.position.x)).toBe(true);
  });

  it('obstacle Y matches the type centerY', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot = firstActive()!;
    const def  = OBSTACLE_TYPE_REGISTRY[slot.typeIndex];
    expect(slot.mesh.position.y).toBe(def.centerY);
  });

  it('no spawn before → Running', () => {
    const gsm2   = new GameStateManager();
    const os2    = new ObstacleSystem(new THREE.Scene(), robot, gsm2, rs);
    os2.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 100);
    expect(os2.activeCount).toBe(0);
    os2.destroy();
  });
});

// ── Movement ──────────────────────────────────────────────────────────────────

describe('obstacle movement', () => {
  beforeEach(() => startRun());

  it('active obstacles move toward robot each tick', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot    = firstActive()!;
    const zBefore = slot.mesh.position.z;
    os.update(16);
    expect(slot.mesh.position.z).toBeGreaterThan(zBefore);
  });

  it('obstacle moves at RS.currentSpeed per second', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot  = firstActive()!;
    const z0    = slot.mesh.position.z;
    const speed = rs.currentSpeed;
    // Use 16ms tick; physics delta is clamped but 16ms = 0.016s (well under clamp)
    os.update(16);
    expect(slot.mesh.position.z).toBeCloseTo(z0 + speed * 0.016, 3);
  });

  it('obstacles freeze after → Dead', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot = firstActive()!;
    gsm.transition(GameState.Dead);
    const zAtDeath = slot.mesh.position.z;
    os.update(100);
    expect(slot.mesh.position.z).toBe(zAtDeath);
  });
});

// ── Recycle ───────────────────────────────────────────────────────────────────

describe('recycle', () => {
  beforeEach(() => startRun());

  it('obstacle is deactivated when Z > recycleThreshold', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot = firstActive()!;
    slot.mesh.position.z = OBSTACLE_SYSTEM_CONFIG.recycleThreshold + 1;
    os.update(16);
    expect(slot.active).toBe(false);
  });

  it('obstacle below recycleThreshold is NOT recycled', () => {
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    const slot = firstActive()!;
    // Set just under threshold; movement in 1ms tick is negligible but positive,
    // so use a comfortable buffer to keep Z strictly below threshold
    slot.mesh.position.z = OBSTACLE_SYSTEM_CONFIG.recycleThreshold - 0.5;
    vi.spyOn(rs, 'currentSpeed', 'get').mockReturnValue(0); // no movement this tick
    os.update(1);
    expect(slot.active).toBe(true);
  });
});

// ── Reset on state transitions ────────────────────────────────────────────────

describe('reset on state transitions', () => {
  it('all obstacles deactivated on → Running restart', () => {
    startRun();
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    expect(os.activeCount).toBeGreaterThan(0);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    expect(os.activeCount).toBe(0);
  });

  it('all obstacles deactivated on → ScoreScreen', () => {
    startRun();
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    expect(os.activeCount).toBe(0);
  });

  it('all obstacles deactivated on → MainMenu', () => {
    startRun();
    os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 16);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.MainMenu);
    expect(os.activeCount).toBe(0);
  });
});

// ── Minimum gap ───────────────────────────────────────────────────────────────

describe('minimum gap', () => {
  it('no two active obstacles are closer than minObstacleGap', () => {
    startRun();
    // Advance in spawnInterval increments — each spawns one obstacle if gap allows
    for (let i = 0; i < 10; i++) {
      os.update(OBSTACLE_SYSTEM_CONFIG.spawnInterval * 1000 + 1);
    }
    const active = pool().filter(p => p.active);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const gap = Math.abs(active[i].mesh.position.z - active[j].mesh.position.z);
        expect(gap).toBeGreaterThanOrEqual(OBSTACLE_SYSTEM_CONFIG.minObstacleGap);
      }
    }
  });
});

// ── Pool exhaustion ───────────────────────────────────────────────────────────

describe('pool exhaustion', () => {
  it('logs a warning when pool is full and skips spawn gracefully', () => {
    startRun();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Activate all pool slots at Z positions far from the spawn point
    // so the minimum-gap check doesn't block _trySpawn from reaching the pool check
    pool().forEach((p, i) => {
      p.active = true;
      p.mesh.position.z = -200 - i * 50; // far from spawnZ=-30
    });

    // Direct call to _trySpawn bypasses the timer
    (os as unknown as { _trySpawn: () => void })._trySpawn();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Pool exhausted'));
    warnSpy.mockRestore();
  });
});

// ── setSpawnInterval ──────────────────────────────────────────────────────────

describe('setSpawnInterval', () => {
  it('accepts a valid interval and spawns faster', () => {
    os.setSpawnInterval(1.0); // shorter than default 2.0s
    startRun();
    os.update(1000 + 16); // 1s + margin
    expect(os.activeCount).toBeGreaterThan(0);
  });

  it('clamps zero to minSpawnInterval and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    os.setSpawnInterval(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('clamps negative value and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    os.setSpawnInterval(-1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── AABB collision ────────────────────────────────────────────────────────────

describe('AABB collision', () => {
  beforeEach(() => startRun());

  it('calls notifyCollision when obstacle overlaps robot', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    // Activate a barrier slot and place it at robot position
    const slot = pool().find(p => p.typeIndex === 0)!;
    slot.active = true;
    slot.mesh.position.set(LANE_CENTER, OBSTACLE_TYPE_REGISTRY[0].centerY, 0);
    robot.position.set(LANE_CENTER, 0, 0);
    os.update(1);
    expect(spy).toHaveBeenCalled();
  });

  it('no collision when obstacle is in a different lane', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    const slot = pool().find(p => p.typeIndex === 0)!;
    slot.active = true;
    slot.mesh.position.set(LANE_RIGHT, OBSTACLE_TYPE_REGISTRY[0].centerY, 0);
    robot.position.set(LANE_CENTER, 0, 0); // robot in center, obstacle at right
    os.update(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('no collision when obstacle is far behind robot (Z >> 0)', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    const slot = pool().find(p => p.typeIndex === 0)!;
    slot.active = true;
    slot.mesh.position.set(LANE_CENTER, OBSTACLE_TYPE_REGISTRY[0].centerY, 20); // well past robot
    robot.position.set(LANE_CENTER, 0, 0);
    os.update(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('drone does NOT collide when robot is sliding (crouched top 0.9 < drone bottom 1.0)', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    vi.spyOn(rs, 'isSliding', 'get').mockReturnValue(true);

    const droneSlot = pool().find(p => p.typeIndex === 1)!;
    droneSlot.active = true;
    droneSlot.mesh.position.set(LANE_CENTER, OBSTACLE_TYPE_REGISTRY[1].centerY, 0);
    robot.position.set(LANE_CENTER, 0, 0); // crouched, top = 0.9; drone bottom = 1.0

    os.update(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('drone collides with standing robot (top 1.8 > drone bottom 1.0)', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    vi.spyOn(rs, 'isSliding', 'get').mockReturnValue(false);

    const droneSlot = pool().find(p => p.typeIndex === 1)!;
    droneSlot.active = true;
    droneSlot.mesh.position.set(LANE_CENTER, OBSTACLE_TYPE_REGISTRY[1].centerY, 0);
    robot.position.set(LANE_CENTER, 0, 0); // standing, top = 1.8; drone range 1.0–1.5 → overlap

    os.update(1);
    expect(spy).toHaveBeenCalled();
  });

  it('barrier clears when robot is jumping high enough (base > barrier top 1.0)', () => {
    const spy = vi.spyOn(rs, 'notifyCollision');
    const barrierSlot = pool().find(p => p.typeIndex === 0)!;
    barrierSlot.active = true;
    barrierSlot.mesh.position.set(LANE_CENTER, OBSTACLE_TYPE_REGISTRY[0].centerY, 0);
    robot.position.set(LANE_CENTER, 2.7, 0); // base at 2.7 > barrier top 1.0

    os.update(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
