/**
 * Sim ↔ Renderer Bridge (S6-02) — connects the Sim Driver's playback to
 * the 85-instance renderer's per-instance transforms and the Animation
 * State Switcher's per-instance state.
 *
 * Per-frame work:
 *   1. Advance the driver clock by real-time `dt`.
 *   2. For each renderer-owned `RobotInstance`, write the driver's
 *      interpolated pose to `inst.root.position` (x/y/z) and
 *      `inst.root.rotation.y` (yaw).
 *
 * Event-driven work (subscribed via `driver.onEvent` at construction):
 *   - `simStart`         → all robots → `'run'`.
 *   - `elimination`      → robot `event.robotId` → `'death'`.
 *   - `finish`           → robot `event.robotId` → `'idle'` (winner cools down).
 *   - `simEnd`           → any still-running robots → `'idle'`. Eliminated
 *                          robots stay in `'death'` (already crossfaded).
 *
 * The bridge owns its own `requestAnimationFrame` loop. It does not modify
 * the renderer's loop. The renderer continues to call `mixer.update(dt)`
 * and `render()` independently. With both loops in flight, in-frame
 * ordering is determined by registration order: the bridge starts AFTER
 * `renderer.mount()` resolves, so the renderer's rAF is registered first
 * and runs first each frame. The bridge's pose writes therefore arrive in
 * time for the next frame's render — a 1-frame visual latency we accept
 * for v1. Eliminating the latency requires a render-loop hook the renderer
 * does not yet expose; tracked as a v1.x polish item.
 *
 * Forbidden patterns observed:
 *   - The renderer's "Direct mutation of `RobotInstance.root.position` from
 *     non-sim code" rule is satisfied: the bridge IS sim code (the
 *     authoritative writer of per-tick instance pose, with the driver as
 *     its data source).
 *   - The Animation State Switcher's "sole owner of `play()` / `crossFadeTo()`"
 *     rule is satisfied: the bridge calls `switcher.setState()` only.
 */
import type { Renderer } from '@/renderer/renderer';
import type { AnimationStateSwitcher } from '@/animation/state-switcher';
import type { SimDriver } from '@/sim/sim-driver';
import type { TimelineEvent } from '@/sim/engine';

/** Matches the renderer's MAX_DT — clamps tab-throttle skip-ahead. */
const MAX_DT_SECONDS = 0.1;

/**
 * Asset-vs-sim coordinate convention reconciliation.
 *
 * The robot GLBs are authored facing world +Z (Blender's default forward
 * for character exports). The Sim Engine Core GDD §3 R3 defines `yaw = 0`
 * as "facing +X" (`buildStartPoses` puts every robot at yaw=0 and the
 * sprint race module advances motion along +X). Without this offset,
 * robots run sideways with their faces toward the camera.
 *
 * Three.js `rotation.y` is counter-clockwise viewed from +Y. Rotating an
 * object whose front-face is +Z by `+π/2` lands its front on +X. (A
 * `-π/2` offset would rotate it to -X — i.e., running backwards along
 * the motion vector.)
 *
 * This is the only correct location for the offset. The sim is
 * coordinate-system-agnostic by design; the asset convention is fixed by
 * the GLB; the bridge is the boundary where both meet.
 */
const ASSET_FORWARD_YAW_OFFSET = Math.PI / 2;

export interface SimRendererBridgeOptions {
  readonly renderer: Renderer;
  readonly switcher: AnimationStateSwitcher;
  readonly driver: SimDriver;
  /** Test seam: rAF impl. Defaults to `globalThis.requestAnimationFrame`. */
  readonly raf?: (cb: FrameRequestCallback) => number;
  /** Test seam: cancelAnimationFrame impl. */
  readonly cancelRaf?: (id: number) => void;
  /** Test seam: monotonic clock returning ms. Defaults to `performance.now`. */
  readonly now?: () => number;
  /**
   * Optional pass-through for non-animation event consumers (camera, UI).
   * Fires AFTER the bridge has applied the corresponding switcher state
   * change so downstream consumers see consistent world+animation state.
   */
  readonly onEvent?: (event: TimelineEvent) => void;
}

export interface SimRendererBridge {
  /** Begin the rAF loop. Idempotent. Throws after dispose. */
  start(): void;
  /** Cancel the rAF loop. Pose writes stop; the driver is not paused. */
  stop(): void;
  isRunning(): boolean;
  /**
   * Cancel the loop and unsubscribe from the driver. Idempotent.
   * Does NOT dispose the underlying renderer, switcher, or driver.
   */
  dispose(): void;
}

export function createSimRendererBridge(opts: SimRendererBridgeOptions): SimRendererBridge {
  const { renderer, switcher, driver } = opts;
  const raf =
    opts.raf ??
    ((cb: FrameRequestCallback) => {
      if (typeof globalThis.requestAnimationFrame !== 'function') {
        throw new Error('requestAnimationFrame is not available in this environment');
      }
      return globalThis.requestAnimationFrame(cb);
    });
  const cancelRaf =
    opts.cancelRaf ??
    ((id: number) => {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(id);
      }
    });
  const now =
    opts.now ??
    (() => {
      if (typeof globalThis.performance?.now === 'function') {
        return globalThis.performance.now();
      }
      return Date.now();
    });

  const instances = renderer.getAllInstances();

  let rafId: number | null = null;
  let lastTimeMs: number | null = null;
  let disposed = false;

  function applyEvent(event: TimelineEvent): void {
    if (disposed) return;
    switch (event.type) {
      case 'simStart': {
        for (const inst of instances) {
          if (switcher.current(inst.id) !== 'run') {
            switcher.setState(inst.id, 'run');
          }
        }
        break;
      }
      case 'elimination': {
        if (switcher.current(event.robotId) !== 'death') {
          switcher.setState(event.robotId, 'death');
        }
        break;
      }
      case 'finish': {
        if (switcher.current(event.robotId) !== 'idle') {
          switcher.setState(event.robotId, 'idle');
        }
        break;
      }
      case 'simEnd': {
        for (const inst of instances) {
          if (switcher.current(inst.id) === 'run') {
            switcher.setState(inst.id, 'idle');
          }
        }
        break;
      }
      // No `default`: the TimelineEvent union is closed and exhaustively
      // handled above. New event types will surface as TS errors here.
    }
  }

  const unsubscribe = driver.onEvent((event) => {
    applyEvent(event);
    opts.onEvent?.(event);
  });

  function tick(): void {
    if (disposed) return;
    rafId = raf(tick);

    const t = now();
    if (lastTimeMs === null) {
      // First frame after start(): consume the timestamp without advancing
      // the driver. Avoids a large dt on the very first sample if the
      // browser has been idle.
      lastTimeMs = t;
      return;
    }
    const dt = Math.min((t - lastTimeMs) / 1000, MAX_DT_SECONDS);
    lastTimeMs = t;

    if (dt > 0) {
      driver.update(dt);
    }

    for (const inst of instances) {
      const pose = driver.getPose(inst.id);
      if (!pose) continue;
      inst.root.position.set(pose.x, pose.y, pose.z);
      inst.root.rotation.y = pose.yaw + ASSET_FORWARD_YAW_OFFSET;
    }
  }

  function start(): void {
    if (disposed) throw new Error('SimRendererBridge disposed');
    if (rafId !== null) return;
    lastTimeMs = null;
    rafId = raf(tick);
  }

  function stop(): void {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    lastTimeMs = null;
  }

  function isRunning(): boolean {
    return rafId !== null;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stop();
    unsubscribe();
  }

  return { start, stop, isRunning, dispose };
}
