# Animation State Switcher — Game Design Document

> **Status**: Approved (2026-04-24)
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S4-05
> **System Index**: design/gdd/systems-index.md (#5)
> **Tier**: M (single API surface, ~150 LOC + tests)

---

## 1. Overview

The Animation State Switcher is a thin bridge layer that maps a per-robot
**state** (`'run'` | `'idle'` | `'death'`) onto Three.js `AnimationMixer`
crossfades. The renderer (S4-04) owns the mixers and clip actions; the sim
(Sprint 5+) owns the state values; the switcher translates between them.

The switcher is the **sole owner of `AnimationAction.play()` and
`crossFadeTo()` calls** in the codebase. The renderer constructs mixers and
`clipAction(...)` references but does not call `.play()` on any action. On
construction, the switcher walks every `RobotInstance` and starts the
default initial action (`'idle'`). Subsequent transitions happen via
`setState(id, state)` calls driven by the sim or, in v1 Sprint 4, from the
App Shell's smoke harness.

**Initial state vs. default state — they are different concepts.**
- *Initial state* is what the switcher plays on each robot when the
  switcher is constructed: hardcoded `'idle'`. Robots stand still until
  something tells them otherwise.
- *Default state* (`CONFIG.animation.defaultState`, currently `'run'`)
  describes the animation for the "alive and moving" sim phase. The sim
  reads this when transitioning a robot from setup to active racing.

The switcher's responsibilities:

1. Track each robot's current state.
2. Crossfade between states using `CONFIG.animation.crossfadeSeconds`.
3. Treat `death` specially: play once, clamp to the final pose, hold
   indefinitely (until something explicitly sets a different state — the
   switcher does not lock).
4. Be idempotent: `setState(id, currentState)` is a no-op (no flicker, no
   re-fade).
5. Apply a small per-id phase offset so 85 idle robots are not in
   lockstep.

What it does NOT own:

- **Mixer ownership** — `AnimationMixer` instances live on
  `RobotInstance.mixer`. The switcher reads them, never replaces them.
- **State policy** — whether a robot can come back from `death` is the
  sim's call; the switcher accepts any valid transition. (Sim v1 will
  refuse to revive dead robots; that policy lives in the sim, not here.)
- **Per-frame ticking** — `mixer.update(dt)` is the renderer's render
  loop responsibility. The switcher only invokes
  `play()`/`crossFadeTo()`.
- **Visual one-shots** — death VFX (particles, spotlight) belong to S4-12
  Winner VFX, not here.

Why it goes in Sprint 4: the renderer ships in S4-04 as a "no animation
playing by default" surface — without the switcher, robots would mount
silent. The switcher is the smallest possible system that turns the
renderer into a visibly-running scene that the sim can later drive.

---

## 2. Viewer Experience Goals

*(adapted from "Player Fantasy" — viewers experience the switcher as the
moment-to-moment animation feel of the field.)*

The viewer should never *notice* the switcher. They should notice its
absence (jank, popping, tearing). Concretely:

- **Smooth transitions.** When a robot moves from running to idle (or
  any pair), the change is a 200ms crossfade, not a hard cut. The viewer
  perceives a soft blend, not a snap.

- **Distinct death.** A dying robot transitions into the death animation
  smoothly, then **holds** the final dead pose. No looping flop, no
  T-pose flash, no return-to-idle. The death pose is the robot's
  permanent visual until a new state is commanded.

- **Per-robot independence.** Robot 47 dying does not affect robot 12's
  animation. Each instance's mixer is independent.

- **No tearing on rapid churn.** Even if the sim hammers
  `setState(id, ...)` every frame for some pathological robot, the
  switcher should not tear, allocate, or fail. Internally:
  same-state-as-current is a fast no-op; new-state-while-mid-crossfade
  re-targets cleanly.

- **No lockstep on idle.** When all 85 robots are idle (sim setup phase,
  pre-race), they breathe slightly out of sync — a per-id phase offset
  of `id * 0.07` seconds against the idle clip. Same trick as the spike
  used for `run`, applied to whichever clip is active on first play.

---

## 3. Detailed Rules

**File location.** `src/animation/state-switcher.ts`. Sibling to
`src/renderer/`. Tests at `src/animation/state-switcher.test.ts`.

**Public API.**

```ts
export type RobotAnimationState = 'run' | 'idle' | 'death';

export interface AnimationStateSwitcher {
  /** Drive a robot's animation to the given state with a crossfade.
   *  No-op if `state === current(id)`. Throws on invalid id or state. */
  setState(id: number, state: RobotAnimationState): void;

  /** Read the current state. Throws on unknown id (matches setState).
   *  Returns the most recent value passed to setState (or `'idle'` for
   *  any known id that has never transitioned). */
  current(id: number): RobotAnimationState;

  /** Stop and dispose any running actions across every instance. After
   *  dispose, further setState calls throw. */
  dispose(): void;
}

export function createAnimationStateSwitcher(
  renderer: Renderer,            // from src/renderer/renderer
): AnimationStateSwitcher;
```

Three exports total: the type, the interface, and the factory. Closure-
style construction matches the renderer pattern.

**Construction rules.**

- The factory takes the renderer (already mounted) and walks
  `renderer.getAllInstances()`.
- For each instance, it builds an internal `Map<id, ActionState>` where
  `ActionState = { state: RobotAnimationState; action: AnimationAction }`.
- It immediately calls `play()` on every instance's `idle` action with a
  per-id phase offset: `idleAction.time = (id * 0.07) % idleClip.duration`.
- This is the **only** call site for the initial `play()` in the entire
  codebase.
- If `renderer.getAllInstances()` is empty (mount not resolved), the
  factory throws `"Renderer not mounted; cannot construct switcher"`.

**Transition rules.**

- `setState(id, state)`:
  1. If id is not in the instance map → throw `"Unknown robot id: {id}"`.
  2. If state is not in `['run', 'idle', 'death']` → throw
     `"Invalid animation state: {state}"`.
  3. If state equals current state for that id → no-op (early return).
  4. Otherwise: get the new action via `mixer.clipAction(clips.get(state)!)`.
     Reset its time to 0, set weight 1, then call `currentAction.crossFadeTo(newAction, CONFIG.animation.crossfadeSeconds, false)`.
  5. If state is `'death'`: also call `newAction.setLoop(THREE.LoopOnce, 1)` and `newAction.clampWhenFinished = true` before the crossfade, so the action plays once and holds the final pose.
  6. If state is **not** `'death'` and the previous state was `'death'`:
     reset the new action's `setLoop(THREE.LoopRepeat, Infinity)` and
     `clampWhenFinished = false` to undo the death configuration.
  7. Update the internal map: `map.set(id, { state, action: newAction })`.

- The crossfade uses `false` for the `warpDuration` parameter (no time
  warp; both clips advance at their natural rate during the blend). This
  is the standard Three.js idiom for a "smooth blend without slowing
  down."

**Death-specific rules.**

- Death plays exactly **one** loop. After the loop finishes, the action
  is paused on its final frame (via `clampWhenFinished = true`).
- The switcher does **not** lock subsequent transitions. The sim can
  call `setState(id, 'idle')` after death and the switcher will fade
  back to idle. v1 sim policy says it won't, but the mechanism allows
  it — useful for development reset and future revive mechanics.
- A robot mid-crossfade-into-death that receives `setState(id, 'run')`
  before the death action completes: the standard crossfade kicks in
  again, blending from wherever death is in its play sequence into run.
  The death action is not retained after the crossfade completes; v1
  Sprint 4 accepts the small inefficiency of repeated `clipAction()`
  lookups (Three.js caches them per mixer).

**Disposal rules.**

- `dispose()` calls `action.stop()` on every tracked action and clears
  the internal map.
- Subsequent `setState()` calls throw `"Switcher disposed"`.
- The switcher does not own the renderer's mixers; it does not dispose
  them.
- `dispose()` is idempotent — calling twice is safe.

**Forbidden patterns.**

- `Math.random()` anywhere in the switcher — even for jitter, use a
  seeded RNG (`createRng` from `@/sim/rng`). v1 has no need for randomness.
- Storing `AnimationClip` references — the switcher reads them via
  `RobotInstance.clips` on every transition. Clips are stable.
- Calling `mixer.update()` — the render loop owns timing.
- Direct `play()` calls outside the constructor and `setState()`. The
  two call sites are the entire surface area.
- Caching the result of `getAllInstances()` after construction. Reading
  it once at construction is fine; the renderer's instance set is stable.

---

## 4. Implementation Approach

*(adapted from "Formulas" — animation timing has values rather than
formulas; this section documents the chosen pattern.)*

**Crossfade pattern (canonical):**

```ts
function setState(id: number, state: RobotAnimationState): void {
  const entry = byId.get(id);
  if (!entry) throw new Error(`Unknown robot id: ${id}`);
  if (state === entry.state) return;

  const inst = instanceById.get(id)!;
  const newClip = inst.clips.get(state)!;
  const newAction = inst.mixer.clipAction(newClip);

  if (entry.state === 'death' && state !== 'death') {
    newAction.setLoop(THREE.LoopRepeat, Infinity);
    newAction.clampWhenFinished = false;
  }
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
```

**State table:**

| From → To | run → idle | run → death | idle → run | idle → death | death → run | death → idle | same → same |
|-----------|-----------|-------------|------------|--------------|--------------|---------------|--------------|
| Crossfade | yes | yes | yes | yes | yes | yes | no-op |
| Loop config change | reset | set LoopOnce | reset | set LoopOnce | unset LoopOnce | unset LoopOnce | n/a |
| `clampWhenFinished` | false | true | false | true | false | false | n/a |

The "unset LoopOnce" branch on death→other matters because Three.js
`AnimationAction` retains its loop config across `crossFadeTo` calls.
Without resetting, a robot revived from death would play one cycle of
the new state and freeze.

**Memory model:**

| Resource | Owned by | Notes |
|----------|----------|-------|
| `AnimationAction` instances | renderer's `AnimationMixer` (cached per clip via `mixer.clipAction()`) | Three.js handles caching; same `(mixer, clip)` returns the same action. |
| `Map<id, ActionState>` | switcher | Tracks current state and current action ref per robot. ~85 small entries. |
| `RobotInstance` references | renderer | Switcher holds a reference to `getAllInstances()` result at construction. |

**No render-loop work.** All switcher logic happens at construction
(initial play) and on `setState()`. There is no per-frame switcher
behavior. The renderer's `mixer.update(dt)` advances the actions the
switcher has played.

---

## 5. Edge Cases

1. **Switcher constructed before renderer mounts.** The factory throws
   `"Renderer not mounted; cannot construct switcher"`. Caller must
   `await renderer.mount(container)` first.

2. **`setState(id)` for unknown id.** Throws `"Unknown robot id: {id}"`.
   Sim must validate ids before passing them in. v1 sim only emits ids
   in `[0, robotCount)`, so this should never fire in production.

3. **`setState(id, state)` with invalid state.** TypeScript catches at
   compile time for `RobotAnimationState`-typed arguments. Runtime
   validation rejects values outside `['run', 'idle', 'death']` for
   loose `string`-typed callers (e.g., debug tooling).

4. **Same-state setState (`setState(id, current(id))`).** No-op. Fast
   early return. No `play()`, no `crossFadeTo()`, no map mutation. This
   matters for naive sim loops that re-emit state every tick.

5. **Rapid state churn (`setState(id, ...)` every frame).** Each call
   triggers a `crossFadeTo()`. Three.js handles overlapping crossfades
   by composing them; the visible result may be a jittery blend, but
   no errors and no state corruption. This is graceful degradation;
   sim is expected to settle on a state for at least a few frames at a
   time.

6. **Mid-crossfade `setState`.** A robot 50% blended from `run` to
   `idle` receiving `setState(id, 'death')` triggers a fresh crossfade
   from idle (the new "current") to death. The previous run→idle
   crossfade completes naturally and is then overridden. Three.js does
   not crash on overlapping fades.

7. **Death action finished but viewer just tabbed back.** The death
   action is paused at its last frame via `clampWhenFinished = true`.
   `mixer.update(dt)` does not advance it further; the pose is held
   regardless of how long the user is away.

8. **`setState(id, 'death')` called twice in quick succession.** Same-
   state no-op on the second call. The death action is not restarted;
   the existing one continues toward its `clampWhenFinished` end frame.

9. **`setState(id, 'idle')` called on a robot still mid-death-action.**
   Standard crossfade applies. The death action's `LoopOnce` config is
   reset to `LoopRepeat` for the *next* time death is played; the
   current already-playing death action's behavior is unaffected by
   this reconfiguration.

10. **`current(id)` for unknown id.** Throws `"Unknown robot id: {id}"`,
    matching `setState`. Strict validation across the API surface; no
    silent misses. Callers must validate ids first if uncertain.

11. **`dispose()` then `setState()`.** Throws `"Switcher disposed"`.
    Caller error.

12. **`dispose()` twice.** Idempotent. Second call is a no-op.

13. **Switcher tries to play a state whose clip is missing.** The
    renderer GDD §3 mandates all three clips load successfully or
    `mount()` rejects. So this should never fire. Defensive fallback:
    if `inst.clips.get(state)` returns undefined, throw
    `"Missing animation clip: {state}"`.

14. **Renderer disposed but switcher still alive.** The renderer's
    mixers are gone; any `setState()` call would error inside Three.js.
    Caller responsibility: dispose the switcher *before* the renderer
    in cleanup. Documented in §6 dependency notes.

---

## 6. Dependencies

**Upstream dependencies (Switcher depends on):**

- **85-Instance Renderer (S4-04)** — reads `RobotInstance.mixer`,
  `RobotInstance.clips`, and the result of `renderer.getAllInstances()`.
  Construction requires the renderer to be mounted.
- **Config Module (S4-01)** — reads `CONFIG.animation.crossfadeSeconds`.
- **Three.js** — `AnimationAction.crossFadeTo`, `setLoop`,
  `clampWhenFinished`, `LoopOnce`, `LoopRepeat`. Locked at r168+.

**Downstream dependents (systems that depend on Switcher):**

| System | What it consumes | First read appears in |
|--------|------------------|------------------------|
| Sim Engine Core | `setState(id, state)` to drive per-tick animation transitions | Sprint 5 |
| Preact App Shell (smoke harness) | `setState` to demo run/idle/death transitions | Sprint 4 (S4-05 verification) |

**Cleanup ordering note:**
Callers must `switcher.dispose()` before `renderer.dispose()`. The
switcher reads from renderer-owned mixers; reversing the order would
read from disposed mixers. The Preact App Shell `useEffect` cleanup
captures both and orders them correctly.

**Bidirectional update to renderer GDD:**
`design/gdd/85-instance-renderer.md` is updated as part of S4-05 to:
- §3 "Initial state" — remove the auto-`play('run')` rule; renderer
  builds `clipAction()` references but does not call `play()`.
- §4 canonical pattern — remove the `runAction.play()` line; keep the
  `runAction.time` offset removed too (offset moves to switcher).
- §6 — add Animation State Switcher as a downstream dependent.
- §8 AC #5 — rephrase to verify mixer functionality without assuming
  any action is auto-playing (e.g., test attaches a switcher and
  checks `mixer.time > 0` after one frame).

**Forbidden dependencies:**

- No imports from `src/sim/`. The sim drives the switcher, not the
  reverse.
- No imports from any UI module. The switcher is a pure mechanism;
  callers (App Shell, Sim Engine) wire it.

---

## 7. Tuning Knobs

All tunable values live in `CONFIG.animation` (Config Module). The
switcher reads them; it does not own them.

| Path | Default | Safe Range | Affects | Notes |
|------|---------|------------|---------|-------|
| `animation.crossfadeSeconds` | 0.2 | 0.05–1.0 | Smoothness of state transitions | Lower = snappier (good for sudden death), higher = more cinematic. 0.2 reads as "responsive but soft." |
| `animation.defaultState` | `'run'` | one of `validStates` | What animation living, moving robots play | Used by the sim, not by the switcher's initial-state logic. |
| `animation.validStates` | `['run','idle','death']` | string[] of rig animation names | Recognized animation states | Expanding requires updating the switcher's `RobotAnimationState` type union. |

**Implementation-detail constants** (in
`src/animation/state-switcher.ts`, not `CONFIG`):

| Constant | Value | Reason it's not in CONFIG |
|----------|-------|----------------------------|
| `INITIAL_STATE` | `'idle'` | A behavioral invariant — robots stand still until the sim wakes them. Not a tuning surface. |
| `PHASE_OFFSET_COEFF` | `0.07` (seconds × id) | Visual desync constant; same value as the renderer used for run-action time. Tweaking is a code change, not a knob. |

**No new tuning surfaces.** All tunable behavior is already captured in
`CONFIG.animation`.

---

## 8. Acceptance Criteria

**Direct criteria** (testable on S4-05 implementation commit):

1. **File exists.** `src/animation/state-switcher.ts` is present, with
   `createAnimationStateSwitcher`, `AnimationStateSwitcher`,
   `RobotAnimationState` exports.

2. **Constructor walks instances and starts idle.** After construction,
   every robot's mixer has the idle action playing. Verified by
   asserting `current(id) === 'idle'` for every id.

3. **Per-id phase offset.** Robot 0 starts idle at `time = 0`; robot 1
   at `time = 0.07`; robot 47 at `time = (47 * 0.07) % idleDuration`.
   Verified by sampling several ids' active idle action times after
   construction.

4. **Throws if renderer not mounted.** `createAnimationStateSwitcher(r)`
   on an unmounted renderer throws
   `"Renderer not mounted; cannot construct switcher"`.

5. **`setState(id, state)` runs without error for all 6 transition
   pairs** (run↔idle, run↔death, idle↔death). Verified by setting up a
   robot, transitioning through each pair, asserting `current(id)`
   matches.

6. **Same-state `setState` is a no-op.** Counter wrapped around
   `mixer.clipAction()` shows zero new calls when state is unchanged.

7. **Death sets `LoopOnce` and `clampWhenFinished`.** After
   `setState(id, 'death')`, the active action's `loop === LoopOnce` and
   `clampWhenFinished === true`.

8. **Death → idle resets loop config.** After `setState(id, 'death')`
   then `setState(id, 'idle')`, the new idle action's `loop === LoopRepeat`
   and `clampWhenFinished === false`.

9. **Death holds final pose after one full loop.** After advancing
   the mixer past the death clip's duration, the action's `time`
   equals the clip's duration (clamped) and the action does not loop.

10. **Invalid id throws.** `setState(robotCount, 'idle')` and
    `setState(-1, 'idle')` both throw `"Unknown robot id: ..."`.

11. **Invalid state throws.** `setState(0, 'sleep' as never)` throws
    `"Invalid animation state: sleep"`.

12. **`current(id)` returns most recent state.** After
    `setState(id, 'run')`, `current(id) === 'run'`.

13. **`current(id)` for unknown id throws.** Same wording as
    `setState`: `"Unknown robot id: {id}"`. Verified for `-1` and
    `robotCount`.

14. **`dispose()` is idempotent.** Calling twice is safe.

15. **`setState()` after `dispose()` throws.** `"Switcher disposed"`.

16. **No `Math.random` in `src/animation/`.** Reviewer greps. Hits are
    rejected unless commented and justified.

17. **Typecheck green.** `npm run typecheck` exits 0.

18. **Test green.** `npm test` exits 0 with switcher tests passing.

19. **Renderer GDD bidirectional update applied.** `85-instance-renderer.md`
    §§3, 4, 6, 8 updated per §6 of this GDD.

20. **Renderer no longer auto-plays.** `src/renderer/renderer.ts` is
    edited as part of this task to remove the `runAction.play()` call;
    grep confirms no `play()` call remains in the renderer file.

21. **Smoke test: 85 idle robots breathing on dev hardware.** App
    Shell wires a switcher; no `setState(id, 'run')` calls on mount.
    Robots remain in their default `'idle'` state. The visual baseline
    is now "ready, not active" — running motion returns when the sim
    drives it (Sprint 5+). Verified by `npm run dev` + browser check
    showing 85 idle-animation robots at 60 FPS.

22. **Spike module deleted.** `src/renderer/renderer-spike.ts` is
    removed in the S4-05 commit. Per the renderer GDD AC #18, the
    spike's lifetime ends here.

**Discipline criteria** (enforced per PR going forward):

23. **Single play() call sites.** Code review verifies that
    `AnimationAction.play()` is called only inside the switcher
    constructor (initial idle) and `setState()` (transitions). The
    renderer must not call `.play()`.
