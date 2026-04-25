import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createFollowLeaderCamera } from '@/camera/follow-leader-camera';
import { CONFIG } from '@/config';
import type { Renderer, RobotInstance } from '@/renderer/renderer';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeInstance(id: number, x: number): RobotInstance {
  const root = new THREE.Object3D();
  root.position.x = x;
  return {
    id,
    root,
    mixer: {} as THREE.AnimationMixer,
    clips: new Map(),
  };
}

function makeFakeRenderer(positions: ReadonlyArray<number>): Renderer {
  const instances: RobotInstance[] = positions.map((x, i) => makeFakeInstance(i, x));
  const byId = new Map(instances.map((i) => [i.id, i]));
  return {
    mount: async () => {},
    getInstance: (id: number) => byId.get(id),
    getAllInstances: () => instances,
    getScene: () => new THREE.Scene(),
    addToScene: () => {},
    dispose: () => {},
  };
}

interface ScriptedClock {
  raf: (cb: FrameRequestCallback) => number;
  cancelRaf: (id: number) => void;
  now: () => number;
  step(dtMs: number): void;
  pending(): number;
}

function makeScriptedClock(startMs = 0): ScriptedClock {
  let nowMs = startMs;
  const queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  return {
    raf: (cb) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    cancelRaf: (id) => {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    now: () => nowMs,
    step(dtMs: number) {
      nowMs += dtMs;
      const next = queue.shift();
      if (next) next.cb(nowMs);
    },
    pending: () => queue.length,
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  // Initial position chosen to NOT match any test leader X so we can
  // verify movement clearly.
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  return cam;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createFollowLeaderCamera — leader selection', () => {
  it('snaps to the leader-X on the first tracked frame', () => {
    const renderer = makeFakeRenderer([5, 50, 30, 12]);
    const camera = makeCamera();
    const clock = makeScriptedClock();

    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();
    clock.step(0); // first tick consumes timestamp without lerp
    clock.step(16); // first tracked tick

    expect(camera.position.x).toBeCloseTo(50, 4);
    expect(camera.position.y).toBeCloseTo(CONFIG.camera.follow.offsetY, 4);
    expect(camera.position.z).toBeCloseTo(CONFIG.camera.follow.offsetZ, 4);
    follower.dispose();
  });

  it('chooses the highest-X instance as the leader regardless of id order', () => {
    // The third id (index 2) has the highest X. Camera should follow it.
    const renderer = makeFakeRenderer([10, 5, 100, 80, 20]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();
    clock.step(0);
    clock.step(16);
    expect(camera.position.x).toBeCloseTo(100, 4);
    follower.dispose();
  });
});

describe('createFollowLeaderCamera — smoothing', () => {
  it('eases toward a moving leader without overshooting', () => {
    const positions = [0];
    const renderer = makeFakeRenderer(positions);
    // Ensure the renderer.getAllInstances() reads the same array so we can
    // mutate position.x mid-test.
    const inst = renderer.getAllInstances()[0];

    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();
    clock.step(0); // init
    clock.step(16); // initial snap to leaderX = 0
    expect(camera.position.x).toBeCloseTo(0, 4);

    // Now leader teleports to x=100 and we step several frames; camera
    // should ease toward 100 and never exceed it.
    inst.root.position.x = 100;
    let prev = camera.position.x;
    for (let i = 0; i < 30; i++) {
      clock.step(16);
      const cur = camera.position.x;
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9); // monotone non-decreasing
      expect(cur).toBeLessThanOrEqual(100 + 1e-6); // no overshoot
      prev = cur;
    }
    expect(camera.position.x).toBeGreaterThan(50);
  });

  it('is frame-rate-independent: same total time → same end position', () => {
    // Two simulators: one at 60 fps, one at 30 fps, run for ~1 second of
    // wall time with a stationary leader at x=100. End positions should
    // match within float precision.
    function trace(stepMs: number, totalMs: number): number {
      const renderer = makeFakeRenderer([100]);
      const camera = makeCamera();
      const clock = makeScriptedClock();
      const follower = createFollowLeaderCamera({
        camera,
        renderer,
        raf: clock.raf,
        cancelRaf: clock.cancelRaf,
        now: clock.now,
      });
      follower.start();
      clock.step(0);
      // First post-init tick snaps to leaderX = 100 (no lerp). To exercise
      // the lerp path, start the leader at 0 then snap, then move to 100.
      const inst = renderer.getAllInstances()[0];
      inst.root.position.x = 0;
      clock.step(stepMs); // snap to 0
      inst.root.position.x = 100;
      let elapsed = 0;
      while (elapsed < totalMs) {
        clock.step(stepMs);
        elapsed += stepMs;
      }
      const end = camera.position.x;
      follower.dispose();
      return end;
    }

    const at60 = trace(1000 / 60, 1000);
    const at30 = trace(1000 / 30, 1000);
    expect(Math.abs(at60 - at30)).toBeLessThan(0.5);
  });
});

describe('createFollowLeaderCamera — lookAt', () => {
  it('points the camera at (leaderX, lookAtY, 0)', () => {
    const renderer = makeFakeRenderer([100]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();
    clock.step(0);
    clock.step(16);
    // After lookAt, the camera's local -Z should point toward the target.
    // Easier: compute the target direction and compare to camera's forward.
    const expectedTarget = new THREE.Vector3(100, CONFIG.camera.follow.lookAtY, 0);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const toTarget = expectedTarget.clone().sub(camera.position).normalize();
    // Dot ≈ 1 means directions agree.
    expect(forward.dot(toTarget)).toBeGreaterThan(0.9999);
    follower.dispose();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('createFollowLeaderCamera — lifecycle', () => {
  it('start/stop/isRunning behave correctly', () => {
    const renderer = makeFakeRenderer([0]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    expect(follower.isRunning()).toBe(false);
    follower.start();
    expect(follower.isRunning()).toBe(true);
    expect(clock.pending()).toBe(1);
    follower.stop();
    expect(follower.isRunning()).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it('start() is idempotent', () => {
    const renderer = makeFakeRenderer([0]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();
    follower.start();
    expect(clock.pending()).toBe(1);
    follower.dispose();
  });

  it('start() after dispose() throws', () => {
    const renderer = makeFakeRenderer([0]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.dispose();
    expect(() => follower.start()).toThrow(/disposed/i);
  });

  it('dispose() is idempotent', () => {
    const renderer = makeFakeRenderer([0]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.dispose();
    expect(() => follower.dispose()).not.toThrow();
  });
});

describe('createFollowLeaderCamera — determinism', () => {
  it('does not call Math.random in the tracking loop', () => {
    // Object3D / PerspectiveCamera construction in three.js calls Math.random
    // internally for UUID generation; that is not our code. Spy AFTER
    // setup so we only catch entropy introduced by the follower itself.
    const renderer = makeFakeRenderer([5, 10, 30]);
    const camera = makeCamera();
    const clock = makeScriptedClock();
    const follower = createFollowLeaderCamera({
      camera,
      renderer,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    follower.start();

    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 5; i++) clock.step(16);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    follower.dispose();
  });
});
