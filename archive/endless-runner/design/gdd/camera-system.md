# Camera System

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: Sensation, Identity First

## Overview

The Camera System owns the Three.js `PerspectiveCamera` and its position each frame.
It maintains a fixed offset behind and above the robot, following the robot's X
position (lane changes) with configurable lag while keeping its Z and Y axes locked.
The player never consciously interacts with it — they experience it as the "window"
through which the run is seen. A well-tuned camera makes lane changes feel snappy,
speed feel visceral, and the robot feel heroic. A poorly-tuned one makes the same
run feel floaty, cramped, or disorienting.

## Player Fantasy

The camera is the player's nervous system. When the robot dashes left to dodge a
drone, the camera follows with a slight delay — just enough to feel like momentum,
not so much that the player loses spatial awareness. As scroll speed increases, the
sensation of rushing forward intensifies without the camera pulling back to compensate;
the world gets faster inside the same frame. The robot stays large in frame —
prominent, recognizable, *your* machine — while enough of the incoming lane is visible
to give the reaction time the design promises. The camera is invisible infrastructure
that makes every near-miss feel more dramatic than it was.

## Detailed Design

### Core Rules

1. The system owns a single `THREE.PerspectiveCamera`, initialized at startup and
   never recreated.
2. The camera's Z and Y positions are **fixed** relative to the world origin:
   `camera.position.z = cameraZOffset` (behind robot),
   `camera.position.y = cameraYOffset` (above robot). Since the robot is permanently
   at Z = 0, these are constant values.
3. The camera's X position follows the robot's X with an exponential lerp each frame:
   `camera.position.x += (robot.position.x − camera.position.x) × xLerpFactor × delta`
4. The camera looks at a **look-ahead target** positioned ahead of the robot:
   `lookTarget = (camera.position.x, 0, −lookAheadDistance)`. Using
   `camera.position.x` (not `robot.position.x`) for the look target's X ensures the
   camera does not appear to stare sideways during lane transitions.
5. `camera.lookAt(lookTarget)` is called after position is updated, every frame.
6. The camera updates unconditionally every frame — no GSM state gating required.
   The robot is always at Z = 0; the fixed offset is always valid.
7. Camera FOV is fixed at MVP. No dynamic FOV zoom with scroll speed.

### States and Transitions

The Camera System has no state-dependent behavior and does not subscribe to Game
State Manager events. It runs its update loop every frame regardless of game state.
The robot is always at Z = 0 and always the tracking target; there is no state in
which the camera behaves differently.

### Interactions with Other Systems

| System | Direction | Interface |
|--------|-----------|-----------|
| Character Renderer | Camera reads | Caches `robotObject3D` reference at init; reads `robotObject3D.position.x` each frame as the lerp target |
| Environment Renderer | Camera reads | Reads `LANE_CENTER` and `laneSpacing` at init to verify camera framing covers all 3 lanes; no per-frame read |
| Runner System | Downstream (no direct interface) | Runner System writes `robot.position.x`; camera follows automatically — no explicit camera API call needed |

## Formulas

**X-axis follow (executed every frame during Running state):**
```
camera.position.x += (robotX − camera.position.x) × xLerpFactor × delta
```

**Look-ahead target (computed after position update):**
```
lookTarget = Vector3(camera.position.x, 0, −lookAheadDistance)
camera.lookAt(lookTarget)
```

**Variable table:**

| Variable | Description | Default |
|----------|-------------|---------|
| `robotX` | `robotObject3D.position.x` — current robot lane X position | −3, 0, or +3 units |
| `xLerpFactor` | Lerp speed for camera X follow (higher = faster) | 8.0 |
| `delta` | Frame time in seconds | ~0.016 at 60fps |
| `cameraZOffset` | Fixed Z distance behind robot (`camera.position.z`) | +8 units |
| `cameraYOffset` | Fixed Y height above robot (`camera.position.y`) | +3 units |
| `lookAheadDistance` | Z distance ahead of robot for the look target | 5 units |
| `cameraFOV` | PerspectiveCamera field of view | 75° |

**Convergence time estimate:**
```
timeToConverge(95%) ≈ 3 / xLerpFactor ≈ 375ms at default xLerpFactor = 8
```
Full lane width = 6 units (left to right). 95% convergence = 5.7 units in ~375ms.
This is the lag window players experience during lane changes. Adjust `xLerpFactor`
to tune the feel: higher = snappier, lower = floatier.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| Camera X is far from robot X at run start (e.g., previous run ended in left lane) | Snap camera X to robot's starting X immediately on restart (no lerp from previous position) | Each run starts from center lane; stale camera position causes a distracting pan at run start |
| Frame spike (large delta) causes overshoot | Clamp delta to 100ms: `delta = Math.min(delta, 0.1)` — same clamp as Environment Renderer | `xLerpFactor × delta > 1.0` causes camera to overshoot the target and oscillate |
| `robotObject3D` reference is null at init | Log error; camera stays at `(0, cameraYOffset, cameraZOffset)` until reference resolves | Initialization order issue — Character Renderer must init before Camera System |
| `xLerpFactor` set to 0 | Camera X freezes; robot moves but camera doesn't follow. Clamp minimum to 0.1. | xLerpFactor = 0 breaks lane tracking entirely |
| `xLerpFactor` set very high (e.g., 100) | Camera snaps to robotX every frame; lerp effect disappears; functionally instant follow | Visually valid but loses momentum feel described in Player Fantasy |
| `robotScale` changed from default (Character Renderer tuning knob) | A larger robot may clip the frame edges. Recheck `cameraYOffset` and `cameraFOV` if `robotScale` deviates significantly from 1.0. | Camera framing is calibrated to `robotScale = 1.0` |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Character Renderer | Upstream | Provides `robotObject3D` reference; Camera System caches it at init and reads `.position.x` each frame | **Hard** — no robot reference means no tracking |
| Environment Renderer | Upstream | Provides `LANE_CENTER` and `laneSpacing` for framing validation at init; no per-frame dependency | **Soft** — camera can estimate framing without ER; verified at init only |
| Runner System | Downstream (no direct interface) | Runner System writes `robot.position.x`; Camera System follows automatically — no method call needed | **Soft** — camera works without Runner System; robot just stays at X = 0 |

**Bidirectional consistency:**
- Character Renderer GDD states: "Camera System reads `CR.robotObject3D.position` each frame; caches reference at init." ✅ Consistent.
- Environment Renderer GDD states: "Camera System reads `LANE_CENTER` and `chunkWidth` for framing." ✅ Consistent.

## Tuning Knobs

| Knob | Default | Safe Range | Effect | Breaks If… |
|------|---------|------------|--------|------------|
| `xLerpFactor` | 8.0 | 2 – 20 | Camera X follow speed; higher = snappier | < 2: camera lags so much robot exits frame; > 20: effectively instant, loses momentum feel |
| `cameraZOffset` | 8 units | 5 – 15 | Distance behind robot | Too close: robot fills frame, obstacles appear with no warning; too far: robot looks small, identity feel weakens |
| `cameraYOffset` | 3 units | 1.5 – 6 | Height above robot | Too low: loses speed sensation; too high: top-down view, loses immersion |
| `lookAheadDistance` | 5 units | 2 – 10 | How far ahead the camera looks | Too small: camera tilts toward robot's feet; too large: robot is at bottom of frame with poor obstacle visibility |
| `cameraFOV` | 75° | 60° – 90° | Perspective field of view | < 60°: telephoto compression, game feels slow; > 90°: fisheye distortion |

All knobs live in `CAMERA_SYSTEM_CONFIG`. No magic numbers in code.

**Interaction note**: `xLerpFactor` and `cameraZOffset` interact. A closer camera with
a low lerp feels floatier than a farther camera with a high lerp despite similar
numerical lag. Tune these together during playtest.

## Visual/Audio Requirements

[To be designed]

## UI Requirements

[To be designed]

## Acceptance Criteria

- [ ] Camera is a `THREE.PerspectiveCamera` initialized at startup with `cameraFOV` = 75°
- [ ] Camera Z position is fixed at `cameraZOffset` throughout all game states
- [ ] Camera Y position is fixed at `cameraYOffset` throughout all game states
- [ ] When robot moves to a new lane, camera X begins following within the same frame
- [ ] Camera X reaches 95% of new lane position within ~375ms at default `xLerpFactor` = 8 (verifiable by logging `camera.position.x` over time)
- [ ] Camera X is snapped (not lerped) to the robot's starting X on every run restart — no pan visible at run start
- [ ] Look-ahead target uses `camera.position.x`, not `robot.position.x` — camera does not appear to look sideways during lane transitions
- [ ] All 3 lane positions (−3, 0, +3) are within the camera's horizontal frustum at default settings
- [ ] Robot is visible and prominently framed at `robotScale` = 1.0 and default camera values
- [ ] Frame delta clamp prevents oscillation: simulating delta = 1.0s does not cause camera to overshoot and oscillate past the target
- [ ] Camera update runs at 60fps on mid-range desktop hardware without measurable frame budget impact
- [ ] All tuning knobs defined in `CAMERA_SYSTEM_CONFIG`; no magic numbers in source code

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| Should FOV increase with scroll speed (dynamic speed-blur feel)? | Developer | After MVP playtest | Deferred to v2 — Two-Week Discipline; test whether static FOV is sufficient first |
| Should a death camera effect play when the robot dies (slow-motion zoom, dramatic angle)? | Developer | v1 polish pass | Deferred to v1; not needed for MVP loop |
| Does the look-ahead target need a Y offset? (Currently Y=0 may tilt camera toward the floor) | Developer | During implementation | Unresolved — test empirically; may need `lookTarget.y = camera.position.y × 0.3` or similar |
| Should camera X reset on restart be a hard snap or a very fast lerp (2–3 frames)? | Developer | MVP playtest | Snap is specified; if it looks jarring in practice, `xLerpFactor = 50` for 1–2 frames is an acceptable softened alternative |
