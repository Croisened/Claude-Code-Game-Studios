/**
 * Winner Camera — composes a "victory portrait" framing around the
 * winning robot and the orange finish tree at race-end. Auto-activates
 * when the maze sim finishes; the user can override it from the
 * top-right CAM toggle (Arena button or Robot # input).
 *
 * Framing:
 *   - Compute the midpoint between the winner's world position and the
 *     tree's trunk position.
 *   - Place the camera at a fixed offset (8.5 right, 5.5 up, -8.5 back)
 *     from that midpoint — a 3/4 angle that lets both subjects share
 *     the frame.
 *   - LookAt is the same midpoint biased upward so the tree's canopy
 *     reads as the dominant silhouette.
 *
 * First-frame snap means there is NO transition lerp from whatever
 * camera came before (typically the static arena cam at distance ~200m).
 * The cut is intentional — it punctuates the race ending and lets the
 * info card resolve into place over a stable shot.
 *
 * Re-reads winner pose every frame so the camera tracks any tail-end
 * idle drift / snap-to-cell-center; in practice the winner's pose is
 * frozen post-finish so the tracking is essentially static.
 */
import * as THREE from 'three';
import type { Renderer } from '@/renderer/renderer';

const MAX_DT_SECONDS = 0.1;

// Camera offset from the winner+tree midpoint. The X/Z magnitudes are
// equal so the camera sits at 45° to the world axis — angle independent
// of which entrance the winner came from. Y lifts the camera above the
// canopy top so it isn't looking up through leaves.
const CAM_OFFSET_X = 8.5;
const CAM_OFFSET_Y = 6.0;
const CAM_OFFSET_Z = -8.5;
/** LookAt y-bias above the midpoint — pushes the canopy near frame-center. */
const LOOK_AT_Y_BIAS = 2.5;
/** Lerp rate. Low so any drift toward the final pose feels deliberate. */
const LERP_RATE = 3.0;

export interface WinnerCameraOptions {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: Renderer;
  readonly winnerRobotId: number;
  readonly treeWorldPos: { readonly x: number; readonly z: number };
  readonly raf?: (cb: FrameRequestCallback) => number;
  readonly cancelRaf?: (id: number) => void;
  readonly now?: () => number;
}

export interface WinnerCamera {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  dispose(): void;
}

export function createWinnerCamera(opts: WinnerCameraOptions): WinnerCamera {
  const { camera, renderer, winnerRobotId, treeWorldPos } = opts;

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

  function findWinnerInstance() {
    const instances = renderer.getAllInstances();
    for (const inst of instances) {
      if (inst.id === winnerRobotId) return inst;
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

    const winnerInst = findWinnerInstance();
    if (!winnerInst) return; // unknown id; leave camera where it is
    const winnerX = winnerInst.root.position.x;
    const winnerY = winnerInst.root.position.y;
    const winnerZ = winnerInst.root.position.z;

    // Midpoint between winner foot position and tree trunk base. Both
    // subjects sit on the ground (y ≈ 0), so the midpoint Y is whatever
    // the winner's y is — typically 0.
    const midX = (winnerX + treeWorldPos.x) / 2;
    const midZ = (winnerZ + treeWorldPos.z) / 2;
    const midY = winnerY;

    const desiredCamX = midX + CAM_OFFSET_X;
    const desiredCamY = midY + CAM_OFFSET_Y;
    const desiredCamZ = midZ + CAM_OFFSET_Z;

    if (!initialised || dt <= 0) {
      camera.position.set(desiredCamX, desiredCamY, desiredCamZ);
      initialised = true;
    } else {
      const alpha = 1 - Math.exp(-LERP_RATE * dt);
      camera.position.x += (desiredCamX - camera.position.x) * alpha;
      camera.position.y += (desiredCamY - camera.position.y) * alpha;
      camera.position.z += (desiredCamZ - camera.position.z) * alpha;
    }

    lookAtTarget.set(midX, midY + LOOK_AT_Y_BIAS, midZ);
    camera.lookAt(lookAtTarget);

    // Override the winner's rotation each frame so they face the
    // camera instead of whatever direction they happened to be moving
    // when they finished. The bridge writes `inst.root.rotation.y` from
    // the (frozen) sim pose every frame; this loop runs after the
    // bridge's rAF — registered later — so our write wins for the
    // current frame's render.
    //
    // Three.js: object rotated by rotation.y = θ has world forward
    // (sin θ, 0, cos θ). To point at the camera, set θ such that
    // (sin θ, cos θ) ∝ (camera.x - winner.x, camera.z - winner.z).
    // That's `θ = atan2(dx, dz)`. The bridge applies an asset offset
    // of +π/2 to compensate for the GLB's authored +Z forward; we
    // bypass that here because we're computing the final rotation.y
    // directly, not a pose.yaw.
    const dx = camera.position.x - winnerX;
    const dz = camera.position.z - winnerZ;
    if (dx * dx + dz * dz > 1e-6) {
      winnerInst.root.rotation.y = Math.atan2(dx, dz);
    }
  }

  function start(): void {
    if (disposed) throw new Error('WinnerCamera disposed');
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
