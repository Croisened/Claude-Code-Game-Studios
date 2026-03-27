# Runner System

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: The City Hunts You, Death is a Beginning

## Overview

The Runner System owns the robot's in-run behavior: auto-forward movement, lane
switching, jumping, sliding, and collision detection. It subscribes to Game State
Manager events to enable/disable itself, reads actions from the Input System,
writes the robot's X position to the Character Renderer's `robotObject3D`, calls
`ER.setScrollSpeed()` every tick to drive the world's forward motion, and fires a
`collisionDetected` event when the robot's hitbox overlaps an obstacle. It is the
system that makes input feel like movement and movement feel like survival.

## Player Fantasy

The Runner System is the player's hands on the robot. When they press left, the
robot moves left — no softness, no forgiveness lag, no ambiguity. The satisfaction
of this system is the narrow escape: a lane change that clears a drone with half a
unit to spare, a jump that crests a barrier with no room above. The robot feels
athletic and precise — it goes exactly where commanded, exactly when commanded.
Dying feels earned because the controls never cheated. This precision is also what
makes a death feel like the player's mistake, not the game's — which is what turns
death into motivation instead of frustration.

## Detailed Design

### Core Rules

1. The Runner System owns the robot's locomotion: lane position (X axis), jump arc
   (Y axis via Rapier), slide state, and current forward speed.
2. The robot's Z position is always 0. Forward motion is produced by calling
   `ER.setScrollSpeed(currentSpeed)` every render tick.
3. On every `→ Running` transition, the robot snaps to `LANE_CENTER` (X = 0),
   Rapier velocity is zeroed, and locomotion state resets to `Standing`.
4. **Lane changes**: `LANE_LEFT` sets the robot's Rapier body translation X to
   `LANE_LEFT` immediately; enable3d syncs this to `robotObject3D.position.x`.
   `LANE_RIGHT` sets Rapier body translation X to `LANE_RIGHT` immediately.
   Attempting to move further left from `LANE_LEFT` or further right from
   `LANE_RIGHT` is silently ignored. Lane changes are permitted regardless of jump
   or slide state.
5. **Jump**: `JUMP` applies an upward impulse (`jumpForce`) to the robot's Rapier
   body. Rapier gravity brings the robot back to ground level (`groundY = 0`).
   `JUMP` while airborne is ignored (no double-jump). `JUMP` while sliding cancels
   the slide immediately and initiates the jump.
6. **Slide**: `SLIDE` switches the robot's Rapier collider to `crouchedCollider`
   dimensions and starts a `slideDuration` timer. At timer expiry the collider
   reverts to `standingCollider` and locomotion state returns to `Standing`. `SLIDE`
   while already sliding is ignored. `SLIDE` while airborne is ignored.
7. The Runner System calls `InputSystem.enable()` on `→ Running` and
   `InputSystem.disable()` on `→ Dead` and `→ MainMenu`. It is the sole caller of
   both methods.
8. The Runner System owns `currentSpeed` (units/second). Every tick it calls
   `ER.setScrollSpeed(currentSpeed)`. In v1, the Difficulty Curve calls
   `RS.setSpeed(newSpeed)` to override this value. For MVP, `currentSpeed` ramps
   from `initialScrollSpeed` at `mvpSpeedRampRate` units/s², capped at `maxSpeed`.
9. **Collision**: On the first Rapier `onCollisionEnter` callback between the robot
   collider and an obstacle collider, the Runner System emits a `collisionDetected`
   event. A `collisionFired` flag prevents duplicate emissions for the remainder of
   the run. The flag resets on every `→ Running` transition.
10. Landing is detected when `robot.position.y ≤ groundY + landingEpsilon` while in
    `Jumping` state. At that moment, Y velocity is zeroed and locomotion state
    transitions to `Standing`.

### States and Transitions

**Internal locomotion states** (independent of GSM state):

| State | Entry | Exit | Active Collider |
|-------|-------|------|-----------------|
| `Standing` | Run start; slide expires; landing detected | `JUMP` action; `SLIDE` action | `standingCollider` |
| `Jumping` | `JUMP` action (from Standing or Sliding) | Landing detected (`robot.y ≤ groundY + ε`) | `standingCollider` (elevated by physics) |
| `Sliding` | `SLIDE` action (from Standing only) | `slideDuration` expires; `JUMP` action cancels early | `crouchedCollider` |

**GSM-driven transitions**:

| GSM Transition | Runner System Action |
|----------------|----------------------|
| `→ Running` (from any) | Snap `robot.position.x = LANE_CENTER`; zero Rapier velocity; set locomotion = `Standing`; reset `collisionFired = false`; call `InputSystem.enable()`; set `currentSpeed = initialScrollSpeed` |
| `→ Dead` | Call `InputSystem.disable()`; halt locomotion updates |
| `→ MainMenu` | Call `InputSystem.disable()`; halt locomotion updates |
| `→ ScoreScreen` | No action (input already disabled) |
| `→ Loading`, `→ Leaderboard` | No action |

### Interactions with Other Systems

| System | Direction | Interface |
|--------|-----------|-----------|
| Game State Manager | Runner listens | Subscribes to `stateChanged(from, to)`; drives enable/disable and reset per GSM table above |
| Game State Manager | Runner emits | Fires `collisionDetected` event; GSM subscribes and triggers `Running → Dead` |
| Input System | Runner controls | Calls `IS.enable()`/`IS.disable()`; subscribes to `IS.on('action', handler)` as sole consumer |
| Character Renderer | Runner reads/writes/calls | Reads `robotObject3D` reference at init; sets Rapier body translation X on lane changes (enable3d syncs to `position.x`); calls `CR.playAnimation('Jump')` on jump takeoff, `CR.playAnimation('Run')` on landing, `CR.playAnimation('Slide')` on slide start, `CR.playAnimation('Run')` on slide expire |
| Environment Renderer | Runner reads/calls | Reads `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` constants at init; calls `ER.setScrollSpeed(currentSpeed)` every tick |
| Difficulty Curve | Runner receives | Difficulty Curve calls `RS.setSpeed(newSpeed)` in v1; Runner System propagates to ER via `setScrollSpeed` |
| Score & Distance Tracker | Runner calls | Runner calls `SDT.addDistance(currentSpeed × delta)` every tick during `Running` state; SDT accumulates distance without a dependency on Runner System |
| Obstacle System | Downstream (no direct interface) | Obstacle System registers Rapier colliders on obstacles; Rapier fires Runner System's collision callback automatically |
| Camera System | Downstream (no direct interface) | Camera follows `robot.position.x` automatically — no Runner System API call needed |

## Formulas

**Jump arc (Rapier impulse + gravity):**
```
impulse = Vector3(0, jumpForce, 0)   applied once on JUMP action
robot.y per tick: governed by Rapier gravity (gravityScale)

Peak height estimate:
  peakHeight ≈ jumpForce² / (2 × gravity)

Air time estimate:
  airTime ≈ 2 × jumpForce / gravity
```

**Landing detection (checked every tick while in Jumping state):**
```
if robot.position.y ≤ groundY + landingEpsilon:
    robot.position.y = groundY
    rapierBody.linvel.y = 0
    locomotionState = Standing
```

**Forward speed (MVP ramp, called every tick during Running state):**
```
currentSpeed += mvpSpeedRampRate × delta
currentSpeed = Math.min(currentSpeed, maxSpeed)
```
In v1, the Difficulty Curve overrides this by calling `RS.setSpeed(newSpeed)`.
The MVP ramp is disabled automatically when `mvpSpeedRampRate = 0`.

**Variable table:**

| Variable | Description | Default |
|----------|-------------|---------|
| `initialScrollSpeed` | Speed at run start (units/s) | 8 |
| `mvpSpeedRampRate` | Speed increase per second (units/s²) | 0.5 |
| `maxSpeed` | Speed cap (units/s) | 25 |
| `jumpForce` | Upward impulse magnitude | 12 |
| `gravity` | Rapier world gravity (Y axis, positive = down) | 20 |
| `groundY` | Robot floor Y position | 0 |
| `landingEpsilon` | Landing detection tolerance (units) | 0.05 |
| `slideDuration` | Time crouched before auto-stand (ms) | 600 |
| `standingCollider` | Robot hitbox dimensions W×H×D (units) | 1.0 × 1.8 × 0.8 |
| `crouchedCollider` | Robot hitbox dimensions W×H×D when sliding (units) | 1.0 × 0.9 × 0.8 |

**Estimates at defaults:**
```
peakHeight ≈ 12² / (2 × 20)  = 3.6 units
airTime    ≈ 2 × 12 / 20     = 1.2 seconds

Speed at 60s of run: 8 + 0.5×60 = 38 → capped at 25 units/s
Time to reach maxSpeed:          (25 − 8) / 0.5 = 34 seconds of run time
```

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| `JUMP` while airborne | Ignore silently | No double-jump per Core Rule 5 |
| `SLIDE` while airborne | Ignore silently | No ground to slide on; robot is mid-jump |
| `JUMP` while sliding | Cancel slide immediately (revert to `standingCollider`), then apply jump impulse | More forgiving than ignoring; prevents the "trapped in slide" frustration |
| `LANE_LEFT` while already in `LANE_LEFT` | Ignore silently | No valid lane to the left |
| `LANE_RIGHT` while already in `LANE_RIGHT` | Ignore silently | No valid lane to the right |
| Two `LANE_LEFT` actions in the same frame (two keys mapped to same action) | Execute first; second is ignored because robot is already at `LANE_LEFT` | Input System may emit both; Runner System's "already at target" guard handles it |
| Rapier collision fires before `→ Running` transition fully completes | `collisionFired` resets at the start of `→ Running` handling; any prior Dead-state contact cannot bleed into the new run | Flag reset precedes physics resume |
| Rapier fires multiple `onCollisionEnter` callbacks for the same obstacle | `collisionFired = true` after first emission; subsequent callbacks are no-ops | Rapier can fire multiple enter events per contact; one death per run |
| Slide timer expires while a new slide is mid-air (edge: JUMP cancelled slide, robot re-slid after landing) | Timer is cancelled when slide is cancelled by JUMP; new timer starts fresh on the next SLIDE action | No stale timers from cancelled slides |
| `landingEpsilon` too small — Rapier micro-bounces keep robot above `groundY` | Increase `landingEpsilon` or add a `grounded` flag: set true when `abs(linvel.y) < 0.1` and `robot.y < groundY + 0.1` | Tune empirically during implementation |
| Robot tunnels through an obstacle at high speed | Enable Rapier CCD (continuous collision detection) on the robot's Rapier body | CCD adds slight overhead; acceptable for a single robot body |
| `RS.setSpeed()` called with value below `initialScrollSpeed` | Accept — Difficulty Curve may legitimately reduce speed (v1 powerup) | Runner System does not clamp Difficulty Curve inputs |
| `RS.setSpeed()` called with a negative value | Clamp to 0; log a console warning | Negative scroll speed would reverse the environment |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Game State Manager | Upstream | Runner subscribes to `stateChanged`; emits `collisionDetected` back | **Hard** — without GSM, Runner has no trigger to enable/disable or notify of death |
| Input System | Upstream | Runner calls `IS.enable()`/`IS.disable()`; subscribes to action events as sole consumer | **Hard** — without Input System, the robot cannot be controlled |
| Character Renderer | Upstream | Runner reads `robotObject3D` reference at init; writes `position.x` on each lane change | **Hard** — without CR, Runner has no object to move |
| Environment Renderer | Upstream | Runner reads `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` at init; calls `ER.setScrollSpeed(currentSpeed)` every tick | **Hard** — without ER lane constants, Runner cannot compute valid X positions; without `setScrollSpeed`, world stands still |
| Camera System | Downstream | Camera reads `robot.position.x` each frame automatically — no direct interface | **Soft** — Runner functions without Camera System |
| Obstacle System | Downstream | Obstacle System registers Rapier colliders on each obstacle; Runner's collision callback fires automatically | **Soft** — Runner functions without Obstacle System; robot runs indefinitely |
| Difficulty Curve | Downstream | Difficulty Curve calls `RS.setSpeed(newSpeed)` in v1 to override MVP ramp | **Soft** — Runner uses built-in MVP ramp without Difficulty Curve |
| Score & Distance Tracker | Downstream | Runner calls `SDT.addDistance(currentSpeed × delta)` every tick; SDT requires no Runner System reference | **Soft** — Runner functions without SDT; distance just won't be tracked |

**Bidirectional consistency:**
- Character Renderer GDD: "Runner System writes `position.x`; `position.y` and `position.z` are owned by CR/physics." ✅
- Environment Renderer GDD: "Runner System is the sole caller of `setScrollSpeed()`." ✅
- Input System GDD: "Runner System is sole consumer of all action events; calls enable/disable." ✅
- Game State Manager GDD: "Runner fires `collisionDetected`; GSM subscribes and triggers `Running → Dead`." ✅
- Camera System GDD: "Runner System writes `robot.position.x`; camera follows automatically." ✅

**Provisional contracts** (downstream systems not yet designed):
- Obstacle System must register each obstacle's Rapier body so that Runner System's `onCollisionEnter` callback fires automatically. Obstacle System must NOT emit `collisionDetected` directly.
- Difficulty Curve must call `RS.setSpeed()` and must NOT call `ER.setScrollSpeed()` directly (ER GDD confirms this; mirrored here).

## Tuning Knobs

| Knob | Default | Safe Range | Effect | Breaks If… |
|------|---------|------------|--------|------------|
| `initialScrollSpeed` | 8 units/s | 4 – 12 | Run-start feel; lower = more onboarding window | < 4: game feels sluggish immediately; > 12: new players have no time to react to first obstacle |
| `mvpSpeedRampRate` | 0.5 units/s² | 0 – 2 | How quickly speed increases; 0 = constant speed (testing mode) | > 2: reaches maxSpeed in under 9 seconds; difficulty spikes too fast |
| `maxSpeed` | 25 units/s | 15 – 40 | Peak speed the run reaches | < 15: game never gets truly challenging; > 40: obstacle reaction time drops below ~100ms at standard look-ahead |
| `jumpForce` | 12 | 6 – 18 | Jump height and air time | < 6: robot barely leaves ground; > 18: air time exceeds 2.4s, jump becomes dominant avoidance tool |
| `gravity` | 20 | 10 – 30 | Fall speed; pairs with `jumpForce` | Too low + high jumpForce = floaty; too high = snappy but arc feels unnatural |
| `slideDuration` | 600ms | 300 – 1200ms | How long crouched hitbox is active | < 300ms: slide feels unresponsive; > 1200ms: player locked out of jump for too long |
| `standingCollider` | 1.0 × 1.8 × 0.8 | — | Standing hitbox W×H×D | Too large: unfair collisions; too small: obstacles visually pass through |
| `crouchedCollider` | 1.0 × 0.9 × 0.8 | — | Crouched hitbox W×H×D | `crouchedHeight` must be less than `standingHeight` or slide has no effect |
| `landingEpsilon` | 0.05 units | 0.01 – 0.2 | Landing detection ground threshold | Too small: Rapier micro-bounces prevent landing; too large: robot "lands" while still visibly airborne |

**Interaction notes**:
- `jumpForce` and `gravity` interact — tune together using the peak height and air time formulas.
- `maxSpeed` and obstacle design interact — obstacle placement must give at least ~300ms reaction time at `maxSpeed`.
- `mvpSpeedRampRate = 0` disables the MVP ramp entirely; useful during obstacle design and playtesting.

All knobs live in `RUNNER_SYSTEM_CONFIG`. No magic numbers in code.

## Visual/Audio Requirements

The Runner System drives animation state changes via Character Renderer. This resolves
the CR GDD open question about `Jump` and `Slide` clips — both are required.

**Character Renderer clips needed** (updated from CR GDD):
`Idle`, `Run`, `Jump`, `Slide`, `Death` — all five clips. CR must expose
`playAnimation(clipName: string)` so Runner System can trigger Jump and Slide.

| Action | Runner System Call | Animation Behavior | MVP | v1 |
|--------|-------------------|--------------------|-----|----|
| JUMP pressed | `CR.playAnimation('Jump')` | Jump clip plays; crossfades to Run on landing | Placeholder crossfade | Thruster-burst VFX at takeoff |
| Landing detected | `CR.playAnimation('Run')` | Crossfade Jump → Run (50ms default) | ✓ | ✓ |
| SLIDE pressed | `CR.playAnimation('Slide')` | Slide clip plays for `slideDuration` | Placeholder crouch pose | Spark/particle trail |
| Slide expires | `CR.playAnimation('Run')` | Crossfade Slide → Run (50ms) | ✓ | ✓ |
| Lane change | No call | Instant snap; no dedicated animation | ✓ | v1: brief lean bias |
| Collision | No call (handled by GSM → CR) | Death clip (owned by Character Renderer) | ✓ | ✓ |

**Audio**: Runner System makes no audio calls. Audio System subscribes independently to
GSM state changes and player-facing events. Speed-responsive audio (wind intensity) is
owned by Audio System, which may read `RS.currentSpeed` directly.

## UI Requirements

None. Runner System produces no UI elements. All in-run information (score, distance)
is owned by the Score & Distance Tracker and HUD systems.

## Acceptance Criteria

- [ ] Robot spawns at `LANE_CENTER` (X = 0) at the start of every run
- [ ] Pressing `LANE_LEFT` from center lane moves robot to X = −3 within 1 frame
- [ ] Pressing `LANE_RIGHT` from center lane moves robot to X = +3 within 1 frame
- [ ] Pressing `LANE_LEFT` while already in `LANE_LEFT` produces no movement
- [ ] Pressing `LANE_RIGHT` while already in `LANE_RIGHT` produces no movement
- [ ] Lane changes are valid while airborne — robot X updates even during a jump
- [ ] `JUMP` applies an upward impulse; robot rises to approximately 3.6 units peak height at defaults
- [ ] Robot returns to `groundY = 0` after every jump; locomotion state returns to `Standing` on landing
- [ ] Double-jump is impossible — `JUMP` while airborne has no effect
- [ ] `SLIDE` shrinks the robot's hitbox to `crouchedCollider` dimensions within the same frame
- [ ] Crouched hitbox auto-reverts to `standingCollider` after `slideDuration` (600ms at default)
- [ ] `SLIDE` while airborne has no effect
- [ ] `JUMP` while sliding cancels the slide and initiates the jump within 1 frame
- [ ] `ER.setScrollSpeed(currentSpeed)` is called every tick during `Running` state
- [ ] `currentSpeed` starts at `initialScrollSpeed` on every run; increases at `mvpSpeedRampRate` per second; never exceeds `maxSpeed`
- [ ] Rapier collision between robot and any obstacle collider fires `collisionDetected` event exactly once per run
- [ ] `collisionDetected` is not emitted in `Dead` state even if physics contact persists
- [ ] On restart, `collisionFired` is false and the robot accepts input within 1 frame
- [ ] `InputSystem.enable()` is called on `→ Running`; `InputSystem.disable()` is called on `→ Dead` and `→ MainMenu`
- [ ] No input actions are processed in `Dead`, `MainMenu`, `ScoreScreen`, or `Leaderboard` states
- [ ] `RS.setSpeed(negativeValue)` clamps to 0 and logs a console warning
- [ ] Robot Rapier body has CCD enabled; no tunneling through obstacles at `maxSpeed` (25 units/s)
- [ ] All tuning knobs defined in `RUNNER_SYSTEM_CONFIG`; no magic numbers in source code
- [ ] Runner System logic (excluding Rapier) runs without measurable frame budget impact at 60fps on mid-range desktop hardware

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| Character Renderer GDD must be updated: add `playAnimation(clipName)` method and `Jump`/`Slide` AnimationClips | Developer | Before CR implementation | Provisional: CR exposes `playAnimation(clipName)`; Runner System calls it on jump takeoff/landing and slide start/end |
| What is the Rapier ground plane? (Static physics body vs. pure code landing detection) | Developer | Implementation spike | Unresolved — static ground body is simpler and prevents fall-through edge cases |
| How does Runner System distinguish obstacle colliders from other physics bodies (e.g., ground)? | Developer | Obstacle System GDD | Provisional: Rapier collision groups; obstacles assigned `OBSTACLE_GROUP`; robot collider reacts only to `OBSTACLE_GROUP` for `collisionDetected` |
| Do Jump and Slide animations need separate AnimationMixer channels, or does single mixer with fast crossfades (50ms) suffice? | Developer | CR GDD update + implementation | Unresolved — single mixer is simpler; evaluate during animation authoring |
| At `maxSpeed` (25 units/s), does the default jump arc (3.6 units height, 1.2s air time) feel fair for obstacle clearance? | Designer | MVP playtest | Unresolved — test empirically; adjust `jumpForce`/`gravity` ratio if needed |
