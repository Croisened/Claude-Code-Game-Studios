/**
 * Game UI
 *
 * DOM overlay providing:
 *   S1-11 — Live distance HUD during Running; score + personal best on ScoreScreen.
 *   S1-12 — "Press any key" handler: MainMenu → Running; ScoreScreen → Running.
 *            Dead state auto-advances to ScoreScreen so the score is displayed,
 *            then waits for a keypress to restart.
 *
 * All elements are created and owned by this class. No external HTML required.
 *
 * GDD sprint tasks: S1-11, S1-12
 */

import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type ScoreTracker } from './score-tracker';

export class GameUI {
  private readonly _hud:        HTMLElement;
  private readonly _overlay:    HTMLElement;
  private readonly _gsmListener: (e: StateChangedEvent) => void;
  private          _rafId:      number | null = null;

  constructor(
    private readonly _gsm:     GameStateManager,
    private readonly _tracker: ScoreTracker,
  ) {
    this._hud     = this._createHUD();
    this._overlay = this._createOverlay();
    document.body.appendChild(this._hud);
    document.body.appendChild(this._overlay);

    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);

    // Show the initial MainMenu prompt
    this._showMainMenu();
  }

  /**
   * Update live distance display. Call once per frame from the game loop.
   * No-op unless in Running state.
   */
  updateHUD(): void {
    if (this._gsm.current !== GameState.Running) return;
    this._hud.textContent = `${Math.floor(this._tracker.distance)}m`;
  }

  destroy(): void {
    this._gsm.off(this._gsmListener);
    this._stopHUDLoop();
    this._hud.remove();
    this._overlay.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      this._hideOverlay();
      this._showHUD();
      return;
    }

    if (to === GameState.Dead) {
      this._hideHUD();
      // ScoreScreen transition is driven by CharacterRenderer.onDeathComplete
      // once the death animation finishes — no auto-advance here.
      return;
    }

    if (to === GameState.ScoreScreen) {
      this._showScoreScreen();
      return;
    }

    if (to === GameState.MainMenu) {
      this._hideHUD();
      this._showMainMenu();
    }
  }

  private _showMainMenu(): void {
    this._overlay.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:48px 24px 96px;gap:8px;background:linear-gradient(to bottom,rgba(7,7,13,0.95) 0%,rgba(7,7,13,0) 100%);">
        <div style="font-size:52px;font-weight:bold;color:#b44fff;text-shadow:0 0 30px #b44fff,0 0 60px #b44fff88;letter-spacing:0.2em;">ROBO RHAPSODY</div>
        <div style="font-size:18px;color:#00f0ff;letter-spacing:0.5em;text-shadow:0 0 12px #00f0ff;">NEON FUGITIVE</div>
      </div>
      <div style="position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:96px 24px 48px;background:linear-gradient(to top,rgba(7,7,13,0.95) 0%,rgba(7,7,13,0) 100%);">
        <div style="font-size:16px;color:#ffffff;text-shadow:0 0 8px #fff,0 0 20px #00f0ff;letter-spacing:0.25em;animation:blink 1.2s ease-in-out infinite;">PRESS ANY KEY TO RUN</div>
      </div>
    `;
    this._overlay.style.display = 'block';
    this._listenForAnyKey(() => {
      this._gsm.transition(GameState.Running);
    });
  }

  private _showScoreScreen(): void {
    const score = this._tracker.finalScore;
    const pb    = this._tracker.personalBest;
    const isPB  = this._tracker.isNewPersonalBest;

    const pbLine = isPB
      ? `<div style="font-size:20px;color:#b44fff;text-shadow:0 0 10px #b44fff;letter-spacing:0.1em;">NEW BEST: ${score.toLocaleString()}m</div>`
      : `<div style="font-size:20px;color:#888;letter-spacing:0.1em;">BEST: ${pb.toLocaleString()}m</div>`;

    this._overlay.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:48px 24px 96px;gap:12px;background:linear-gradient(to bottom,rgba(7,7,13,0.95) 0%,rgba(7,7,13,0) 100%);">
        <div style="font-size:72px;font-weight:bold;color:#00f0ff;text-shadow:0 0 30px #00f0ff,0 0 60px #00f0ff88;">${score.toLocaleString()}m</div>
        ${pbLine}
      </div>
      <div style="position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:96px 24px 48px;background:linear-gradient(to top,rgba(7,7,13,0.95) 0%,rgba(7,7,13,0) 100%);">
        <div style="font-size:16px;color:#ffffff;text-shadow:0 0 8px #fff,0 0 20px #00f0ff;letter-spacing:0.25em;animation:blink 1.2s ease-in-out infinite;">PRESS ANY KEY TO REBOOT</div>
      </div>
    `;
    this._overlay.style.display = 'block';
    // Return to MainMenu (hero showcase + idle robot) — not directly to Running.
    this._listenForAnyKey(() => {
      this._gsm.transition(GameState.MainMenu);
    });
  }

  private _showHUD(): void {
    this._hud.style.display = 'block';
  }

  private _hideHUD(): void {
    this._hud.style.display = 'none';
    this._hud.textContent   = '0m';
  }

  private _hideOverlay(): void {
    this._overlay.style.display = 'none';
    this._overlay.innerHTML     = '';
  }

  /** Listen for a single keydown (non-modifier) then call cb. Debounce-safe. */
  private _listenForAnyKey(cb: () => void): void {
    const IGNORED = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock']);
    let fired = false;
    const handler = (e: KeyboardEvent): void => {
      if (IGNORED.has(e.key)) return;
      if (fired) return;
      fired = true;
      window.removeEventListener('keydown', handler);
      cb();
    };
    window.addEventListener('keydown', handler);
  }

  private _stopHUDLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  // ── Element factories ─────────────────────────────────────────────────────────

  private _createHUD(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'hud';
    el.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      font-family: 'Courier New', monospace;
      font-size: 28px;
      font-weight: bold;
      color: #00f0ff;
      text-shadow: 0 0 12px #00f0ff, 0 0 4px #fff;
      letter-spacing: 0.1em;
      pointer-events: none;
      display: none;
      z-index: 10;
    `;
    el.textContent = '0m';
    return el;
  }

  private _createOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'overlay';
    el.style.cssText = `
      position: fixed;
      inset: 0;
      font-family: 'Courier New', monospace;
      color: #e0e0ff;
      pointer-events: none;
      z-index: 20;
    `;

    // Keyframe for prompt blink — inline styles cannot define @keyframes.
    const style = document.createElement('style');
    style.textContent = `@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }`;
    document.head.appendChild(style);

    return el;
  }
}
