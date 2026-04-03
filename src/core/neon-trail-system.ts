/**
 * Neon Trail System
 *
 * Renders a fading position-queue trail behind the robot during Running state.
 * Pre-allocates a fixed pool of quad meshes — zero allocations in the game loop.
 *
 * Each frame the robot's current position is pushed into a ring buffer.
 * Quads are repositioned and their opacity scaled from 0 (newest) to MAX_OPACITY
 * (oldest) so the trail appears to evaporate in the robot's wake.
 *
 * Sprint 3 — S3-04
 */

import * as THREE from 'three';
import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';

// ── Config ────────────────────────────────────────────────────────────────────

const TRAIL_SEGMENTS    = 14;       // number of quads in the trail
const TRAIL_QUAD_W      = 0.09;     // width of each quad (units)
const TRAIL_QUAD_H      = 0.28;     // height of each quad (units)
const TRAIL_COLOR       = 0x00f0ff; // neon cyan
const TRAIL_MAX_OPACITY = 0.55;     // opacity of the newest (closest) segment
const TRAIL_Y_OFFSET    = 0.6;      // Y offset above robot origin (robot feet = 0)
const TRAIL_Z_SPACING   = 0.18;     // Z offset between segments (world units behind robot)

// ── NeonTrailSystem ───────────────────────────────────────────────────────────

export class NeonTrailSystem {
  private _active: boolean = false;

  private readonly _quads:       THREE.Mesh[];
  private readonly _positions:   THREE.Vector3[]; // ring buffer
  private          _head:        number = 0;      // ring buffer write index
  private          _filled:      number = 0;      // how many slots have real data

  private readonly _gsmListener: (e: StateChangedEvent) => void;

  constructor(
    private readonly _scene: THREE.Scene,
    private readonly _robot: THREE.Object3D,
    private readonly _gsm:   GameStateManager,
  ) {
    this._quads     = this._buildPool();
    this._positions = Array.from({ length: TRAIL_SEGMENTS }, () => new THREE.Vector3());
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Sample robot position and update trail quads.
   * Call once per frame after runnerSystem.update().
   * No-op when not in Running state.
   */
  update(): void {
    if (!this._active) return;

    // Push current robot position into ring buffer — track actual Y so trail
    // stays attached during jumps
    this._positions[this._head].set(
      this._robot.position.x,
      this._robot.position.y + TRAIL_Y_OFFSET,
      this._robot.position.z,
    );
    this._head   = (this._head + 1) % TRAIL_SEGMENTS;
    this._filled = Math.min(this._filled + 1, TRAIL_SEGMENTS);

    // Reposition and fade each quad
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const quad = this._quads[i];

      if (i >= this._filled) {
        quad.visible = false;
        continue;
      }

      // Index into ring buffer: slot 0 is newest (head - 1), last is oldest
      const bufIdx = (this._head - 1 - i + TRAIL_SEGMENTS) % TRAIL_SEGMENTS;
      const pos    = this._positions[bufIdx];

      quad.position.set(pos.x, pos.y, pos.z + i * TRAIL_Z_SPACING);
      quad.visible = true;

      // Opacity: newest (i=0) is TRAIL_MAX_OPACITY, fades to 0 at the tail
      const t = this._filled > 1 ? i / (this._filled - 1) : 0;
      (quad.material as THREE.MeshBasicMaterial).opacity = (1 - t) * TRAIL_MAX_OPACITY;
    }
  }

  /** Remove all listeners and trail meshes. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    for (const quad of this._quads) {
      this._scene.remove(quad);
      quad.geometry.dispose();
      (quad.material as THREE.Material).dispose();
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _buildPool(): THREE.Mesh[] {
    const geo  = new THREE.PlaneGeometry(TRAIL_QUAD_W, TRAIL_QUAD_H);
    const quads: THREE.Mesh[] = [];

    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const mat  = new THREE.MeshBasicMaterial({
        color:       TRAIL_COLOR,
        transparent: true,
        opacity:     0,
        depthWrite:  false,
        side:        THREE.DoubleSide,
      });
      const quad = new THREE.Mesh(geo, mat);
      quad.visible = false;
      // Park off-screen until the trail fills
      quad.position.set(0, TRAIL_Y_OFFSET, -1000);
      this._scene.add(quad);
      quads.push(quad);
    }

    return quads;
  }

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      this._head   = 0;
      this._filled = 0;
      this._active = true;
      return;
    }

    if (to === GameState.Dead || to === GameState.ScoreScreen || to === GameState.MainMenu) {
      this._active = false;
      for (const quad of this._quads) quad.visible = false;
    }
  }
}
