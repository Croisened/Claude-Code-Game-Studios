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

  /**
   * Find the leader's full (x, z). The leader is the highest-X active
   * instance; the lateral z is read so the camera tracks lane drift
   * (separation force, future lane-change AI). Without z tracking, a
   * leader that drifts off-axis appears at frame edges instead of
   * centered.
   */
  function findLeaderXZ(): { x: number; z: number } {
    const instances = renderer.getAllInstances();
    if (instances.length === 0) return { x: 0, z: 0 };
    let maxX = -Infinity;
    let leaderZ = 0;
    for (const inst of instances) {
      const x = inst.root.position.x;
      if (x > maxX) {
        maxX = x;
        leaderZ = inst.root.position.z;
      }
    }
    // Edge case: empty roster or all positions at NaN. Fall back to
    // current camera placement so we don't drift to garbage values.
    if (!Number.isFinite(maxX)) return { x: camera.position.x, z: 0 };
    return { x: maxX, z: leaderZ };
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

    const { x: leaderX, z: leaderZ } = findLeaderXZ();
    const targetCameraX = leaderX + cfg.aheadOffsetX;
    const targetCameraZ = leaderZ + cfg.offsetZ;

    camera.position.y = cfg.offsetY;

    if (!initialised) {
      // First-frame snap: jump straight to the configured framing to
      // avoid a long ease-in from the original placeholder origin.
      camera.position.x = targetCameraX;
      camera.position.z = targetCameraZ;
      initialised = true;
    } else if (dt > 0) {
      const alpha = 1 - Math.exp(-cfg.lerpRatePerSecond * dt);
      camera.position.x += (targetCameraX - camera.position.x) * alpha;
      camera.position.z += (targetCameraZ - camera.position.z) * alpha;
    }

    // lookAt sits at a fixed offset from the LEADER (not the camera) so
    // the framing stays constant as the race progresses. Tracking leader
    // z keeps the leader laterally centered even when separation force
    // pushes them off the arena centerline.
    lookAtTarget.set(leaderX + cfg.lookAtAheadX, cfg.lookAtY, leaderZ);
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
