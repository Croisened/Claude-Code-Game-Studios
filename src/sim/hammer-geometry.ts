/**
 * Shared hammer geometry constants and pendulum kinematics. Imported by
 * both the sim (`@/sim/obstacle-gauntlet`) and the visuals
 * (`@/arena-visuals/gauntlet-traps`) so the kill-zone and the rendered
 * mesh stay in lock-step. Editing the swing formula here updates both
 * sides.
 */
import type { HammerSpec } from '@/sim/arena';

/** Length (metres) from pivot to head, along the arm's local -Y. */
export const HAMMER_ARM_LENGTH_M = 11.0;

/**
 * Max swing angle from vertical-down. < π/2 keeps the head BELOW the
 * cross-beam — at 0.48π the arm reaches ±10.98 m from the pivot at the
 * extreme of each swing.
 */
export const HAMMER_MAX_SWING_RAD = Math.PI * 0.48;

/**
 * Compute the hammer arm's rotation (radians around X) at a given sim
 * tick. The arm pivots at the centre of the cross-beam and swings as a
 * **true pendulum** in the YZ plane (perpendicular to robot motion),
 * passing through angle = 0 (straight down, kill posture) at the centre
 * of the sim's down window and reaching ±HAMMER_MAX_SWING_RAD at the
 * extremes of each swing. The swing is symmetric: arm goes down →
 * +max → down → -max → down each cycle.
 *
 * Sim/visual coupling: the sim's single down-window aligns with the
 * FIRST zero-crossing per cycle (offset=0). The arm passes through 0
 * a second time at offset=0.5 — that crossing is visually "down" but
 * the sim does not register it as a kill. v1 cosmetic tradeoff.
 */
export function hammerArmAngle(spec: HammerSpec, tickFloat: number): number {
  const phase =
    ((tickFloat % spec.cycleTicks) + spec.cycleTicks) % spec.cycleTicks;
  const downCenter = (spec.downStartTick + spec.downEndTick) / 2;
  const offset =
    ((phase - downCenter + spec.cycleTicks) % spec.cycleTicks) / spec.cycleTicks;
  return HAMMER_MAX_SWING_RAD * Math.sin(2 * Math.PI * offset);
}

/**
 * World-space Z of the hammer head at the given tick. Arm-local -Y maps
 * to world Z under X-axis rotation. At angle = 0 the head is at z = 0;
 * positive angle → -Z.
 */
export function hammerHeadZ(spec: HammerSpec, tickFloat: number): number {
  return -HAMMER_ARM_LENGTH_M * Math.sin(hammerArmAngle(spec, tickFloat));
}

/**
 * True if the hammer is currently in its "down" (deadly) phase at the
 * given sim tick. Pure modular arithmetic — no rng — so the sim and
 * renderer can both call this with identical results.
 */
export function isHammerDown(spec: HammerSpec, tick: number): boolean {
  const phase = ((tick % spec.cycleTicks) + spec.cycleTicks) % spec.cycleTicks;
  return phase >= spec.downStartTick && phase < spec.downEndTick;
}
