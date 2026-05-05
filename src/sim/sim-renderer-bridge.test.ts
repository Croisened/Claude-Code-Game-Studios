import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createSimRendererBridge } from '@/sim/sim-renderer-bridge';
import { createSimDriver, type SimDriver } from '@/sim/sim-driver';
import { POSE_STRIDE, type PoseFrame, type SimResult, type TimelineEvent } from '@/sim/engine';
import type { Renderer, RobotInstance } from '@/renderer/renderer';
import type { AnimationStateSwitcher } from '@/animation/state-switcher';
import type { RobotAnimationState } from '@/animation/types';

// ---------------------------------------------------------------------------
// Test doubles — bridge needs only RobotInstance.root + AnimationStateSwitcher
// API. We build minimal fakes to keep these tests fast and free of GLB/WebGL.
// ---------------------------------------------------------------------------

function makeFakeInstance(id: number): RobotInstance {
  // Only `root` is read by the bridge. `mixer` and `clips` are unused here
  // but the type requires them.
  return {
    id,
    root: new THREE.Object3D(),
    mixer: {} as THREE.AnimationMixer,
    clips: new Map(),
  };
}

function makeFakeRenderer(robotCount: number): Renderer {
  const instances: RobotInstance[] = [];
  for (let i = 0; i < robotCount; i++) instances.push(makeFakeInstance(i));
  const byId = new Map(instances.map((i) => [i.id, i]));
  return {
    mount: async () => {},
    getInstance: (id: number) => byId.get(id),
    getAllInstances: () => instances,
    getScene: () => new THREE.Scene(),
    addToScene: () => {},
    applyInitialPoses: () => {},
    dispose: () => {},
  };
}

interface SwitcherSpy extends AnimationStateSwitcher {
  states: Map<number, RobotAnimationState>;
  setStateCalls: Array<{ id: number; state: RobotAnimationState }>;
}

function makeFakeSwitcher(robotCount: number, initial: RobotAnimationState = 'idle'): SwitcherSpy {
  const states = new Map<number, RobotAnimationState>();
  for (let i = 0; i < robotCount; i++) states.set(i, initial);
  const setStateCalls: Array<{ id: number; state: RobotAnimationState }> = [];
  return {
    states,
    setStateCalls,
    setState(id: number, state: RobotAnimationState): void {
      states.set(id, state);
      setStateCalls.push({ id, state });
    },
    current(id: number): RobotAnimationState {
      const s = states.get(id);
      if (!s) throw new Error(`Unknown id ${id}`);
      return s;
    },
    dispose(): void {},
  };
}

// ---------------------------------------------------------------------------
// Driver fixtures
// ---------------------------------------------------------------------------

const TICK_DT = 1 / 60;

function makeFrame(
  tick: number,
  robots: ReadonlyArray<{ active: number; x: number; y: number; z: number; yaw: number }>,
): PoseFrame {
  const data = new Float32Array(robots.length * POSE_STRIDE);
  for (let id = 0; id < robots.length; id++) {
    const base = id * POSE_STRIDE;
    data[base] = robots[id].active;
    data[base + 1] = robots[id].x;
    data[base + 2] = robots[id].y;
    data[base + 3] = robots[id].z;
    data[base + 4] = robots[id].yaw;
  }
  return { tick, data };
}

function makeLinearResult(opts?: {
  ticks?: number;
  robotCount?: number;
  events?: TimelineEvent[];
  finishOrder?: number[];
  winnerId?: number | null;
}): SimResult {
  const ticks = opts?.ticks ?? 6;
  const robotCount = opts?.robotCount ?? 3;
  const poseFrames: PoseFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    poseFrames.push(
      makeFrame(
        t,
        Array.from({ length: robotCount }, (_, id) => ({
          active: 1,
          x: id + t,
          y: 0.5,
          z: id * 0.25,
          yaw: 0,
        })),
      ),
    );
  }
  return {
    ticks,
    events: opts?.events ?? [],
    poseFrames,
    finishOrder: opts?.finishOrder ?? [],
    winnerId: opts?.winnerId ?? null,
  };
}

function makeDriver(result: SimResult): SimDriver {
  return createSimDriver({ result });
}

// ---------------------------------------------------------------------------
// Fake rAF + clock
// ---------------------------------------------------------------------------

interface ScriptedClock {
  raf: (cb: FrameRequestCallback) => number;
  cancelRaf: (id: number) => void;
  now: () => number;
  /** Advance the clock by `dtMs` and fire one queued rAF callback. */
  step(dtMs: number): void;
  /** Number of currently-queued rAF callbacks. */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSimRendererBridge — pose writes', () => {
  it('writes interpolated poses to RobotInstance.root each tick', () => {
    const renderer = makeFakeRenderer(3);
    const switcher = makeFakeSwitcher(3);
    const driver = makeDriver(makeLinearResult({ ticks: 6, robotCount: 3 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });

    bridge.start();
    clock.step(0); // first tick consumes the timestamp without advancing
    clock.step(TICK_DT * 1000); // advance 1 tick worth

    const inst0 = renderer.getAllInstances()[0];
    const inst1 = renderer.getAllInstances()[1];
    // Robot 0 at tick 1 → x = 0 + 1 = 1; robot 1 at tick 1 → x = 2.
    expect(inst0.root.position.x).toBeCloseTo(1, 5);
    expect(inst1.root.position.x).toBeCloseTo(2, 5);
    expect(inst0.root.position.y).toBeCloseTo(0.5, 5);
    expect(inst1.root.position.z).toBeCloseTo(0.25, 5);
  });

  it('skips robots whose ids fall outside the SimResult', () => {
    // Renderer has 5 instances; sim only knows about 3. The bridge should
    // leave instance 3/4 untouched (still at default (0,0,0)).
    const renderer = makeFakeRenderer(5);
    const switcher = makeFakeSwitcher(5);
    const driver = makeDriver(makeLinearResult({ ticks: 6, robotCount: 3 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });

    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 1000);

    const insts = renderer.getAllInstances();
    expect(insts[3].root.position.x).toBe(0);
    expect(insts[4].root.position.x).toBe(0);
    expect(insts[0].root.position.x).toBeCloseTo(1, 5); // proves the bridge ran
    bridge.dispose();
  });

  it('applies the GLB-vs-sim forward-axis offset (+π/2) to rotation.y', () => {
    // The sim's pose.yaw = 0 means "facing +X"; the GLB is authored facing
    // +Z. The bridge must absorb the +π/2 offset or robots run sideways
    // (zero offset) or backwards (-π/2 offset).
    const f0 = makeFrame(0, [{ active: 1, x: 0, y: 0, z: 0, yaw: 0 }]);
    const f1 = makeFrame(1, [{ active: 1, x: 1, y: 0, z: 0, yaw: 0 }]);
    const result: SimResult = {
      ticks: 2,
      events: [],
      poseFrames: [f0, f1],
      finishOrder: [],
      winnerId: null,
    };
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(result);
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 1000);

    // pose.yaw = 0 + offset (+π/2) → rotation.y ≈ 1.5708.
    expect(renderer.getAllInstances()[0].root.rotation.y).toBeCloseTo(Math.PI / 2, 6);

    // A sim yaw of -π/2 should land at exactly 0 in world rotation.
    const f2 = makeFrame(0, [{ active: 1, x: 0, y: 0, z: 0, yaw: -Math.PI / 2 }]);
    const f3 = makeFrame(1, [{ active: 1, x: 0, y: 0, z: 0, yaw: -Math.PI / 2 }]);
    const result2: SimResult = {
      ticks: 2,
      events: [],
      poseFrames: [f2, f3],
      finishOrder: [],
      winnerId: null,
    };
    const renderer2 = makeFakeRenderer(1);
    const switcher2 = makeFakeSwitcher(1);
    const driver2 = makeDriver(result2);
    const clock2 = makeScriptedClock();
    const bridge2 = createSimRendererBridge({
      renderer: renderer2,
      switcher: switcher2,
      driver: driver2,
      raf: clock2.raf,
      cancelRaf: clock2.cancelRaf,
      now: clock2.now,
    });
    bridge2.start();
    clock2.step(0);
    clock2.step(TICK_DT * 1000);
    expect(renderer2.getAllInstances()[0].root.rotation.y).toBeCloseTo(0, 6);

    bridge.dispose();
    bridge2.dispose();
  });

  it('clamps large dt jumps to MAX_DT_SECONDS (tab-throttle protection)', () => {
    // Step a 5-second jump in one frame. Driver should advance only by
    // 0.1 s (MAX_DT). With a 6-tick result at 1/60 s, the driver needs
    // 6/60 = 0.1 s exactly to hit the end. So one clamped step should
    // land us right at the final frame.
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(makeLinearResult({ ticks: 6, robotCount: 1 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });

    bridge.start();
    clock.step(0);
    clock.step(5000); // 5 seconds — would otherwise rocket past the end

    expect(driver.getTimeSeconds()).toBeCloseTo(0.1, 6);
    expect(driver.isDone()).toBe(true);
    bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Event → animation state mapping
// ---------------------------------------------------------------------------

describe('createSimRendererBridge — event → animation state', () => {
  it('puts every robot into "run" on simStart', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 42, arenaId: 'test', rosterSize: 3 },
    ];
    const renderer = makeFakeRenderer(3);
    const switcher = makeFakeSwitcher(3, 'idle');
    const driver = makeDriver(makeLinearResult({ ticks: 6, robotCount: 3, events }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0); // first frame: timestamp init, no driver advance
    clock.step(TICK_DT * 1000); // advance enough to fire tick-0 events

    expect(switcher.current(0)).toBe('run');
    expect(switcher.current(1)).toBe('run');
    expect(switcher.current(2)).toBe('run');
    bridge.dispose();
  });

  it('puts an eliminated robot into "death" and leaves others alone', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 3 },
      { type: 'elimination', tick: 1, robotId: 1, reason: 'gate_a_closed' },
    ];
    const renderer = makeFakeRenderer(3);
    const switcher = makeFakeSwitcher(3, 'idle');
    const driver = makeDriver(makeLinearResult({ ticks: 6, robotCount: 3, events }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 2 * 1000); // through tick 1

    expect(switcher.current(0)).toBe('run');
    expect(switcher.current(1)).toBe('death');
    expect(switcher.current(2)).toBe('run');
    bridge.dispose();
  });

  it('puts the finishing robot into "idle" on a finish event', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 3 },
      { type: 'finish', tick: 2, robotId: 0, place: 1 },
    ];
    const renderer = makeFakeRenderer(3);
    const switcher = makeFakeSwitcher(3, 'idle');
    const driver = makeDriver(
      makeLinearResult({ ticks: 6, robotCount: 3, events, finishOrder: [0], winnerId: 0 }),
    );
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 3 * 1000);

    expect(switcher.current(0)).toBe('idle');
    expect(switcher.current(1)).toBe('run');
    expect(switcher.current(2)).toBe('run');
    bridge.dispose();
  });

  it('moves still-running robots to "idle" on simEnd; dead robots stay dead', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 3 },
      { type: 'elimination', tick: 1, robotId: 1, reason: 'gate_a_closed' },
      { type: 'finish', tick: 2, robotId: 0, place: 1 },
      { type: 'simEnd', tick: 2, winnerId: 0, reason: 'eventDone' },
    ];
    const renderer = makeFakeRenderer(3);
    const switcher = makeFakeSwitcher(3, 'idle');
    const driver = makeDriver(
      makeLinearResult({ ticks: 6, robotCount: 3, events, finishOrder: [0], winnerId: 0 }),
    );
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 4 * 1000);

    expect(switcher.current(0)).toBe('idle'); // finished — already idle
    expect(switcher.current(1)).toBe('death'); // eliminated — stays dead
    expect(switcher.current(2)).toBe('idle'); // still running → simEnd → idle
    bridge.dispose();
  });

  it('does not call setState if the robot is already in the target state', () => {
    // simStart fires while every robot is already 'run' — should be no-op.
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 2 },
    ];
    const renderer = makeFakeRenderer(2);
    const switcher = makeFakeSwitcher(2, 'run'); // already in 'run'
    const driver = makeDriver(makeLinearResult({ ticks: 4, robotCount: 2, events }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 1000);

    expect(switcher.setStateCalls).toHaveLength(0);
    bridge.dispose();
  });

  it('forwards events to opts.onEvent AFTER applying state changes', () => {
    const events: TimelineEvent[] = [
      { type: 'elimination', tick: 1, robotId: 0, reason: 'race_over' },
    ];
    const renderer = makeFakeRenderer(2);
    const switcher = makeFakeSwitcher(2, 'run');
    const driver = makeDriver(makeLinearResult({ ticks: 4, robotCount: 2, events }));
    const clock = makeScriptedClock();
    const seenStates: RobotAnimationState[] = [];

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
      onEvent: (e) => {
        if (e.type === 'elimination') {
          // By the time this hook fires, switcher.current should reflect
          // the new state. This is the contract camera + UI rely on.
          seenStates.push(switcher.current(e.robotId));
        }
      },
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 2 * 1000);

    expect(seenStates).toEqual(['death']);
    bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: start / stop / dispose
// ---------------------------------------------------------------------------

describe('createSimRendererBridge — lifecycle', () => {
  it('start() schedules a rAF; stop() cancels it; isRunning reflects state', () => {
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(makeLinearResult({ robotCount: 1 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });

    expect(bridge.isRunning()).toBe(false);
    bridge.start();
    expect(bridge.isRunning()).toBe(true);
    expect(clock.pending()).toBe(1);
    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it('start() is idempotent — calling twice does not double-schedule', () => {
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(makeLinearResult({ robotCount: 1 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    bridge.start();
    expect(clock.pending()).toBe(1);
    bridge.dispose();
  });

  it('dispose() unsubscribes from the driver — later events do not call setState', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 1 },
      { type: 'elimination', tick: 1, robotId: 0, reason: 'race_over' },
    ];
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1, 'idle');
    const driver = makeDriver(makeLinearResult({ ticks: 4, robotCount: 1, events }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 1000); // tick-0 simStart fires → 'run'

    bridge.dispose();
    const callsBefore = switcher.setStateCalls.length;

    // Now drive the underlying driver directly — bridge should be deaf.
    driver.update(TICK_DT * 5);

    expect(switcher.setStateCalls.length).toBe(callsBefore);
  });

  it('start() after dispose() throws', () => {
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(makeLinearResult({ robotCount: 1 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.dispose();
    expect(() => bridge.start()).toThrow(/disposed/i);
  });

  it('dispose() is idempotent', () => {
    const renderer = makeFakeRenderer(1);
    const switcher = makeFakeSwitcher(1);
    const driver = makeDriver(makeLinearResult({ robotCount: 1 }));
    const clock = makeScriptedClock();

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.dispose();
    expect(() => bridge.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism: bridge does not introduce non-determinism
// ---------------------------------------------------------------------------

describe('createSimRendererBridge — determinism', () => {
  it('does not call Math.random', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 't', rosterSize: 2 },
      { type: 'elimination', tick: 1, robotId: 1, reason: 'gate_a_closed' },
      { type: 'simEnd', tick: 2, winnerId: 0, reason: 'eventDone' },
    ];
    const renderer = makeFakeRenderer(2);
    const switcher = makeFakeSwitcher(2);
    const driver = makeDriver(
      makeLinearResult({ ticks: 4, robotCount: 2, events, finishOrder: [0], winnerId: 0 }),
    );
    const clock = makeScriptedClock();
    const spy = vi.spyOn(Math, 'random');

    const bridge = createSimRendererBridge({
      renderer,
      switcher,
      driver,
      raf: clock.raf,
      cancelRaf: clock.cancelRaf,
      now: clock.now,
    });
    bridge.start();
    clock.step(0);
    clock.step(TICK_DT * 1000);
    clock.step(TICK_DT * 1000);
    clock.step(TICK_DT * 1000);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    bridge.dispose();
  });
});
