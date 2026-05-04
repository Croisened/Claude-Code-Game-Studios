# Camera System — Game Design Document

> **Status**: Approved
> **Created**: 2026-05-04
> **Last Updated**: 2026-05-04
> **Sprint Task**: S6-03 (spike landed in `88165a9`; reverse-doc as part of Sprint 6 close-out)
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Camera System** is the viewer's eye on the race. It owns four
mutually-exclusive modes, each implemented as a small standalone module
that mutates a single shared `THREE.PerspectiveCamera` per frame:

| Mode | File | Active when |
|------|------|-------------|
| **Follow-Leader** (with arena-specific resolver + settings) | `src/camera/follow-leader-camera.ts` | Default for sprint-race arenas; default for any arena that does not provide a `staticCameraPlacement` and isn't currently overridden |
| **Static Arena** | inlined in `src/app.tsx` (one-shot `position.set` + `lookAt`) | Default for maze-race arenas, OR a follow-mode arena where the user has clicked the **Arena** button after race-end |
| **Robot Shoulder** | `src/camera/robot-shoulder-camera.ts` | User typed a valid robot id into the **Robot #** input |
| **Winner Camera** | `src/camera/winner-camera.ts` | Race is done, winner id is known, the arena published a `winnerCamTarget`, the user has not suppressed it via the **Arena** button, and no shoulder cam is active |

Mode selection is centralised in the App shell's "camera effect"
(`src/app.tsx`, `useEffect` keyed on `[sceneVersion, cameraTargetId,
winnerCamSuppressed, stats.isDone, stats.winnerId]`). Switching modes
**never** touches the renderer, sim driver, or bridge — only the active
camera handle is disposed and a new one is constructed against the same
`THREE.PerspectiveCamera`.

The system is **per-frame deterministic in inputs but real-time in
smoothing**: every camera reads renderer-instance positions written by
the deterministic Sim ↔ Renderer Bridge, but the smoothing lerps consume
real `dt` (via `performance.now`). This is intentional — frame-rate-
independent exponential smoothing is the established pattern, and real
`dt` is the only piece that survives rAF jitter without adding visible
stutter.

---

## 2. Player Fantasy

The Camera System protects three viewer-facing promises:

> **"I always know who's winning."** — Sprint-race Follow-Leader keeps
> the front of the pack centred so the viewer's eye never has to hunt.

> **"I can pick a horse."** — Robot Shoulder lets the viewer commit to a
> single robot for the entire event, including post-elimination. (V1
> tracks any id whether or not the robot is still active; an eliminated
> robot's frozen pose is followed in place.)

> **"The winner gets a moment."** — When the race ends, the camera cuts
> to a posed portrait of the winning robot framed against the arena's
> focal landmark (the orange tree, in Arena-02), and the winner is
> rotated to face the lens. No soft transition, no continued tracking
> of the now-irrelevant pack — a hard cut that punctuates the ending.

The fantasy the system **does not** try to deliver in v1: cinematic
multi-camera sequences, replay scrubbing, follow-leader hysteresis to
prevent rapid id swaps mid-race, or any form of automatic dramatic
emphasis (mid-race close-ups during gate culls, etc.). Those were
considered but cut to keep the system inside the sprint window.

---

## 3. Detailed Rules

### Mode selection

- **R1.** At most one camera mode is active at any time. Mode selection
  is centralised in the App shell's camera effect — no module is allowed
  to mount its own camera handle.
- **R2.** Mode priority, highest to lowest:
  1. **Robot Shoulder** — `cameraTargetId !== null`.
  2. **Winner Camera** — `cameraTargetId === null` AND `stats.isDone`
     AND `stats.winnerId !== null` AND `built.winnerCamTarget !== undefined`
     AND `winnerCamSuppressed === false`.
  3. **Static Arena** — `built.staticCameraPlacement !== undefined`.
  4. **Follow-Leader** — fallback.
- **R3.** Switching modes:
  - Disposes the previous camera handle (which cancels its rAF loop).
  - Constructs the next handle against the **same** `PerspectiveCamera`
    instance — the camera object is re-used, never replaced.
  - Does **not** touch the renderer, sim driver, switcher, or bridge.
  - Does **not** restart the sim playback clock.

### Follow-Leader

- **R4.** The "leader" is computed every frame by a `LeaderResolver`
  function (default: max-X across all renderer instances). The resolver
  is pluggable per arena — sprint-race uses the default; maze-race
  arenas would supply a BFS-distance resolver if they ever ran a
  follow-leader cam (they currently don't — see R10).
- **R5.** Camera placement = `{ x: leader.x + aheadOffsetX, y: offsetY,
  z: leader.z + offsetZ }`. The lookAt target = `{ x: leader.x +
  lookAtAheadX, y: lookAtY, z: leader.z }`. Both translate with the
  leader's z so the leader stays laterally centred even when separation
  forces push them off the arena centreline.
- **R6.** Position smoothing is frame-rate-independent exponential lerp:
  `alpha = 1 - exp(-lerpRatePerSecond * dt)`. Both camera.x and camera.z
  ease toward their targets each frame. y is set hard each frame
  (no smoothing) because no source of camera y-motion exists in v1.
- **R7.** First frame snaps both x and z exactly to target (no ease-in
  from the camera's prior placement). Without this, the first ~0.3 s
  of a fresh race shows the camera flying in from origin or from
  whatever vantage the previous mode left it at.
- **R8.** "Sprint races are forward-only along +X" — the leader cannot
  move backwards, so dead robots' frozen positions can never exceed the
  live leader's. No `active` filter is required on the resolver.
- **R9.** The resolver returns `{ x, z }` only — y framing is always
  `cfg.offsetY`. This is correct for v1 because all arenas are flat
  ground planes; it would need to grow if arenas with elevation
  arrived.
- **R10.** Per-arena settings (`CONFIG.camera.follow` vs
  `CONFIG.camera.mazeFollow`) are passed through the App shell's
  `ArenaSetup.cameraSettings` field. **Currently no arena uses
  `mazeFollow`** — Arena-02 (maze) selects `staticCameraPlacement`
  instead. The `mazeFollow` config + `cameraSettings` API parameter are
  retained as forward-compat for arenas that want overhead follow.

### Static Arena

- **R11.** Static placement is one-shot at mount: `camera.position.set(...)`
  + `camera.lookAt(...)`, then no further updates. The handle's `dispose`
  is a no-op.
- **R12.** The placement is computed in `buildArenaSetup` from arena
  geometry. For Arena-02 (square maze), `camY = halfMaze * 2.1` and
  `camZ = halfMaze * 1.1`, giving a roughly 30° off-vertical isometric-
  feeling vantage. The maze stays stationary in screen-space while
  robots move within the frame.
- **R13.** Static is also the post-race **user-forced wide view**:
  clicking the **Arena** button on a follow-leader arena sets
  `cameraTargetId = null` AND `winnerCamSuppressed = true`. This drops
  the camera into the sprint-race default Follow-Leader at frozen
  leader position (effectively static, since nothing is moving).

### Robot Shoulder

- **R14.** Triggered by `cameraTargetId !== null`. The user enters an id
  via the **Robot #** input; the App shell parses on `Enter` / blur and
  rejects out-of-range ids by clearing the input.
- **R15.** Camera trails the target robot at `(backDistance, height)`
  along the robot's facing direction, looking at a point `lookAhead`
  ahead of and `lookAtY` above the robot.
- **R16.** Forward direction is read off the renderer instance's
  `rotation.y` (which the bridge writes from `pose.yaw + π/2` to align
  the GLB's authored +Z forward with the sim's yaw=0 → +X convention).
  In Three.js, an object rotated by `rotation.y = θ` has world forward
  `(sin θ, 0, cos θ)`. The shoulder cam reads exactly this — no asset/
  sim convention assumptions baked in.
- **R17.** Both position AND smoothed forward direction are
  exponentially lerped at `lerpRatePerSecond`. A maze 90° corner
  produces an instant `rotation.y` jump in the renderer; the shoulder
  cam orbits around that turn instead of teleporting. The smoothed
  forward is renormalised to a unit vector each frame so
  `backDistance` / `lookAhead` magnitudes stay consistent mid-turn.
- **R18.** First frame snaps both position AND smoothed forward to the
  target's instantaneous values; without this, the cam would lerp in
  from arena-cam vantage and the smoothed forward from `(0, 0, 1)`.
- **R19.** If `targetRobotId` is not present in the renderer's instance
  list, the cam tick is a no-op — camera stays where it was. This
  handles the (currently impossible) case where the renderer hasn't
  populated yet, and protects against an id mismatch surviving a
  Race Again.

### Winner Camera

- **R20.** Active only on race-end (`stats.isDone && stats.winnerId !==
  null`) when the arena publishes a `winnerCamTarget` (the focal
  landmark world position — the orange tree in Arena-02). Sprint-race
  arenas leave `winnerCamTarget` undefined and never trigger this mode.
- **R21.** Camera placement = `midpoint(winner, tree) + (CAM_OFFSET_X,
  CAM_OFFSET_Y, CAM_OFFSET_Z)` where the X/Z magnitudes are equal
  (45° to world axes — angle-independent of which entrance the winner
  came from). LookAt = `midpoint + (0, LOOK_AT_Y_BIAS, 0)`.
- **R22.** First frame snaps; no transition lerp from the previous
  camera. The cut is intentional and punctuates race-end.
- **R23.** The Winner Camera **mutates the winner robot's
  `rotation.y` every frame** to face the camera. This is the only
  camera mode that writes back to renderer state. The bridge would
  normally overwrite the rotation each frame from the (frozen) sim
  pose; the Winner Camera's rAF tick is registered AFTER the bridge's
  rAF, so the per-frame write order is: bridge writes pose-yaw →
  winner cam overwrites rotation.y → renderer renders. The forbidden-
  pattern rule "no non-sim writes to RobotInstance.rotation" has a
  documented exception here.
- **R24.** `rotation.y = atan2(camera.x - winner.x, camera.z - winner.z)`.
  No asset-offset compensation — the bridge's `+ π/2` only applies when
  starting from `pose.yaw`; we compute final world rotation directly.
  Skipped when the camera is exactly above the winner (`dx² + dz² <=
  1e-6`) to avoid a degenerate atan2.
- **R25.** Re-reads winner pose every frame. In practice the winner's
  pose is frozen post-finish so the camera tracks essentially nothing;
  the per-frame read exists so any future tail-end animation drift
  (idle bob, snap-to-cell-centre) follows correctly.

### Disposal & lifecycle

- **R26.** Every camera handle exposes `start / stop / isRunning /
  dispose`. `dispose` is idempotent and cancels the rAF loop. None of
  the camera modules dispose the underlying `PerspectiveCamera`; that
  lifetime is owned by the App shell.
- **R27.** Each rAF tick re-schedules itself before doing work, then
  early-exits if `disposed`. This means a `dispose()` called between
  rAF schedule and tick is honoured cleanly without leaking work
  against a disposed handle.
- **R28.** `MAX_DT_SECONDS = 0.1` in every cam. If the tab is throttled
  and `dt` measures > 0.1 s, the lerp clamps to that to prevent a
  frame's worth of catch-up motion from snapping the camera.

---

## 4. Formulas

### Frame-rate-independent exponential smoothing (every cam mode)

```
alpha = 1 - exp(-lerpRatePerSecond * dt)
out  += (target - out) * alpha
```

Geometrically convergent: doubling `dt` halves the remaining gap twice
rather than once. Identical visual behaviour at 30 / 60 / 144 fps.

### Follow-Leader position

```
target.x = leader.x + cfg.aheadOffsetX
target.z = leader.z + cfg.offsetZ
camera.y = cfg.offsetY                       // hard set, no lerp
camera.x += (target.x - camera.x) * alpha
camera.z += (target.z - camera.z) * alpha

lookAt   = (leader.x + cfg.lookAtAheadX, cfg.lookAtY, leader.z)
```

### Robot Shoulder

```
fx, fz   = sin(robot.rotY), cos(robot.rotY)              // unit forward
smoothFx += (fx - smoothFx) * alpha                      // smoothed
smoothFz += (fz - smoothFz) * alpha
len      = sqrt(smoothFx² + smoothFz²); smooth /= len    // renormalise

target.x = robot.x - smoothFx * backDistance
target.y = robot.y + height
target.z = robot.z - smoothFz * backDistance
camera   += (target - camera) * alpha

lookAt   = (robot.x + smoothFx * lookAhead,
            robot.y + lookAtY,
            robot.z + smoothFz * lookAhead)
```

### Winner Camera

```
mid     = ((winner.x + tree.x)/2, winner.y, (winner.z + tree.z)/2)
target  = mid + (CAM_OFFSET_X, CAM_OFFSET_Y, CAM_OFFSET_Z)
lookAt  = mid + (0, LOOK_AT_Y_BIAS, 0)
camera  += (target - camera) * alpha

dx, dz  = camera.x - winner.x, camera.z - winner.z
if dx² + dz² > 1e-6:
    winner.rotation.y = atan2(dx, dz)
```

### Variable ranges (defaults captured at sprint close)

| Symbol | Where | Value | Safe range |
|--------|-------|-------|-----------|
| `aheadOffsetX` (sprint follow) | `CONFIG.camera.follow` | `10` | 0–30 |
| `offsetY` (sprint follow) | `CONFIG.camera.follow` | `18` | 8–40 |
| `offsetZ` (sprint follow) | `CONFIG.camera.follow` | `16` | 8–40 |
| `lookAtAheadX` (sprint follow) | `CONFIG.camera.follow` | `-6` | -20 to 0 |
| `lookAtY` (sprint follow) | `CONFIG.camera.follow` | `0.5` | 0–3 |
| `lerpRatePerSecond` (sprint follow) | `CONFIG.camera.follow` | `4.0` | 1–10 |
| `lerpRatePerSecond` (maze follow, unused) | `CONFIG.camera.mazeFollow` | `2.5` | 1–10 |
| `backDistance` (shoulder) | module const `DEFAULT_BACK_DISTANCE` | `5.0` | 2–10 |
| `height` (shoulder) | module const `DEFAULT_HEIGHT` | `5.0` | 2–10 |
| `lookAhead` (shoulder) | module const `DEFAULT_LOOK_AHEAD` | `9.0` | 4–20 |
| `lerpRate` (shoulder) | module const `DEFAULT_LERP_RATE` | `3.5` | 1–10 |
| `CAM_OFFSET_{X,Y,Z}` (winner) | module const | `(8.5, 6.0, -8.5)` | per-arena tuning |
| `LERP_RATE` (winner) | module const | `3.0` | 1–6 |
| `MAX_DT_SECONDS` | every cam module | `0.1` | fixed |

> **Why some constants are module-level and not in `CONFIG`:** the
> Shoulder and Winner cameras are not currently exposed for live
> tuning — they are presentation polish, not gameplay surfaces. Per
> the project's "magic numbers in user-facing code" forbidden-pattern,
> only **gameplay tuning surfaces** must live in `CONFIG`. Shoulder
> and Winner constants are implementation-detail polish; if a future
> sprint exposes a "Camera Polish" tuning UI, they migrate to `CONFIG`
> at that time.

---

## 5. Edge Cases

| Case | Behaviour |
|------|-----------|
| User types an out-of-range robot id | App shell parses, clears the input, and sets `cameraTargetId = null`. Mode resolves back to whichever non-shoulder mode applies. |
| `cameraTargetId` set to a robot id whose pose is frozen (eliminated) | Shoulder cam tracks the frozen pose. Camera stops moving along with the robot — intentional, lets the viewer linger on a "my horse died here" shot. |
| Race ends, but arena did not publish a `winnerCamTarget` (sprint races) | Winner Camera does not activate. Follow-Leader stays parked on the (now stationary) winner's x/z. The WinnerCard panel does NOT render either, since its render gate is the same as the winner-cam gate. |
| User clicks **Arena** post-race | `winnerCamSuppressed = true`. Mode falls through to Static (maze) or Follow-Leader (sprint, parked on winner). |
| User clicks **Arena** before race-end | Same effect plus the input clear. Mode falls through to the arena's default. |
| Race Again | App shell resets `cameraTargetId = null`, `winnerCamSuppressed = false`, `seed = pickRandomSeed()`, which triggers a full renderer rebuild. The camera effect runs once with the new scene refs and selects the arena default. |
| `getAllInstances()` returns empty (transient race-rebuild moment) | Follow-Leader's default resolver returns `(0, 0)` and the cam parks at origin until instances populate. Shoulder returns `null` and the cam tick is a no-op. Winner cam ditto. |
| `dt > MAX_DT_SECONDS` (tab throttle, debug pause) | `dt` clamps to 0.1 s. The lerp absorbs the catch-up gracefully — no snap, but a noticeably faster ease for one frame. |
| First frame after construction (`lastTimeMs === null`) | `now()` is captured but no work is done. Position/forward initialisation happens on frame 2 with `initialised === false` → snap-set. |
| Two cameras of the same kind constructed in quick succession | The first's `dispose` is called by the camera-effect cleanup before the second is constructed. No rAF leak. |
| `dispose()` called while rAF is queued | The next tick early-exits on the `disposed` flag. The rAF id is cleared by `stop()`. Idempotent. |
| Winner Camera with `winnerInst` not present in renderer | Tick is a no-op. Camera stays at last placement; the failing case is a transient between scene rebuilds. |
| Winner sits exactly on top of the camera in XZ plane | `dx² + dz² <= 1e-6` → rotation override is skipped. Winner keeps its bridge-written yaw; visually negligible because that geometry only happens if `CAM_OFFSET_X = CAM_OFFSET_Z = 0`, which is not the v1 configuration. |

---

## 6. Dependencies

### Inbound (this system depends on)

- **[85-Instance Renderer](85-instance-renderer.md)** — every camera
  reads positions and (for shoulder + winner) rotations from
  `Renderer.getAllInstances()`. The shared `PerspectiveCamera` is built
  by the App shell and passed into `renderer.mount(container, camera)`,
  so the renderer's `WebGLRenderer.render(scene, camera)` reads the
  exact instance the cameras are mutating.
- **[Sim ↔ Renderer Bridge](sim-driver.md) (S6-02 — covered in the Sim
  Driver GDD §6 outbound)** — the bridge is the sole writer of
  per-instance pose. Cameras are read-only consumers of those writes,
  with the **single documented exception** of the Winner Camera's
  `rotation.y` override (R23).
- **[Sim Driver](sim-driver.md)** — only used indirectly: the App
  shell reads `driver.isDone()` and the bridge surfaces the `simEnd`
  winner id, both of which feed `stats.isDone` / `stats.winnerId` →
  Winner Camera activation.
- **[Config Module](config-module.md)** — `CONFIG.camera.follow` and
  `CONFIG.camera.mazeFollow` are the Follow-Leader tuning surfaces.

### Outbound (these systems depend on this)

- **[Preact App Shell](preact-app-shell.md)** — owns the camera-mode
  selection effect, the **Arena / Robot # / WIN** control bar, and
  the WinnerCard render gate. The shell is the only client of the
  cameras' constructor APIs.
- **Future** (v1.x): scheduled cinematic cuts during gate-cull events
  will subscribe to the Sim Driver's `onEvent` stream and call into
  this system. Out of scope for v1.

### Forbidden dependencies

- **No DOM access** in the camera modules — they own a Three.js camera
  reference and rAF only. The App shell handles all DOM interactions.
- **No `Math.random`** anywhere. The cameras read deterministic
  positions; their only non-deterministic input is real `dt` from
  `performance.now()`, which is the established pattern.
- **No writes to `RobotInstance.position`** by any camera. Only the
  Winner Camera writes `rotation.y`, and only on the winning robot.
  Sim ↔ Renderer Bridge invariants explicitly carve out this exception
  in the renderer GDD's update note (forthcoming).

---

## 7. Tuning Knobs

| Knob | Location | Range | Effect |
|------|----------|-------|--------|
| `CONFIG.camera.follow.aheadOffsetX` | Config | 0–30 | How far ahead of the leader the camera sits along +X. Increases means more of the trailing pack is visible behind. |
| `CONFIG.camera.follow.offsetY` | Config | 8–40 | Camera height. Higher = more "stadium overhead", lower = "track-side". |
| `CONFIG.camera.follow.offsetZ` | Config | 8–40 | Side-of-arena distance. Higher = wider establishing shot. |
| `CONFIG.camera.follow.lookAtAheadX` | Config | -20 to 0 | Negative pulls the framing back into the trailing field. -6 puts the leader ~12° off-centre at arena-01 row spacing. |
| `CONFIG.camera.follow.lookAtY` | Config | 0–3 | Eye line. 0.5 keeps the horizon roughly level with the robots' chests. |
| `CONFIG.camera.follow.lerpRatePerSecond` | Config | 1–10 | Tracking responsiveness. Higher = camera nails the leader instantly (snappy / nervy); lower = floaty trail. |
| `CONFIG.camera.mazeFollow.*` | Config | (same shape) | Currently unused; reserved for an arena that wants overhead leader-follow. |
| Shoulder `DEFAULT_BACK_DISTANCE` etc. | module const | see §4 | Polish, not gameplay tuning. Migrate to `CONFIG` when polish UI is built. |
| Winner `CAM_OFFSET_*` etc. | module const | see §4 | Per-arena reframing would move these to a per-arena setup map; v1 hard-codes one framing. |

### Tuning rationale

- `aheadOffsetX = 10` was tuned against arena-01's 240 m course so the
  camera leads the front of the pack by roughly two robot-lengths.
- `lookAtAheadX = -6` is exactly the arena-01 `startGrid.rowSpacing`,
  so the trailing field reads as ~one row back relative to the leader.
- `lerpRatePerSecond = 4.0` was chosen to feel "responsive but not
  jittery" when the leader id rotates between near-tied robots.
  Higher values amplified the rotation; lower felt soggy.
- Maze-follow `lerpRatePerSecond = 2.5` is calibrated against the
  high-overhead view's amplification of lateral target motion. Unused
  in current arenas.

---

## 8. Acceptance Criteria

### Spike-validated (Follow-Leader)

Mechanically tested by `src/camera/follow-leader-camera.test.ts` (385 LOC).

- [ ] **AC-1.** `createFollowLeaderCamera` constructs without throwing
  given a fake `Renderer` and `PerspectiveCamera`.
- [ ] **AC-2.** First frame snaps `camera.position` exactly to
  `(leader.x + aheadOffsetX, offsetY, leader.z + offsetZ)`.
- [ ] **AC-3.** Subsequent frames lerp toward the target at the
  configured rate; at `lerpRatePerSecond = 4` and `dt = 0.25`, the
  camera covers `1 - exp(-1) ≈ 63%` of the remaining gap (within
  rounding).
- [ ] **AC-4.** `lookAt` translates with the leader's z each frame.
- [ ] **AC-5.** `dt > 0.1` clamps to `0.1` so a tab-throttle catch-up
  does not snap the camera.
- [ ] **AC-6.** A custom `leaderResolver` is invoked every frame and
  its return value is used in place of the default max-X rule.
- [ ] **AC-7.** `dispose()` cancels the rAF loop and is idempotent.
- [ ] **AC-8.** No `Math.random` calls anywhere in the module
  (Vitest spy).

### Reverse-doc verified (Static / Shoulder / Winner)

Verified by inspection at sprint close; covered by manual playtest in
the browser since they don't lend themselves to headless tests without
a heavier Three.js fake.

- [ ] **AC-9.** Static placement on Arena-02 frames the entire maze
  at race-start; the maze stays stationary in screen-space throughout
  the race.
- [ ] **AC-10.** Robot Shoulder follows a typed-in id over corner
  turns without snapping; smoothed forward unit-norms verifiably stay
  near 1 mid-turn (no collapse to zero magnitude).
- [ ] **AC-11.** Race Again with `Robot # = 12` set retains the
  shoulder cam against the new race's robot 12.
- [ ] **AC-12.** Race-end on Arena-02 cuts to Winner Camera composing
  the winner + finish tree at 45° to world axes; the winner is rotated
  to face the camera.
- [ ] **AC-13.** Clicking **Arena** post-race-end clears the winner
  cam and reverts to static; clicking again does nothing.
- [ ] **AC-14.** Race Again resets `winnerCamSuppressed = false`
  so the next race's winner cam fires.

### Determinism

- [ ] **AC-15.** Two sessions playing the same `seed` see the same
  leader sequence (not because cameras enforce it, but because the
  deterministic Sim ↔ Renderer Bridge writes the same positions; the
  cameras are passive consumers).

### Forbidden patterns

- [ ] **AC-16.** No camera module writes to `RobotInstance.position`.
- [ ] **AC-17.** Winner Camera is the only module that writes
  `RobotInstance.rotation.y`, and only on the winning instance.
- [ ] **AC-18.** No camera module imports from `@/sim` (cameras are
  Three.js-side; sim coupling lives in the App shell).

---

## Implementation Notes

- Files:
  - [`src/camera/follow-leader-camera.ts`](../../src/camera/follow-leader-camera.ts)
    + `.test.ts` (385 LOC tests, 12 AC mechanically verified)
  - [`src/camera/robot-shoulder-camera.ts`](../../src/camera/robot-shoulder-camera.ts)
  - [`src/camera/winner-camera.ts`](../../src/camera/winner-camera.ts)
  - Mode-selection effect: [`src/app.tsx`](../../src/app.tsx) lines
    ~408–466 (the second `useEffect`, keyed on scene + camera state).
- Total LOC: ~628 (impl) + 385 (test) — Follow-Leader carries the
  test load; Shoulder + Winner are tested manually in-browser.
- Spike landed in commit `88165a9` ("S6-02 fix + S6-03 spike: face-of-
  motion rotation + Follow-Leader camera"). Subsequent commits added
  Robot Shoulder (`a340919`), Winner Camera + WinnerCard (`34829ce`),
  and the static-placement path for maze (`a340919`).
- This GDD reverse-documents the four-mode system as it stands at
  Sprint 6 close. The original sprint plan called out a "cull-stage
  target switching" feature for Follow-Leader (leader → contested
  pack → top-N → winner) that did **not** ship; it is captured in the
  Sprint 6 retrospective as a cut and would re-enter via a future
  cinematic-cuts system, not as additional Follow-Leader phases.
