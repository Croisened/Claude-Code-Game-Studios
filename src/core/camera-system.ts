/**
 * Camera System
 *
 * Owns the Three.js PerspectiveCamera. Follows the robot's X position with
 * configurable exponential lerp; Y and Z are fixed offsets. No GSM
 * subscription — runs unconditionally every frame.
 *
 * Call snapToRobot() on run restart to prevent a visible pan from the
 * previous run's camera position back to lane center.
 *
 * GDD: design/gdd/camera-system.md
 */

import * as THREE from 'three';
import { CAMERA_SYSTEM_CONFIG, type CameraSystemConfig } from '../config/camera-system.config';

export class CameraSystem {
  /** The managed camera. Pass to renderer.render() — do not reassign. */
  readonly camera: THREE.PerspectiveCamera;

  // Pre-allocated look-at target — reused every frame (zero per-frame allocation).
  private readonly _lookTarget = new THREE.Vector3();

  constructor(
    private readonly _robot:  THREE.Object3D,
    aspect:                   number = 16 / 9,
    private readonly _config: CameraSystemConfig = CAMERA_SYSTEM_CONFIG,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      _config.fov,
      aspect,
      _config.near,
      _config.far,
    );

    // Start positioned directly behind/above the robot with no lerp lag.
    this.camera.position.set(_robot.position.x, _config.yOffset, _config.zOffset);
    this._updateLookAt();
  }

  /**
   * Advance camera follow. Call once per frame from the game loop.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    const delta      = Math.min(deltaMs * 0.001, this._config.deltaClamp);
    const lerpFactor = Math.max(this._config.xLerpFactor, 0.1); // guard against 0

    // X follows robot with exponential lerp.
    this.camera.position.x +=
      (this._robot.position.x - this.camera.position.x) * lerpFactor * delta;

    // Y and Z are always fixed — reassign each frame to resist any drift.
    this.camera.position.y = this._config.yOffset;
    this.camera.position.z = this._config.zOffset;

    this._updateLookAt();
  }

  /**
   * Instantly snap camera X to the robot's current X.
   * Call on every run restart (ScoreScreen → Running) to prevent a visible
   * pan from the previous run's ending camera position.
   */
  snapToRobot(): void {
    this.camera.position.x = this._robot.position.x;
    this._updateLookAt();
  }

  /**
   * Update the camera aspect ratio after a window resize.
   * @param aspect - new width / height ratio
   */
  onResize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _updateLookAt(): void {
    // Look-at X uses camera.position.x (not robot.position.x) so the camera
    // does not appear to stare sideways during lane transitions.
    this._lookTarget.set(
      this.camera.position.x,
      0,
      -this._config.lookAheadDistance,
    );
    this.camera.lookAt(this._lookTarget);
  }
}
