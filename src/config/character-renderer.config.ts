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
}

export const CHARACTER_RENDERER_CONFIG: CharacterRendererConfig = {
  crossfadeDuration:      150,
  deathDuration:          2000,
  robotScale:             1.0,
  idleAnimationSpeed:     1.0,
  runAnimationSpeed:      1.0,
  placeholderColor:       0xb44fff,
  placeholderGroundOffset: 0.9,  // half of 1.8-unit mesh height
};
