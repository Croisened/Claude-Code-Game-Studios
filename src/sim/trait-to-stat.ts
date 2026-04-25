/**
 * Trait → Stat Derivation — pure function mapping a robot's five raw NFT
 * traits to the seven derived simulation stats consumed by the sim engine.
 *
 * See design/gdd/trait-to-stat-derivation.md for the full contract. Key rules:
 * - Pure, synchronous, side-effect-free; no I/O, no `Math.random`.
 * - Does not validate, clamp, or mutate input. GIGO by design (R3, R7).
 * - All coefficients live in `CONFIG.sim.traitToStat` (R5); read at call time.
 */

import { CONFIG } from '@/config';

/**
 * Five raw NFT traits, integer values in `[0, 100]` from the trait CSV.
 * Field names match the lowerCamelCase convention used across the codebase.
 */
export interface RobotTraits {
  fullSend: number;
  degen: number;
  cipher: number;
  doubter: number;
  altruist: number;
}

/**
 * Seven derived simulation stats. Field order is part of the contract for
 * snapshot tests (R4) — never reorder.
 */
export interface SimStats {
  speed: number;
  acceleration: number;
  handling: number;
  pathfinding: number;
  caution: number;
  chaos: number;
  grace: number;
}

/**
 * Derive `SimStats` from `RobotTraits`. See trait-to-stat-derivation.md §4.
 */
export function deriveStats(traits: RobotTraits): SimStats {
  const k = CONFIG.sim.traitToStat;

  const f = traits.fullSend / 100;
  const d = traits.degen / 100;
  const c = traits.cipher / 100;
  const b = traits.doubter / 100;
  const a = traits.altruist / 100;

  return {
    speed: k.speed.base + k.speed.fullSendCoeff * f,
    acceleration:
      k.acceleration.base +
      k.acceleration.fullSendCoeff * f -
      k.acceleration.doubterCoeff * b,
    handling:
      k.handling.base +
      k.handling.cipherCoeff * c -
      k.handling.fullSendCoeff * f,
    pathfinding: k.pathfinding.base + k.pathfinding.cipherCoeff * c,
    caution: k.caution.doubterCoeff * b,
    chaos: k.chaos.degenCoeff * d,
    grace: k.grace.altruistCoeff * a,
  };
}
