/**
 * Follow-Leader Camera (S6-03 spike).
 *
 * Tracks the leader of a sprint race — the active robot with the highest
 * world-X position. Keeps a fixed Y/Z offset (the spectator-side angle
 * established by the Sprint 4 placeholder camera) and slides along world
 * +X to stay framed on the front of the pack.
 *
 * Smoothing: per-frame, the camera's X position eases toward the leader's
 * X using a frame-rate-independent exponential lerp:
 *   alpha = 1 - exp(-CONFIG.camera.follow.lerpRatePerSecond * dt)
 *   cam.x += (target - cam.x) * alpha
 * This converges geometrically; doubling dt halves the remaining gap
 * twice rather than once. No snapping at any framerate.
 *
 * Determinism: the camera reads `inst.root.position.x` from the renderer
 * each frame. Those positions are written by the Sim ↔ Renderer Bridge
 * (S6-02) from a deterministic `SimResult`, so the camera's per-frame
 * "leader" choice is deterministic given a fixed `update(dt)` sequence.
 * The camera adds no randomness of its own.
 *
 * Scope (v1 spike):
 * - Single mode: Follow Leader.
 * - "Leader" = max world-X across all renderer instances. Sprint races
 *   are forward-only, so dead robots' frozen positions can never exceed
 *   the live leader's; no active-flag check is needed.
 * - No target switching, no fixed presets, no Follow ID — those land
 *   when the full S6-03 Camera System GDD is authored.
 *
 * The full Camera System GDD (Follow Leader / Fixed / Follow ID, plus
 * cull-stage target switching) supersedes this file when it lands.
 */
import * as THREE from 'three';
import { CONFIG } from '@/config';
import type { Renderer } from '@/renderer/renderer';

/** Clamps tab-throttle skip-ahead — matches renderer + bridge convention. */
const MAX_DT_SECONDS = 0.1;

export interface FollowLeaderCameraOptions {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: Renderer;
  /** Test seam: rAF impl. Defaults to `globalThis.requestAnimationFrame`. */
  readonly raf?: (cb: FrameRequestCallback) => number;
  /** Test seam: cancelAnimationFrame impl. */
  readonly cancelRaf?: (id: number) => void;
  /** Test seam: monotonic clock returning ms. Defaults to `performance.now`. */
  readonly now?: () => number;
}

export interface FollowLeaderCamera {
  /** Begin the rAF tracking loop. Idempotent. Throws after dispose. */
  start(): void;
  /** Cancel the rAF loop without disposing. */
  stop(): void;
  isRunning(): boolean;
  /** Cancel and detach. Idempotent. Does NOT dispose the underlying camera. */
  dispose(): void;
}

export function createFollowLeaderCamera(
  opts: FollowLeaderCameraOptions,
): FollowLeaderCamera {
  const { camera, renderer } = opts;
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

  const cfg = CONFIG.camera.follow;

  let rafId: number | null = null;
  let lastTimeMs: number | null = null;
  let disposed = false;
  // Pre-allocated lookAt target — avoids per-frame `Vector3` allocation.
  const lookAtTarget = new THREE.Vector3();
  let initialised = false;

  function findLeaderX(): number {
    const instances = renderer.getAllInstances();
    if (instances.length === 0) return 0;
    let maxX = -Infinity;
    for (const inst of instances) {
      const x = inst.root.position.x;
      if (x > maxX) maxX = x;
    }
    // Edge case: empty roster or all positions at NaN. Fall back to current
    // camera x so we don't slide to -Infinity.
    if (!Number.isFinite(maxX)) return camera.position.x;
    return maxX;
  }

  function tick(): void {
    if (disposed) return;
    rafId = raf(tick);

    const t = now();
    if (lastTimeMs === null) {
      lastTimeMs = t;
      return;
    }
    const dt = Math.min((t - lastTimeMs) / 1000, MAX_DT_SECONDS);
    lastTimeMs = t;

    const leaderX = findLeaderX();

    // Lock Y / Z to the configured offset so the spectator angle stays
    // constant — only X tracks the leader.
    camera.position.y = cfg.offsetY;
    camera.position.z = cfg.offsetZ;

    if (!initialised) {
      // First-frame snap: jump to the leader to avoid a long ease-in
      // from the original placeholder X (0).
      camera.position.x = leaderX;
      initialised = true;
    } else if (dt > 0) {
      const alpha = 1 - Math.exp(-cfg.lerpRatePerSecond * dt);
      camera.position.x += (leaderX - camera.position.x) * alpha;
    }

    lookAtTarget.set(camera.position.x, cfg.lookAtY, 0);
    camera.lookAt(lookAtTarget);
  }

  function start(): void {
    if (disposed) throw new Error('FollowLeaderCamera disposed');
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
  }

  return { start, stop, isRunning, dispose };
}
