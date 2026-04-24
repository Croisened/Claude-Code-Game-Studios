/**
 * Game State Manager
 *
 * Central authority on what the game is currently doing. Maintains a single
 * active state, enforces valid transitions, and broadcasts stateChanged events
 * to all registered listeners.
 *
 * GDD: design/gdd/game-state-manager.md
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export enum GameState {
  Loading     = 'Loading',
  MainMenu    = 'MainMenu',
  Running     = 'Running',
  Dead        = 'Dead',
  ScoreScreen = 'ScoreScreen',
  Leaderboard = 'Leaderboard',
}

export interface StateChangedEvent {
  from: GameState;
  to:   GameState;
}

export type StateChangedListener = (event: StateChangedEvent) => void;

// ── Valid transition table ────────────────────────────────────────────────────
// Derived directly from the GDD transition table. Any pair not listed here
// is invalid and will be silently rejected.

const VALID_TRANSITIONS = new Map<GameState, ReadonlySet<GameState>>([
  [GameState.Loading,     new Set([GameState.MainMenu])],
  [GameState.MainMenu,    new Set([GameState.Running, GameState.Leaderboard])],
  [GameState.Running,     new Set([GameState.Dead])],
  [GameState.Dead,        new Set([GameState.ScoreScreen])],
  [GameState.ScoreScreen, new Set([GameState.Running, GameState.MainMenu])],
  [GameState.Leaderboard, new Set([GameState.MainMenu])],
]);

// ── GameStateManager ──────────────────────────────────────────────────────────

export class GameStateManager {
  private _current: GameState = GameState.Loading;
  private readonly _listeners: Set<StateChangedListener> = new Set();

  /** The currently active game state. Read-only externally. */
  get current(): GameState {
    return this._current;
  }

  /**
   * Attempt to transition to the given state.
   *
   * - If the transition is valid, updates current state and fires stateChanged.
   * - If invalid or same-state, rejects silently and logs in development.
   * - Listener errors are caught and logged; they do not halt the transition.
   */
  transition(to: GameState): void {
    if (to === this._current) {
      if (import.meta.env.DEV) {
        console.warn(`[GSM] Rejected same-state transition: ${this._current} → ${to}`);
      }
      return;
    }

    const allowed = VALID_TRANSITIONS.get(this._current);
    if (!allowed?.has(to)) {
      if (import.meta.env.DEV) {
        console.warn(`[GSM] Rejected invalid transition: ${this._current} → ${to}`);
      }
      return;
    }

    const event: StateChangedEvent = { from: this._current, to };
    this._current = to;

    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[GSM] Listener threw during ${event.from} → ${event.to}:`, err);
      }
    }
  }

  /**
   * Register a listener for state changes.
   * The listener is called synchronously during each valid transition.
   */
  on(listener: StateChangedListener): void {
    this._listeners.add(listener);
  }

  /**
   * Remove a previously registered listener.
   */
  off(listener: StateChangedListener): void {
    this._listeners.delete(listener);
  }

  /**
   * Remove all listeners. Useful for testing and full resets.
   */
  clearListeners(): void {
    this._listeners.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// One shared instance for the entire game module. Systems import and use this
// directly; they do not construct their own instances.

export const gsm = new GameStateManager();
