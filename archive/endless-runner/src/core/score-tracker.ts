/**
 * Score & Distance Tracker
 *
 * Accumulates distance (meters) during Running state. Locks the value on
 * Dead, evaluates against the personal best, and persists the new personal
 * best to localStorage. Exposes live distance for the HUD and final score
 * for the Death Screen.
 *
 * localStorage keys:
 *   neon_fugitive_pb_[tokenId]  — wallet connected
 *   neon_fugitive_pb_guest      — no wallet
 *
 * localStorage failures are caught and silently ignored.
 *
 * GDD: design/gdd/score-and-distance-tracker.md
 */

import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { SCORE_TRACKER_CONFIG, type ScoreTrackerConfig } from '../config/score-tracker.config';

const GUEST_KEY = 'neon_fugitive_pb_guest';

// ── ScoreTracker ──────────────────────────────────────────────────────────────

export class ScoreTracker {
  /** Live distance traveled in the current run (meters). Reads 0 between runs. */
  get distance(): number { return this._distance; }

  /** Distance at the moment of death. 0 until the run ends. */
  get finalScore(): number { return this._finalScore; }

  /** All-time personal best for the active token / guest (meters). */
  get personalBest(): number { return this._personalBest; }

  /** True if the last run beat the previous personal best. */
  get isNewPersonalBest(): boolean { return this._isNewPb; }

  private _distance:    number  = 0;
  private _finalScore:  number  = 0;
  private _personalBest: number = 0;
  private _isNewPb:     boolean = false;
  private _active:      boolean = false;
  private _tokenId:     string | null = null;

  private readonly _gsmListener: (e: StateChangedEvent) => void;

  constructor(
    private readonly _gsm:    GameStateManager,
    private readonly _config: ScoreTrackerConfig = SCORE_TRACKER_CONFIG,
  ) {
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Accumulate distance for this frame.
   * Call once per frame from the game loop, passing Runner System's currentSpeed.
   * No-op when not in Running state.
   * @param forwardSpeed - units/s from Runner System
   * @param deltaMs      - milliseconds since last frame
   */
  update(forwardSpeed: number, deltaMs: number): void {
    if (!this._active) return;
    const delta = Math.min(deltaMs * 0.001, this._config.deltaClamp);
    this._distance += forwardSpeed * delta;
  }

  /**
   * Set the active token ID for localStorage keying.
   * Call when wallet connects; pass null to revert to guest key.
   */
  setTokenId(tokenId: string | null): void {
    this._tokenId = tokenId;
  }

  /** Remove all GSM listeners. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      this._distance    = 0;
      this._finalScore  = 0;
      this._isNewPb     = false;
      this._personalBest = this._loadPersonalBest();
      this._active      = true;
      return;
    }

    if (to === GameState.Dead) {
      this._active     = false;
      this._finalScore = Math.floor(this._distance);
      if (this._finalScore > 0 && this._finalScore > this._personalBest) {
        this._isNewPb      = true;
        this._personalBest = this._finalScore;
        this._savePersonalBest(this._personalBest);
      }
    }
  }

  private _pbKey(): string {
    return this._tokenId ? `neon_fugitive_pb_${this._tokenId}` : GUEST_KEY;
  }

  private _loadPersonalBest(): number {
    try {
      const raw = localStorage.getItem(this._pbKey());
      if (raw === null) return 0;
      const val = parseInt(raw, 10);
      return Number.isFinite(val) && val >= 0 ? val : 0;
    } catch {
      return 0;
    }
  }

  private _savePersonalBest(value: number): void {
    try {
      localStorage.setItem(this._pbKey(), String(value));
    } catch {
      // localStorage unavailable — silently continue
    }
  }
}
