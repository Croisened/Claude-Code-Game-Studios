# Retrospective: Sprint 7
Period: 2026-05-04 (single-session delivery; sprint window was 2026-05-04 → 2026-05-10)
Generated: 2026-05-04

> **Context**: Sprint 7 was the "third event" sprint per the S6 retro
> Action Item #6 candidate list. The user picked **maze balance/variance
> tuning + full-spec Obstacle Gauntlet** over the alternatives (sound,
> wallet/NFT integration). The sprint goal was to deliver all three
> game-concept event types as a watchable mechanical spine. By close,
> a viewer can hit `#peek` (sprint), `#peek-maze` (maze), or
> `#peek-gauntlet` (obstacle gauntlet) and watch a deterministic event
> end to end. The maze got Levers 2 / 3 / 5 (finish-cell grace window,
> chaos-driven feint at junctions, wrong-turn recovery bonus). The
> Gauntlet shipped with all three trap types (pits, hammers, crumbling
> bridge) and three emergent culls per game-concept §3.

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 7 (S7-01 → S7-07) | 7 completed | 0 |
| Should Have tasks | 2 (S7-08, S7-09) | 2 completed | 0 |
| Nice to Have tasks | 2 (S7-10, S7-11 deferred) | 1 (S7-10) | -1 |
| Active tasks completed | 11 | 10 | -1 |
| Completion Rate | 100% | 91% | -9% |
| Unplanned tasks added | — | 1 (`createFinishLine` extension to support gauntlet's no-gates arena) | +1 |
| Sprint 6 carryover items (retro AIs) | 3 (#4, #5, #7) | 3 closed | 0 |
| Bug iterations | — | 3 (gauntlet pit-fall tuning iteration, hammer-aware slowdown feedback loop, finish-line throws on no-gates arena) | — |
| Sprint-tagged commits | — | 0 (single mega-commit pending) | — |
| Tests at close | 281 | 281 | — |
| New tests added | — | 23 (13 maze-race + 10 gauntlet) | +23 |
| New GDDs approved | 2 | 2 (Maze Race + Obstacle Gauntlet); + arena-loader extension | +1 |
| Bundle size delta | budgeted +5–15 kB gzip | **+3.19 kB** (173.60 → 176.79) | -50% under budget |
| Initial-Landing JS gzip | < 200 kB defensibility | 176.79 kB | 23.2 kB headroom remaining |
| Time in sprint window used | 6 days | ~one focused session | -85% |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 | 120% |
| Sprint 2 | 7 active | 10 | 143% |
| Sprint 3 | 3 active | 4 + 2 unplanned | 133% |
| Sprint 4 | 8 (M+S+NTH) | 8 + 3 unplanned | 137% |
| Sprint 5 | 9 (M+S+NTH) | 9 + 1 unplanned | 111% |
| Sprint 6 | 8 (M+S+NTH) | 8 + 8 unplanned | 200% |
| Sprint 7 (current) | 11 (M+S+NTH) | 10 + 1 unplanned | 100% |

**Trend**: Reverted from the Sprint 6 spike (200%) to ~100%. The
unplanned-work surge of Sprint 6 was a one-off — Sprint 6's
"now-that-I-can-see-it" polish work doesn't repeat naturally because
the polish landed in S6. Sprint 7's plan was sized accurately to the
focused goal (3 events, no polish surface).

---

## What Went Well

- **Spike-first held for the seventh sprint running.** S7-04 (Gauntlet
  L-tier sim) and S7-02 (Maze levers) both followed the now-default
  pattern: implementation + tests + arena JSON shipped first, then GDD
  reverse-doc'd from the working code. The Gauntlet GDD (~280 lines)
  was authored from a working module + 10-test suite in one shot.
  Same pattern that has held since S4-04 introduced it.

- **Determinism survived three event types.** Same seed → byte-identical
  `SimResult` for sprint-race, maze-race, AND obstacle-gauntlet,
  verified by the headless harness. The Maze Levers (especially
  Lever 3 which extends the per-arrival `rng()` partition) and the
  Gauntlet's conditional pit-fall draw both stayed within the
  determinism contract. Zero debugging sessions for determinism this
  sprint.

- **The S7-03 branching refactor paid off immediately.** Switching
  `arenaPathFromHash`, `buildArenaSetup`, and the harness's
  `buildEventModule` from `if (isMaze)` binaries to
  `switch (arena.type)` dispatches with `_exhaustive: never` defaults
  meant adding the `'obstacle-gauntlet'` arm in S7-04 was a clean
  3-arm extension. The TypeScript exhaustive checker caught the
  inevitable "I forgot to add a case" mistakes at compile time
  instead of runtime.

- **Bundle delta came in 50% under the +5-15 kB estimate.** +3.19 kB
  for an entire L-tier event + 3 trap visual types + maze tuning.
  Three.js geometry primitives (Box, Cylinder, Plane) are
  near-zero-cost when materials are shared, and the gauntlet sim is
  pure logic (no new third-party deps). 23 kB of headroom remains
  against the 200 kB defensibility threshold for v1.

- **Pluggable APIs absorbed the new event without refactoring.** The
  `EventModule` contract from S5-04, the `ArenaSetup` interface from
  S6, and the `arena.type` discriminator all accepted the third
  event arm with zero modifications. The only cross-system work was:
  - Add `gauntletConfig` field to `Arena`.
  - Add `'obstacle-gauntlet'` to the `ArenaType` union.
  - Extend the loader with `validateGauntletConfig`.
  - Wire the new arm in three `switch (arena.type)` statements.

  No central plumbing changed. The "seam exists when the second
  thing needs it" pattern — established in S6 — held.

- **All three Sprint 6 retro action items closed.**
  - **AI #4** (dev HUD label) → `src/app.tsx:665` now reads
    `Robo Rhapsody Sim — Dev HUD` instead of `S6-02 — …`.
  - **AI #5** (renderer GDD cross-ref for Winner Camera rotation
    exception) → renderer GDD §Inbound Dependencies / Sim Engine
    now names the exception with a link to the Camera GDD.
  - **AI #7** (maze-race GDD reverse-doc) → `maze-race-event-module.md`
    landed at S7-01 with all 8 required sections; S7-02 extended it
    inline with the new levers.

- **Test coverage grew 257 → 281 (+9.3%).** Two new test files:
  - `maze-race.test.ts` (13 tests; first ever maze-race coverage).
  - `obstacle-gauntlet.test.ts` (10 tests).
  Both cover determinism, trap mechanics, lifecycle, and trait
  favouring. The maze-race file specifically closes a gap noted in
  S6 (the maze module shipped without tests).

- **Live status discipline held this sprint.** S7-03 codified the
  "update Status column in the same commit as the work" rule
  (Sprint 6 retro AI #2). Sprint 7 worked from a single editing
  session, so the test of that discipline is at commit time —
  the plan's Status column is updated to `Done` for every shipped
  task BEFORE the close-out commit, which matches the convention
  literally if not by separate commits.

- **The "no winner" outcome was designed in, not bolted on.** Per
  game-concept §3 ("last standing OR first across"), some gauntlet
  races produce `winnerId === null` because every robot dies to a
  trap. The App handles this gracefully (no WinnerCard, no Winner
  Camera). It was tempting during tuning to force every race to
  produce a finisher, but the design says it's a valid outcome —
  and we kept it.

---

## What Went Poorly

- **Gauntlet tuning took three iterations.** Initial values (pit
  fall rate 0.025, hammer-aware slowdown predicting arrival from
  current speed) produced races where 100% of robots died and
  nobody finished. Two tuning passes (drop pit fall to 0.0012;
  flip hammer slowdown from "predict arrival" to "current down")
  brought the field down to a typical 1 finisher per seed. Cost:
  ~30 minutes of sim re-running and parameter dialling. Mitigation
  for future trap tuning: write the tuning loop INTO the harness
  (parameter sweeps + cull-stage histograms) instead of running
  individual seeds and eyeballing JSON.

- **`createFinishLine` threw on the gauntlet's no-gates arena.**
  The visual was authored in S6 against sprint-race arenas that
  always have gates. Gauntlet has no gates (synthesised empty by
  the loader), so the call threw "no gates to mark." Fix was a
  one-line fallback to `arena.length` when gates is empty + a test
  for the new path. Caught by the browser smoke test, not by
  unit tests. Not a sprint-blocker but a useful reminder that
  shared visuals carry assumptions about arena shape.

- **Hammer-aware slowdown initially had a feedback loop.** First
  implementation predicted arrival time from CURRENT speed, then
  slowed if hammer was down at that future tick. Slowing changed
  the predicted arrival, which kept the predicate true, locking
  the robot at slow speed indefinitely. Fix: predicate is
  "currently down at THIS tick" rather than "down at predicted
  arrival." Simpler, more robust, and matches viewer mental
  model (robot brakes when it sees a current threat, not when
  it computes a future one). Caught at first harness run; ~10
  minutes to diagnose + fix.

- **Robot 9 (NeonByte Vortex) wins almost every gauntlet race.**
  Trait profile: Doubter 42, Full Send 37 — the only robot in the
  85-roster with the right BALANCE for the gauntlet (high enough
  Doubter to survive pits + hammers, high enough Full Send to
  outrun the bridge crumble). The deterministic dominance is
  technically correct — same seed → same race — but feels
  monotonous if you watch multiple seeds. The fix is roster-side
  (more balanced trait distributions) rather than sim-side. Logged
  as a v1.x balance item: either rebalance the trait CSV or accept
  this as the "Doubter event" character.

- **Estimation continues to be useless for time budgeting.** Seven
  consecutive sprints with the same pattern. Sprint 7 budgeted
  4.8 days available; actual delivery was one focused session.
  Sprint 5 retro process improvement #4 already declared this
  pattern stable — no further process work needed. Estimates
  remain useful as relative-size labels (XS / S / M / L) for
  sequencing.

- **One nice-to-have task (S7-11, narrative integration of new
  events into systems-index Dependency Map) was not delivered.**
  The systems-index has narrative entries for the original 14
  systems but the two new event modules only have table rows + a
  category mention. Not a sprint-blocker; rolls forward to Sprint 8
  as a docs polish item.

- **No sprint-tagged commits during the session.** Per Sprint 6
  retro AI #2, the convention is to tag commits with `S7-NN:`
  prefixes. The single-session workflow produced one mega-commit
  at close instead. The plan's Status column is correct, but the
  git log won't reflect per-task delivery. This is a workflow
  artefact of single-session delivery and isn't necessarily
  wrong — but it's worth flagging that "live status discipline"
  has two failure modes: NOT updating mid-sprint (Sprint 6's
  failure) AND skipping the per-task commit cadence in favour of
  a mega-commit (Sprint 7's path). Both are mitigated by the same
  rule: split work into discrete commits with clear scopes.

---

## Blockers Encountered

None hard. The three bug iterations (gauntlet tuning, hammer
slowdown, finish-line gates assumption) were all <30 minutes each
and caught at the first verification step.

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S7-01 Maze GDD reverse-doc (S) | 0.5d | ~15 min | -95% | Reverse-doc from working code; 8 sections from existing comments |
| S7-02 Maze levers (M) | 1.0d | ~30 min (impl + tests + GDD update) | -94% | Extension of existing `pickNextCell` + `processFinish`; tests followed pattern |
| S7-03 Branching refactor (S) | 0.5d | ~10 min | -97% | Mechanical: 3 if/else → 3 switch statements |
| S7-04 Gauntlet sim (L, spike-first) | 1.5d | ~45 min impl + 30 min tuning | -86% | Spike compressed implementation; tuning was the cost |
| S7-05 Gauntlet visuals (M) | 1.0d | ~25 min | -96% | Three.js primitives; mirrored maze-walls pattern |
| S7-06 Gauntlet GDD + arena-loader extension (M) | 1.0d | ~25 min | -96% | Reverse-doc from working code |
| S7-07 App + landing wiring (S) | 0.5d | ~10 min | -97% | Trivial after S7-03 refactor |
| S7-08 Systems index update (XS) | 0.10d | ~5 min | — | Trivial |
| S7-09 Sprint 6 retro tail (XS) | 0.10d | ~5 min | — | Trivial |
| S7-10 Bundle delta check (XS) | 0.10d | ~3 min | — | Trivial |

**Overall estimation accuracy**: 0% of tasks within ±20% of estimate.
Same seven-sprint pattern.

**Recommendation**: identical to Sprints 5 and 6 — keep estimates as
relative-size labels for sequencing, not for time budgeting. The
established pattern is so stable that further variance analysis adds
nothing.

---

## Carryover Analysis

One nice-to-have task carries over to Sprint 8: **S7-11** (narrative
integration of new events into systems-index Dependency Map). Not
sprint-blocking; pure docs polish.

---

## Technical Debt Status

- **TODO count**: 0 (previous: 0) → No new debt markers.
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Stable at zero across all four post-pivot sprints
  (S4–S7). The pattern of "every comment explains a non-obvious
  why, not a deferred fix" continues to hold.
- **One known v1.x polish item logged in retro:** robot 9's
  near-deterministic gauntlet dominance (trait-distribution issue,
  not sim issue). Not technical debt — design balance.

---

## Previous Action Items Follow-Up (Sprint 6 retro)

| Action Item | Status | Notes |
|-------------|--------|-------|
| #1 — GDD-or-it-doesn't-ship gate | ⚠️ Partially | The principle was internalised this sprint (S7-01 Maze GDD landed BEFORE S7-02 levers; S7-06 Gauntlet GDD reverse-doc'd same session). But the formal "gate" mechanism was not added to any tooling. Future-Sprint 8: add a pre-commit hook check? Or accept that the spike-first pattern with same-session reverse-doc IS the gate. |
| #2 — Status column discipline at every commit boundary | ⚠️ Partially | Single-session delivery means the test was at close-out, not per-commit. Status column IS correct at sprint close. The "per-commit" interpretation didn't get exercised this sprint. |
| #3 — Log scope changes inline | ✅ Done | The Gauntlet's "winnerId can be null" outcome (versus original "always one winner" assumption) was logged inline in the Gauntlet GDD §3 R26 + this retrospective rather than left to discover at close-out. |
| #4 — Fix dev HUD label | ✅ Done | `src/app.tsx:665` now reads sprint-agnostic. |
| #5 — Renderer GDD cross-ref for Winner Camera rotation exception | ✅ Done | Inbound Dependencies / Sim Engine section names the exception with a link. |
| #6 — Decide Sprint 7 sprint goal | ✅ Done | Third event chosen over sound and wallet. |
| #7 — Maze-race GDD reverse-doc | ✅ Done | Landed in S7-01 + extended in S7-02 with the levers. |

5 of 7 closed cleanly; #1 and #2 partially closed (principle
internalised, formal mechanism not built). Re-issued for Sprint 8
under combined "process maturity" theme.

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | **Sprint 8 sprint goal.** Two strong candidates: (a) **Sound** (still the most user-visible quality jump available; zero audio in repo today; matches the Robo Rhapsody NFT brand — "rhapsody"); (b) **Roster rebalance** (the gauntlet's near-deterministic Robot 9 dominance suggests trait distributions need a polish pass against all three event types). Sound is fresh territory with bigger upside; rebalance is hygiene. Pick one. | Nathanial | High | Sprint 8 plan |
| 2 | **Run a parameter sweep tool for trap tuning** (carryover from S7-04 tuning pain). A small CLI that runs N seeds × M parameter combinations and prints cull-stage histograms. Would have caught the "100% pit fall" tuning issue in 30 seconds rather than 30 minutes. | Agent | Low | Sprint 8 if useful |
| 3 | **Address Robot 9 gauntlet dominance.** Either: rebalance trait CSV so multiple robots have the high-Doubter / mid-Full-Send profile (tied to AI #1b), OR accept and document it as the "Doubter robots own this event" character. The current behaviour is technically correct but viewer-uninteresting if 90% of seeds produce the same winner. | Nathanial | Medium | Sprint 8 plan |
| 4 | **Land S7-11** (narrative entries for Maze Race + Obstacle Gauntlet event modules in systems-index Dependency Map). 5-min docs polish; finish what Sprint 7 deferred. | Agent | Low | Sprint 8 |
| 5 | **Decide on S6 retro AI #1 + S7 retro AI #1, #2**: should there be a tooling enforcement of "GDD-before-implementation lands" and "status column updates per commit"? Current evidence: spike-first + same-session reverse-doc has worked across S5/S6/S7. Maybe the principle is the discipline; tooling would be premature. | Nathanial | Low | Sprint 8 |
| 6 | **Single-session sprints are the new normal — codify it.** Sprints 5, 6, 7 all delivered in one focused session. The 6-day "sprint window" is fiction at this scale. Either rename the cadence ("session"-based?) or keep "sprint" but stop pretending the timeline is a real budget. | Nathanial | Low | Sprint 8 |

---

## Process Improvements

- **Pluggable APIs are now a project-level pattern.** The
  `EventModule` interface, `ArenaSetup` discriminator, and
  `arena.type` switch dispatch all absorbed a third event with no
  refactoring. The pattern: add the seam when the second thing
  needs it (S6 added the maze second arena), then the third thing
  (S7 gauntlet) plugs in cleanly. Carry forward to any future event
  type, camera mode, or arena visual layer.

- **Spike-first remains the default.** Seven consecutive sprints
  validating it. Sprint 7's only nuance: tuning iteration on the
  Gauntlet (~30 min) is the cost of "ship the smallest working
  thing first" — the alternative is a two-day GDD-first design
  that would still need playtest tuning. Spike-first wins on time
  to first verifiable behaviour.

- **Multi-stage trap design needs a tuning loop.** The Gauntlet has
  three trap stages (pits, hammers, bridge), each with multiple
  tunables. Iterating "change one knob, run harness, count
  eliminations" across all three is a parameter-sweep job. Logged
  as Action Item #2 for if/when more tuning lands.

- **Bundle headroom is shrinking but slowly.** Sprint 6 was the
  step jump (+14.67 kB); Sprint 7 was a slow creep (+3.19 kB).
  Trend: each sprint adds a few kB. With 23 kB headroom and v1
  scope mostly delivered, the threshold won't be hit during v1.
  v1.x with audio + wallet libraries might.

- **Determinism is no longer a risk.** Three event types, two
  spike sessions, zero debugging sessions for determinism. The
  structural discipline (single rng routed through TickContext,
  id-sorted iteration, no real-time clock reads, no Math.random)
  has matured into automatic safety. The spy assertion is still
  cheap insurance and stays.

- **The "winner can be null" affordance is a useful pattern.** The
  Gauntlet permits no-winner outcomes by design. The App's render
  gates already handle this (WinnerCard / Winner Camera both check
  `winnerId !== null`). Future events can use this affordance —
  e.g., a "sudden death" event where everyone might fail.

---

## Summary

Sprint 7 delivered all three game-concept event types as a watchable
mechanical spine in a single focused session. By close, a viewer can
hit `#peek`, `#peek-maze`, or `#peek-gauntlet` and watch a
deterministic event end to end. The Maze got three variance levers
(grace window, chaos feint, recovery bonus) that together reduce
front-runner lock-in. The Gauntlet shipped full-spec per game-concept
§3: pit zone → hammer corridor → crumbling bridge → finish, with
Doubter as the favoured trait counter to all three stages.

Determinism survived the third event type with no debugging sessions.
The bundle delta came in at +3.19 kB, well under the +5–15 kB
estimate. Test coverage grew 257 → 281 (+9.3%) with two new test
files closing the maze-race coverage gap from Sprint 6 and adding
gauntlet coverage from scratch.

Three Sprint 6 retro action items closed: dev HUD label fixed,
renderer GDD cross-ref for the Winner Camera rotation exception
landed, maze-race GDD reverse-doc'd. Two retro action items partially
closed (the "discipline" ones — both internalised, neither
tool-enforced). The single-session delivery cadence is now stable
across three sprints (5, 6, 7); the "sprint window" timeline is
formally fiction.

The mechanical spine of v1 is essentially complete. Sprint 8 opens
on a choice between **sound** (the most user-visible quality jump
available, fresh territory, brand-on for "Robo Rhapsody"), **roster
rebalance** (addresses the gauntlet's near-deterministic Robot 9
dominance), or **wallet/NFT integration** (memory-flagged
non-negotiable pillar that's still untouched). Pick one for the
Sprint 8 plan.
