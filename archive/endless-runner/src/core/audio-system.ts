/**
 * Audio System
 *
 * Manages all game audio: looping background music and four SFX (run loop,
 * jump, lane change, death). Driven entirely by GSM state transitions and
 * RunnerSystem callbacks — no update loop. Uses HTML <audio> elements for
 * broad browser compatibility with no external dependencies.
 *
 * Autoplay policy: browsers block audio until the first user interaction.
 * On construction the system registers a one-shot pointer/key listener that
 * unlocks playback and then removes itself.
 *
 * Mute state persists across sessions via localStorage.
 *
 * GDD: design/gdd/audio-system.md
 */

import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type RunnerSystem } from './runner-system';
import { AUDIO_SYSTEM_CONFIG, type AudioSystemConfig } from '../config/audio-system.config';

const MUTE_STORAGE_KEY = 'roborhapsody_muted';
const FADE_TICK_MS     = 16;

// ── AudioSystem ───────────────────────────────────────────────────────────────

export class AudioSystem {
  /** Current mute state. Read by GameUI to render the toggle button label. */
  get isMuted(): boolean { return this._muted; }

  private readonly _music:    HTMLAudioElement;
  private readonly _sfxRun:   HTMLAudioElement;
  private readonly _sfxJump:  HTMLAudioElement;
  private readonly _sfxLane:  HTMLAudioElement;
  private readonly _sfxDeath: HTMLAudioElement;

  private _muted:              boolean;
  private _autoplayUnlocked:   boolean = false;
  private _pendingMusicPlay:   boolean = false;
  private _fadeInterval:       ReturnType<typeof setInterval> | null = null;

  private readonly _gsmListener:      (e: StateChangedEvent) => void;
  private readonly _jumpListener:     () => void;
  private readonly _laneListener:     () => void;
  private readonly _autoplayHandler:  () => void;

  constructor(
    private readonly _gsm:    GameStateManager,
    private readonly _rs:     RunnerSystem,
    private readonly _config: AudioSystemConfig = AUDIO_SYSTEM_CONFIG,
  ) {
    this._muted = this._loadMuted();

    this._music    = this._createAudio(_config.musicPath,    _config.musicVolume,   true);
    this._sfxRun   = this._createAudio(_config.sfxRunPath,   _config.sfxRunVolume,  true);
    this._sfxJump  = this._createAudio(_config.sfxJumpPath,  _config.sfxJumpVolume, false);
    this._sfxLane  = this._createAudio(_config.sfxLanePath,  _config.sfxLaneVolume, false);
    this._sfxDeath = this._createAudio(_config.sfxDeathPath, _config.sfxDeathVolume,false);

    // Subscribe to events
    this._gsmListener  = this._onStateChanged.bind(this);
    this._jumpListener = this._onJump.bind(this);
    this._laneListener = this._onLaneChange.bind(this);
    this._gsm.on(this._gsmListener);
    this._rs.onJump(this._jumpListener);
    this._rs.onLaneChange(this._laneListener);

    // Autoplay unlock — fires on first pointer or key interaction, then removes itself.
    this._autoplayHandler = (): void => {
      if (this._autoplayUnlocked) return;
      this._autoplayUnlocked = true;
      window.removeEventListener('pointerdown', this._autoplayHandler);
      window.removeEventListener('keydown',     this._autoplayHandler);
      if (this._pendingMusicPlay) {
        this._pendingMusicPlay = false;
        this._startMusic();
      }
    };
    window.addEventListener('pointerdown', this._autoplayHandler);
    window.addEventListener('keydown',     this._autoplayHandler);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Toggle mute on/off. Applies immediately to all playing audio.
   * Persists the new state to localStorage.
   * @returns The new muted state.
   *
   * @example
   * const nowMuted = audioSystem.toggleMute();
   */
  toggleMute(): boolean {
    this._muted = !this._muted;
    this._saveMuted(this._muted);

    // Cancel any in-progress fade — apply mute state immediately.
    this._clearFade();

    const allElements = [this._music, this._sfxRun, this._sfxJump, this._sfxLane, this._sfxDeath];
    if (this._muted) {
      for (const el of allElements) el.volume = 0;
    } else {
      this._music.volume    = this._config.musicVolume;
      this._sfxRun.volume   = this._config.sfxRunVolume;
      this._sfxJump.volume  = this._config.sfxJumpVolume;
      this._sfxLane.volume  = this._config.sfxLaneVolume;
      this._sfxDeath.volume = this._config.sfxDeathVolume;
    }

    return this._muted;
  }

  /** Unsubscribe from all events and stop all audio. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    this._rs.offJump(this._jumpListener);
    this._rs.offLaneChange(this._laneListener);
    window.removeEventListener('pointerdown', this._autoplayHandler);
    window.removeEventListener('keydown',     this._autoplayHandler);
    this._clearFade();
    this._stopAll();
  }

  // ── GSM handler ──────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    switch (event.to) {
      case GameState.MainMenu:
        this._sfxRun.pause();
        this._sfxRun.currentTime = 0;
        this._sfxDeath.pause();
        this._sfxDeath.currentTime = 0;
        this._fadeInMusic();
        break;

      case GameState.Running:
        this._fadeInMusic();
        this._playSfx(this._sfxRun);
        break;

      case GameState.Dead:
        this._sfxRun.pause();
        this._sfxRun.currentTime = 0;
        this._fadeOutMusic();
        this._playSfx(this._sfxDeath);
        break;

      default:
        break;
    }
  }

  // ── SFX handlers ─────────────────────────────────────────────────────────────

  private _onJump(): void {
    this._playSfx(this._sfxJump);
  }

  private _onLaneChange(): void {
    // Rewind and replay — cuts any previous instance on the same element.
    this._sfxLane.currentTime = 0;
    this._playSfx(this._sfxLane);
  }

  // ── Playback helpers ─────────────────────────────────────────────────────────

  private _playSfx(el: HTMLAudioElement): void {
    el.play().catch((err) => {
      if (import.meta.env.DEV) {
        console.warn('[AudioSystem] SFX play blocked:', err);
      }
    });
  }

  private _startMusic(): void {
    this._music.play().catch((err) => {
      if (import.meta.env.DEV) {
        console.warn('[AudioSystem] Music play blocked:', err);
      }
    });
  }

  private _stopAll(): void {
    for (const el of [this._music, this._sfxRun, this._sfxJump, this._sfxLane, this._sfxDeath]) {
      el.pause();
      el.currentTime = 0;
    }
  }

  // ── Music fade ───────────────────────────────────────────────────────────────

  private _fadeInMusic(): void {
    if (this._muted) {
      // Ensure music is playing even when muted (volume stays 0).
      if (this._autoplayUnlocked) {
        this._startMusic();
      } else {
        this._pendingMusicPlay = true;
      }
      return;
    }

    this._clearFade();
    const target   = this._config.musicVolume;
    const steps    = this._config.musicFadeDuration / FADE_TICK_MS;
    const stepSize = (target - this._music.volume) / steps;

    if (!this._autoplayUnlocked) {
      this._pendingMusicPlay = true;
      return;
    }

    this._startMusic();
    this._fadeInterval = setInterval(() => {
      const next = this._music.volume + stepSize;
      if (next >= target) {
        this._music.volume = target;
        this._clearFade();
      } else {
        this._music.volume = next;
      }
    }, FADE_TICK_MS);
  }

  private _fadeOutMusic(): void {
    if (this._muted) return; // already at 0

    this._clearFade();
    const steps    = this._config.musicFadeDuration / FADE_TICK_MS;
    const stepSize = this._music.volume / steps;

    this._fadeInterval = setInterval(() => {
      const next = this._music.volume - stepSize;
      if (next <= 0) {
        this._music.volume = 0;
        this._music.pause();
        this._clearFade();
      } else {
        this._music.volume = next;
      }
    }, FADE_TICK_MS);
  }

  private _clearFade(): void {
    if (this._fadeInterval !== null) {
      clearInterval(this._fadeInterval);
      this._fadeInterval = null;
    }
  }

  // ── Element factory ──────────────────────────────────────────────────────────

  private _createAudio(src: string, volume: number, loop: boolean): HTMLAudioElement {
    const el = new Audio();
    el.src     = src;
    el.loop    = loop;
    el.volume  = this._muted ? 0 : volume;
    el.preload = 'auto';
    el.addEventListener('error', () => {
      console.error(`[AudioSystem] Failed to load audio: ${src}`);
    });
    return el;
  }

  // ── localStorage helpers ──────────────────────────────────────────────────────

  private _loadMuted(): boolean {
    try { return localStorage.getItem(MUTE_STORAGE_KEY) === 'true'; } catch { return false; }
  }

  private _saveMuted(muted: boolean): void {
    try { localStorage.setItem(MUTE_STORAGE_KEY, String(muted)); } catch { /* ignore */ }
  }
}
