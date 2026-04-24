/**
 * Milestone System
 *
 * Tracks the player's highest-ever distance milestone across sessions.
 * Persists to localStorage (synchronous) and Supabase (async, fire-and-forget).
 * Fires a 3-bolt lightning VFX sequence on every 1000m crossing during a run.
 *
 * Milestones are one-time unlocks: once earned they persist regardless of
 * subsequent run performance.
 *
 * GDD: design/gdd/distance-milestone-badges.md
 */

import * as THREE from 'three';
import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type ScoreTracker } from './score-tracker';
import { LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';
import {
  MILESTONE_SYSTEM_CONFIG,
  type MilestoneSystemConfig,
} from '../config/milestone-system.config';
import { LEADERBOARD_CONFIG } from '../config/leaderboard.config';

// ── Internal bolt state ───────────────────────────────────────────────────────

interface BoltState {
  /** ms remaining before bolt fires; -1 = not pending this trigger */
  delay:   number;
  /** ms elapsed since bolt fired; -1 = not yet fired */
  elapsed: number;
  mesh:    THREE.Mesh;
}

const BOLT_LANES = [LANE_LEFT, LANE_CENTER, LANE_RIGHT] as const;

// ── MilestoneSystem ───────────────────────────────────────────────────────────

export class MilestoneSystem {
  /** Index of highest milestone reached (-1 = none). */
  get highestIndex(): number { return this._highestIndex; }

  /** Display name of the highest reached milestone, or null if none. */
  get highestName(): string | null {
    if (this._highestIndex < 0) return null;
    return this._config.milestones[this._highestIndex]?.name ?? null;
  }

  /** Display name of the next unreached milestone, or null if at max. */
  get nextName(): string | null {
    const next = this._config.milestones[this._highestIndex + 1];
    return next?.name ?? null;
  }

  /** Distance threshold of the next unreached milestone, or null if at max. */
  get nextThreshold(): number | null {
    const next = this._config.milestones[this._highestIndex + 1];
    return next?.threshold ?? null;
  }

  private _highestIndex:           number  = -1;
  private _lastAlertIndex:         number  = -1; // resets each run; tracks alerts fired this run
  private _active:                 boolean = false;
  private _playerId:               string | null = null;
  private _previousDistance:       number  = 0;
  private _lastLightningThreshold: number  = 0;

  private readonly _unlockCbs:   Array<(name: string) => void> = [];
  private readonly _bolts:       BoltState[];
  private readonly _gsmListener: (e: StateChangedEvent) => void;

  constructor(
    private readonly _scene:   THREE.Scene,
    private readonly _tracker: ScoreTracker,
    private readonly _gsm:     GameStateManager,
    private readonly _config:  MilestoneSystemConfig = MILESTONE_SYSTEM_CONFIG,
  ) {
    this._bolts = this._buildBoltPool();
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
    this._loadFromStorage();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Check distance thresholds and advance lightning VFX each frame.
   * No-op when not in Running state.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    if (!this._active) return;

    this._checkMilestones();
    this._checkLightningTrigger();
    this._updateBolts(deltaMs);

    this._previousDistance = this._tracker.distance;
  }

  /**
   * Register a callback fired when a new milestone is unlocked.
   * Receives the milestone display name (e.g. "Industrial Corridor").
   *
   * @example
   * milestoneSystem.onUnlock((name) => gameUI.showMilestoneAlert(name));
   */
  onUnlock(cb: (name: string) => void): void {
    this._unlockCbs.push(cb);
  }

  /**
   * Set the active player ID for persistence keying.
   * Pass null to revert to guest key.
   */
  setPlayerId(id: string | null): void {
    this._playerId = id;
    this._loadFromStorage();
  }

  /** Remove all listeners and bolt meshes from the scene. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    for (const bolt of this._bolts) {
      this._scene.remove(bolt.mesh);
      bolt.mesh.geometry.dispose();
      (bolt.mesh.material as THREE.Material).dispose();
    }
  }

  // ── Private — state ──────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      this._previousDistance       = 0;
      this._lastLightningThreshold = 0;
      this._lastAlertIndex         = -1; // reset so all alerts fire again this run
      this._active                 = true;
      return;
    }

    if (to === GameState.Dead) {
      this._active = false;
      this._hideBolts();
      return;
    }

    if (to === GameState.ScoreScreen || to === GameState.MainMenu) {
      this._hideBolts();
    }
  }

  // ── Private — milestone checks ────────────────────────────────────────────────

  private _checkMilestones(): void {
    const dist = this._tracker.distance;
    // Iterate highest → lowest to find the best newly-crossed milestone this run.
    // On a lag spike that crosses multiple thresholds in one frame, the
    // highest applicable tier wins (GDD edge case: single unlock per frame).
    for (let i = this._config.milestones.length - 1; i >= 0; i--) {
      const m = this._config.milestones[i];
      if (dist >= m.threshold && i > this._lastAlertIndex) {
        // Persist only if this is a new all-time record
        if (i > this._highestIndex) {
          this._highestIndex = i;
          this._persist();
        }
        this._lastAlertIndex = i;
        const name = m.name;
        for (const cb of this._unlockCbs) cb(name);
        break; // only one alert per frame
      }
    }
  }

  private _checkLightningTrigger(): void {
    const dist = this._tracker.distance;
    const interval = this._config.lightningInterval;
    const current  = Math.floor(dist / interval) * interval;
    const previous = Math.floor(this._previousDistance / interval) * interval;

    if (current > previous && current > 0) {
      this._lastLightningThreshold = current;
      this._triggerLightning();
    }
  }

  // ── Private — lightning VFX ───────────────────────────────────────────────────

  private _buildBoltPool(): BoltState[] {
    const bolts: BoltState[] = [];
    const geo = new THREE.PlaneGeometry(0.07, 12);

    for (let i = 0; i < this._config.lightningBoltCount; i++) {
      const mat  = new THREE.MeshBasicMaterial({
        color:       0xaaddff,
        transparent: true,
        opacity:     0,
        depthWrite:  false,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(BOLT_LANES[i] ?? 0, 5, -1);
      mesh.visible = false;
      this._scene.add(mesh);
      bolts.push({ delay: -1, elapsed: -1, mesh });
    }

    return bolts;
  }

  private _triggerLightning(): void {
    for (let i = 0; i < this._bolts.length; i++) {
      this._bolts[i].delay   = i * this._config.lightningStaggerMs;
      this._bolts[i].elapsed = -1;
      this._bolts[i].mesh.visible = false;
      (this._bolts[i].mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  private _updateBolts(deltaMs: number): void {
    const duration = this._config.lightningDurationMs;

    for (const bolt of this._bolts) {
      // Pending: count down delay before firing
      if (bolt.delay >= 0) {
        bolt.delay -= deltaMs;
        if (bolt.delay <= 0) {
          bolt.delay   = -1;
          bolt.elapsed = 0;
          bolt.mesh.visible = true;
          (bolt.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        }
        continue;
      }

      // Active: fade out over duration
      if (bolt.elapsed >= 0) {
        bolt.elapsed += deltaMs;
        const opacity = Math.max(0, 1 - bolt.elapsed / duration);
        (bolt.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
        if (bolt.elapsed >= duration) {
          bolt.mesh.visible = false;
          bolt.elapsed = -1;
        }
      }
    }
  }

  private _hideBolts(): void {
    for (const bolt of this._bolts) {
      bolt.delay   = -1;
      bolt.elapsed = -1;
      bolt.mesh.visible = false;
      (bolt.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  // ── Private — persistence ─────────────────────────────────────────────────────

  private _storageKey(): string {
    return this._playerId
      ? `${this._config.storageKeyPrefix}${this._playerId}`
      : this._config.guestStorageKey;
  }

  private _loadFromStorage(): void {
    // Try localStorage first (fast, synchronous)
    try {
      const raw = localStorage.getItem(this._storageKey());
      if (raw !== null) {
        const val = parseInt(raw, 10);
        if (Number.isFinite(val) && val >= -1) {
          this._highestIndex = Math.min(val, this._config.milestones.length - 1);
          return;
        }
      }
    } catch { /* unavailable */ }

    // Fall back to Supabase (async — updates _highestIndex when it resolves)
    if (this._playerId) {
      this._fetchFromSupabase().catch(() => { /* silent */ });
    }
  }

  private _persist(): void {
    // localStorage — synchronous, must complete before next frame
    try {
      localStorage.setItem(this._storageKey(), String(this._highestIndex));
    } catch { /* unavailable */ }

    // Supabase — async, fire-and-forget, guest players skipped
    if (this._playerId) {
      this._writeToSupabase().catch(() => { /* silent */ });
    }
  }

  private async _fetchFromSupabase(): Promise<void> {
    const { supabaseUrl, supabaseAnonKey } = LEADERBOARD_CONFIG;
    if (!supabaseUrl) return;

    const url = `${supabaseUrl}/rest/v1/${this._config.supabaseTable}` +
      `?skin_id=eq.${encodeURIComponent(this._playerId!)}&select=highest_index&limit=1`;

    const res = await fetch(url, { headers: this._supabaseHeaders(supabaseAnonKey) });
    if (!res.ok) return;

    const rows = await res.json() as Array<{ highest_index: number }>;
    if (rows.length > 0 && rows[0].highest_index > this._highestIndex) {
      this._highestIndex = rows[0].highest_index;
      // Sync back to localStorage so next load is fast
      try { localStorage.setItem(this._storageKey(), String(this._highestIndex)); } catch { /* ignore */ }
    }
  }

  private async _writeToSupabase(): Promise<void> {
    const { supabaseUrl, supabaseAnonKey } = LEADERBOARD_CONFIG;
    if (!supabaseUrl) return;

    const url = `${supabaseUrl}/rest/v1/${this._config.supabaseTable}`;

    await fetch(url, {
      method:  'POST',
      headers: {
        ...this._supabaseHeaders(supabaseAnonKey),
        'Prefer': 'resolution=merge-duplicates', // upsert on primary key
      },
      body: JSON.stringify({
        skin_id:       this._playerId,
        highest_index: this._highestIndex,
        updated_at:    new Date().toISOString(),
      }),
    });
  }

  private _supabaseHeaders(anonKey: string): Record<string, string> {
    return {
      'apikey':        anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type':  'application/json',
    };
  }
}
