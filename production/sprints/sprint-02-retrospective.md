# Retrospective: Sprint 2
Period: 2026-04-01 — 2026-04-01
Generated: 2026-04-01

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 3 (S2-01, S2-02, S2-03) | 2 completed, 1 correctly deferred (S2-02) | — |
| Should Have tasks | 3 (S2-07, S2-08, S2-09) | 2 completed, 1 correctly dropped (S2-08) | — |
| Nice to Have tasks | 3 (S2-10, S2-11, S2-12) | 3 completed | +3 |
| Active tasks completed | 7 | 7 | 0 |
| Completion Rate | 100% (must) | 100% | — |
| Scope descoped (correct decisions) | — | 4 (S2-02, S2-04, S2-05, S2-06, S2-08) | — |
| Effort Days Planned | 4 (2 available after buffer) | ~1 session | −3 |
| Unplanned tasks added | — | 3 (GLTFLoader wiring, animation swap, hero camera) | — |
| Visual bug fix commits | — | 4 | — |
| Commits (sprint) | — | 12 | — |
| TODOs at close | — | 2 (down from 6) | −4 |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 (incl. 2 NTH) | 120% |
| Sprint 2 (current) | 7 active (4 descoped) | 7 + 3 NTH = 10 | 143% |

**Trend**: Increasing.
Sprint 2 matched Sprint 1's single-session delivery and shipped all three Nice-to-Haves, despite the sprint containing more complex external integrations (Supabase, browser audio API, GLB animation pipeline).

---

## What Went Well

- **All Sprint 1 action items resolved.** The `tsc --noEmit` pre-commit gate (S2-01), recycleBuffer startup assertion, and capacity planning adjustments were all addressed before the first feature task.
- **Smart scope decisions unblocked velocity.** Dropping wallet connect (S2-04/05/06/08) and deferring Rapier (S2-02) were made early and cleanly. The NFT ID input (S2-07) delivered the core skin personalisation without any Web3 friction — a strictly better player experience for this stage.
- **Technical debt shrank: 6 TODOs → 2.** Four TODOs from Sprint 1 were resolved by the GLB animation pipeline work (AnimationMixer wiring, idle/run/death model swaps). The two remaining TODOs are intentional and bounded (Rapier lane snap and AABB → Rapier collision, both deferred by design).
- **Leaderboard shipped in one session.** Supabase REST integration, top-10 ScoreScreen UI, player row highlighting, graceful error handling — all completed in a single sitting with zero type errors at commit. The no-SDK approach (plain `fetch()`) kept dependencies clean.
- **Audio system required zero post-delivery bug fixes.** The edge case handling (autoplay policy, fade cancellation, mute-during-fade, spam rewinding) was designed upfront in the GDD and implemented correctly first-pass.
- **Art pass gave the obstacles distinct identity.** Barrier and Drone went from debug-colored boxes to emissive neon geometry in a contained refactor with no hitbox changes and no test breakage.

---

## What Went Poorly

- **Four visual bug fix commits were needed.** UI layout, text visibility, overlay positioning, and robot metalness all required post-implementation correction passes. These are structurally invisible to the type-checker and unit tests — they only surface in the browser.
- **Skin ID default was wrong at first launch.** The input defaulted to empty instead of `9`, exposing a gap: the system had no concept of a canonical default. This was caught during leaderboard testing (player submitted as "Guest"), not during implementation. It required a follow-up fix.
- **External setup dependency (Supabase) created a blocking step.** The leaderboard implementation required the user to create a project, run a SQL migration, and supply credentials before any code could be tested. This isn't avoidable, but it wasn't surfaced in the sprint plan as a risk.
- **Unplanned scope crept in silently.** Three tasks not in the sprint plan were completed (GLTFLoader wiring, animation model swapping, hero showcase camera). These were the right calls but were not tracked — they consumed session time that wasn't accounted for.

---

## Blockers Encountered

| Blocker | Duration | Resolution | Prevention |
|---------|----------|------------|------------|
| Supabase project not yet created | ~10 min | User created project and ran SQL migration | Document external service setup as a pre-sprint dependency in the sprint plan |
| Skin ID defaulted to empty — leaderboard submitted "Guest" | ~5 min | Added default of `'9'` and 0–83 clamp in `_loadSkinId()` | Default values for all persistent state should be explicit in config, not inferred from absence |
| Browser autoplay policy blocks audio | Handled in GDD | One-shot pointer/keydown unlock listener designed upfront | N/A — design handled it correctly |

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S2-09 Audio System | 0.5d | ~1.5h | −80% | Agent pair-programming; GDD was complete before implementation began |
| S2-10/S2-11 Leaderboard | 0.75d combined | ~1.5h | −80% | Same; plain fetch() avoided SDK setup overhead |
| S2-12 Art pass | 0.5d | ~45 min | −75% | Geometry-only, no asset pipeline; contained refactor |
| S2-07 Skin Selector | 0.25d | ~30 min | −75% | Same pattern |
| S2-03 Difficulty Curve | 0.5d | ~1h | −80% | Same |

**Overall estimation accuracy**: 0% of tasks within +/- 20% of estimate. All tasks dramatically underran — same pattern as Sprint 1.

**Analysis**: The Sprint 1 retro recommended planning 2–3× the task count for the agent pair-programming working mode. Sprint 2 applied this and still finished all active tasks plus all Nice-to-Haves in one session. The next adjustment: estimates are useful only for sequencing and dependency mapping, not for capacity planning. Capacity should be driven by task count and scope, not hour estimates.

---

## Carryover Analysis

No active tasks carried over.

| Deferred Item | Original Sprint | Decision | Status |
|---------------|----------------|----------|--------|
| Rapier physics body integration | S1 (S2-02) | Deferred indefinitely — AABB working well for lane runner | Closed as won't-fix for this scope |
| Web3 wallet connect | S2 (S2-04/05/06) | Dropped — NFT ID input replaces the need | Closed |

---

## Technical Debt Status

- **TODO count**: 2 (previous: 6) ↓
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Shrinking — 4 TODOs resolved this sprint.

**Remaining TODO breakdown**:
- `runner-system.ts` (1): Replace simulated gravity with Rapier `applyImpulse()` — intentional deferral
- `obstacle-system.ts` (1): Replace AABB with Rapier kinematic bodies — intentional deferral

Both are the same items from Sprint 1. They are bounded and non-blocking for the current game scope. No new debt introduced.

---

## Previous Action Items Follow-Up

| Action Item (from Sprint 1) | Status | Notes |
|-----------------------------|--------|-------|
| Add `tsc --noEmit` pre-commit gate | ✅ Done | S2-01: hook added, passed clean at every commit this sprint |
| Add `recycleBuffer > cameraZOffset` startup assertion | ✅ Done | Assertion added in `main.ts` boot block |
| Rebase capacity planning for agent pair-programming | ✅ Done | Sprint 2 planned 2–3× task count; retro recommendation applied |
| Rapier physics body integration | ➡ Deferred indefinitely | Correct decision — AABB sufficient, Rapier adds complexity without gameplay benefit |
| Art pass — replace placeholder boxes | ✅ Done | S2-12: Barrier gate + Drone geometry shipped |

**4 of 5 action items fully resolved. 1 correctly closed as won't-fix.**

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | Add a 30-second browser smoke test checklist to the pre-commit workflow — robot visible, floor seamless, obstacles render, UI overlays show — to catch visual regressions before commit | Nathanial | High | Sprint 3 start |
| 2 | Explicitly list external service dependencies in the sprint plan (Supabase, audio assets, etc.) with a "ready before sprint" checkbox — prevents mid-sprint blocking setup steps | Nathanial | Medium | Sprint 3 planning |
| 3 | Make all persistent state defaults explicit in config (`AUDIO_SYSTEM_CONFIG`, `LEADERBOARD_CONFIG`, etc.) — no system should rely on absence of a localStorage value to determine its default | Nathanial | Medium | Sprint 3 start |
| 4 | Track unplanned tasks in the sprint doc as they are added — silently completing out-of-plan work masks the true sprint load and makes velocity comparison unreliable | Nathanial | Low | Sprint 3 (ongoing) |

---

## Process Improvements

- **Browser smoke test before commit**: Unit tests and `tsc --noEmit` cannot catch rendering bugs. A 30-second manual checklist (robot, floor, obstacles, UI) run before every rendering-adjacent commit would have caught the four visual bug-fix commits this sprint. The cost is ~30 seconds; the benefit is a cleaner commit history and no "fix UI visibility" noise.
- **Sprint plan as the single source of truth for scope**: Three unplanned tasks were completed this sprint without being tracked. This makes velocity data unreliable over time. When a task is added mid-sprint, add it to the sprint doc immediately — even a one-liner — so the plan reflects reality.

---

## Summary

Sprint 2 was a clean success: all active tasks completed, all three Nice-to-Haves shipped, all Sprint 1 action items resolved, and technical debt shrunk from 6 TODOs to 2. The external integrations (Supabase, browser audio API) introduced minor setup friction but were handled without blocking the delivery. The recurring pattern is that human-scale estimates remain irrelevant — the working mode consistently delivers in one session what was planned for a week. The single most important change for Sprint 3 is formalising a pre-commit browser smoke test to catch the class of visual regressions that unit tests structurally cannot see.
