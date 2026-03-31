/**
 * Character Renderer
 *
 * Owns the 3D robot model in the Three.js scene: mesh visibility, animation
 * state, and texture application. Exposes `robotObject3D` for Camera and
 * Runner Systems. Fires `deathAnimationComplete` when the death sequence ends.
 *
 * Architecture: `robotObject3D` is a stable root Object3D container. The
 * placeholder box mesh is its child until the GLB loads; the loaded model
 * replaces it. Camera and Runner Systems hold the root reference forever —
 * it never changes identity.
 *
 * GDD: design/gdd/character-renderer.md
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { CHARACTER_RENDERER_CONFIG, type CharacterRendererConfig } from '../config/character-renderer.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeathCompleteListener = () => void;

// ── CharacterRenderer ─────────────────────────────────────────────────────────

export class CharacterRenderer {
  /**
   * Stable Object3D root container for the robot.
   * Camera System and Runner System cache this at init — it is never replaced.
   * Children are swapped (placeholder → GLB model) as assets load.
   */
  readonly robotObject3D: THREE.Object3D;

  private readonly _placeholder:  THREE.Mesh;
  private readonly _material:     THREE.MeshStandardMaterial;
  private _loadedModel:            THREE.Object3D | null = null;
  private _mixer:                  THREE.AnimationMixer | null = null;
  private _deathTimer:             ReturnType<typeof setTimeout> | null = null;
  private readonly _deathListeners = new Set<DeathCompleteListener>();
  private readonly _gsmListener:   (e: StateChangedEvent) => void;

  constructor(
    private readonly _scene:  THREE.Scene,
    private readonly _gsm:    GameStateManager,
    private readonly _config: CharacterRendererConfig = CHARACTER_RENDERER_CONFIG,
  ) {
    // ── Root container ──────────────────────────────────────────────────────
    // Stable identity for Camera / Runner Systems. Children are swapped here.
    const root = new THREE.Object3D();
    root.visible = false; // hidden until MainMenu state
    this.robotObject3D = root;
    this._scene.add(root);

    // ── Placeholder mesh ────────────────────────────────────────────────────
    // Shown until GLB loads (or as permanent fallback if load fails).
    this._material = new THREE.MeshStandardMaterial({
      color:    _config.placeholderColor,
      emissive: new THREE.Color(_config.placeholderColor).multiplyScalar(0.15),
    });

    const geo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    geo.translate(0, _config.placeholderGroundOffset, 0);

    this._placeholder = new THREE.Mesh(geo, this._material);
    this._placeholder.castShadow = true;
    this._placeholder.scale.setScalar(_config.robotScale);
    root.add(this._placeholder);

    // ── Load idle GLB ────────────────────────────────────────────────────────
    this._loadIdleModel();

    // ── GSM subscription ────────────────────────────────────────────────────
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply a skin texture to all meshes on the robot.
   * Works for both the placeholder box and the loaded GLB model.
   * Called by NFT Skin Loader when ownership is verified.
   * Safe to call at any time including mid-run.
   *
   * @example
   * cr.applyTexture(loadedTexture);
   */
  applyTexture(texture: THREE.Texture | null): void {
    if (texture === null) {
      if (import.meta.env.DEV) {
        console.warn('[CharacterRenderer] applyTexture called with null — keeping current texture');
      }
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    // Traverse the root container so this works for both placeholder and GLB.
    this.robotObject3D.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.map = texture;
        mat.needsUpdate = true;
      }
    });
  }

  /**
   * Register a listener for the death animation complete event.
   * GSM subscribes to this to trigger Dead → ScoreScreen.
   *
   * @example
   * cr.onDeathComplete(() => gsm.transition(GameState.ScoreScreen));
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
    this._mixer?.stopAllAction();
    this._scene.remove(this.robotObject3D);
    this._deathListeners.clear();
  }

  // ── GLB loader ───────────────────────────────────────────────────────────────

  private _loadIdleModel(): void {
    const loader = new GLTFLoader();
    loader.load(
      this._config.idleModelPath,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(this._config.robotScale);
        model.position.y = this._config.modelGroundOffset;

        // Enable shadows on all meshes in the loaded model.
        model.traverse(obj => {
          if (obj instanceof THREE.Mesh) obj.castShadow = true;
        });

        // Swap placeholder for the real model.
        this.robotObject3D.remove(this._placeholder);
        this.robotObject3D.add(model);
        this._loadedModel = model;

        // Wire AnimationMixer and start idle clip.
        this._mixer = new THREE.AnimationMixer(model);
        const idleClip = THREE.AnimationClip.findByName(
          gltf.animations,
          this._config.idleClipName,
        );
        if (idleClip) {
          const action = this._mixer.clipAction(idleClip);
          action.setEffectiveTimeScale(this._config.idleAnimationSpeed);
          action.play();
        } else if (import.meta.env.DEV) {
          console.warn(
            `[CharacterRenderer] Clip "${this._config.idleClipName}" not found in ` +
            `${this._config.idleModelPath}. Available clips:`,
            gltf.animations.map(a => a.name),
          );
        }

        // Apply default texture immediately so the robot never appears untextured.
        // flipY must be false for glTF/GLB models — their UVs follow the glTF
        // spec (origin bottom-left), whereas Three.js TextureLoader defaults to
        // flipY=true which inverts the texture vertically on the model.
        new THREE.TextureLoader().load(
          this._config.defaultTexturePath,
          (tex) => { tex.flipY = false; this.applyTexture(tex); },
          undefined,
          (err) => {
            console.error('[CharacterRenderer] Failed to load default texture:', err);
          },
        );

        if (import.meta.env.DEV) {
          console.log('[CharacterRenderer] Idle model loaded:', this._config.idleModelPath);
        }
      },
      undefined,
      (err) => {
        // Load failed — placeholder mesh remains active as per GDD edge case.
        console.error('[CharacterRenderer] Failed to load idle model:', err);
      },
    );
  }

  // ── GSM handler ─────────────────────────────────────────────────────────────

  private _onStateChanged(event: StateChangedEvent): void {
    switch (event.to) {
      case GameState.Loading:
        this.robotObject3D.visible = false;
        this._cancelDeathTimer();
        break;

      case GameState.MainMenu:
        this.robotObject3D.visible = true;
        this._cancelDeathTimer();
        // TODO: crossfade to Idle clip when full AnimationMixer wiring is complete.
        break;

      case GameState.Running:
        this.robotObject3D.visible = true;
        this._cancelDeathTimer();
        if (event.from === GameState.ScoreScreen) {
          // Restart: hard-snap to start pose (no crossfade from death).
          // TODO: stop death action, reset mixer to frame 0 of Idle.
        }
        // TODO: crossfade Idle → Run (150ms) when Run clip is loaded.
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
