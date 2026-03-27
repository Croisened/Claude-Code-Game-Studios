## Prototype Report: Runner Core Loop

### Hypothesis

A 3-lane endless runner with instant lane snap, physics jump arc (peak ≈3.6 units,
air time ≈1.2s), timed 600ms slide, and two obstacle types (Barrier jump / Drone slide)
will produce satisfying near-miss dodges at speeds from 8 to 25 units/second.

### Approach

Built in ~1 day. Single-file Three.js prototype (no Rapier, no enable3d, no abstraction).
Shortcuts taken: manual jump arc math instead of Rapier, AABB collision instead of
physics callbacks, box geometry for all meshes, raw keydown events, hardcoded values.

### Result

The core loop is validated. Lane snap felt precise and responsive — input mapped
directly to movement with no ambiguity. Drone sliding felt like a satisfying committed
read: the tight 0.1-unit clearance created genuine tension without feeling unfair.
Speed ramp and obstacle density built pressure at a good pace.

One mechanical issue identified: the jump arc felt too floaty. At the default
`jumpForce=12, gravity=20`, air time is ≈1.2s — long enough to lose a sense of
control mid-arc and make barrier timing feel guesswork rather than skill. This is
a tunable fix (increase gravity), not a design problem.

Most deaths came from failed barrier jumps, consistent with a jump arc that's hard to
time precisely when it's too long. Once the arc is snappier the barrier should become
the most satisfying obstacle to clear.

### Metrics

| Metric | Value |
|--------|-------|
| Furthest distance reached | 100–300 m |
| Most common death cause | Barriers (failed jump timing) |
| Lane snap feel | Precise and responsive ✓ |
| Jump arc feel | Too floaty — air time too long |
| Drone slide feel | Satisfying commitment ✓ |
| Speed ramp / density | Good ramp, fair density ✓ |

### Recommendation: PROCEED

Core loop hypothesis confirmed. Three of four mechanics tested as designed. The one
failure (floaty jump) has a clear root cause (air time 1.2s at `gravity=20`) and a
known fix. The fix is a config value change — no design revision needed.

### If Proceeding

**Jump arc tuning (address before or early in production):**

Current: `jumpForce=12, gravity=20` → peak=3.6 units, airTime=1.2s (too floaty)

Recommended starting point for production: `gravity=30, jumpForce=12`
→ peak = 12²/(2×30) = 2.4 units, airTime = 2×12/30 = **0.8s**

This cuts air time by 33% while still clearing Barrier top (1.0) with 1.4 units of
foot-level margin. Tune `jumpForce` up if the arc feels too low visually.

All other production implementation changes:

1. **Replace manual jump arc with Rapier physics** — apply `jumpForce` impulse to
   `ExtendedObject3D` rigid body; let Rapier gravity bring it down; detect landing
   via `position.y ≤ groundY + epsilon` each frame. Update `RUNNER_SYSTEM_CONFIG`
   with tuned `gravity=30` (or equivalent Rapier world gravity setting).
2. **Replace AABB collision with Rapier OBSTACLE_GROUP filter** — obstacle colliders
   get `OBSTACLE_GROUP` flag; Rapier callback fires `collisionDetected` event once
   per run via `collisionFired` debounce flag.
3. **Replace direct position.x writes with Rapier `setTranslation()`** — prototype
   writes to `robotGroup.position.x` directly; production must go through the Rapier
   body API so enable3d sync doesn't override it.
4. **Replace raw keydown with Input System** — extract to `InputSystem` class with
   `enable()` / `disable()` and key-repeat suppression.
5. **Integrate with Game State Manager** — Runner System activates on `→ Running`,
   halts on `→ Dead`, resets on `→ MainMenu`.
6. **Drive ER scroll speed** — production calls `ER.setScrollSpeed(currentSpeed)`
   each tick instead of moving obstacle Z directly.
7. **Extract all hardcoded values** into `RUNNER_SYSTEM_CONFIG` and
   `OBSTACLE_SYSTEM_CONFIG`.

### Lessons Learned

- **Jump arc tuning is the first production task** — start with `gravity=30,
  jumpForce=12` and playtest immediately. Shorter arc resolves the floaty feel
  and should make barrier timing learnable.
- **Drone slide clearance held up** — 0.1-unit gap felt tense but fair. No need
  to widen it (Obstacle System GDD open question resolved: keep `centerY=1.25`).
- **Instant lane snap is correct** — the camera lerp (xLerpFactor=8) provides
  enough momentum sensation without softening the input response. No need for
  a transition animation on the snap itself.
- **Barrier is the dominant threat** — players died to barriers more than drones,
  which is expected early. Once jump timing is snappier this should balance out.
  Monitor in production playtest.
