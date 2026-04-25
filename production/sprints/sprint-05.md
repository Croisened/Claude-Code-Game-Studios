# Sprint 5 — 2026-04-24 to 2026-04-30

> **Status**: Active
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-04-24

---

## Context

Sprint 4 retired the project's biggest technical risk: 85 animated skinned-mesh
robots running at 60 FPS in the browser, with the Animation State Switcher
demonstrating `run` ↔ `idle` ↔ `death` transitions. The post-pivot foundation
(Config, PRNG, Build/Deploy, Renderer, Switcher) is in place; no carryover.

Sprint 5 turns from rendering to **simulation**. The goal is a headless,
deterministic Sprint Race event running end-to-end in Node, producing an event
timeline JSON. No rendering of actual sim state yet — the renderer integration
arrives in Sprint 6.

Reference documents:
- [design/gdd/game-concept.md](../../design/gdd/game-concept.md)
- [design/gdd/systems-index.md](../../design/gdd/systems-index.md)
- [production/sprints/sprint-04-retrospective.md](sprint-04-retrospective.md)

---

## Sprint Goal

**Headless sim produces a deterministic Sprint Race event timeline.** Trait math
+ roster + arena loaded; sim engine core ticks; one Sprint Race event runs from
start to winner — all in Node, no rendering yet. Renderer integration is Sprint 6.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for unplanned work |
| **Available** | 4 days |

> Per Sprint 1–4 retro pattern: estimates are upper bounds and useful for
> sequencing, not time budgets. The unit of measure is "tasks per session,"
> not "hours per task." Treat the Est. column as relative size only.

---

## Tasks

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|--------------|---------------------|
| S5-01 | **Trait → Stat Derivation** — GDD (S-tier, 8-section) + implementation. Pure function: `(traits) → {speed, acceleration, handling, pathfinding, caution, chaos}`. Coefficients live in `CONFIG.sim.traitToStat`. Unit tests cover curve shape and edge cases (all-zero traits, max traits, sum-at-100 boundary). | S | Config Module | GDD approved; pure function with no side effects; tests cover representative trait profiles + boundaries; deterministic |
| S5-02 | **Robot Roster Loader** — GDD (S-tier) + implementation. Loads built `robots-traits.json`, resolves the 85 skin texture paths, returns a `RobotRoster` shape ready for the sim. Re-uses the CSV→JSON build step from S4-03. | S | Config Module, S4-03, S5-01 | GDD approved; loads all 85 robots; texture paths resolve; missing-robot / malformed-row edge cases enumerated |
| S5-03 | **Arena Loader + `sprint-01.json`** — GDD (M-tier) + implementation + first hand-authored arena. Schema: lane count, length, gate positions, stage cull thresholds, start grid. Pure data, validated on load. | M | Config Module | GDD approved; `assets/data/arenas/sprint-01.json` validates and loads; in-memory arena type usable by sim and (future) renderer |
| S5-04 | **Sim Engine Core** — GDD (L-tier) + implementation. Fixed 60 Hz timestep, active-robot array, elimination bookkeeping, position/rotation updates, event timeline emission. Three.js-agnostic (Node-runnable). | L | Config Module, PRNG, S5-01, S5-02, S5-03 | GDD approved; **same seed → same outcome** determinism test passes; tick loop runs in Node; no `Math.random` use; emits structured timeline events (tick, position, elimination, finish) |
| S5-05 | **Sprint Race Event Module** — GDD (M-tier) + implementation. Per-tick AI decisions, gate/lane logic, three-stage cull (85 → 28 → 10 → 1), winner signal. Drives Sim Engine Core for the sprint event type. | M | S5-04 | GDD approved; one Sprint Race runs end-to-end in a Node script; produces a winner; cull stages fire at correct gates; deterministic vs. seed |

### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|--------------|---------------------|
| S5-06 | **Headless sim harness** — `tools/sim/run-event.ts` script. Loads roster + arena, runs Sprint Race, prints/emits timeline JSON. This is the artifact Sprint 6 will consume to drive the renderer. | S | S5-05 | `npx tsx tools/sim/run-event.ts --seed 42` runs to completion, outputs deterministic JSON; runtime < 1s for one sprint event |

### Nice to Have (Sprint 4 retro carryovers + drive-bys)

| ID | Task | Est. | Source | Acceptance Criteria |
|----|------|------|--------|---------------------|
| S5-07 | **Bundle-size audit baseline** — run `vite build`, record `dist/assets/*.js` sizes, document baseline in `docs/performance/bundle-baseline.md`. | XS | S4 retro AI #2 | Baseline numbers committed; defensible reference for Sprint 6+ growth |
| S5-08 | **Codify "approve = commit" protocol** — one-line addition to `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`: only unqualified "approve" / "commit" / "ready to commit" counts as a commit signal. | XS | S4 retro AI #1 | One-line edit committed |
| S5-09 | **Drive-by**: remove the resolved cross-reference TODO note from `design/gdd/85-instance-renderer.md` §7. | XS | S4 retro AI #4 | TODO gone; commit references AI #4 |

---

## Convention Change (per Sprint 4 retro AI #3)

**Stop tracking unplanned mid-sprint tasks in `sprint-05.md`.** Three sprints
attempted, three sprints missed. Going forward: unplanned work is captured in
the retrospective only. Sprint plan = planned work; retro = what actually
shipped. The mid-sprint tracking step is process overhead the developer doesn't
naturally do, and the retro has reliably caught the same information.

---

## Carryover from Sprint 4

None active. The three open Sprint 4 retro action items are captured as Nice to
Have tasks (S5-07, S5-08, S5-09).

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Sim determinism breaks subtly (Map iteration order, float drift, accidental `Math.random`) | Medium | **High (project-level)** | Determinism test wired in from day 1 of S5-04 (same seed → same timeline hash). `Math.random` already forbidden in tech-prefs. Sort every collection iteration by a stable key. Use the seeded RNG for every stochastic decision; route through `createRng` only. |
| Trait → Stat coefficients hard to balance without visual feedback | Medium | Low | Sprint 5 does not need *good* balance, only *deterministic* and *plausible*. Real tuning waits for renderer integration in Sprint 6 when behavior is observable. |
| Arena schema needs to evolve once the renderer consumes it (S6) | High | Low | Accept the churn. Keep schema minimal for v1 sprint; refactor in S6 if needed. Don't over-design speculative fields now. |
| Sim Engine GDD larger than estimated (L-tier) | Low | Medium | Spike-first option available — write a Node harness against a stub trait→stat before the GDD is fully approved, mirroring the S4-04 pattern that worked well. |
| Hand-authored `sprint-01.json` underspecified — first arena reveals missing schema fields | Medium | Low | First arena IS the schema validator. Expect one round of "oh, we also need X" iteration during S5-03; budget for it inside the M estimate. |

---

## Dependencies on External Factors

- **None.** Sprint 5 is entirely local: TypeScript + Vitest + Node. No Render
  deploy work, no external APIs, no Supabase, no Three.js (sim is rendering-agnostic).

---

## Build Order

```
S5-01 (Trait→Stat)   ─┐
S5-02 (Roster)       ─┼─► S5-04 (Sim Engine) ─► S5-05 (Sprint Race) ─► S5-06 (harness)
S5-03 (Arena)        ─┘

S5-07 (bundle audit)        ┐
S5-08 (approve protocol)    ├─ independent; any time
S5-09 (TODO cleanup)        ┘
```

Critical path: **S5-01 / S5-02 / S5-03 (parallel) → S5-04 → S5-05 → S5-06**.

S5-01, S5-02, S5-03 have no inter-dependencies and may be authored in parallel
or in any order. S5-04 needs all three before its implementation can land.

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All five Must-Have GDDs written and approved before their implementation commits
- [ ] `npx tsx tools/sim/run-event.ts --seed 42` runs to completion and produces a winner
- [ ] Determinism test (same seed → same timeline hash) passes
- [ ] No `Math.random` use anywhere in `src/sim/`
- [ ] All new code reviewed per `coding-standards.md` (doc comments, tests, no magic numbers)
- [ ] Sprint retrospective written at close (`sprint-05-retrospective.md`)

---

## Sprint Exit Criteria

**Good**: S5-01 through S5-04 complete. Sim ticks deterministically. Sprint Race
event module (S5-05) and harness (S5-06) slip to Sprint 6.

**Great**: All Must + Should tasks complete. Sprint 6 starts with a working
headless sim consuming hand-authored arena JSON, ready to wire to the renderer.

**Concerning**: S5-04 determinism cannot be made stable in the sprint window.
Sprint 6 plan inherits a determinism debugging task before renderer integration
can begin.
