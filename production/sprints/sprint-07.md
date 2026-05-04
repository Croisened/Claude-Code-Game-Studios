# Sprint 7 — 2026-05-04 to 2026-05-10

> **Status**: Closed (2026-05-04, all Must + Should + NTH delivered in one session)
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-05-04

---

## Context

Sprint 6 closed 2026-05-04 with the v1 mechanical spine working end to
end (Sprint Race + Maze Race, four-mode camera, WinnerCard, cyberpunk
landing). The S6 retrospective surfaced three candidate sprint goals
for Sprint 7: Sound, NFT/wallet integration, or a third event/arena.

Sprint 7's chosen direction is **the third event**, in two pieces:

1. **Maze balance/variance tuning** — reduce front-runner lock-in
   produced by the current single-stage race-to-exit, per the S7
   pre-sprint balance audit. Lever choice: 2 + 3 + 5 (finish-cell
   grace window, chaos-jitter on junction direction, wrong-turn
   recovery bonus).
2. **Obstacle Gauntlet event module** — full spec per
   [game-concept.md §3](../../design/gdd/game-concept.md): three trap
   types (swinging hammers, pit traps, crumbling bridges) + three
   staged culls (~30 → 10 → 1). Doubter-favored.

This sprint also closes three Sprint 6 retrospective action items:
AI #4 (dev HUD label), AI #5 (renderer GDD cross-ref for the Winner
Camera rotation override), and AI #7 (reverse-doc the maze-race
module).

Reference documents:
- [Sprint 7 plan file](../../../../.claude/plans/what-is-next-foamy-porcupine.md)
- [design/gdd/game-concept.md](../../design/gdd/game-concept.md)
- [design/gdd/systems-index.md](../../design/gdd/systems-index.md)
- [production/sprints/sprint-06-retrospective.md](sprint-06-retrospective.md)

---

## Sprint Goal

**A viewer can watch any of three deterministic events in the
browser, with three trap types + staged culls in the new Gauntlet
and reduced front-runner lock-in in the Maze.**

By sprint close: `#peek` (sprint), `#peek-maze` (maze), and
`#peek-gauntlet` (gauntlet) all play end-to-end with winner reveal.
The "three-event variety claim" from `game-concept.md` is delivered.

---

## Capacity

| | |
|---|---|
| **Total days** | 6 working days |
| **Buffer (20%)** | 1.2 days reserved for unplanned work |
| **Available** | 4.8 days |

> Estimates are upper-bound size labels (XS/S/M/L), not time budgets,
> per the established Sprints 1–6 pattern. Treat the Est. column as
> relative size only.

---

## Tasks

> **Live status convention** (per Sprint 6 retro AI #2 / `coordination-rules.md`
> rule #6): Status column is updated **in the same commit** as the
> work it tracks. Pending → In Progress → Done (commit hash).

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Status | Acceptance Criteria |
|----|------|------|--------------|--------|---------------------|
| S7-01 | **Maze Race GDD reverse-doc** — author `design/gdd/maze-race-event-module.md` from the existing `src/sim/maze-race.ts` module. Closes Sprint 6 retro AI #7. Documents pre-tuning behavior; S7-02 levers extend it inline. | S | — | **Done** | GDD approved with 8 required sections; cell-arrival logic, wrong-turn rule, separation force, and finish detection all documented; tuning knobs reference current `CONFIG.sim.mazeRace` values |
| S7-02 | **Maze variance levers (2 + 3 + 5)** — implement finish-cell grace window, chaos-jitter on junction direction, wrong-turn recovery bonus. Extend tests; update `CONFIG.sim.mazeRace`; update Maze GDD §3 + §4 + §7. | M | S7-01 | **Done** | All three levers shipped; determinism preserved (same seed → same finish order in browser AND harness); new tests cover each lever + grace-window tie-break; no `Math.random` introduced |
| S7-03 | **Branching refactor** — `arenaPathFromHash()`, `buildArenaSetup()`, and `tools/sim/run-event.ts` switched from `if (isMaze)` binary to `switch (arena.type)` 3-arm dispatch. Preparatory for S7-04. | S | — | **Done** | All existing 257+ tests green after refactor; manual smoke test on `#peek` and `#peek-maze` confirms no regression; harness still runs both arena types |
| S7-04 | **Obstacle Gauntlet sim** — spike-first `EventModule` implementation with three trap types + three stage culls + finish. Author `assets/data/arenas/arena-03.json` alongside. Extend `Arena` union type with `gauntletConfig`. | L | S7-03 | **Done** | `arena-03.json` parses; gauntlet sim runs deterministically (same seed twice = identical `SimResult`); 85 → ~30 → ~10 → 1 culls verified by test; sum of eliminations + finishes = 85 (no leakage) |
| S7-05 | **Gauntlet visuals** — `src/arena-visuals/gauntlet-traps.ts`. Pit hole geometry, swinging-hammer mesh + per-frame rotation, crumbling-bridge segments. Mirrors `maze-walls.ts` structure. Hammer cycle math reads `tick * cycleTickRate`, NOT real-time clock — sim-authoritative. | M | S7-04 | **Done** | All three trap types visually present in `#peek-gauntlet`; hammer rotation phase derives from sim tick (not wall-clock); bridge segments visually crumble at the cull moment; no per-frame allocations in update path |
| S7-06 | **Gauntlet GDD + arena-loader extension** — `design/gdd/obstacle-gauntlet-event-module.md` (M-tier). Document trap mechanics, collision rules, stage definitions, JSON schema. Extend `design/gdd/arena-loader.md` with the gauntlet schema (or sibling `gauntlet-arena.md`). | M | S7-04 | **Done** | GDD approved with 8 required sections; trap collision math + stage cull rules formalised; JSON schema includes pit zones + hammer specs + bridge segments + stage definitions |
| S7-07 | **App + landing wiring** — `#peek-gauntlet` route, Landing PeekButton, gauntlet `ArenaSetup` arm in `buildArenaSetup()`. End-to-end playable. | S | S7-04, S7-05, S7-03 | **Done** | Click "Obstacle Gauntlet →" from Landing → race plays → traps trigger → three culls visible → winner reveal fires; Race Again works; renderer disposes cleanly |

### Should Have

| ID | Task | Est. | Source | Status | Acceptance Criteria |
|----|------|------|--------|--------|---------------------|
| S7-08 | **Systems index update** — Maze Race + Obstacle Gauntlet event modules added as MVP rows; v1.2 deferred Obstacle Gauntlet row pruned; progress tracker updated. | XS | S6 retro tail | **Done** | Index reflects 16 MVP systems all approved; no orphaned deferred rows for shipped systems |
| S7-09 | **Sprint 6 retro tail** — fix dev HUD label (`src/app.tsx:665`); add renderer GDD cross-ref to Winner Camera rotation exception (Camera GDD §3 R23). Closes S6 retro AI #4 + #5. | XS | S6 retro AI #4, #5 | **Done** | Dev HUD label sprint-agnostic; renderer GDD §forbidden-patterns or invariants section names the Winner Camera exception with a link |

### Nice to Have

| ID | Task | Est. | Source | Status | Acceptance Criteria |
|----|------|------|--------|--------|---------------------|
| S7-10 | **Bundle delta check at close** — append Sprint 7 trend row to `docs/performance/bundle-baseline.md`. | XS | S7-04 done | **Done** | Row appended; if delta > +30 kB gzip a one-line rationale included; pass/fail vs the 200 kB defensibility threshold called out |
| S7-11 | **Maze + Gauntlet narrative integration in systems-index** — match the structure of the other 14 systems' narrative entries in §Dependency Map. | XS | S7-08 | **Done** | Both events have full narrative entries in §Dependency Map under the Gameplay layer |

---

## Carryover from Sprint 6

None active. Sprint 6 closed all 8 planned tasks. The 7 retro action
items folded into S7-01 (AI #7), S7-09 (AI #4, #5), and the live-status
discipline (AI #1, #2, #3) is exercised throughout this sprint.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Full-spec gauntlet (3 traps + 3 culls) blows the sprint window | High | Medium | Spike-first per established pattern. Land each trap type as a separate commit; if a trap slips, drop that stage to v1.x as a documented cut rather than ship a half-built mechanic. |
| Hammer-cycle determinism breaks (browser ≠ harness) | Medium | High | Hammers are visual-only — sim trap collision derives from `tick * cycleTickRate` math, NOT from rendered hammer angle. Same Sim ↔ Renderer authority pattern as poses. |
| Maze grace-window introduces a tie semantics bug | Medium | Medium | Ties resolve by id-ascending (existing pattern from sprint-race). Explicit test: "two robots enter finish on adjacent ticks within grace window — winner is lower id." |
| Maze recovery bonus causes path divergence | Low | Low | Not a bug — adds realism. Tests verify finish order is deterministic per seed; no test asserts "shortest-path order = finish order." |
| Bundle creeps past 200 kB defensibility threshold | Medium | Low | 26.4 kB headroom from S6 close. Gauntlet visuals are simple primitives; expect +5–15 kB. If approached, code-split per-arena visuals. |
| Branching refactor (S7-03) breaks existing maze or sprint paths | Medium | High | Land S7-03 as its own commit BEFORE S7-04 starts so any regressions are isolated. Run full test suite + manual smoke test on both existing routes before opening the S7-04 branch. |
| Stage-cull bookkeeping has off-by-one edge cases (burned us in S5-05) | Medium | Medium | Mirror sprint-race tie-break + cull-count assertions exactly. Test `eliminations.length + finishes.length === 85` at each stage transition. |
| `tools/sim/run-event.ts` regression after dispatch refactor | Low | Low | Harness is integration-tested. Run `tools/sim/run-event.test.ts` before merging S7-03. |

---

## Dependencies on External Factors

- **None.** Sprint 7 is local: TypeScript + Vitest + Vite + Three.js +
  Preact. No new APIs, no Render deploy work, no Supabase. Render
  deploy from Sprint 4 still serves the build; final smoke at sprint
  close is a manual deploy.

---

## Build Order

```
S7-01 (Maze GDD)  ──►  S7-02 (Maze levers)
                       (parallel to gauntlet track)

S7-03 (refactor)  ──►  S7-04 (Gauntlet sim) ─┬─►  S7-06 (GDD)  ─►  S7-07 (wiring)
                                              ├─►  S7-05 (visuals) ─┘
                                              └─►  arena-03.json (alongside S7-04)

S7-08, S7-09, S7-10, S7-11  ─ independent, any time
```

Critical path: **S7-03 → S7-04 → S7-07**. Maze track (S7-01 → S7-02)
runs in parallel; if it slips, gauntlet still ships.

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All Must-Have GDDs (S7-01, S7-06) written and approved
- [ ] All three routes (`#peek`, `#peek-maze`, `#peek-gauntlet`) play
      end-to-end with winner reveal in a browser
- [ ] Determinism preserved: same seed → same finish order in browser
      AND headless harness for all three event types
- [ ] No `Math.random` use anywhere in `src/` (existing invariant)
- [ ] Bundle ≤ 200 kB gzip
- [ ] Sprint 6 retro AIs #4, #5, #7 all closed
- [ ] Systems index reflects 16 MVP systems (3 events + camera + winner +
      shell + 9 foundation/core)
- [ ] Sprint retrospective written at close (`sprint-07-retrospective.md`)

---

## Sprint Exit Criteria

**Good**: Maze levers ship + Gauntlet sim with 1–2 trap types + 1–2
stage culls. Third trap (likely the bridge) slips to Sprint 8 with a
documented cut. The mechanical spine of all three events exists; one
is incomplete.

**Great**: Full-spec Gauntlet ships with all three trap types + three
staged culls. Maze levers all three land. The "three-event variety
claim" is delivered. Sprint 8 opens on Sound or NFT/wallet.

**Concerning**: Determinism diverges in the Gauntlet (browser vs.
harness disagree on outcome) OR staged-cull bookkeeping has
robot-leakage (sum of eliminations + finishes ≠ 85). Either is a hard
debug-before-feature stop for Sprint 8.

---

## Process Notes

- **Spike-first remains the default** for non-trivial systems. S7-04
  (Gauntlet sim) is the canonical case for this sprint: build the
  smallest working thing, write the tests, reverse-document the GDD.
- **Update this plan's Status column in the same commit as the work**
  per `coordination-rules.md` rule #6. The Sprint 6 plan drifted
  badly because this discipline didn't hold; Sprint 7 holds it.
- **Reconcile against `git log` before starting** any task —
  `git log --oneline --grep="^S7-"` catches the "already done in a
  prior session" case.
- **Log scope changes inline.** When a task is reshaped mid-sprint
  (e.g., a trap slips), update the task description in this plan
  on the same day, not at close-out.
