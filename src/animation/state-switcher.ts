/**
 * Robo Rhapsody Sim — Animation State Switcher.
 *
 * Bridge layer that maps a per-robot RobotAnimationState ('run' | 'idle' |
 * 'death') onto Three.js AnimationMixer crossfades. The renderer (S4-04)
 * owns the mixers and clip references; this module is the sole owner of
 * `play()` and `crossFadeTo()` calls codebase-wide.
 *
 * Construction starts every robot in the 'idle' state with a per-id phase
 * offset so 85 idles don't breathe in lockstep. Subsequent transitions
 * happen via `setState(id, state)` calls driven by the sim (Sprint 5+) or
 * by the App Shell smoke harness (Sprint 4).
 *
 * See design/gdd/animation-state-switcher.md for the full contract.
 */
import * as THREE from 'three';
import { CONFIG } from '@/config';
import type { RobotAnimationState } from '@/animation/types';
import type { Renderer, RobotInstance } from '@/renderer/renderer';

const INITIAL_STATE: RobotAnimationState = 'idle';
const PHASE_OFFSET_COEFF = 0.07; // seconds × id

const VALID_STATES: ReadonlySet<RobotAnimationState> = new Set([
  'run',
  'idle',
  'death',
]);

interface ActionState {
  state: RobotAnimationState;
  action: THREE.AnimationAction;
}

export interface AnimationStateSwitcher {
  /** Drive a robot's animation to the given state with a crossfade.
   *  No-op if `state === current(id)`. Throws on invalid id or state. */
  setState(id: number, state: RobotAnimationState): void;

  /** Read the current state. Throws on unknown id (matches setState). */
  current(id: number): RobotAnimationState;

  /** Stop running actions across every instance and detach. After dispose,
   *  further setState/current calls throw. Idempotent. */
  dispose(): void;
}

export function createAnimationStateSwitcher(
  renderer: Renderer,
): AnimationStateSwitcher {
  const instances = renderer.getAllInstances();
  if (instances.length === 0) {
    throw new Error('Renderer not mounted; cannot construct switcher');
  }

  const byInstance = new Map<number, RobotInstance>();
  const byId = new Map<number, ActionState>();
  let disposed = false;

  for (const inst of instances) {
    byInstance.set(inst.id, inst);

    const idleClip = inst.clips.get('idle');
    if (!idleClip) {
      throw new Error(`Missing animation clip: idle (robot ${inst.id})`);
    }

    const idleAction = inst.mixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.clampWhenFinished = false;
    idleAction.reset();
    idleAction.time = (inst.id * PHASE_OFFSET_COEFF) % idleClip.duration;
    idleAction.setEffectiveWeight(1);
    idleAction.play();

    byId.set(inst.id, { state: INITIAL_STATE, action: idleAction });
  }

  function assertNotDisposed(): void {
    if (disposed) throw new Error('Switcher disposed');
  }

  function assertKnownId(id: number): void {
    if (!byInstance.has(id)) throw new Error(`Unknown robot id: ${id}`);
  }

  function assertValidState(state: RobotAnimationState): void {
    if (!VALID_STATES.has(state)) {
      throw new Error(`Invalid animation state: ${state}`);
    }
  }

  function setState(id: number, state: RobotAnimationState): void {
    assertNotDisposed();
    assertKnownId(id);
    assertValidState(state);

    const entry = byId.get(id)!;
    if (state === entry.state) return;

    const inst = byInstance.get(id)!;
    const newClip = inst.clips.get(state);
    if (!newClip) throw new Error(`Missing animation clip: ${state}`);

    const newAction = inst.mixer.clipAction(newClip);

    // If we're leaving 'death', explicitly reset loop config — Three.js
    // retains it on the AnimationAction across crossFadeTo calls, and a
    // revived robot would freeze on the first cycle without this.
    if (entry.state === 'death' && state !== 'death') {
      newAction.setLoop(THREE.LoopRepeat, Infinity);
      newAction.clampWhenFinished = false;
    }

    // Death is one-shot, holds final pose.
    if (state === 'death') {
      newAction.setLoop(THREE.LoopOnce, 1);
      newAction.clampWhenFinished = true;
    }

    newAction.reset();
    newAction.setEffectiveWeight(1);
    newAction.play();
    entry.action.crossFadeTo(newAction, CONFIG.animation.crossfadeSeconds, false);

    byId.set(id, { state, action: newAction });
  }

  function current(id: number): RobotAnimationState {
    assertNotDisposed();
    assertKnownId(id);
    return byId.get(id)!.state;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const entry of byId.values()) {
      entry.action.stop();
    }
    byId.clear();
    byInstance.clear();
  }

  return { setState, current, dispose };
}
