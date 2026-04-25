import { describe, it, expect, vi } from 'vitest';
import {
  createSimDriver,
  type InterpolatedPose,
  type TimelineEventHandler,
} from '@/sim/sim-driver';
import { POSE_STRIDE, type PoseFrame, type SimResult, type TimelineEvent } from '@/sim/engine';

// ---------------------------------------------------------------------------
// Fixture builders — small, fully synthetic SimResults
// ---------------------------------------------------------------------------

const TICK_DT = 1 / 60;
const HALF_DT = TICK_DT / 2;

interface FixtureRobot {
  active: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function makeFrame(tick: number, robots: ReadonlyArray<FixtureRobot>): PoseFrame {
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

/** Linear-motion fixture: robot `id` is at x = id + tick on tick `tick`. */
function makeLinearResult(opts?: {
  ticks?: number;
  robotCount?: number;
  events?: TimelineEvent[];
  finishOrder?: number[];
  winnerId?: number | null;
}): SimResult {
  const ticks = opts?.ticks ?? 4;
  const robotCount = opts?.robotCount ?? 3;
  const poseFrames: PoseFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    poseFrames.push(
      makeFrame(
        t,
        Array.from({ length: robotCount }, (_, id) => ({
          active: 1,
          x: id + t,
          y: 0,
          z: id * 0.5,
          yaw: 0,
        })),
      ),
    );
  }
  const events: TimelineEvent[] = opts?.events ?? [
    { type: 'simStart', tick: 0, seed: 42, arenaId: 'test', rosterSize: robotCount },
    {
      type: 'simEnd',
      tick: ticks - 1,
      winnerId: opts?.winnerId ?? 0,
      reason: 'eventDone',
    },
  ];
  return {
    ticks,
    events,
    poseFrames,
    finishOrder: opts?.finishOrder ?? [0],
    winnerId: opts?.winnerId ?? 0,
  };
}

function copyPose(p: InterpolatedPose): InterpolatedPose {
  return { active: p.active, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('createSimDriver — construction', () => {
  it('throws when SimResult has no poseFrames', () => {
    const result: SimResult = {
      ticks: 0,
      events: [],
      poseFrames: [],
      finishOrder: [],
      winnerId: null,
    };
    expect(() => createSimDriver({ result })).toThrow(/no poseFrames/i);
  });

  it('throws on non-positive tickDtSeconds', () => {
    const result = makeLinearResult();
    expect(() => createSimDriver({ result, tickDtSeconds: 0 })).toThrow(/positive/i);
    expect(() => createSimDriver({ result, tickDtSeconds: -0.01 })).toThrow(/positive/i);
  });

  it('reports the configured tick dt and total tick count', () => {
    const result = makeLinearResult({ ticks: 7 });
    const driver = createSimDriver({ result, tickDtSeconds: 0.02 });
    expect(driver.getTickDtSeconds()).toBe(0.02);
    expect(driver.getTotalTicks()).toBe(7);
  });

  it('defaults tickDtSeconds to 1 / CONFIG.sim.tickRateHz', () => {
    const result = makeLinearResult();
    const driver = createSimDriver({ result });
    // 60 Hz default — assert the round-trip rather than the literal.
    expect(driver.getTickDtSeconds()).toBeCloseTo(1 / 60, 12);
  });
});

// ---------------------------------------------------------------------------
// Pose interpolation
// ---------------------------------------------------------------------------

describe('SimDriver.getPose — interpolation', () => {
  it('returns the exact frame-0 pose at t=0', () => {
    const driver = createSimDriver({ result: makeLinearResult() });
    const p = driver.getPose(2);
    expect(p).toBeDefined();
    expect(p!.x).toBe(2); // robot 2 at tick 0 → x = 2 + 0
    expect(p!.z).toBeCloseTo(1.0, 6);
    expect(p!.active).toBe(true);
  });

  it('lerps linearly halfway between adjacent frames', () => {
    const driver = createSimDriver({ result: makeLinearResult() });
    driver.update(HALF_DT); // half a tick into [tick 0, tick 1]
    const p = driver.getPose(0);
    expect(p!.x).toBeCloseTo(0.5, 5); // 0 + (1 - 0) * 0.5
  });

  it('clamps to the last frame past the end', () => {
    const result = makeLinearResult({ ticks: 3 });
    const driver = createSimDriver({ result });
    driver.update(TICK_DT * 100); // way past the end
    const p = driver.getPose(1);
    // Last frame is tick 2 → robot 1 at x = 1 + 2 = 3
    expect(p!.x).toBeCloseTo(3, 5);
  });

  it('returns undefined for out-of-range robot ids', () => {
    const driver = createSimDriver({ result: makeLinearResult({ robotCount: 3 }) });
    expect(driver.getPose(-1)).toBeUndefined();
    expect(driver.getPose(3)).toBeUndefined();
    expect(driver.getPose(99)).toBeUndefined();
  });

  it('interpolates yaw along the shortest arc across the ±π wrap', () => {
    // Robot 0 yaw flips from +3.0 to -3.0 between frames; shortest arc is
    // through ±π, not through 0. At alpha=0.5 we should be near ±π, not 0.
    const f0 = makeFrame(0, [{ active: 1, x: 0, y: 0, z: 0, yaw: 3.0 }]);
    const f1 = makeFrame(1, [{ active: 1, x: 0, y: 0, z: 0, yaw: -3.0 }]);
    const result: SimResult = {
      ticks: 2,
      events: [],
      poseFrames: [f0, f1],
      finishOrder: [],
      winnerId: null,
    };
    const driver = createSimDriver({ result });
    driver.update(HALF_DT);
    const p = driver.getPose(0)!;
    // diff = -3.0 - 3.0 = -6.0; normalized to (-π, π] → -6 + 2π ≈ 0.283
    // result = 3.0 + (-6 + 2π) * 0.5 = 3.0 + 0.1416 ≈ 3.1416 (≈ π)
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(0.01);
  });

  it('treats active as a step function on the source frame', () => {
    // tick 0: active=1, tick 1: active=0. Halfway through, source flag wins.
    const f0 = makeFrame(0, [{ active: 1, x: 0, y: 0, z: 0, yaw: 0 }]);
    const f1 = makeFrame(1, [{ active: 0, x: 1, y: 0, z: 0, yaw: 0 }]);
    const f2 = makeFrame(2, [{ active: 0, x: 1, y: 0, z: 0, yaw: 0 }]);
    const result: SimResult = {
      ticks: 3,
      events: [],
      poseFrames: [f0, f1, f2],
      finishOrder: [],
      winnerId: null,
    };
    const driver = createSimDriver({ result });
    driver.update(HALF_DT); // mid-window between tick 0 and tick 1
    expect(driver.getPose(0)!.active).toBe(true);
    driver.update(HALF_DT); // exactly at tick 1
    expect(driver.getPose(0)!.active).toBe(false);
  });

  it('returns the same internally-owned object across calls (no allocation)', () => {
    const driver = createSimDriver({ result: makeLinearResult() });
    const a = driver.getPose(0);
    const b = driver.getPose(0);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Time + tick accounting
// ---------------------------------------------------------------------------

describe('SimDriver — time and tick accounting', () => {
  it('advances getTimeSeconds and getCurrentTick monotonically', () => {
    const driver = createSimDriver({ result: makeLinearResult({ ticks: 10 }) });
    expect(driver.getTimeSeconds()).toBe(0);
    expect(driver.getCurrentTick()).toBe(0);
    driver.update(TICK_DT);
    expect(driver.getCurrentTick()).toBe(1);
    driver.update(TICK_DT * 2);
    expect(driver.getCurrentTick()).toBe(3);
  });

  it('clamps getCurrentTick to totalTicks - 1 past the end', () => {
    const driver = createSimDriver({ result: makeLinearResult({ ticks: 4 }) });
    driver.update(TICK_DT * 100);
    expect(driver.getCurrentTick()).toBe(3);
  });

  it('isDone returns true once playback passes the final tick', () => {
    const driver = createSimDriver({ result: makeLinearResult({ ticks: 4 }) });
    expect(driver.isDone()).toBe(false);
    driver.update(TICK_DT * 3.5);
    expect(driver.isDone()).toBe(false);
    driver.update(TICK_DT * 1);
    expect(driver.isDone()).toBe(true);
  });

  it('throws on negative dtSeconds', () => {
    const driver = createSimDriver({ result: makeLinearResult() });
    expect(() => driver.update(-0.001)).toThrow(/non-negative/i);
  });
});

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

describe('SimDriver — event dispatch', () => {
  it('fires tick-0 events on the first update call (even with dt=0)', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));
    driver.update(0);
    expect(heard).toHaveLength(1);
    expect(heard[0].type).toBe('simStart');
  });

  it('dispatches events in stored order as time advances past their tick', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'elimination', tick: 1, robotId: 0, reason: 'gate_a_closed' },
      { type: 'elimination', tick: 2, robotId: 1, reason: 'gate_b_closed' },
      { type: 'finish', tick: 3, robotId: 2, place: 1 },
      { type: 'simEnd', tick: 3, winnerId: 2, reason: 'eventDone' },
    ];
    const driver = createSimDriver({
      result: makeLinearResult({ ticks: 4, events, robotCount: 3, finishOrder: [2], winnerId: 2 }),
    });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));

    driver.update(TICK_DT * 0.5); // entered tick 0
    expect(heard.map((e) => e.type)).toEqual(['simStart']);

    driver.update(TICK_DT); // entered tick 1
    expect(heard.map((e) => e.type)).toEqual(['simStart', 'elimination']);

    driver.update(TICK_DT * 2.5); // entered tick 3
    expect(heard.map((e) => e.type)).toEqual([
      'simStart',
      'elimination',
      'elimination',
      'finish',
      'simEnd',
    ]);
  });

  it('fires simEnd events emitted at tick === result.ticks (one past the last frame)', () => {
    // Regression for S6-02 bug: the engine emits `simEnd` at
    // `tick = result.ticks` (one past the last poseFrame). The driver's
    // `getCurrentTick()` clamps to `totalTicks - 1` for UI purposes, but
    // event dispatch must use the unclamped tick or simEnd never fires.
    const ticks = 4;
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'simEnd', tick: ticks, winnerId: 0, reason: 'eventDone' },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ ticks, events }) });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));
    driver.update(TICK_DT * (ticks + 1)); // step past the end
    expect(heard.map((e) => e.type)).toEqual(['simStart', 'simEnd']);
  });

  it('preserves engine-emitted intra-tick ordering (eliminations before finishes)', () => {
    // Engine pushes eliminations first, then finishes within the same tick.
    // The driver must NOT re-sort.
    const events: TimelineEvent[] = [
      { type: 'elimination', tick: 1, robotId: 0, reason: 'race_over' },
      { type: 'finish', tick: 1, robotId: 1, place: 1 },
    ];
    const driver = createSimDriver({
      result: makeLinearResult({ ticks: 3, events }),
    });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));
    driver.update(TICK_DT * 1.5);
    expect(heard.map((e) => e.type)).toEqual(['elimination', 'finish']);
  });

  it('delivers the same event to multiple subscribers', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const a = vi.fn();
    const b = vi.fn();
    driver.onEvent(a);
    driver.onEvent(b);
    driver.update(TICK_DT);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('honors unsubscribe', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'simEnd', tick: 1, winnerId: null, reason: 'maxTicks' },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const heard: TimelineEvent[] = [];
    const unsubscribe = driver.onEvent((e) => heard.push(e));
    driver.update(TICK_DT * 0.5); // simStart fires
    unsubscribe();
    driver.update(TICK_DT * 1.5); // simEnd does NOT reach this handler
    expect(heard.map((e) => e.type)).toEqual(['simStart']);
  });

  it('handles unsubscribe during dispatch without skipping siblings', () => {
    // Two events at tick 0; handler A unsubscribes itself after the first.
    // Handler B must still receive both events.
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'elimination', tick: 0, robotId: 0, reason: 'instant' },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const heardB: TimelineEvent[] = [];
    let aCalls = 0;
    let unsubscribeA: (() => void) | null = null;
    unsubscribeA = driver.onEvent(() => {
      aCalls += 1;
      unsubscribeA?.();
    });
    driver.onEvent((e) => heardB.push(e));
    driver.update(TICK_DT);
    expect(aCalls).toBe(1);
    expect(heardB.map((e) => e.type)).toEqual(['simStart', 'elimination']);
  });
});

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

describe('SimDriver — pause / resume', () => {
  it('does not advance time or fire events while paused', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'simEnd', tick: 2, winnerId: null, reason: 'maxTicks' },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events, ticks: 3 }) });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));
    driver.update(TICK_DT * 0.5); // simStart fires
    driver.pause();
    expect(driver.isPaused()).toBe(true);
    driver.update(TICK_DT * 5); // ignored
    expect(driver.getTimeSeconds()).toBeCloseTo(TICK_DT * 0.5, 8);
    expect(heard.map((e) => e.type)).toEqual(['simStart']);
    driver.resume();
    driver.update(TICK_DT * 2); // crosses tick 2
    expect(heard.map((e) => e.type)).toEqual(['simStart', 'simEnd']);
  });
});

// ---------------------------------------------------------------------------
// Restart
// ---------------------------------------------------------------------------

describe('SimDriver — restart', () => {
  it('resets time and re-arms the event queue', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
      { type: 'simEnd', tick: 1, winnerId: null, reason: 'maxTicks' },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const heard: TimelineEvent[] = [];
    driver.onEvent((e) => heard.push(e));
    driver.update(TICK_DT * 5);
    expect(heard.map((e) => e.type)).toEqual(['simStart', 'simEnd']);

    driver.restart();
    expect(driver.getTimeSeconds()).toBe(0);
    expect(driver.getCurrentTick()).toBe(0);
    expect(driver.isDone()).toBe(false);

    driver.update(TICK_DT * 5);
    // Both events fire again — full replay.
    expect(heard.map((e) => e.type)).toEqual([
      'simStart',
      'simEnd',
      'simStart',
      'simEnd',
    ]);
  });

  it('preserves pause state across restart', () => {
    const driver = createSimDriver({ result: makeLinearResult() });
    driver.pause();
    driver.restart();
    expect(driver.isPaused()).toBe(true);
  });

  it('keeps subscribed handlers across restart', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 1, arenaId: 'a', rosterSize: 1 },
    ];
    const driver = createSimDriver({ result: makeLinearResult({ events }) });
    const handler: TimelineEventHandler = vi.fn();
    driver.onEvent(handler);
    driver.update(TICK_DT);
    driver.restart();
    driver.update(TICK_DT);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('SimDriver — determinism', () => {
  it('produces identical pose readings for identical update sequences', () => {
    const result = makeLinearResult({ ticks: 12, robotCount: 5 });
    const seq = [TICK_DT * 0.3, TICK_DT * 0.7, TICK_DT * 1.0, TICK_DT * 0.5, TICK_DT * 2.5];

    function trace(): string {
      const driver = createSimDriver({ result });
      const out: number[] = [];
      for (const dt of seq) {
        driver.update(dt);
        for (let id = 0; id < 5; id++) {
          const p = driver.getPose(id)!;
          out.push(p.x, p.y, p.z, p.yaw, p.active ? 1 : 0);
        }
      }
      return out.map((n) => n.toFixed(8)).join(',');
    }

    expect(trace()).toBe(trace());
  });

  it('produces identical event firings for identical update sequences', () => {
    const events: TimelineEvent[] = [
      { type: 'simStart', tick: 0, seed: 7, arenaId: 't', rosterSize: 3 },
      { type: 'elimination', tick: 1, robotId: 2, reason: 'gate_a_closed' },
      { type: 'elimination', tick: 2, robotId: 1, reason: 'gate_b_closed' },
      { type: 'finish', tick: 3, robotId: 0, place: 1 },
      { type: 'simEnd', tick: 3, winnerId: 0, reason: 'eventDone' },
    ];
    const result = makeLinearResult({ ticks: 4, robotCount: 3, events, finishOrder: [0], winnerId: 0 });
    const seq = [TICK_DT * 0.4, TICK_DT * 1.2, TICK_DT * 0.5, TICK_DT * 1.0, TICK_DT * 1.0];

    function trace(): string {
      const driver = createSimDriver({ result });
      const out: string[] = [];
      driver.onEvent((e) => out.push(`${e.type}@${e.tick}`));
      for (const dt of seq) driver.update(dt);
      return out.join('|');
    }

    expect(trace()).toBe(trace());
  });

  it('produces no Math.random calls', () => {
    const spy = vi.spyOn(Math, 'random');
    const driver = createSimDriver({ result: makeLinearResult() });
    driver.update(TICK_DT * 2);
    driver.getPose(0);
    driver.restart();
    driver.update(TICK_DT * 2);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// SimResult passthrough
// ---------------------------------------------------------------------------

describe('SimDriver — SimResult passthrough', () => {
  it('exposes the underlying SimResult', () => {
    const result = makeLinearResult({ winnerId: 2, finishOrder: [2, 0, 1] });
    const driver = createSimDriver({ result });
    expect(driver.getSimResult()).toBe(result);
    expect(driver.getSimResult().finishOrder).toEqual([2, 0, 1]);
  });
});
