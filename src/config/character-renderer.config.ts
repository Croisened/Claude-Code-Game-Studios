/**
 * Character Renderer — tuning configuration
 * All designer-adjustable values live here. No magic numbers in renderer code.
 * GDD: design/gdd/character-renderer.md § Tuning Knobs
 */

export interface CharacterRendererConfig {
  /** Blend duration between animation clips (ms). Range: 0–300. */
  crossfadeDuration: number;
  /**
   * Fallback death duration (ms) used until a real Death AnimationClip is
   * authored. Gates the Dead → ScoreScreen transition.
   * Range: 1500–3000. Target: ~2000.
   */
  deathDuration: number;
  /** Uniform scale applied to the robot Object3D. */
  robotScale: number;
  /** Playback speed multiplier for the Idle clip. */
  idleAnimationSpeed: number;
  /** Playback speed multiplier for the Run clip. */
  runAnimationSpeed: number;
  /** Hex color of the placeholder box mesh (used until GLB model is loaded). */
  placeholderColor: number;
  /** Y offset so the box mesh sits on the ground plane (half of mesh height). */
  placeholderGroundOffset: number;
  /**
   * Path to the idle .glb model served by Vite dev server.
   * Vite serves project-root files in development; production builds require
   * the assets folder to be copied to dist (handled in tools/build pipeline).
   */
  idleModelPath: string;
  /**
   * Y offset applied to the loaded GLB model so its base aligns with the
   * floor (y=0). Adjust if the model origin is not at the character's feet.
   * Range: -2 to 2.
   */
  modelGroundOffset: number;
  /**
   * Name of the idle animation clip inside the GLB file.
   * Must match the clip name exported by the 3D artist.
   */
  idleClipName: string;
  /**
   * Path to the default skin texture applied to the robot on load.
   * Overridden by NFT Skin Loader when the player is a verified holder.
   */
  defaultTexturePath: string;
}

export const CHARACTER_RENDERER_CONFIG: CharacterRendererConfig = {
  crossfadeDuration:       150,
  deathDuration:           2000,
  robotScale:              1.0,
  idleAnimationSpeed:      1.0,
  runAnimationSpeed:       1.0,
  placeholderColor:        0xb44fff,
  placeholderGroundOffset: 0.9,   // half of 1.8-unit placeholder mesh height
  idleModelPath:           '/assets/art/characters/robot/robot_idle.glb',
  modelGroundOffset:       0,     // tune if model origin is not at feet
  idleClipName:            'mixamo.com',
  defaultTexturePath:      '/assets/art/characters/robot/skins/Default.png',
};
