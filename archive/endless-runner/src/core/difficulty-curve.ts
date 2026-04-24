/**
 * Difficulty Curve
 *
 * Drives run difficulty by monitoring distance and applying speed + spawn
 * interval to RunnerSystem and ObstacleSystem when the player crosses a
 * stage threshold.
 *
 * Subscribes to GSM: resets stage index on Running; pauses on Dead/MainMenu.
 * Calls rs.setSpeed() and os.setSpawnInterval() — never writes positions directly.
 *
 * GDD: design/gdd/difficulty-curve.md
 */

import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type RunnerSystem } from './runner-system';
import { type ObstacleSystem } from './obstacle-system';
import { type ScoreTracker } from './score-tracker';
import { DIFFICULTY_CURVE_CONFIG, type DifficultyCurveConfig } from '../config/difficulty-curve.config';

export class DifficultyCurve {
  private _active       = false;
  private _stageIndex   = 0;

  private readonly _gsmListener: (e: StateChangedEvent) => void;

  constructor(
    private readonly _rs:     RunnerSystem,
    private readonly _os:     ObstacleSystem,
    private readonly _tracker: ScoreTracker,
    private readonly _gsm:    GameStateManager,
    private readonly _config: DifficultyCurveConfig = DIFFICULTY_CURVE_CONFIG,
  ) {
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  /**
   * Advance difficulty check. Call once per frame from the game loop.
   * No-op when not in Running state.
   */
  update(): void {
    if (!this._active) return;

    const { stages } = this._config;
    const distance   = this._tracker.distance;

    // Walk forward through stages — never rewind.
    while (
      this._stageIndex < stages.length - 1 &&
      distance >= stages[this._stageIndex + 1].distanceM
    ) {
      this._stageIndex++;
      this._applyStage(this._stageIndex);
    }
  }

  /** Unsubscribe from GSM. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    if (event.to === GameState.Running) {
      this._stageIndex = 0;
      this._active     = true;
      this._applyStage(0); // apply stage 0 immediately at run start
      return;
    }

    if (
      event.to === GameState.Dead    ||
      event.to === GameState.MainMenu
    ) {
      this._active = false;
    }
  }

  private _applyStage(index: number): void {
    const stage = this._config.stages[index];
    this._rs.setSpeed(stage.speed);
    this._os.setSpawnInterval(stage.spawnInterval);

    if (import.meta.env.DEV) {
      console.log(
        `[DifficultyCurve] Stage ${index} @ ${stage.distanceM}m — ` +
        `speed: ${stage.speed} u/s, spawnInterval: ${stage.spawnInterval}s`,
      );
    }
  }
}
