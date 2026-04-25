/**
 * Robot Shoulder Camera — over-the-shoulder 3rd-person follow for a
 * specific robot id. Sits behind and slightly above the robot, looking
 * ahead in the robot's facing direction. Position lerps each frame so
 * sharp corners (especially in maze-race) don't snap the framing.
 *
 * Forward-direction math:
 *   The bridge writes `inst.root.rotation.y = pose.yaw + π/2` to align
 *   the GLB (authored facing +Z) with the sim's yaw=0 → +X convention.
 *   In three.js, an object whose local +Z is its visual forward, after
 *   rotation.y = θ, faces world (sin θ, 0, cos θ). We use that directly
 *   so the camera is always behind the rendered robot regardless of
 *   asset/sim convention drift.
 *
 * Determinism: like the leader-follow camera, the shoulder camera reads
 * positions written by the deterministic Sim ↔ Renderer Bridge each
 * frame. The camera adds no randomness; only its lerp depends on real
 * `dt`, which is intentional (frame-rate-independent smoothing).
 */
import * as THREE from 'three';
import type { Renderer } from '@/renderer/renderer';

const MAX_DT_SECONDS = 0.1;

// Defaults — tuned to sit above maze wall tops (1.6m) with comfortable
// margin so the camera can never clip through a wall, with a gentle
// downward tilt and slow follow on turns. Camera-to-lookAt vector is
// (back + lookAhead, height - lookAtY) = (14, -4), giving ≈16° down.
const DEFAULT_BACK_DISTANCE = 5.0;
const DEFAULT_HEIGHT = 5.0;
const DEFAULT_LOOK_AHEAD = 9.0;
const DEFAULT_LOOK_AT_Y = 1.0;
const DEFAULT_LERP_RATE = 3.5;

export interface RobotShoulderCameraOptions {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: Renderer;
  /** Robot id to follow. Out-of-range ids park the camera at the origin. */
  readonly targetRobotId: number;
  /** Distance behind the robot along its facing direction. */
  readonly backDistance?: number;
  /** Height above the ground plane. */
  readonly height?: number;
  /** Distance ahead of the robot for the lookAt point. */
  readonly lookAhead?: number;
  /** Y-offset of the lookAt point (eye-level for the robot). */
  readonly lookAtY?: number;
  /** Position-tracking smoothing rate, in 1/seconds. */
  readonly lerpRatePerSecond?: number;
  /** Test seam: rAF impl. */
  readonly raf?: (cb: FrameRequestCallback) => number;
  readonly cancelRaf?: (id: number) => void;
  readonly now?: () => number;
}

export interface RobotShoulderCamera {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  dispose(): void;
}

export function createRobotShoulderCamera(
  opts: RobotShoulderCameraOptions,
): RobotShoulderCamera {
  const { camera, renderer, targetRobotId } = opts;
  const backDistance = opts.backDistance ?? DEFAULT_BACK_DISTANCE;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const lookAhead = opts.lookAhead ?? DEFAULT_LOOK_AHEAD;
  const lookAtY = opts.lookAtY ?? DEFAULT_LOOK_AT_Y;
  const lerpRate = opts.lerpRatePerSecond ?? DEFAULT_LERP_RATE;

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

  let rafId: number | null = null;
  let lastTimeMs: number | null = null;
  let disposed = false;
  let initialised = false;
  const lookAtTarget = new THREE.Vector3();
  // Smoothed forward direction (XZ plane). When the robot snaps 90° at
  // a maze junction, instant forward jumps; this smoothed vector lerps
  // toward it, dragging the camera's behind-pose around the turn slowly
  // instead of teleporting. Same exponential rate as position lerp so
  // the orbit-around-the-turn and the trail-along-the-corridor feel
  // coherent as one camera move.
  let smoothFx = 0;
  let smoothFz = 1;

  function findInstance(): { x: number; y: number; z: number; rotY: number } | null {
    const instances = renderer.getAllInstances();
    for (const inst of instances) {
      if (inst.id === targetRobotId) {
        return {
          x: inst.root.position.x,
          y: inst.root.position.y,
          z: inst.root.position.z,
          rotY: inst.root.rotation.y,
        };
      }
    }
    return null;
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

    const target = findInstance();
    if (!target) return; // unknown id; leave camera where it is

    // Three.js Y-rotation θ applied to a +Z-forward object yields world
    // forward (sin θ, 0, cos θ). The robot's GLB is authored facing +Z
    // and the bridge applies rotation.y = pose.yaw + π/2.
    const fX = Math.sin(target.rotY);
    const fZ = Math.cos(target.rotY);

    if (!initialised) {
      // First-frame snap on both position AND orientation so we don't
      // lerp in from arena-cam's vantage or last-known smoothFx/Fz.
      smoothFx = fX;
      smoothFz = fZ;
    } else if (dt > 0) {
      const fAlpha = 1 - Math.exp(-lerpRate * dt);
      smoothFx += (fX - smoothFx) * fAlpha;
      smoothFz += (fZ - smoothFz) * fAlpha;
      // Renormalize to a unit vector so backDistance / lookAhead stay
      // consistent magnitudes; without this, the smoothed forward shrinks
      // when the two unit forwards are far apart (mid-turn).
      const len = Math.sqrt(smoothFx * smoothFx + smoothFz * smoothFz);
      if (len > 1e-6) {
        smoothFx /= len;
        smoothFz /= len;
      }
    }

    const desiredCamX = target.x - smoothFx * backDistance;
    const desiredCamY = target.y + height;
    const desiredCamZ = target.z - smoothFz * backDistance;

    if (!initialised || dt <= 0) {
      camera.position.set(desiredCamX, desiredCamY, desiredCamZ);
      initialised = true;
    } else {
      const alpha = 1 - Math.exp(-lerpRate * dt);
      camera.position.x += (desiredCamX - camera.position.x) * alpha;
      camera.position.y += (desiredCamY - camera.position.y) * alpha;
      camera.position.z += (desiredCamZ - camera.position.z) * alpha;
    }

    // LookAt uses the same smoothed forward, so the view direction eases
    // into the new heading at the same rate as the camera body. The
    // robot itself stays roughly framed because its world position is
    // read directly each frame (no smoothing).
    lookAtTarget.set(
      target.x + smoothFx * lookAhead,
      target.y + lookAtY,
      target.z + smoothFz * lookAhead,
    );
    camera.lookAt(lookAtTarget);
  }

  function start(): void {
    if (disposed) throw new Error('RobotShoulderCamera disposed');
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
