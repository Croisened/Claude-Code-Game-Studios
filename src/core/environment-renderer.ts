/**
 * Environment Renderer
 *
 * Owns the Neotropolis world geometry: lane floor, lane dividers, and flanking
 * building placeholders. Creates the illusion of forward movement by recycling
 * a fixed pool of chunks along the Z axis.
 *
 * Runner System is the sole caller of setScrollSpeed().
 * Lane constants (LANE_LEFT, LANE_CENTER, LANE_RIGHT) are the canonical source
 * of truth for lane X positions — all other systems read them from here.
 *
 * GDD: design/gdd/environment-renderer.md
 */

import * as THREE from 'three';
import { GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { ENVIRONMENT_RENDERER_CONFIG, type EnvironmentRendererConfig } from '../config/environment-renderer.config';

// ── Lane constants ─────────────────────────────────────────────────────────────
// Canonical lane X positions. All systems read from here — never hardcode these.

export const LANE_LEFT:   number = -ENVIRONMENT_RENDERER_CONFIG.laneSpacing;
export const LANE_CENTER: number = 0;
export const LANE_RIGHT:  number = +ENVIRONMENT_RENDERER_CONFIG.laneSpacing;

// ── EnvironmentRenderer ───────────────────────────────────────────────────────

export class EnvironmentRenderer {
  private _scrollSpeed = 0;
  private _isScrolling = false;

  private readonly _chunks:   THREE.Group[];
  private readonly _initialZ: number[];
  private readonly _gsmListener: (e: StateChangedEvent) => void;

  // Shared materials — created once, reused across all chunks.
  private readonly _floorMat    = new THREE.MeshStandardMaterial({ color: 0x222222 });
  private readonly _dividerMat  = new THREE.MeshStandardMaterial({ color: 0x444444 });
  private readonly _buildingMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e });

  constructor(
    private readonly _scene:  THREE.Scene,
    private readonly _gsm:    GameStateManager,
    private readonly _config: EnvironmentRendererConfig = ENVIRONMENT_RENDERER_CONFIG,
  ) {
    // ── Startup assertion ───────────────────────────────────────────────────
    // Pool coverage must exceed a generous camera draw distance.
    const coverage = _config.chunkCount * _config.chunkLength;
    if (coverage < 60) {
      console.error(
        `[EnvironmentRenderer] Pool coverage (${coverage} units) is below minimum ` +
        `camera draw distance. Increase chunkCount or chunkLength.`,
      );
    }

    // ── Build chunk pool ────────────────────────────────────────────────────
    // chunk[i].position.z = -(i + 0.5) × chunkLength
    // Back face of chunk[0] starts at Z=0 (robot position).
    this._chunks   = [];
    this._initialZ = [];

    for (let i = 0; i < _config.chunkCount; i++) {
      const z = -(i + 0.5) * _config.chunkLength;
      this._initialZ.push(z);
      const chunk = this._buildChunk(i);
      chunk.position.z = z;
      this._scene.add(chunk);
      this._chunks.push(chunk);
    }

    // ── GSM subscription ────────────────────────────────────────────────────
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Set the forward scroll speed in units/second.
   * Called every tick by Runner System — it is the sole caller.
   * Negative values are clamped to 0.
   */
  setScrollSpeed(speed: number): void {
    if (speed < 0) {
      if (import.meta.env.DEV) {
        console.warn(
          `[EnvironmentRenderer] setScrollSpeed(${speed}) is negative — clamping to 0. ` +
          `Only Runner System should call this method.`,
        );
      }
      speed = 0;
    }
    this._scrollSpeed = speed;
  }

  /**
   * Advance the scroll simulation. Call once per frame from the game loop.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    if (!this._isScrolling) return;

    // Clamp delta to prevent frame-spike chunk teleports (GDD edge case).
    const delta = Math.min(deltaMs * 0.001, this._config.deltaClamp);

    for (const chunk of this._chunks) {
      chunk.position.z += this._scrollSpeed * delta;

      // Recycle when the chunk's back face passes the robot (Z=0) + buffer.
      const backFace = chunk.position.z + this._config.chunkLength / 2;
      if (backFace > this._config.recycleBuffer) {
        chunk.position.z -= this._config.chunkCount * this._config.chunkLength;
      }
    }
  }

  /** Unsubscribe from GSM and remove all chunks from the scene. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    for (const chunk of this._chunks) {
      this._scene.remove(chunk);
    }
  }

  // ── GSM handler ─────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    switch (event.to) {
      case GameState.Running:
        if (event.from === GameState.ScoreScreen) {
          // Restart: reset all chunks to initial layout and speed.
          this._resetChunks();
        }
        this._scrollSpeed = this._config.initialScrollSpeed;
        this._isScrolling = true;
        break;

      case GameState.Dead:
      case GameState.ScoreScreen:
      case GameState.MainMenu:
      case GameState.Leaderboard:
        this._isScrolling = false;
        break;

      case GameState.Loading:
        // Chunk pool already built in constructor; nothing extra to do.
        break;
    }
  }

  // ── Chunk construction ───────────────────────────────────────────────────────

  /**
   * Build one environment chunk as a Three.js Group.
   * MVP: flat lane floor, lane dividers, placeholder flanking building blocks.
   * v1: replace materials and flanking meshes with Neotropolis art assets.
   */
  private _buildChunk(index: number): THREE.Group {
    const group = new THREE.Group();
    const { chunkLength, laneSpacing, laneWidth } = this._config;

    // ── Lane floor ──────────────────────────────────────────────────────────
    // PlaneGeometry is on the XY plane by default — rotate to lay it flat.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(laneWidth, chunkLength),
      this._floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // ── Lane dividers ────────────────────────────────────────────────────────
    for (const x of [-laneSpacing, laneSpacing]) {
      const divider = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.05, chunkLength),
        this._dividerMat,
      );
      divider.position.set(x, 0.025, 0);
      group.add(divider);
    }

    // ── Flanking placeholder buildings ───────────────────────────────────────
    // Two buildings per side — heights vary by index for minimal visual interest.
    // Replace entirely in v1 art pass.
    const buildingConfigs = [
      { w: 2.5, h: 4 + (index % 3) * 2, d: chunkLength * 0.9 },
      { w: 1.5, h: 6 + (index % 2) * 3, d: chunkLength * 0.5 },
    ];

    for (const side of [-1, 1]) {
      let xOffset = side * (laneSpacing + 2.5);
      for (const bc of buildingConfigs) {
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(bc.w, bc.h, bc.d),
          this._buildingMat,
        );
        building.position.set(xOffset, bc.h / 2, 0);
        group.add(building);
        xOffset += side * (bc.w / 2 + 0.5);
      }
    }

    return group;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private _resetChunks(): void {
    for (let i = 0; i < this._chunks.length; i++) {
      this._chunks[i].position.z = this._initialZ[i];
    }
  }
}
