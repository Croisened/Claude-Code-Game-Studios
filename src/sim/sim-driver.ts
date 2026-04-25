/**
 * Sim Driver (S6-01) — bridges a recorded `SimResult` to a real-time
 * playback clock. The headless sim runs at a fixed 60 Hz tick rate; the
 * browser's render loop targets 60 fps but jitters. The driver does the
 * mapping:
 *   - per-frame, advance an internal clock by `dtSeconds`
 *   - linearly interpolate `RobotPose` between adjacent `PoseFrame`s
 *   - dispatch `TimelineEvent`s to subscribers when their `tick` is crossed
 *
 * Three.js-agnostic. Renderer wire-up (S6-02) reads `getPose` per frame,
 * subscribes via `onEvent`, and forwards animation-state-relevant events
 * (elimination → death, finish/simEnd → idle) to the Animation State
 * Switcher.
 *
 * Determinism contract:
 *   Given the same `SimResult` and the same `update(dt)` sequence, the
 *   emitted event order and every `getPose` reading are byte-identical.
 *   No `Math.random`, no clock reads, no timers.
 */

import { CONFIG } from '@/config';
import { POSE_STRIDE, type PoseFrame, type SimResult, type TimelineEvent } from '@/sim/engine';

export interface InterpolatedPose {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export type TimelineEventHandler = (event: TimelineEvent) => void;

export interface SimDriver {
  /**
   * Advance the playback clock by `dtSeconds`. Fires every timeline event
   * whose `tick` boundary was crossed during this delta, in stored order.
   * No-op when paused. Negative `dtSeconds` throws.
   */
  update(dtSeconds: number): void;
  /**
   * Linear-interpolated pose for `robotId` at the current playback time.
   * Returns the same internally-owned object on every call (mutated in
   * place) to avoid per-frame allocation. Copy if you need to retain.
   * Returns `undefined` for unknown ids or before any frames exist.
   */
  getPose(robotId: number): InterpolatedPose | undefined;
  /** Playback time in seconds since the sim started. */
  getTimeSeconds(): number;
  /** Current integer tick (floor of `time / tickDt`), clamped to `[0, totalTicks-1]`. */
  getCurrentTick(): number;
  /** Total ticks recorded in the underlying `SimResult`. */
  getTotalTicks(): number;
  /** Tick duration in seconds (1 / `CONFIG.sim.tickRateHz` by default). */
  getTickDtSeconds(): number;
  /** True once playback has passed the final tick (no more events to fire). */
  isDone(): boolean;
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  /**
   * Reset to t=0. Pending event queue restored. Subscribed handlers stay
   * subscribed. Pause state preserved (restart while paused stays paused).
   */
  restart(): void;
  /** Subscribe to timeline events. Returns an unsubscribe function. */
  onEvent(handler: TimelineEventHandler): () => void;
  /** Underlying sim result, exposed read-only for inspection (finishOrder, etc). */
  getSimResult(): SimResult;
}

export interface SimDriverOptions {
  readonly result: SimResult;
  /**
   * Tick duration in seconds. Defaults to `1 / CONFIG.sim.tickRateHz`.
   * The driver does not store `tickRateHz` — only the resulting dt — so
   * the engine and driver rate stay coupled at the boundary.
   */
  readonly tickDtSeconds?: number;
}

/**
 * Construct a Sim Driver from a completed `SimResult`. Fails fast if the
 * result has no recorded pose frames (i.e., `runSim` was called with
 * `recordPoseFrames: false`).
 */
export function createSimDriver(opts: SimDriverOptions): SimDriver {
  const { result } = opts;
  const tickDt = opts.tickDtSeconds ?? 1 / CONFIG.sim.tickRateHz;

  if (tickDt <= 0) {
    throw new Error(`SimDriver: tickDtSeconds must be positive (got ${tickDt})`);
  }
  if (result.poseFrames.length === 0) {
    throw new Error(
      'SimDriver: SimResult has no poseFrames. Run sim with recordPoseFrames=true.',
    );
  }

  const frames = result.poseFrames;
  const events = result.events;
  const totalTicks = result.ticks;
  // The engine snapshots after each tick advance, so every frame in
  // `poseFrames` is one stride wide. Use the first frame as the canonical
  // robot count for bounds checking.
  const robotCount = Math.floor(frames[0].data.length / POSE_STRIDE);

  let timeSec = 0;
  let paused = false;
  let nextEventIdx = 0;
  const handlers = new Set<TimelineEventHandler>();

  // Reusable pose object — mutated in place per `getPose` call. Renderer
  // and camera consume the values immediately and don't retain references,
  // so a single shared object eliminates per-frame allocation.
  const poseScratch: InterpolatedPose = { active: false, x: 0, y: 0, z: 0, yaw: 0 };

  function dispatchEventsThroughTick(tickInclusive: number): void {
    while (nextEventIdx < events.length && events[nextEventIdx].tick <= tickInclusive) {
      const ev = events[nextEventIdx];
      nextEventIdx += 1;
      // Snapshot handlers so an unsubscribe during dispatch doesn't skip
      // remaining handlers in this round.
      const snapshot = Array.from(handlers);
      for (const h of snapshot) h(ev);
    }
  }

  function update(dtSeconds: number): void {
    if (dtSeconds < 0) {
      throw new Error(`SimDriver.update: dtSeconds must be non-negative (got ${dtSeconds})`);
    }
    if (paused || dtSeconds === 0) {
      // First-frame edge: even at dt=0, dispatch any tick-0 events that
      // are still queued. This lets a freshly-created driver flush
      // `simStart` before time has actually advanced. After the first
      // dt=0 call, nextEventIdx has moved past tick-0 events and further
      // dt=0 calls become true no-ops.
      if (!paused) {
        const tick = Math.min(Math.floor(timeSec / tickDt), totalTicks - 1);
        dispatchEventsThroughTick(tick);
      }
      return;
    }

    timeSec += dtSeconds;
    const tick = Math.min(Math.floor(timeSec / tickDt), totalTicks - 1);
    dispatchEventsThroughTick(tick);
  }

  function getPose(robotId: number): InterpolatedPose | undefined {
    if (robotId < 0 || robotId >= robotCount) return undefined;

    const tickFloat = timeSec / tickDt;
    const lastFrameIdx = frames.length - 1;
    let aIdx: number;
    let bIdx: number;
    let alpha: number;

    if (tickFloat <= 0) {
      aIdx = 0;
      bIdx = 0;
      alpha = 0;
    } else if (tickFloat >= lastFrameIdx) {
      aIdx = lastFrameIdx;
      bIdx = lastFrameIdx;
      alpha = 0;
    } else {
      aIdx = Math.floor(tickFloat);
      bIdx = aIdx + 1;
      alpha = tickFloat - aIdx;
    }

    const a = frames[aIdx];
    const b = frames[bIdx];
    const base = robotId * POSE_STRIDE;

    const aActive = a.data[base];
    const aX = a.data[base + 1];
    const aY = a.data[base + 2];
    const aZ = a.data[base + 3];
    const aYaw = a.data[base + 4];

    const bX = b.data[base + 1];
    const bY = b.data[base + 2];
    const bZ = b.data[base + 3];
    const bYaw = b.data[base + 4];

    // Active is a step function on the source frame: a robot is alive
    // through the [tickN, tickN+1) interpolation window if it was alive
    // at frame N's snapshot. The renderer's death-animation crossfade
    // is driven by `elimination` events (timed precisely at tick
    // boundaries), not by polling this flag.
    poseScratch.active = aActive >= 0.5;
    poseScratch.x = aX + (bX - aX) * alpha;
    poseScratch.y = aY + (bY - aY) * alpha;
    poseScratch.z = aZ + (bZ - aZ) * alpha;
    poseScratch.yaw = lerpAngleShortestPath(aYaw, bYaw, alpha);
    return poseScratch;
  }

  function getCurrentTick(): number {
    if (timeSec <= 0) return 0;
    return Math.min(Math.floor(timeSec / tickDt), totalTicks - 1);
  }

  function isDone(): boolean {
    return timeSec >= totalTicks * tickDt;
  }

  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
  }

  function restart(): void {
    timeSec = 0;
    nextEventIdx = 0;
  }

  function onEvent(handler: TimelineEventHandler): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  return {
    update,
    getPose,
    getTimeSeconds: () => timeSec,
    getCurrentTick,
    getTotalTicks: () => totalTicks,
    getTickDtSeconds: () => tickDt,
    isDone,
    isPaused: () => paused,
    pause,
    resume,
    restart,
    onEvent,
    getSimResult: () => result,
  };
}

/**
 * Linear interpolate two angles along the shortest arc on the unit circle.
 * `a` and `b` are radians. Result is in `[a + diff*alpha]` where `diff` is
 * normalized into `(-π, π]`. Pure; no `Math.random`.
 */
function lerpAngleShortestPath(a: number, b: number, alpha: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * alpha;
}
