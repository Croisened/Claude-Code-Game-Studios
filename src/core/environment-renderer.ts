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

  // Neon emissive materials for windows and doors — no extra lights needed.
  private readonly _neonBlueMat = new THREE.MeshStandardMaterial({
    color:           0x001a2e,
    emissive:        new THREE.Color(0x00cfff),
    emissiveIntensity: 1.2,
  });
  private readonly _neonPinkMat = new THREE.MeshStandardMaterial({
    color:           0x1a0010,
    emissive:        new THREE.Color(0xff00cc),
    emissiveIntensity: 1.2,
  });
  private readonly _neonDoorMat = new THREE.MeshStandardMaterial({
    color:           0x1a0010,
    emissive:        new THREE.Color(0xff00cc),
    emissiveIntensity: 0.8,
  });

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
   * Buildings have neon-emissive windows (blue/pink) and a door on the front face.
   */
  private _buildChunk(index: number): THREE.Group {
    const group = new THREE.Group();
    const { chunkLength, laneSpacing, laneWidth } = this._config;

    // ── Lane floor ──────────────────────────────────────────────────────────
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

    // ── Flanking buildings with neon windows and doors ───────────────────────
    const buildingConfigs = [
      { w: 2.5, h: 4 + (index % 3) * 2, d: chunkLength * 0.9 },
      { w: 1.5, h: 6 + (index % 2) * 3, d: chunkLength * 0.5 },
    ];

    for (const side of [-1, 1]) {
      let xOffset = side * (laneSpacing + 2.5);

      buildingConfigs.forEach((bc, bIdx) => {
        // ── Building body ───────────────────────────────────────────────────
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(bc.w, bc.h, bc.d),
          this._buildingMat,
        );
        building.position.set(xOffset, bc.h / 2, 0);
        building.castShadow = true;
        building.receiveShadow = true;
        group.add(building);

        // Front face Z of this building (facing the runner / camera).
        const frontZ = building.position.z + bc.d / 2 + 0.02;

        // ── Neon windows ────────────────────────────────────────────────────
        const winW    = 0.35;
        const winH    = 0.45;
        const marginX = 0.3;
        const marginY = 0.4;
        const gapX    = 0.2;
        const gapY    = 0.3;

        const cols = Math.max(1, Math.floor((bc.w - marginX * 2 + gapX) / (winW + gapX)));
        const rows = Math.max(1, Math.floor((bc.h - marginY * 2 - 1.2 + gapY) / (winH + gapY)));

        const totalWinW = cols * winW + (cols - 1) * gapX;
        const startX    = building.position.x - totalWinW / 2 + winW / 2;
        const startY    = 1.4; // leave headroom above ground for door

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            // Alternate blue/pink deterministically — varies per chunk + building.
            const isBlue = (index + bIdx + row + col) % 2 === 0;
            const win = new THREE.Mesh(
              new THREE.PlaneGeometry(winW, winH),
              isBlue ? this._neonBlueMat : this._neonPinkMat,
            );
            win.position.set(
              startX + col * (winW + gapX),
              startY + row * (winH + gapY),
              frontZ,
            );
            group.add(win);
          }
        }

        // ── Neon door (first building per side only, centred) ───────────────
        if (bIdx === 0) {
          const doorW = 0.55;
          const doorH = 1.1;
          const door  = new THREE.Mesh(
            new THREE.PlaneGeometry(doorW, doorH),
            this._neonDoorMat,
          );
          door.position.set(
            building.position.x,
            doorH / 2,
            frontZ,
          );
          group.add(door);
        }

        xOffset += side * (bc.w / 2 + 0.5);
      });
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
