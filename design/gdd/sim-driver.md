# Sim Driver — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-25
> **Last Updated**: 2026-04-25
> **Sprint Task**: S6-01
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Sim Driver** is the bridge between the headless [Sim Engine
Core](sim-engine-core.md) and any real-time consumer (renderer, camera,
audio). The engine produces a `SimResult` — a frozen, deterministic record
of a finished race: a `PoseFrame[]` snapshot per tick, an ordered
`TimelineEvent[]`, a finish order, and a winner id. The Sim Driver wraps
that result with a **playback clock** that can be advanced by arbitrary
real-time deltas (`update(dtSeconds)`), and exposes per-frame interpolated
poses (`getPose(robotId)`) plus a subscription-based event stream
(`onEvent(handler)`).

The driver is the answer to the Sprint 5 retro decision (AI #3): **in-process
pose-frame transport.** `runSim()` is invoked inside the browser entry, the
returned `SimResult` is fed directly to a Sim Driver, and the renderer reads
poses + animation-state events from that driver each frame. No JSON-on-disk,
no network round-trip; the `SimResult` shape stays stable so a JSON variant
remains a thin adapter when v1.x replay-from-server arrives.

The driver is **Three.js-agnostic** and runs in Node identically to the
browser. The S6-02 wire-up (Renderer ↔ Sim) is the first system that
**uses** the driver, but does not live inside it.

The M-tier designation reflects **breadth, not depth**: the driver is a
small ~220 LOC module, but it owns the timing contract that every
real-time consumer (renderer, camera, future audio mixer) reads from.

---

## 2. Player Fantasy

The Sim Driver is internal infrastructure with no direct player surface.
The fantasy it protects sits at the seam between two of the project's
load-bearing promises:

> **"The same race, the same way, every time"** — extended past the engine
> boundary. Determinism survives all the way to the user's eyeballs.

The Sim Engine guarantees that `seed 42 + arena-01` produces a byte-identical
`SimResult`. The Sim Driver guarantees that two browsers playing back that
same `SimResult` see the **same robots in the same places at the same wall-
clock moments** — assuming both browsers feed the driver the same
`update(dt)` sequence (which the render loop does, modulo rAF jitter
that is itself absorbed by interpolation).

> **"Smooth at 60 fps with a 60 Hz sim"** — even when the render frame
> doesn't land exactly on a sim tick boundary.

The sim ticks at exactly 60 Hz; the renderer targets 60 fps but jitters by
±a few ms. Without interpolation, that mismatch produces visible stutter
on every frame that misses its tick. The driver lerps poses linearly
between adjacent `PoseFrame`s based on sub-tick alpha, so the visible
motion stays smooth regardless of when the render frame actually fires.

---

## 3. Detailed Rules

### Construction

- **R1.** `createSimDriver({result, tickDtSeconds?})` returns a `SimDriver`.
- **R2.** `result.poseFrames.length === 0` throws. The driver requires
  pose frames; pure event-only `SimResult`s are not a supported input.
- **R3.** `tickDtSeconds <= 0` throws. Default is `1 / CONFIG.sim.tickRateHz`.
- **R4.** `tickDtSeconds` is captured at construction; the driver does not
  read `CONFIG` again afterward. Live-tuning the sim rate mid-playback is
  out of scope for v1.

### Time advancement

- **R5.** `update(dtSeconds)`:
  - `dtSeconds < 0` throws.
  - When `paused`, the call is a no-op (does not advance time, does not
    fire events).
  - When `dtSeconds === 0` and not paused, the driver still **dispatches
    any tick-0 events that haven't fired yet**. This lets a freshly-
    constructed driver flush `simStart` before time has actually moved.
    Subsequent `dt=0` calls become true no-ops because the event index has
    advanced past tick 0.
  - When `dtSeconds > 0` and not paused, `timeSec += dtSeconds`, then any
    events whose `tick * tickDt <= timeSec` fire in stored order.
- **R6.** Event firing is **inclusive** at tick boundaries: an event at
  `tick = N` fires the moment playback time reaches `N * tickDt` — i.e.,
  the same instant the corresponding `PoseFrame` becomes the source frame
  of interpolation.
- **R6a.** Event dispatch uses the **unclamped** tick `floor(timeSec / tickDt)`,
  not the clamped `getCurrentTick()`. The engine emits `simEnd` at
  `tick = result.ticks` (one past the last `PoseFrame`); that event must
  still fire when playback time crosses the end. The `getCurrentTick()`
  clamp is for UI display only.
- **R7.** `getCurrentTick()` returns `min(floor(timeSec / tickDt), totalTicks - 1)`.
  Past the final tick, it clamps; it never returns a value `>= totalTicks`.
- **R8.** `isDone()` returns `true` once `timeSec >= totalTicks * tickDt`.

### Pose interpolation

- **R9.** `getPose(robotId)`:
  - Returns `undefined` for `robotId < 0` or `robotId >= robotCount` (where
    `robotCount` is derived from the first frame's stride at construction).
  - Returns the same internally-owned `InterpolatedPose` object on every
    call, mutated in place. Consumers read the values immediately and
    discard the reference; this is a zero-allocation per-frame contract.
- **R10.** Interpolation uses `tickFloat = timeSec / tickDt`:
  - `tickFloat <= 0`: returns frame 0 exactly.
  - `tickFloat >= lastFrameIdx`: returns the last frame exactly.
  - Otherwise: linear lerp between `frames[floor]` and `frames[floor + 1]`
    using `alpha = tickFloat - floor`.
- **R11.** `x`, `y`, `z` are linearly interpolated.
- **R12.** `yaw` is interpolated along the **shortest arc** on the unit
  circle: the difference is normalized into `(-π, π]` before scaling by
  alpha. Without this, a robot turning across the ±π wrap would visually
  spin the long way round.
- **R13.** `active` is a **step function on the source frame**. A robot
  remains `active === true` for the entire `[tick N, tick N+1)` window
  if frame `N`'s active flag is set. The destination frame's flag is
  ignored. Rationale: precise death-animation timing is driven by
  `elimination` events at exact tick boundaries (R6), not by polling the
  pose flag — so the source-side step gives the cleanest "alive until the
  tick boundary, then dead" semantics.

### Event subscription

- **R14.** `onEvent(handler)` registers a handler and returns an
  `unsubscribe` function. Calling `unsubscribe` removes the handler from
  future dispatches.
- **R15.** Multiple handlers may be registered. Each handler receives every
  event in stored order.
- **R16.** Within a single dispatch round (one `update` call's worth of
  events), the handler list is **snapshotted before iteration**. A handler
  that unsubscribes itself or another handler during dispatch does NOT
  cause sibling handlers to be skipped for the events still in this round.
  Events fired in subsequent `update` calls see the post-mutation handler
  set.
- **R17.** The driver does **not** re-sort events. The engine guarantees
  intra-tick ordering (`elimination` before `finish` within the same
  tick); the driver replays that ordering verbatim.

### Pause / resume / restart

- **R18.** `pause()` sets a flag. `resume()` clears it. `isPaused()` reads it.
- **R19.** `restart()`:
  - Resets `timeSec` to `0`.
  - Resets the event-queue cursor to `0` (every event is eligible to fire
    again on the next `update`).
  - **Preserves** the pause flag. Restart while paused stays paused.
  - **Preserves** all subscribed handlers.
- **R20.** There is no `seek(time)` or `seekToTick(N)` in v1. The only
  supported mutations are `update(+dt)`, `pause`, `resume`, `restart`.
  Backward seeking arrives in v1.x with the replay scrubber UI.

---

## 4. Formulas

### Tick float

```
tickFloat = timeSec / tickDt
tickIdx   = floor(tickFloat)
alpha     = tickFloat - tickIdx          ∈ [0, 1)
```

### Pose interpolation (per axis)

```
out.x = a.x + (b.x - a.x) * alpha
out.y = a.y + (b.y - a.y) * alpha
out.z = a.z + (b.z - a.z) * alpha
```
where `a = frames[tickIdx]`, `b = frames[tickIdx + 1]`.

### Yaw shortest-arc interpolation

```
diff = b.yaw - a.yaw
while diff >  π: diff -= 2π
while diff < -π: diff += 2π
out.yaw = a.yaw + diff * alpha
```

### Active step function

```
out.active = (a.active >= 0.5)         // source-frame flag, no lerp
```

(`a.active` is stored as a `Float32` 0 or 1 in `PoseFrame.data`; the `≥ 0.5`
threshold tolerates any float precision noise even though the writer always
emits exactly 0 or 1.)

### Tick-clamp formulas

```
currentTick = clamp(floor(timeSec / tickDt), 0, totalTicks - 1)
isDone      = timeSec >= totalTicks * tickDt
```

---

## 5. Edge Cases

| Case | Behavior |
|------|----------|
| `update` with `dtSeconds = 0` on a fresh driver, with tick-0 events queued | Tick-0 events fire (R5). After this call, further `dt=0` updates are true no-ops. |
| `update` with `dtSeconds > totalTicks * tickDt` in one call | Time clamps via tick-clamp (R7); all remaining events fire in order during this single dispatch round; `isDone()` becomes true. |
| `update` while paused | No-op. `timeSec` unchanged, no event dispatch. |
| `getPose(robotId)` at `timeSec = 0` | Returns frame-0 pose exactly (alpha=0, lerp degenerates). |
| `getPose(robotId)` past the last frame | Returns last-frame pose exactly (alpha=0 against a degenerate `[last, last]` window). |
| `getPose(-1)` / `getPose(robotCount)` / `getPose(NaN)` | Returns `undefined`. The renderer wire-up (S6-02) treats `undefined` as "skip this instance for this frame." |
| `restart()` mid-playback | Time → 0, event cursor → 0, handlers preserved, pause state preserved. Next `update(dt)` replays from the beginning. |
| Subscribing during dispatch | The new handler is added but does NOT receive events still in flight in the current dispatch round (snapshot semantics, R16). It receives events from the next `update` onward. |
| Unsubscribing the only handler during dispatch | Safe. The snapshot in R16 holds the old reference until the round completes. |
| `tickDtSeconds` mismatched with the engine's tick rate | Allowed but unsupported. Driver will play back faster or slower than the engine's "wall-clock intent." Provided as a test seam, not a tuning surface. |
| `SimResult` with zero events | Legal. Driver advances poses; no events ever fire. `isDone` still works off `totalTicks`. |
| `SimResult` with all events at tick 0 | Legal. They all fire on the first non-paused `update`, in stored order. |

---

## 6. Dependencies

### Inbound (this system depends on)

- **[Sim Engine Core](sim-engine-core.md)** — consumes the `SimResult`,
  `PoseFrame`, and `TimelineEvent` types directly. The driver is a pure
  consumer; it does not call `runSim` itself (the entry point that
  constructs the driver does).
- **[Config Module](config-module.md)** — reads `CONFIG.sim.tickRateHz`
  for the default `tickDtSeconds`.

### Outbound (these systems will depend on this)

- **Renderer ↔ Sim wire-up (S6-02)** — first consumer. Reads `getPose` per
  frame to write `RobotInstance.root.position` / `rotation`; subscribes
  via `onEvent` and forwards `elimination` / `finish` / `simEnd` to the
  Animation State Switcher.
- **[Camera System](systems-index.md) (S6-03)** — reads `getPose` for
  target selection across cull phases; subscribes to gate-related
  `elimination` reasons (`gate_a_closed`, `gate_b_closed`, `race_over`)
  and `finish` to drive target switches.
- **Preact App Shell (S6-04)** — drives the playback control bar
  (pause / resume / restart) directly against the driver. Only pause UI
  reads `isPaused()`.
- **Future**: audio mixer (Sprint 7+) will subscribe to `onEvent` for
  cue triggering.

### Forbidden dependencies

- **No DOM, no Three.js, no `requestAnimationFrame`.** Same Three.js-
  agnostic discipline as the engine. The driver runs in Node and in
  the browser identically.
- **No `Math.random`, `Date.now()`, `performance.now()`.** The driver is
  a pure function of (`SimResult`, `update(dt)` sequence). Real-time
  clock reads happen at the renderer entry (one `clock.getDelta()` per
  frame), not inside the driver.

---

## 7. Tuning Knobs

The driver itself has **no tuning surface**. Every numeric parameter is
either:

- A consequence of the underlying `SimResult` (`totalTicks`, `robotCount`,
  the recorded poses), or
- A construction-time configuration (`tickDtSeconds`, defaulting to
  `CONFIG.sim.tickRateHz`).

Implementation-detail constants (none currently — the file is parameter-
free apart from `tickDt`) would live in module scope per the established
pattern.

The interpolation algorithm is fixed: linear for x/y/z, shortest-arc
linear for yaw, source-step for active. v1 does not expose alternative
interpolation modes (e.g., Hermite, exponential smoothing). If a future
need arises (e.g., low-tickrate sims with visible lerp artifacts), a
strategy parameter can be added without breaking the existing contract.

`CONFIG.sim.tickRateHz` is the single tuning knob, and it lives in the
[Config Module](config-module.md) and is owned by the [Sim Engine
Core](sim-engine-core.md) GDD §7. The driver inherits it.

---

## 8. Acceptance Criteria

All criteria are mechanically tested by [`src/sim/sim-driver.test.ts`](../../src/sim/sim-driver.test.ts).

### Construction

- [ ] **AC-1.** `createSimDriver` throws when `result.poseFrames` is empty.
- [ ] **AC-2.** `createSimDriver` throws on `tickDtSeconds <= 0`.
- [ ] **AC-3.** Default `tickDtSeconds` resolves to `1 / CONFIG.sim.tickRateHz`.
- [ ] **AC-4.** `getTotalTicks()` returns `result.ticks` verbatim.

### Pose interpolation

- [ ] **AC-5.** At `timeSec = 0`, `getPose(id)` returns frame-0 pose exactly.
- [ ] **AC-6.** At a half-tick offset, `getPose(id).x` lerps exactly halfway
  between adjacent frames.
- [ ] **AC-7.** Past the last frame, `getPose(id)` clamps to the last frame.
- [ ] **AC-8.** `getPose(robotId)` returns `undefined` for out-of-range ids.
- [ ] **AC-9.** Yaw interpolation crosses ±π by the shortest arc (e.g.,
  `lerp(3.0, -3.0, 0.5)` lands within `0.01` of ±π, not 0).
- [ ] **AC-10.** `active` is the source frame's flag for the entire
  `[tickN, tickN+1)` window.
- [ ] **AC-11.** `getPose(id)` returns the same object reference across
  calls (zero per-frame allocation).

### Event dispatch

- [ ] **AC-12.** Tick-0 events fire on the first non-paused `update` call,
  even with `dtSeconds = 0`.
- [ ] **AC-13.** Events fire in the order stored on `result.events` —
  intra-tick ordering preserved (eliminations before finishes).
- [ ] **AC-14.** Multiple subscribers each receive every event.
- [ ] **AC-15.** `unsubscribe()` removes the handler from future dispatches.
- [ ] **AC-16.** A handler that unsubscribes during dispatch does not
  cause sibling handlers to be skipped for events still in the current
  dispatch round.

### Pause / restart

- [ ] **AC-17.** While paused, `update(dt)` does not advance `timeSec` or
  fire events.
- [ ] **AC-18.** `restart()` resets `timeSec`, `getCurrentTick`, and the
  event cursor to 0; subscribed handlers are preserved.
- [ ] **AC-19.** `restart()` preserves `isPaused()` state.

### Determinism

- [ ] **AC-20.** Two drivers built from the same `SimResult` and fed the
  same `update(dt)` sequence produce byte-identical `getPose` traces
  (string-formatted to 8 decimal places).
- [ ] **AC-21.** Two drivers built from the same `SimResult` and fed the
  same `update(dt)` sequence produce byte-identical event firing
  sequences.
- [ ] **AC-22.** No `Math.random` calls anywhere in the driver, verified
  by Vitest spy.

---

## Implementation Notes

- File: [`src/sim/sim-driver.ts`](../../src/sim/sim-driver.ts)
- Tests: [`src/sim/sim-driver.test.ts`](../../src/sim/sim-driver.test.ts)
  (29 tests, all AC mechanically verified)
- LOC: ~220 (implementation) + ~370 (tests)
- Followed the **spike-first** pattern (Sprint 5 retro process improvement):
  implementation + tests landed first, GDD reverse-documented from the
  working code in one commit.
