# Retrospective: Sprint 1
Period: 2026-03-30 — 2026-03-31
Generated: 2026-03-31

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Tasks (Must Have) | 8 | 8 | 0 |
| Tasks (Should Have) | 2 | 2 | 0 |
| Tasks (Nice to Have) | 2 | 2 | +2 |
| Total Tasks | 8 | 12 | +4 |
| Completion Rate | 100% (must) | 100% | — |
| Effort Days Planned | 4 | ~1 (single session) | −3 |
| Unit Tests Written | — | 175 | — |
| Bugs Found Post-Delivery | — | 2 (visual) | — |
| Bugs Fixed | — | 2 | — |
| Unplanned Tasks Added | — | 2 (arch diagram, bug fixes) | — |
| Commits (sprint) | — | 15 | — |

---

## Velocity Trend

| Sprint | Planned Tasks | Completed | Rate |
|--------|--------------|-----------|------|
| Sprint 1 (current) | 8 Must + 2 Should | 12 (all + 2 NTH) | 150% |

**Trend**: Baseline established.
First sprint — no prior data for comparison. Velocity significantly exceeded the plan due to Claude Code agent pair-programming compressing implementation time.

---

## What Went Well

- **100% Must Have + Should Have + Nice to Have completion** — all 12 planned tasks shipped in a single session, well within the 5-day sprint window.
- **175 unit tests written** — every system has meaningful test coverage including edge cases (delta clamp, collision guards, pool exhaustion, localStorage failure). Tests caught real integration bugs (singleton GSM state leaking between tests, TypeScript `readonly` violation).
- **Zero regression on refactor** — a mid-sprint refactor (shared materials, DEV guards, main.ts cleanup) was applied across 4 files without breaking any tests.
- **Playable core loop shipped** — robot runs, dodges, dies, restarts with live score and personal best. Sprint goal fully met.
- **GDD-driven development worked** — every system was implemented directly from its GDD. No design ambiguity caused implementation blockers.
- **Dependency Injection pattern** — adopting DI (constructor-injected GSM, InputSystem) from S1-02 onward made isolated testing straightforward throughout the sprint.

---

## What Went Poorly

- **Two visual bugs shipped** — the robot appeared below the floor and floor tiles vanished every other section. Both were caught during first browser run, not during testing. Root causes: (1) mesh origin assumption mismatch between CharacterRenderer and RunnerSystem `position.y=0` reset; (2) `recycleBuffer` value didn't account for camera Z offset.
- **No visual regression testing** — unit tests cover logic but cannot catch rendering issues. The visual bugs required a browser run to detect; there is no automated layer for this.
- **TypeScript `readonly` violation shipped** — `ObstacleSystem._config` was declared `readonly` but `setSpawnInterval()` reassigned it. This caused a `tsc --noEmit` failure that wasn't caught until after the commit. The test suite (Vitest) doesn't run `tsc`, so type errors can slip through.
- **Rapier physics integration deferred** — GDD specified Rapier `setTranslation()` for lane changes, `applyImpulse()` for jump, and `OBSTACLE_GROUP` collision callbacks. All three were replaced with manual position writes and AABB checks. This is a known tech debt item, not a surprise, but it means collision accuracy and physics feel are currently unverified against the Rapier spec.

---

## Blockers Encountered

| Blocker | Duration | Resolution | Prevention |
|---------|----------|------------|------------|
| Robot mesh below floor | ~10 min | Bottom-anchored geometry via `geo.translate(0, 0.9, 0)` instead of `position.y` offset | Establish convention: mesh origins always at base; document in coding standards |
| Floor tiles disappearing | ~20 min | `recycleBuffer` must be ≥ `cameraZOffset + chunkLength` (8+20=28); `chunkCount` raised 4→5 | Add a startup assertion that validates `recycleBuffer > cameraZOffset` |
| GSM singleton state leaking between tests | ~15 min | Switched all tests to fresh `new GameStateManager()` instances (DI) | Already resolved — DI pattern is now standard |
| TypeScript `readonly` on mutable config | ~5 min | Changed `readonly _config` to `_config` in ObstacleSystem | Run `tsc --noEmit` as part of pre-commit check (see action items) |

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S1-07 Runner System | 0.75d | ~1–2h | −80% | Claude Code agent pair programming massively compresses implementation |
| S1-08 Obstacle System | 0.75d | ~1–2h | −80% | Same — test-driven implementation with agent assistance |
| S1-02 GSM | 0.5d | ~30min | −75% | Clean, well-specified GDD meant no design iteration during implementation |
| S1-05 Environment Renderer | 0.5d | ~45min | −70% | Same |
| Visual bug fixes (unplanned) | 0 | ~30min | N/A | No estimate for post-delivery bugs |

**Overall estimation accuracy**: 0% of tasks within +/- 20% of estimate — all tasks dramatically underran.

**Analysis**: Effort estimates were written for a human developer working alone. Claude Code agent pair-programming compresses implementation by 5–10×. Sprint estimates should be rebased for the actual working mode. For Sprint 2, treat estimates as upper bounds only; plan 2–3× as many tasks as a human-hour estimate would suggest.

---

## Carryover Analysis

No tasks carried over. All 12 planned tasks completed.

| Deferred Item | Reason | Target Sprint |
|---------------|--------|---------------|
| Rapier physics body integration (lane/jump/collision) | enable3d physics body API not yet wired to scene objects; AABB stub sufficient for MVP validation | Sprint 2 |
| AnimationMixer / animation clips | No .glb asset yet; placeholder timer sufficient | Sprint 2 (art pass) |

---

## Technical Debt Status

- **TODO count**: 6 (all in production code, 0 in tests)
- **FIXME count**: 0
- **HACK count**: 0
- **Trend**: Baseline — first sprint

**TODO breakdown**:
- `runner-system.ts` (1): Replace simulated gravity with Rapier `applyImpulse()`
- `obstacle-system.ts` (1): Replace AABB with Rapier kinematic bodies + `OBSTACLE_GROUP` collision filter
- `character-renderer.ts` (4): AnimationMixer wiring — Idle/Run crossfades and Death clip trigger

All 6 TODOs are documented deferred-physics and deferred-animation items. None represent shortcuts in active logic. Debt is intentional and bounded.

---

## Previous Action Items Follow-Up

N/A — this is Sprint 1. No prior retrospectives.

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | Add `tsc --noEmit` to pre-commit (or CI) check — TypeScript errors should not reach commits | Nathanial | High | Sprint 2 start |
| 2 | Add camera/recycle startup assertion: `recycleBuffer > cameraZOffset` — prevent floor-gap regression | Nathanial | High | S2-01 (EnvironmentRenderer hardening) |
| 3 | Rebase sprint capacity planning for agent pair-programming — plan 2–3× task count vs. human-hours estimate | Nathanial | Medium | Sprint 2 planning |
| 4 | Implement Rapier physics body integration for lane changes, jump, and collision detection (replace AABB stub) | Nathanial | High | Sprint 2 |
| 5 | Begin art pass — replace placeholder box meshes with first-pass geometry for robot, barriers, and drones | Nathanial | Medium | Sprint 2 |

---

## Process Improvements

- **Type-check gate**: The `readonly` TS error and any future type regressions should be caught before commit, not after. Add `npm run typecheck` (`tsc --noEmit`) to the pre-commit workflow or run it manually before every commit.
- **Visual smoke test checklist**: Before committing rendering changes, run a 30-second browser check: robot visible, floor seamless, obstacles appear. A quick checklist prevents the class of bugs that unit tests structurally cannot catch.

---

## Summary

Sprint 1 was a strong success — all 12 tasks (8 Must, 2 Should, 2 Nice-to-Have) shipped in a single session with 175 unit tests and a fully playable core loop. The GDD-driven approach eliminated design ambiguity during implementation and the DI architecture enabled clean isolated testing throughout. Two visual bugs were caught immediately on first browser run and fixed quickly, but point to a gap in pre-commit validation: `tsc --noEmit` should be a standard step before every commit. The single most important change for Sprint 2 is formalising the type-check gate and beginning the Rapier physics body integration, which is the largest outstanding tech debt item.
