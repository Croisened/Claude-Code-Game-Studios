/**
 * Character Renderer
 *
 * Owns the 3D robot model in the Three.js scene: mesh visibility, animation
 * state, and texture application. Exposes `robotObject3D` for Camera and
 * Runner Systems. Fires `deathAnimationComplete` when the death sequence ends.
 *
 * S1-04 state: placeholder box mesh; GLTFLoader scaffolded for when the
 * real .glb asset is available. Animation clips replaced by a timer fallback.
 *
 * GDD: design/gdd/character-renderer.md
 */

import * as THREE from 'three';
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // uncomment when .glb is ready
import { GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { CHARACTER_RENDERER_CONFIG, type CharacterRendererConfig } from '../config/character-renderer.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeathCompleteListener = () => void;

// ── CharacterRenderer ─────────────────────────────────────────────────────────

export class CharacterRenderer {
  /**
   * Stable Object3D reference for the robot mesh.
   * Camera System and Runner System cache this at init — it is never replaced.
   */
  readonly robotObject3D: THREE.Object3D;

  private readonly _mesh:     THREE.Mesh;
  private readonly _material: THREE.MeshStandardMaterial;
  private _mixer:              THREE.AnimationMixer | null = null;
  private _deathTimer:         ReturnType<typeof setTimeout> | null = null;
  private readonly _deathListeners = new Set<DeathCompleteListener>();
  private readonly _gsmListener:   (e: StateChangedEvent) => void;

  constructor(
    private readonly _scene:  THREE.Scene,
    private readonly _gsm:    GameStateManager,
    private readonly _config: CharacterRendererConfig = CHARACTER_RENDERER_CONFIG,
  ) {
    // ── Placeholder mesh ────────────────────────────────────────────────────
    // Replaced by GLTFLoader output when the real .glb asset is available.
    this._material = new THREE.MeshStandardMaterial({
      color: _config.placeholderColor,
      emissive: new THREE.Color(_config.placeholderColor).multiplyScalar(0.15),
    });

    this._mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.8, 0.8),
      this._material,
    );
    this._mesh.castShadow = true;
    this._mesh.scale.setScalar(_config.robotScale);
    // Position bottom of mesh flush with ground (y=0).
    this._mesh.position.y = _config.placeholderGroundOffset;
    this._mesh.visible = false; // hidden until MainMenu state

    this.robotObject3D = this._mesh;
    this._scene.add(this._mesh);

    // ── GLTFLoader scaffold ─────────────────────────────────────────────────
    // Uncomment and fill in the asset path when robot.glb is ready.
    // The loaded model replaces this._mesh as the robotObject3D content;
    // this._mixer is constructed from the loaded scene; animation clips
    // ('Idle', 'Run', 'Death') are extracted by name from gltf.animations.
    //
    // const loader = new GLTFLoader();
    // loader.load(
    //   '/assets/art/robot/robot.glb',
    //   (gltf) => {
    //     const model = gltf.scene;
    //     model.scale.setScalar(this._config.robotScale);
    //     model.position.y = 0;
    //     this._scene.remove(this._mesh);
    //     this._scene.add(model);
    //     (this.robotObject3D as THREE.Object3D) = model;
    //     this._mixer = new THREE.AnimationMixer(model);
    //     // Wire up Idle / Run / Death clips here.
    //   },
    //   undefined,
    //   (err) => {
    //     console.error('[CharacterRenderer] Failed to load robot.glb:', err);
    //     // Placeholder mesh remains active as fallback per GDD edge case.
    //   },
    // );

    // ── GSM subscription ────────────────────────────────────────────────────
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply an NFT skin texture to the robot material.
   * Called by NFT Skin Loader when ownership is verified.
   * Safe to call at any time including mid-run.
   */
  applyTexture(texture: THREE.Texture | null): void {
    if (texture === null) {
      console.warn('[CharacterRenderer] applyTexture called with null — keeping current texture');
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    this._material.map = texture;
    this._material.needsUpdate = true;
  }

  /**
   * Register a listener for the death animation complete event.
   * GSM subscribes to this to trigger Dead → ScoreScreen.
   */
  onDeathComplete(listener: DeathCompleteListener): void {
    this._deathListeners.add(listener);
  }

  /** Remove a death complete listener. */
  offDeathComplete(listener: DeathCompleteListener): void {
    this._deathListeners.delete(listener);
  }

  /**
   * Advance the AnimationMixer. Call once per frame from the game loop.
   * @param deltaMs - time since last frame in milliseconds
   */
  update(deltaMs: number): void {
    this._mixer?.update(deltaMs * 0.001);
  }

  /** Unsubscribe from GSM and clean up scene objects. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    this._cancelDeathTimer();
    this._scene.remove(this._mesh);
    this._mixer?.stopAllAction();
    this._deathListeners.clear();
  }

  // ── GSM handler ─────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    switch (event.to) {
      case GameState.Loading:
        this._mesh.visible = false;
        this._cancelDeathTimer();
        break;

      case GameState.MainMenu:
        this._mesh.visible = true;
        this._cancelDeathTimer();
        // TODO (S1-04+): crossfade to Idle clip when AnimationMixer is wired.
        break;

      case GameState.Running:
        this._mesh.visible = true;
        this._cancelDeathTimer();
        if (event.from === GameState.ScoreScreen) {
          // Restart: hard-snap to start pose (no crossfade from death).
          // TODO: stop death action, reset mixer to frame 0 of Idle.
        }
        // TODO: crossfade Idle → Run (150ms) when clips are available.
        break;

      case GameState.Dead:
        // Start death sequence. Fires deathAnimationComplete at end.
        // TODO: replace timer with AnimationMixer 'finished' event on Death clip.
        this._startDeathTimer();
        break;

      case GameState.ScoreScreen:
        // Hold final death pose. Timer already fired; nothing to do here.
        break;

      case GameState.Leaderboard:
        // Robot is behind menu layer — no pose change needed.
        break;
    }
  }

  // ── Death timer ──────────────────────────────────────────────────────────────

  private _startDeathTimer(): void {
    this._cancelDeathTimer();
    this._deathTimer = setTimeout(() => {
      this._deathTimer = null;
      for (const listener of this._deathListeners) {
        try {
          listener();
        } catch (err) {
          console.error('[CharacterRenderer] deathComplete listener threw:', err);
        }
      }
    }, this._config.deathDuration);
  }

  private _cancelDeathTimer(): void {
    if (this._deathTimer !== null) {
      clearTimeout(this._deathTimer);
      this._deathTimer = null;
    }
  }
}
