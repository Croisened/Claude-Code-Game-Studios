/**
 * Audio System — tuning configuration
 * GDD: design/gdd/audio-system.md § Tuning Knobs
 */

export interface AudioSystemConfig {
  /** Run loop SFX volume. Range: 0.0–0.6. Above 0.6 competes with music. */
  sfxRunVolume: number;
  /** Jump SFX volume. Range: 0.3–0.9. */
  sfxJumpVolume: number;
  /** Lane change SFX volume. Range: 0.2–0.8. */
  sfxLaneVolume: number;
  /** Death SFX volume. Range: 0.4–1.0. Should be the loudest SFX. */
  sfxDeathVolume: number;
  /** Background music volume. Range: 0.1–0.6. Above 0.6 dominates the mix. */
  musicVolume: number;
  /** Music fade duration in ms. Range: 200–1000. Below 200ms feels abrupt. */
  musicFadeDuration: number;

  /** Asset paths */
  sfxRunPath:   string;
  sfxJumpPath:  string;
  sfxLanePath:  string;
  sfxDeathPath: string;
  musicPath:    string;
}

export const AUDIO_SYSTEM_CONFIG: AudioSystemConfig = {
  sfxRunVolume:      0.3,
  sfxJumpVolume:     0.6,
  sfxLaneVolume:     0.5,
  sfxDeathVolume:    0.7,
  musicVolume:       0.4,
  musicFadeDuration: 500,

  sfxRunPath:   '/assets/audio/sfx/run-loop.wav',
  sfxJumpPath:  '/assets/audio/sfx/jump.wav',
  sfxLanePath:  '/assets/audio/sfx/lane-change.wav',
  sfxDeathPath: '/assets/audio/sfx/death.wav',
  musicPath:    '/assets/audio/music/music-loop.wav',
};
