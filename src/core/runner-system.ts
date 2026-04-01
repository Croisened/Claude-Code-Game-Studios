/**
 * Runner System
 *
 * Owns the robot's in-run locomotion: lane position (X), jump arc (Y via
 * simulated gravity), slide state, and forward speed. Subscribes to GSM
 * for enable/disable; subscribes to InputSystem for actions; drives
 * EnvironmentRenderer scroll speed every tick.
 *
 * Physics note (TODO S1-08+): Lane changes and jump currently write directly
 * to robotObject3D.position. When Rapier bodies are wired to scene objects,
 * replace with setTranslation() / applyImpulse() calls and remove the manual
 * gravity accumulator (_yVelocity).
 *
 * GDD: design/gdd/runner-system.md
 */

import * as THREE from 'three';
import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type InputSystem, InputAction } from './input-system';
import { type EnvironmentRenderer, LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';

const RUNNER_LANES = [LANE_LEFT, LANE_CENTER, LANE_RIGHT] as const;
import { RUNNER_SYSTEM_CONFIG, type RunnerSystemConfig } from '../config/runner-system.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CollisionDetectedListener = () => void;
export type JumpListener              = () => void;
export type LaneChangeListener        = () => void;

export const enum LocomotionState {
  Standing = 'Standing',
  Jumping  = 'Jumping',
  Sliding  = 'Sliding',
}

// ── RunnerSystem ──────────────────────────────────────────────────────────────

export class RunnerSystem {
  /** Current forward speed (units/s). Read by Audio System for wind intensity. */
  get currentSpeed(): number { return this._currentSpeed; }

  /** True while the robot is in the Sliding locomotion state. Read by ObstacleSystem for AABB collision. */
  get isSliding(): boolean { return this._locomotionState === LocomotionState.Sliding; }

  private _locomotionState: LocomotionState = LocomotionState.Standing;
  private _currentSpeed:    number          = 0;
  private _currentLane:     number          = LANE_CENTER;
  private _yVelocity:       number          = 0; // simulated; replaced by Rapier in future
  private _collisionFired:  boolean         = false;
  private _active:          boolean         = false;
  private _slideTimer:      ReturnType<typeof setTimeout> | null = null;

  private readonly _collisionListeners:  Set<CollisionDetectedListener> = new Set();
  private readonly _jumpListeners:       Set<JumpListener>              = new Set();
  private readonly _laneChangeListeners: Set<LaneChangeListener>        = new Set();

  // Bound references for add/remove symmetry
  private readonly _gsmListener:   (e: StateChangedEvent) => void;
  private readonly _inputListener: (action: InputAction) => void;

  constructor(
    private readonly _robot:  THREE.Object3D,
    private readonly _er:     EnvironmentRenderer,
    private readonly _gsm:    GameStateManager,
    private readonly _input:  InputSystem,
    private readonly _config: RunnerSystemConfig = RUNNER_SYSTEM_CONFIG,
  ) {
    this._gsmListener   = this._onStateChanged.bind(this);
    this._inputListener = this._onAction.bind(this);

    this._gsm.on(this._gsmListener);
    this._input.on(this._inputListener);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Advance locomotion and speed. Call once per frame from the game loop.
   * No-op when not in Running state.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    if (!this._active) return;

    const delta = Math.min(deltaMs * 0.001, this._config.deltaClamp);

    // Speed is set externally by DifficultyCurve via setSpeed().
    this._er.setScrollSpeed(this._currentSpeed);

    // ── Jump / gravity ────────────────────────────────────────────────────────
    if (this._locomotionState === LocomotionState.Jumping) {
      this._yVelocity -= this._config.gravity * delta;
      this._robot.position.y += this._yVelocity * delta;

      // Landing detection
      if (this._robot.position.y <= this._config.groundY + this._config.landingEpsilon) {
        this._robot.position.y = this._config.groundY;
        this._yVelocity        = 0;
        this._locomotionState  = LocomotionState.Standing;
      }
    }
  }

  /**
   * Override the current speed. Called by Difficulty Curve in v1.
   * Negative values are clamped to 0.
   */
  setSpeed(speed: number): void {
    if (speed < 0) {
      if (import.meta.env.DEV) {
        console.warn(`[RunnerSystem] setSpeed(${speed}) clamped to 0`);
      }
      this._currentSpeed = 0;
      return;
    }
    this._currentSpeed = Math.min(speed, this._config.maxSpeed);
  }

  /**
   * Register a listener for the collisionDetected event.
   * Fired at most once per run.
   */
  onCollisionDetected(listener: CollisionDetectedListener): void {
    this._collisionListeners.add(listener);
  }

  /** Remove a previously registered collisionDetected listener. */
  offCollisionDetected(listener: CollisionDetectedListener): void {
    this._collisionListeners.delete(listener);
  }

  /** Register a listener fired when a jump input is accepted. */
  onJump(listener: JumpListener): void {
    this._jumpListeners.add(listener);
  }

  /** Remove a previously registered jump listener. */
  offJump(listener: JumpListener): void {
    this._jumpListeners.delete(listener);
  }

  /** Register a listener fired when a lane change succeeds. */
  onLaneChange(listener: LaneChangeListener): void {
    this._laneChangeListeners.add(listener);
  }

  /** Remove a previously registered lane change listener. */
  offLaneChange(listener: LaneChangeListener): void {
    this._laneChangeListeners.delete(listener);
  }

  /**
   * Call when the robot's Rapier collider contacts an obstacle collider.
   * Safe to call multiple times — fires the event only once per run.
   */
  notifyCollision(): void {
    if (this._collisionFired || !this._active) return;
    this._collisionFired = true;
    for (const listener of this._collisionListeners) {
      try { listener(); } catch (err) {
        console.error('[RunnerSystem] collisionDetected listener threw:', err);
      }
    }
  }

  /** Remove all listeners and unsubscribe from GSM/InputSystem. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    this._input.off(this._inputListener);
    this._clearSlideTimer();
    this._collisionListeners.clear();
    this._jumpListeners.clear();
    this._laneChangeListeners.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      // Reset all state for a fresh run
      this._robot.position.x = LANE_CENTER;
      this._robot.position.y = this._config.groundY;
      this._currentLane      = LANE_CENTER;
      this._yVelocity        = 0;
      this._locomotionState  = LocomotionState.Standing;
      this._collisionFired   = false;
      this._currentSpeed     = this._config.initialScrollSpeed;
      this._clearSlideTimer();
      this._active = true;
      this._input.enable();
      return;
    }

    if (to === GameState.Dead || to === GameState.MainMenu) {
      this._active = false;
      this._input.disable();
      this._clearSlideTimer();
    }
  }

  private _onAction(action: InputAction): void {
    if (!this._active) return;

    switch (action) {
      case InputAction.LaneLeft:  this._tryLaneChange(-1); break;
      case InputAction.LaneRight: this._tryLaneChange(+1); break;
      case InputAction.Jump:      this._tryJump();         break;
      case InputAction.Slide:     this._trySlide();        break;
    }
  }

  private _tryLaneChange(direction: -1 | 1): void {
    const idx  = RUNNER_LANES.indexOf(this._currentLane as typeof RUNNER_LANES[number]);
    const next = idx + direction;
    if (next < 0 || next >= RUNNER_LANES.length) return; // at boundary — ignore

    this._currentLane      = RUNNER_LANES[next];
    this._robot.position.x = this._currentLane;
    for (const l of this._laneChangeListeners) { try { l(); } catch (e) { console.error(e); } }
  }

  private _tryJump(): void {
    if (this._locomotionState === LocomotionState.Jumping) return; // no double-jump

    if (this._locomotionState === LocomotionState.Sliding) {
      this._cancelSlide(); // JUMP cancels slide first
    }

    this._yVelocity       = this._config.jumpForce;
    this._locomotionState = LocomotionState.Jumping;
    for (const l of this._jumpListeners) { try { l(); } catch (e) { console.error(e); } }
  }

  private _trySlide(): void {
    if (this._locomotionState !== LocomotionState.Standing) return; // airborne or already sliding

    this._locomotionState = LocomotionState.Sliding;
    this._slideTimer = setTimeout(() => {
      this._slideTimer      = null;
      this._locomotionState = LocomotionState.Standing;
    }, this._config.slideDuration);
  }

  private _cancelSlide(): void {
    this._clearSlideTimer();
    this._locomotionState = LocomotionState.Standing;
  }

  private _clearSlideTimer(): void {
    if (this._slideTimer !== null) {
      clearTimeout(this._slideTimer);
      this._slideTimer = null;
    }
  }
}
