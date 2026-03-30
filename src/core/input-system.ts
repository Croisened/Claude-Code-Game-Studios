/**
 * Input System
 *
 * Captures keyboard events and translates them into named game actions.
 * The only system that reads raw browser key codes — all other systems
 * receive abstract InputActions via the 'action' event.
 *
 * GDD: design/gdd/input-system.md
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export enum InputAction {
  LaneLeft  = 'LANE_LEFT',
  LaneRight = 'LANE_RIGHT',
  Jump      = 'JUMP',
  Slide     = 'SLIDE',
}

export type ActionListener = (action: InputAction) => void;

// ── Key binding config ────────────────────────────────────────────────────────
// All raw KeyboardEvent.code values are confined to this single object.
// To remap keys, change values here — nowhere else.

const KEY_BINDINGS: Readonly<Record<string, InputAction>> = {
  ArrowLeft:  InputAction.LaneLeft,
  KeyA:       InputAction.LaneLeft,
  ArrowRight: InputAction.LaneRight,
  KeyD:       InputAction.LaneRight,
  ArrowUp:    InputAction.Jump,
  KeyW:       InputAction.Jump,
  Space:      InputAction.Jump,
  ArrowDown:  InputAction.Slide,
  KeyS:       InputAction.Slide,
};

// ── InputSystem ───────────────────────────────────────────────────────────────

export class InputSystem {
  private _enabled = false;
  private readonly _activeKeys = new Set<string>();
  private readonly _listeners  = new Set<ActionListener>();

  // Bound handler references — stored so they can be removed in destroy().
  private readonly _onKeyDown: (e: KeyboardEvent) => void;
  private readonly _onKeyUp:   (e: KeyboardEvent) => void;
  private readonly _onBlur:    ()                 => void;

  constructor(private readonly _target: Window = window) {
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp   = this._handleKeyUp.bind(this);
    this._onBlur    = this._handleBlur.bind(this);

    this._target.addEventListener('keydown', this._onKeyDown as EventListener);
    this._target.addEventListener('keyup',   this._onKeyUp   as EventListener);
    this._target.addEventListener('blur',    this._onBlur);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Begin processing and emitting actions.
   * Idempotent — safe to call when already enabled.
   */
  enable(): void {
    this._enabled = true;
  }

  /**
   * Stop emitting actions. All input is silently consumed.
   * Idempotent — safe to call when already disabled.
   */
  disable(): void {
    this._enabled = false;
    this._activeKeys.clear();
  }

  /** Register a listener for action events. */
  on(listener: ActionListener): void {
    this._listeners.add(listener);
  }

  /** Remove a previously registered listener. */
  off(listener: ActionListener): void {
    this._listeners.delete(listener);
  }

  /** Remove all listeners and browser event handlers. */
  destroy(): void {
    this._target.removeEventListener('keydown', this._onKeyDown as EventListener);
    this._target.removeEventListener('keyup',   this._onKeyUp   as EventListener);
    this._target.removeEventListener('blur',    this._onBlur);
    this._listeners.clear();
    this._activeKeys.clear();
  }

  // ── Private handlers ────────────────────────────────────────────────────────

  private _handleKeyDown(e: KeyboardEvent): void {
    // Key-repeat suppression: ignore if this key is already held down.
    if (this._activeKeys.has(e.code)) return;
    this._activeKeys.add(e.code);

    if (!this._enabled) return;

    const action = KEY_BINDINGS[e.code];
    if (action === undefined) return;

    for (const listener of this._listeners) {
      listener(action);
    }
  }

  private _handleKeyUp(e: KeyboardEvent): void {
    this._activeKeys.delete(e.code);
  }

  private _handleBlur(): void {
    // Clear all held keys so no phantom repeats fire when focus returns.
    this._activeKeys.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const inputSystem = new InputSystem();
