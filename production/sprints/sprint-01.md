# Sprint 1 — 2026-03-30 to 2026-04-05

> **Status**: Active
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-03-30

---

## Sprint Goal

Build all 8 MVP production systems in `src/` — the core loop (run, dodge, die,
restart) is playable in the browser with no prototype code in the path.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for Rapier/enable3d integration friction |
| **Available** | 4 days |

---

## Tasks

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S1-01 | Project scaffolding — `src/` entry point, Vite config, Three.js + enable3d wired, PhysicsLoader boots | 0.25d | — | `npm run dev` serves a blank Three.js scene with Rapier initialized |
| S1-02 | Game State Manager — 6-state machine, event emitter, invalid transition guard | 0.5d | S1-01 | All valid transitions fire events; invalid transitions log + reject; unit tests pass |
| S1-03 | Input System — keyboard handler, 4 actions, enable/disable, blur clear | 0.25d | S1-01 | `enable()`/`disable()` idempotent; key-repeat suppressed; blur clears state |
| S1-04 | Character Renderer — placeholder box mesh at robot scale, GLTFLoader scaffolded | 0.25d | S1-02 | Robot mesh visible at `LANE_CENTER`; show/hide on GSM state |
| S1-05 | Environment Renderer — scrolling lane floor + placeholder building columns, `setScrollSpeed()` API | 0.5d | S1-02 | Lane tiles loop seamlessly; `ER.setScrollSpeed(0)` halts scroll; `setScrollSpeed(8)` scrolls |
| S1-06 | Camera System — follow camera, X lerp, Y/Z offsets | 0.25d | S1-04 | Camera tracks robot X with lerp; fixed Y/Z offset; no jitter |
| S1-07 | Runner System — lane snap via Rapier `setTranslation`, jump impulse (`gravity=30`), slide collider swap, speed ramp, GSM integration | 0.75d | S1-02, S1-03, S1-04, S1-05, S1-06 | Lane snaps instantly; jump arc peaks ~2.4 units, air time ~0.8s; slide duration 0.6s; `collisionDetected` event fires on hit; `InputSystem.enable()`/`disable()` called on state transitions |
| S1-08 | Obstacle System — object pool (8 obstacles), Barrier + Drone types, spawner, Rapier `OBSTACLE_GROUP` collision | 0.75d | S1-02, S1-07 | Pool pre-allocated at startup; no `new` calls in game loop; Barrier kills on body contact; Drone kills unless sliding; `collisionDetected` fires GSM → Dead transition |

### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S1-09 | Score & Distance Tracker — live distance counter, personal best persistence (localStorage) | 0.25d | S1-02 | Distance increments during Running; resets on restart; personal best persists across page reload |
| S1-10 | Jump arc tuning pass — confirm `gravity=30, jumpForce=12` in `RUNNER_SYSTEM_CONFIG`, playtest barrier clearance | 0.25d | S1-07, S1-08 | Barrier clearance confirmed at walking speed and max speed; no death-on-perfect-jump |

### Nice to Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S1-11 | Inline HUD — distance counter text overlay during run, personal best on death screen | 0.25d | S1-09 | Distance visible during run; score + PB shown on death; disappears on restart |
| S1-12 | Restart input — press any key on death to restart (GSM `Dead → Running` trigger) | 0.1d | S1-02, S1-07 | Keypress on Dead state fires restart; no double-trigger |

---

## Carryover from Previous Sprint

None — this is Sprint 1.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| enable3d/Rapier API friction — `setTranslation`, `setNextKinematicTranslation`, collision callback signatures differ from LLM knowledge | High | Medium | Check actual installed API before writing; `REPORT.md` documents known correct calls |
| Environment Renderer scope creep — temptation to polish art before loop is proven | Medium | High | Sprint 1 ER is placeholder only — box meshes, flat lane tiles. Art pass is Sprint 2 |
| Rapier collision callback wiring — `OBSTACLE_GROUP` filter pattern is enable3d-specific | Medium | Medium | Verify against enable3d GitHub source if callback doesn't fire; fallback to per-frame AABB as temporary stub |
| Solo bandwidth — 8 systems in 4 available days is aggressive | Medium | Medium | S1-09 through S1-12 are explicitly optional; core loop (S1-01 to S1-08) is the only hard requirement |

---

## Dependencies on External Factors

- **enable3d/Rapier documentation**: API verification required before implementing S1-07 and S1-08. Reference: https://github.com/yandeu/enable3d
- **Node/npm environment**: `npm install` must succeed in project root before S1-01 can begin

---

## Definition of Done

- [ ] `npm run dev` runs the game in the browser with no console errors
- [ ] Robot runs forward; player can lane-switch (A/D + arrow keys), jump, and slide
- [ ] At least one Barrier and one Drone obstacle spawn and kill the robot on contact
- [ ] Death triggers a state transition; restart returns to Running state
- [ ] All tunable values live in `RUNNER_SYSTEM_CONFIG` and `OBSTACLE_SYSTEM_CONFIG` — no magic numbers in game loop code
- [ ] No prototype code imported or referenced from `src/`
- [ ] Unit tests pass for GSM state machine and Input System

---

## Implementation Notes

### Prototype → Production delta (from REPORT.md)

The prototype validated the loop. Production rewrites are not refactors — they are
clean implementations built to the GDDs. Key deltas:

1. **Jump arc**: Use `gravity=30, jumpForce=12` as starting point (prototype used `gravity=20` — too floaty). Apply impulse via Rapier body; detect landing via `position.y ≤ groundY + epsilon`.
2. **Collision**: Rapier `OBSTACLE_GROUP` filter + `onCollisionEnter` callback — not AABB.
3. **Lane changes**: `body.setTranslation()` via enable3d — not direct `position.x` writes.
4. **Input**: `InputSystem` class with `enable()`/`disable()` — not raw `keydown` events.
5. **Speed**: Runner System calls `ER.setScrollSpeed(currentSpeed)` — obstacles do not move themselves.
6. **Config**: All values in named config objects — no hardcoded numbers in game loop.

### Build order

```
S1-01 (scaffold)
  ├── S1-02 (GSM)     ← unit test immediately
  └── S1-03 (Input)   ← unit test immediately
        ├── S1-04 (CharacterRenderer)
        ├── S1-05 (EnvironmentRenderer)   ← placeholder art only
        └── S1-06 (CameraSystem)
              └── S1-07 (RunnerSystem)    ← first playable moment
                    └── S1-08 (ObstacleSystem)   ← core loop complete
                          ├── S1-09 (Score)
                          ├── S1-10 (Jump tuning)
                          ├── S1-11 (HUD)
                          └── S1-12 (Restart input)
```
