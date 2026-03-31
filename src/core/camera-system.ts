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

  private _showcase = true; // start in showcase (MainMenu is first state)

  // Pre-allocated look-at target — reused every frame (zero per-frame allocation).
  private readonly _lookTarget = new THREE.Vector3();

  constructor(
    private readonly _robot:  THREE.Object3D,
    aspect:                   number = 16 / 9,
    private readonly _config: CameraSystemConfig = CAMERA_SYSTEM_CONFIG,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      _config.showcaseFov,
      aspect,
      _config.near,
      _config.far,
    );

    // Start in showcase position — no lerp lag on first frame.
    this.camera.position.set(_robot.position.x, _config.showcaseYOffset, _config.showcaseZOffset);
    this._updateLookAt();
  }

  /**
   * Switch between hero showcase mode (MainMenu / ScoreScreen) and gameplay mode.
   * The camera smoothly lerps to the target position on subsequent update() calls.
   *
   * @example
   * cameraSystem.setShowcase(true);  // MainMenu / ScoreScreen
   * cameraSystem.setShowcase(false); // Running
   */
  setShowcase(on: boolean): void {
    this._showcase = on;
    this.camera.fov = on ? this._config.showcaseFov : this._config.fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Advance camera follow. Call once per frame from the game loop.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    const delta = Math.min(deltaMs * 0.001, this._config.deltaClamp);

    if (this._showcase) {
      const lerp = this._config.showcaseLerpFactor * delta;
      this.camera.position.x += (this._robot.position.x - this.camera.position.x) * lerp;
      this.camera.position.y += (this._config.showcaseYOffset - this.camera.position.y) * lerp;
      this.camera.position.z += (this._config.showcaseZOffset - this.camera.position.z) * lerp;
    } else {
      const lerp = Math.max(this._config.xLerpFactor, 0.1) * delta;
      this.camera.position.x += (this._robot.position.x - this.camera.position.x) * lerp;
      this.camera.position.y += (this._config.yOffset - this.camera.position.y) * lerp;
      this.camera.position.z += (this._config.zOffset - this.camera.position.z) * lerp;
    }

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
    const lookAtY = this._showcase ? this._config.showcaseLookAtY : 0;
    const lookAtZ = this._showcase ? 0 : -this._config.lookAheadDistance;
    // Look-at X uses camera.position.x so the camera doesn't stare sideways during lanes.
    this._lookTarget.set(this.camera.position.x, lookAtY, lookAtZ);
    this.camera.lookAt(this._lookTarget);
  }
}
