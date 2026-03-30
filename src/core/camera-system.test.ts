// @vitest-environment jsdom
/**
 * Camera System — unit tests
 * GDD acceptance criteria: design/gdd/camera-system.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraSystem } from './camera-system';
import { CAMERA_SYSTEM_CONFIG } from '../config/camera-system.config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRobot(x = 0): THREE.Object3D {
  const obj = new THREE.Object3D();
  obj.position.x = x;
  return obj;
}

function makeCs(robot: THREE.Object3D): CameraSystem {
  return new CameraSystem(robot, 16 / 9, CAMERA_SYSTEM_CONFIG);
}

let robot: THREE.Object3D;
let cs:    CameraSystem;

beforeEach(() => {
  robot = makeRobot(0);
  cs    = makeCs(robot);
});

// ── Initial position ──────────────────────────────────────────────────────────

describe('initial position', () => {
  it('camera starts at robot X', () => {
    expect(cs.camera.position.x).toBe(0);
  });

  it('camera starts at configured Y offset', () => {
    expect(cs.camera.position.y).toBe(CAMERA_SYSTEM_CONFIG.yOffset);
  });

  it('camera starts at configured Z offset', () => {
    expect(cs.camera.position.z).toBe(CAMERA_SYSTEM_CONFIG.zOffset);
  });

  it('camera tracks a non-zero starting robot X', () => {
    const r = makeRobot(-3); // LANE_LEFT
    const c = new CameraSystem(r);
    expect(c.camera.position.x).toBe(-3);
  });

  it('camera FOV matches config', () => {
    expect(cs.camera.fov).toBe(CAMERA_SYSTEM_CONFIG.fov);
  });
});

// ── X lerp ───────────────────────────────────────────────────────────────────

describe('X lerp follow', () => {
  it('camera X moves toward robot X after update', () => {
    robot.position.x = 3; // robot switches to LANE_RIGHT
    cs.update(16);
    expect(cs.camera.position.x).toBeGreaterThan(0);
    expect(cs.camera.position.x).toBeLessThan(3);
  });

  it('camera reaches 95% of lane width within ~375ms at default xLerpFactor=8', () => {
    robot.position.x = 3;
    // Simulate 375ms in 16ms ticks
    for (let i = 0; i < 24; i++) cs.update(16);
    expect(cs.camera.position.x).toBeGreaterThan(3 * 0.95);
  });

  it('camera never overshoots the target', () => {
    robot.position.x = 3;
    for (let i = 0; i < 60; i++) cs.update(16);
    expect(cs.camera.position.x).toBeLessThanOrEqual(3 + 0.001);
  });
});

// ── Fixed Y and Z ─────────────────────────────────────────────────────────────

describe('fixed Y and Z', () => {
  it('Y remains fixed after many updates', () => {
    robot.position.x = 3;
    for (let i = 0; i < 30; i++) cs.update(16);
    expect(cs.camera.position.y).toBe(CAMERA_SYSTEM_CONFIG.yOffset);
  });

  it('Z remains fixed after many updates', () => {
    robot.position.x = 3;
    for (let i = 0; i < 30; i++) cs.update(16);
    expect(cs.camera.position.z).toBe(CAMERA_SYSTEM_CONFIG.zOffset);
  });
});

// ── Delta clamp ───────────────────────────────────────────────────────────────

describe('delta clamp', () => {
  it('a 1-second spike does not overshoot the robot X target', () => {
    robot.position.x = 3;
    cs.update(1000); // 1000ms spike → clamped to 0.1s
    // With xLerpFactor=8 and delta=0.1: step = 3 × 8 × 0.1 = 2.4 → no overshoot
    expect(cs.camera.position.x).toBeLessThanOrEqual(3 + 0.001);
  });

  it('a 1-second spike moves less than an unclamped equivalent', () => {
    robot.position.x = 3;
    cs.update(1000);
    const clampedX = cs.camera.position.x;

    // Compare: same scenario without a clamp would step by 3 × 8 × 1.0 = 24
    // (overshoot). Our clamped result should be well below 3.
    expect(clampedX).toBeLessThan(3);
  });
});

// ── snapToRobot ───────────────────────────────────────────────────────────────

describe('snapToRobot', () => {
  it('instantly sets camera X to robot X', () => {
    robot.position.x = -3;
    cs.snapToRobot();
    expect(cs.camera.position.x).toBe(-3);
  });

  it('snap does not change Y or Z', () => {
    robot.position.x = 3;
    cs.snapToRobot();
    expect(cs.camera.position.y).toBe(CAMERA_SYSTEM_CONFIG.yOffset);
    expect(cs.camera.position.z).toBe(CAMERA_SYSTEM_CONFIG.zOffset);
  });

  it('after snap, subsequent lerp starts from snapped position', () => {
    robot.position.x = 3;
    cs.snapToRobot(); // now at 3
    robot.position.x = 0; // robot moves back to center
    cs.update(16);
    // Camera should be moving from 3 toward 0, so slightly below 3
    expect(cs.camera.position.x).toBeLessThan(3);
    expect(cs.camera.position.x).toBeGreaterThan(0);
  });
});

// ── onResize ──────────────────────────────────────────────────────────────────

describe('onResize', () => {
  it('updates camera aspect ratio', () => {
    cs.onResize(4 / 3);
    expect(cs.camera.aspect).toBeCloseTo(4 / 3);
  });
});
