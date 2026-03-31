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
  private _idleModel:              THREE.Object3D | null = null;
  private _runModel:               THREE.Object3D | null = null;
  private _deathModel:             THREE.Object3D | null = null;
  private _activeModel:            THREE.Object3D | null = null;
  private _mixer:                  THREE.AnimationMixer | null = null;
  private _activeTexture:          THREE.Texture | null = null;
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

    // ── Preload GLB models ───────────────────────────────────────────────────
    // Idle: faces camera (rotation 0). Shown on MainMenu.
    this._loadModel(this._config.idleModelPath, this._config.idleClipName, 0, (m) => {
      this._idleModel = m;
      // Only swap idle in if we haven't already entered Running state.
      if (this._gsm.current !== GameState.Running) this._swapModel(m);
    });
    // Run: faces away from camera (rotation π). Shown during Running state.
    // If the run model finishes loading after the state transition, swap immediately.
    this._loadModel(this._config.runModelPath, this._config.runClipName, this._config.runModelYRotation, (m) => {
      this._runModel = m;
      if (this._gsm.current === GameState.Running) this._swapModel(m);
    });
    // Death: preloaded so the swap is instant when the player dies.
    this._loadModel(this._config.deathModelPath, this._config.deathClipName, this._config.deathModelYRotation, (m) => {
      this._deathModel = m;
      if (this._gsm.current === GameState.Dead) this._swapDeathModel();
    });

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
    texture.flipY = false; // glTF UV convention — must be false for Mixamo GLBs
    this._activeTexture = texture;
    // Traverse the root container so this works for placeholder and any loaded GLB.
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
    if (this._mixer) {
      this._mixer.update(deltaMs * 0.001);
    }
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

  /**
   * Load a GLB model, wire its AnimationMixer, and call back with the loaded scene.
   * The default texture is applied to the first model that loads successfully.
   * @param yRotation - Y rotation in radians (0 = faces camera, Math.PI = faces away)
   */
  private _loadModel(
    path: string,
    clipName: string,
    yRotation: number,
    onLoaded: (model: THREE.Object3D) => void,
  ): void {
    const loader = new GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(this._config.robotScale);
        model.position.y = this._config.modelGroundOffset;
        model.rotation.y = yRotation;

        model.traverse(obj => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            // Disable frustum culling — Mixamo SkinnedMesh bounding spheres are
            // computed in T-pose and become stale once bones animate, causing the
            // mesh to be incorrectly culled as it moves outside the T-pose bounds.
            obj.frustumCulled = false;
          }
        });

        // Use animations[0] directly — avoids any findByName reference mismatch.
        const clip = gltf.animations[0] ?? null;
        if (!clip && import.meta.env.DEV) {
          console.warn(`[CharacterRenderer] No animations found in ${path}.`);
        }
        const tagged = model as THREE.Object3D & { _clip?: THREE.AnimationClip };
        tagged._clip = clip ?? undefined;

        // Load default texture once (on the first model to finish loading).
        if (this._activeTexture === null) {
          new THREE.TextureLoader().load(
            this._config.defaultTexturePath,
            (tex) => { this.applyTexture(tex); },
            undefined,
            (err) => { console.error('[CharacterRenderer] Failed to load default texture:', err); },
          );
        }

        if (import.meta.env.DEV) {
          console.log(`[CharacterRenderer] Loaded: ${path}`);
        }

        onLoaded(model);
      },
      undefined,
      (err) => {
        console.error(`[CharacterRenderer] Failed to load model: ${path}`, err);
      },
    );
  }

  /**
   * Swap the active model inside the root container.
   * Stops the previous mixer, starts the new one, re-applies the current texture.
   */
  private _swapModel(model: THREE.Object3D): void {
    // Remove current active child (placeholder or previous model).
    if (this._activeModel) {
      this.robotObject3D.remove(this._activeModel);
    } else {
      this.robotObject3D.remove(this._placeholder);
    }

    this.robotObject3D.add(model);
    this._activeModel = model;

    // Build a fresh mixer now that the model is in the scene, then play the clip.
    // Constructing the mixer against a live scene hierarchy ensures bone targets resolve.
    this._mixer?.stopAllAction();
    const tagged = model as THREE.Object3D & { _clip?: THREE.AnimationClip };
    if (tagged._clip) {
      this._mixer = new THREE.AnimationMixer(model);
      this._mixer.clipAction(tagged._clip).play();
    } else {
      this._mixer = null;
    }

    // Re-apply the current texture so the swap is seamless.
    if (this._activeTexture) {
      this.robotObject3D.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          mat.map = this._activeTexture;
          mat.needsUpdate = true;
        }
      });
    }
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
        if (this._idleModel && this._activeModel !== this._idleModel) {
          this._swapModel(this._idleModel);
        }
        break;

      case GameState.Running:
        this.robotObject3D.visible = true;
        this._cancelDeathTimer();
        if (this._runModel && this._activeModel !== this._runModel) {
          this._swapModel(this._runModel);
        }
        break;

      case GameState.Dead:
        // Swap to death model immediately if loaded; otherwise timer fires as fallback.
        if (this._deathModel) {
          this._swapDeathModel();
        } else {
          this._startDeathTimer();
        }
        break;

      case GameState.ScoreScreen:
        // Hold final death pose. Timer already fired; nothing to do here.
        break;

      case GameState.Leaderboard:
        // Robot is behind menu layer — no pose change needed.
        break;
    }
  }

  // ── Death sequence ───────────────────────────────────────────────────────────

  /**
   * Swap to the death model, play its clip once (LoopOnce + clampWhenFinished),
   * and fire deathListeners when the AnimationMixer 'finished' event fires.
   * Falls back to the timer if the model has no clip.
   */
  private _swapDeathModel(): void {
    const model = this._deathModel!;
    this._swapModel(model);

    const tagged = model as THREE.Object3D & { _clip?: THREE.AnimationClip };
    if (this._mixer && tagged._clip) {
      // Re-configure the action for a one-shot death play.
      const action = this._mixer.clipAction(tagged._clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.reset().play();

      // Fire deathListeners when the clip finishes naturally.
      this._mixer.addEventListener('finished', () => {
        this._fireDeathListeners();
      });
    } else {
      // No clip — fall back to timer so the flow is never blocked.
      this._startDeathTimer();
    }
  }

  private _fireDeathListeners(): void {
    for (const listener of this._deathListeners) {
      try {
        listener();
      } catch (err) {
        console.error('[CharacterRenderer] deathComplete listener threw:', err);
      }
    }
  }

  // ── Death timer (fallback when no death clip is available) ───────────────────

  private _startDeathTimer(): void {
    this._cancelDeathTimer();
    this._deathTimer = setTimeout(() => {
      this._deathTimer = null;
      this._fireDeathListeners();
    }, this._config.deathDuration);
  }

  private _cancelDeathTimer(): void {
    if (this._deathTimer !== null) {
      clearTimeout(this._deathTimer);
      this._deathTimer = null;
    }
  }
}
