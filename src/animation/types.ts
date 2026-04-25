/**
 * Shared animation types.
 *
 * `RobotAnimationState` lives here (not in the renderer or the switcher) so
 * neither module owns the conceptual definition — both are downstream
 * consumers. Keeps the renderer ↔ switcher import graph acyclic and the
 * domain vocabulary centralised.
 */

/** The three animation states recognised in v1.
 *  Mirrors `CONFIG.animation.validStates`. */
export type RobotAnimationState = 'run' | 'idle' | 'death';
