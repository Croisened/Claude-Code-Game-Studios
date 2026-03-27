# Character Renderer

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: Identity First, Two-Week Discipline

## Overview

The Character Renderer owns the 3D robot model within the Three.js scene: loading
the shared `.glb` asset, managing the active animation state (idle, run, death), and
applying the correct texture set for the active NFT skin. The player never directly
interacts with this system — they experience it as the robot that runs, dives, and
dies on screen. Without it, there is no character, no NFT identity, and no emotional
hook; the entire "Identity First" pillar collapses to a hitbox.

## Player Fantasy

The Character Renderer is invisible when it works. The player doesn't think "the GLB
loaded and the animation is playing" — they think "my robot is running." The system's
job is to make that illusion seamless: the robot hits the ground moving, its idle
stance is confident, its run loop reads as urgent, and its death doesn't feel cheap.
For NFT holders, the moment the correct texture appears on the model is the moment the
game stops being a demo and becomes personal. That texture recognition — "that's mine"
— is the entire emotional payload of the Identity First pillar.

## Detailed Design

### Core Rules

1. The system owns a single Three.js `Object3D` (the robot model), loaded once at
   startup via `GLTFLoader`. It is never unloaded or duplicated during a session.
2. The robot mesh uses one shared material. NFT skin textures are applied by swapping
   `material.map` — no geometry changes, no model reloads.
3. Animation is driven by a Three.js `AnimationMixer` with three authored
   `AnimationClip`s: `Idle`, `Run`, and `Death`.
4. Exactly one clip plays at a time. Transitions between clips use a configurable
   crossfade duration (default: 150ms).
5. On scene load, the demo skin texture is applied immediately. If an NFT texture is
   pending (wallet query in flight), it replaces the demo skin when the texture
   resolves — this swap may happen mid-run.
6. The system fires a `deathAnimationComplete` custom event when the `Death` clip
   reaches its final frame. The Game State Manager subscribes to this event to
   trigger `Dead → ScoreScreen`.
7. The system exposes the robot's `Object3D` reference for downstream systems: Camera
   System reads position from it; Runner System uses it for lane snapping.
8. The system calls `mixer.update(delta)` on each render tick in all states where
   an animation is playing (`MainMenu`, `Running`, `Dead`, `ScoreScreen`). The mixer
   is paused only during `Loading` (model not yet visible).

### States and Transitions

The Character Renderer has no internal state machine. Its animation state is a direct
function of Game State Manager events. All transitions are driven externally.

| GSM Transition | Character Renderer Action |
|----------------|--------------------------|
| `→ Loading` | Load `.glb` via `GLTFLoader`; apply demo skin; hold first frame of `Idle` (not yet visible) |
| `→ MainMenu` | Make robot visible; play `Idle` clip (looping) |
| `→ Running` (from MainMenu) | Crossfade from `Idle` to `Run` clip (looping); 150ms crossfade |
| `→ Dead` | Crossfade from `Run` to `Death` clip (one-shot, non-looping); fire `deathAnimationComplete` event at clip end |
| `→ ScoreScreen` | Hold final frame of `Death` clip; robot remains visible behind score screen overlay |
| `→ Running` (restart from ScoreScreen) | Snap to frame 0 of `Idle` immediately (no crossfade from death pose); then crossfade to `Run` |
| `→ Leaderboard` | Hold current pose (robot is not visible; menu layer covers scene) |

### Interactions with Other Systems

| System | Direction | Interface |
|--------|-----------|-----------|
| Game State Manager | CR listens | Subscribes to `stateChanged(from, to)` event; drives animation state per the States table above |
| Game State Manager | CR emits | Fires `deathAnimationComplete` event when `Death` clip ends; GSM uses this to trigger `Dead → ScoreScreen` |
| NFT Skin Loader | CR receives | Exposes `applyTexture(texture: THREE.Texture)` method; NFT Skin Loader calls this when the NFT texture is ready |
| Camera System | CR exposes | Exposes `robotObject3D` reference; Camera System reads its world position each frame to compute follow position |
| Runner System | CR exposes | Exposes `robotObject3D` reference; Runner System sets `position.x` directly for lane snapping |

## Formulas

The Character Renderer performs no gameplay calculations. It contains two timing
values that govern visual behavior:

**Animation Crossfade Duration**
```
crossfadeDuration = 150ms (default)
```
Applied to: `Idle → Run` and `Run → Death` transitions.
Not applied to: `Death → Idle` snap on restart (hard reset, no crossfade).
Range: 0ms (instant cut) – 300ms (noticeable blend). Above 300ms feels laggy at run start.

**Death Animation Duration**
```
deathDuration = [TO BE DETERMINED during animation authoring]
Target: 1800ms – 2200ms
```
This value is authored into the `Death` AnimationClip keyframes. The
`deathAnimationComplete` event fires when the clip ends naturally. Adjust by editing
the clip, not by code timer.

Per the Game State Manager GDD: the `Dead → ScoreScreen` transition is gated on this
event. Keeping it in the ~2s range satisfies the "Death is a Beginning" pillar (fast
restart) without feeling abrupt.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| `.glb` fails to load | Show a placeholder cube mesh with demo skin; log error to console; do not block game startup | Gameplay must continue; a missing model is a dev-time error, not a user-facing failure |
| NFT texture swap arrives mid-death animation | Apply the texture immediately; do not interrupt the death animation | Texture swap is a material property change — it does not affect animation state |
| NFT texture swap arrives mid-run | Apply immediately; no visual interruption beyond the material update itself | Per design: async swap is allowed at any point during a run |
| `Death` clip fires `deathAnimationComplete` but GSM is already in `ScoreScreen` (duplicate event) | GSM ignores duplicate; CR fires once and does not re-fire | GSM's `Dead → ScoreScreen` transition guard rejects same-state calls per the GSM GDD |
| Player restarts before `deathAnimationComplete` fires (early restart queued) | CR calls `deathAction.stop()` and removes the `finished` event listener, then hard-snaps to `Idle` frame 0; `deathAnimationComplete` event is suppressed | GSM queues the restart per the GSM GDD; stopping the action before the listener is removed ensures no stale event fires |
| `applyTexture()` called with a null or invalid texture | Log warning; keep current texture active; do not crash | Defensive: NFT Skin Loader may call this before the texture is fully decoded |
| Two `applyTexture()` calls in rapid succession (race condition) | Last-caller wins; apply whichever texture arrives last | Simple and correct; texture loading is idempotent on the material |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Game State Manager | Upstream | CR subscribes to `stateChanged` events; CR emits `deathAnimationComplete` back | **Hard** — without GSM, CR has no trigger to change animation state |
| NFT Skin Loader | Downstream | NFT Skin Loader calls `CR.applyTexture(texture)` | **Soft** — CR functions fully with demo skin if NFT Skin Loader never calls in |
| Camera System | Downstream | Camera System reads `CR.robotObject3D.position` each frame | **Hard** — Camera System cannot follow the robot without this reference |
| Runner System | Downstream | Runner System writes `CR.robotObject3D.position.x` for lane snapping | **Hard** — Runner System cannot move the robot without this reference |

**Bidirectional note**: The Game State Manager GDD lists this system in its
interactions table. The contracts defined here are consistent with those entries.

**Provisional contracts** (downstream systems not yet designed):
- Camera System expects `robotObject3D` to be a stable `THREE.Object3D` reference
  that persists across runs (not re-created on restart). Camera System will cache
  this reference at init.
- Runner System expects `position.x` to be the only property it writes. `position.y`
  and `position.z` are owned by the Character Renderer and physics system respectively.

## Tuning Knobs

| Knob | Default | Safe Range | Effect | Breaks If… |
|------|---------|------------|--------|------------|
| `crossfadeDuration` | 150ms | 0 – 300ms | Blend time between animation clips | > 300ms: run start feels sluggish; < 0: invalid |
| `deathAnimationDuration` | ~2000ms | 1500 – 3000ms | Length of `Death` clip; gates `Dead → ScoreScreen` transition | < 1500ms: death feels abrupt; > 3000ms: feels like punishment |
| `robotScale` | 1.0 | 0.5 – 2.0 | Uniform scale of the robot `Object3D` | Changing without updating Camera System and Runner System lane positions creates visual misalignment |
| `idleAnimationSpeed` | 1.0 | 0.5 – 2.0 | Playback speed multiplier for `Idle` clip | > 2.0: robot looks jittery at rest |
| `runAnimationSpeed` | 1.0 | 0.5 – 2.0 | Playback speed multiplier for `Run` clip | Changing independently of forward speed creates a disconnect between visual stride and environment scroll rate |

All tuning knobs live in a single config object (e.g., `CHARACTER_RENDERER_CONFIG`)
loaded from an external data file. No magic numbers in code.

## Visual/Audio Requirements

[To be designed]

## UI Requirements

[To be designed]

## Acceptance Criteria

- [ ] Robot `.glb` model loads and is visible in the Three.js scene before `MainMenu` state is entered
- [ ] `Idle` animation plays on loop when game is in `MainMenu` state
- [ ] `Run` animation begins within 150ms of entering `Running` state (crossfade visible, not an instant cut)
- [ ] `Death` animation plays on `→ Dead` transition and does not loop
- [ ] `deathAnimationComplete` event fires exactly once per death, at the natural end of the `Death` clip
- [ ] `deathAnimationComplete` event fires in under 3000ms of `→ Dead` transition
- [ ] On restart (`ScoreScreen → Running`), robot snaps to start pose with no lingering death animation frames visible
- [ ] Demo skin is visible on the robot at scene load before any wallet query resolves
- [ ] Calling `applyTexture(nftTexture)` while `Run` animation is playing swaps the material texture without interrupting the animation
- [ ] Calling `applyTexture(null)` produces a console warning and leaves the current texture unchanged
- [ ] `robotObject3D` reference is stable across multiple run/death/restart cycles (same object, not re-created)
- [ ] Robot renders at target framerate (60fps) on mid-range desktop hardware during `Run` state
- [ ] All tuning knobs are defined in an external config file; changing them requires no code edits

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| What animation authoring tool will be used? (Blender → .glb export, or Three.js procedural keyframes?) | Developer | Before implementation begins | Unresolved |
| How many frames is the `Death` clip? (Determines exact `deathDuration` value) | Developer / Artist | During animation authoring | Unresolved — target 1800–2200ms |
| Should a VFX effect accompany the death animation (spark burst, screen flash)? | Developer | After core animation works; v1 polish pass | Deferred — design death animation first, add FX as polish |
| Should `Loading` state show a progress bar or static logo? (Robot not yet visible during Loading) | Designer | Main Menu GDD | Deferred to Main Menu GDD |
| Does the robot need `Jump` and `Slide` animation clips? (Game concept mentions jump/slide inputs) | Designer | Runner System GDD | Provisional: likely yes — flag for Runner System GDD to confirm and add clips to this system's clip list |
