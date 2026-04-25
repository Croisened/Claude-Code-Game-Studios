# Retrospective: Sprint 5
Period: 2026-04-24 (two-session delivery; sprint window was 2026-04-24 → 2026-04-30)
Generated: 2026-04-24

> **Context**: Sprint 5 turned the project from rendering to simulation. The
> goal was a headless, deterministic Sprint Race event running end-to-end in
> Node, producing an event timeline JSON. No rendering of actual sim state
> yet — the renderer integration arrives in Sprint 6. Foundation from Sprint 4
> (Config, PRNG, Build/Deploy, Renderer, Switcher) carried in clean, no
> carryover.

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 5 (S5-01 → S5-05) | 5 completed | 0 |
| Should Have tasks | 1 (S5-06) | 1 completed | 0 |
| Nice to Have tasks | 3 (S5-07, S5-08, S5-09) | 3 completed | 0 |
| Active tasks completed | 9 | 9 | 0 |
| Completion Rate | 100% | 100% | — |
| Unplanned tasks added | — | 1 (code-review hygiene drive-by — `f71fa50`) | +1 |
| Sprint 4 carryover items | 0 | 0 | 0 |
| Bug iterations | — | 0 | — |
| Commits | — | 13 (10 sprint-tagged + 1 plan + 1 code-review + 1 retrospective entry) | — |
| New tests added | — | 107 (trait-to-stat 15, roster 16, arena 37, engine 14, sprint-race 11, run-event 14) | +107 |
| Tests at close | 178 | 178 | 0 |
| New GDDs approved | 5 | 5 | 0 |
| TODOs at close | 0 | 0 | -1 vs S4 close (S5-09 cleanup) |
| Bundle size delta | — | +0.01 kB gzip (158.92 → 158.93 kB) — noise | — |
| Time in sprint window used | 5 days | ~3 hours across two sessions on 2026-04-24 | -97% |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 (incl. 2 NTH) | 120% |
| Sprint 2 | 7 active | 10 | 143% |
| Sprint 3 | 3 active | 4 + 2 unplanned | 133% |
| Sprint 4 | 8 (M+S+NTH) | 8 + 3 unplanned | 137% |
| Sprint 5 (current) | 9 (M+S+NTH) | 9 + 1 unplanned | 111% |

**Trend**: Stable. Sprint 5 hit every Must, Should, and Nice-to-Have item with
one drive-by code-review hygiene commit. The marginally lower rate vs. prior
sprints reflects fewer unplanned tasks landed, not slower output — the planned
work was sized to fully cover the sprint goal so there was less room for ad-hoc
expansion.

---

## What Went Well

- **Spike-first matured into a repeatable pattern.** S4-04 established the
  approach (build the proven thing first, write the GDD reverse-documented
  from the working code). S5-04 (L-tier Sim Engine Core) and S5-05 (M-tier
  Sprint Race Event Module) repeated it exactly: implementation + tests
  shipped first, GDD authored from the concrete shape, all in one commit.
  Both came up green on the first test run. The Sprint 5 risk register
  explicitly endorsed this option (§103); it is now the default for any
  task with non-obvious architecture.

- **Determinism contract held from day one.** Every sim file shipped with
  byte-identical-output assertions for same-seed runs and `Math.random` spy
  guards. Zero debugging sessions. The single-RNG-routed-through-`TickContext`
  + id-sorted iteration discipline made determinism a structural property
  rather than something to chase. The sprint plan flagged "Sim determinism
  breaks subtly" as the project-level highest-impact risk (§100); the
  mitigation worked exactly as designed.

- **Three.js-agnostic sim, validated.** The headless harness
  (`tools/sim/run-event.ts`) loads `public/traits.json` and an arena JSON,
  runs a full sprint race, and emits a deterministic 4.57 MB JSON in
  ~34 ms of sim time, ~470 ms wall-clock with `tsx` startup. It runs in
  Node with no DOM, no WebGL, no jsdom. Sprint 6 starts with a real
  artifact to consume.

- **All five GDDs landed approved.** Trait→Stat (S, S5-01), Robot Roster
  Loader (S, S5-02), Arena Loader (M, S5-03), Sim Engine Core (L, S5-04),
  Sprint Race Event Module (M, S5-05). Every one carries the eight required
  sections; the L-tier engine doc spans 220+ lines with R1–R20 rules and
  16 acceptance criteria. The systems index moved 5 entries from
  Not Started → Approved.

- **Cull arithmetic worked first try.** Arena-01's 85 → 28 → 10 → 1
  schedule is asserted by name in `sprint-race.test.ts`: 57 `gate_a_closed`
  + 18 `gate_b_closed` + 9 `race_over` + 1 finish = 85 robots fully
  accounted for. The id-tiebreak rule for same-tick gate crossings handles
  the mass-cull case cleanly. No off-by-one bugs, no edge-case fixes.

- **All four Sprint 4 retro action items closed.**
  AI #1 (commit-signal rule) → S5-08 codified the TL;DR rule.
  AI #2 (bundle baseline) → S5-07 ran `vite build` and recorded sprint
  delta (+0.01 kB, noise).
  AI #3 (stop tracking unplanned tasks in `sprint-NN.md`) → sprint-05 plan
  documented the convention change; pattern held this sprint (one drive-by
  not tracked in the plan, captured here only).
  AI #4 (renderer GDD §7 cleanup) → S5-09 trimmed the stale
  cross-reference fragment. No outstanding items roll over.

- **Bundle is effectively unchanged.** All sim code lives under `src/sim/`
  and `tools/sim/`, neither of which is reachable from the Landing entry.
  158.92 → 158.93 kB gzip is rounding noise. Sprint 6's renderer wire-up
  will be the first commit to materially affect the Landing payload again.

- **Test suite grew from 70 → 178 (+154%) in one sprint.** Every new system
  shipped with thorough unit coverage including determinism, edge cases,
  output shape pinning, and (for the harness) a CLI integration test that
  spawns `tsx` as a child process and asserts byte-identical stdout across
  two invocations.

- **Auto mode handled XS items well.** When the user activated auto mode
  for the closing XS items (S5-07/08/09), the agent moved through them
  with reasonable defaults and no prompts — exactly the intended behavior.
  The earlier critical-path tasks (S5-04..06) all paused for explicit
  approval before each commit; the auto-mode acceleration only applied to
  trivial follow-ups. No misfire in the commit-signal rule that S4 retro
  AI #1 had to address.

---

## What Went Poorly

- **S5-07/08/09 were partially redone.** The sprint plan was committed at
  21:13:20 and three "S5-07", "S5-08", "S5-09"-tagged commits landed within
  the next 21 seconds (`6329e4c`, `4c93d29`) — clearly chained automation.
  Those commits did the substantive work for all three NTH items. The
  agent in this session, picking up at S5-04, did not check git log for
  pre-existing S5-07/08/09 commits before re-doing the tasks at sprint
  close. The end-of-sprint commit (`9f56a59`) added genuinely incremental
  improvements (Sprint 5 trend row in the bundle baseline, a TL;DR rule
  line, a final fragment trim from renderer GDD §7) — but the agent's
  perception was that it was doing the tasks for the first time. Cost: ~3
  minutes of redundant work; no functional duplication on disk because each
  edit was additive.

- **The sprint plan's task table was not updated as items completed.** This
  is the deeper version of the previous bullet. S5-07/08/09 were done
  within seconds of the plan being committed but remained listed as Nice
  to Have under the same task IDs. The plan never had a "Done" column.
  Future sprints either need a status column on the task table, or a
  convention that completed tasks are struck through / annotated as the
  work lands.

- **Estimation continues to be useless for time budgeting.** Same pattern
  as Sprints 1–4. The plan estimated 5 working days; actual delivery was
  ~3 hours across two sessions. Estimates remain useful for sequencing
  (S5-04 must follow S5-01/02/03) and for size-relative decisions
  (L-tier GDD vs S-tier GDD), but they do not predict wall-clock effort.
  This is now a five-sprint stable pattern; the convention is
  established.

- **Auto-mode activation was implicit, not deliberate.** The user enabled
  auto mode mid-conversation when the agent asked whether to proceed
  with the XS items. The agent could have noted the mode change more
  explicitly so it was clear which boundary had moved. No harm done this
  sprint; flag for next sprint as a small etiquette improvement.

- **One incidental commit slipped in unflagged.** `f71fa50` ("Code-review
  hygiene: shared anim types, @/ imports, unmounted-getInstance throws")
  landed at 21:13:55, between the plan creation and the start of S5-01.
  This was useful work but is not tracked in the sprint plan or any of
  the S5-NN commits. Captured here per the new convention.

---

## Blockers Encountered

None. The sprint had no debugging sessions, no test failures requiring
investigation, no design rework. Every implementation passed its tests on
the first or second run. The "S5-07/08/09 done early" issue above is a
process observation, not a blocker.

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S5-01 Trait → Stat (S, GDD + impl) | 0.5d | ~25 min | -91% | Pure function, well-scoped formulas |
| S5-02 Robot Roster Loader (S, GDD + impl) | 0.5d | ~30 min | -90% | Existing CSV→JSON build artifact reused |
| S5-03 Arena Loader + arena-01.json (M, GDD + impl + data) | 1.0d | ~50 min | -90% | Schema authored cleanly first try |
| S5-04 Sim Engine Core (L, spike + GDD) | 1.5d | ~40 min | -94% | Spike-first short-circuited the L-tier GDD complexity |
| S5-05 Sprint Race Event Module (M, spike + GDD) | 1.0d | ~25 min | -94% | Engine contract from S5-04 made the implementation mechanical |
| S5-06 Headless sim harness (S) | 0.25d | ~15 min | -90% | Thin CLI shell over `runSim`; 14 tests including spawned-tsx integration |
| S5-07 Bundle baseline (XS) | <0.10d | ~3 min | — | Already substantially done in an earlier commit; appended trend row |
| S5-08 Approve=commit codification (XS) | <0.10d | ~3 min | — | Already substantially done; added TL;DR line |
| S5-09 Renderer GDD §7 cleanup (XS) | <0.10d | ~2 min | — | Two-line trim |

**Overall estimation accuracy**: 0% of tasks within ±20% of estimate. Every
M-tier and larger task underran by ~90%. Same five-sprint pattern.

**Analysis**: Spike-first compresses the implementation phase to near-zero
because the GDD doesn't gate code production — it's reverse-documented after
the code works. This is the third sprint in which estimates were exercised
purely as relative-size signals. The "5 working days" budget on the sprint
plan was theoretical from the start; nobody planned around it.

**Recommendation for Sprint 6**: same as Sprint 5 — keep estimates as
relative-size labels (XS / S / M / L) for sequencing and decision-making,
do not use them for time budgeting. The unit of measure remains "tasks per
session," not "hours per task."

---

## Carryover Analysis

No active tasks carried over. Sprint 5 closes with all 9 planned + 1
unplanned tasks complete. No deferred GDDs, no half-finished
implementations.

---

## Technical Debt Status

- **TODO count**: 0 (previous: 1) ↓ — S5-09 removed the renderer GDD §7
  cross-reference fragment.
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Cleaner than Sprint 4 by one. The new sim code shipped with
  zero debt markers — every comment explains a non-obvious "why," not a
  deferred "fix later."

---

## Previous Action Items Follow-Up (Sprint 4 retro)

| Action Item | Status | Notes |
|-------------|--------|-------|
| #1 — Codify "approve = commit" protocol | ✅ Done | S5-08 added the TL;DR rule line. The full Counts/Doesn't-count lists were already in `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` from the same-second sprint-open commit `4c93d29`. |
| #2 — Bundle-size baseline audit | ✅ Done | S5-07 ran the build at sprint close and appended the Sprint 5 trend row (+0.01 kB delta — noise). Initial post-Sneak-Peek baseline was captured in commit `6329e4c` at sprint open. |
| #3 — Stop tracking unplanned mid-sprint tasks in `sprint-NN.md` | ✅ Done | sprint-05.md adopted the convention. One unplanned task this sprint (`f71fa50`); captured in this retro only, not in the plan. |
| #4 — Remove renderer GDD §7 cross-reference TODO note | ✅ Done | S5-09 trimmed the stale "Documented here for cross-reference" fragment; replaced with a clean Markdown link to the Config Module GDD §4. |

Every Sprint 4 action item is closed. No carryover into Sprint 6.

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | When picking up a sprint mid-stream, scan `git log --oneline --grep="^SN-"` first and reconcile against the plan's task table before starting work. Avoids the S5-07/08/09 redo pattern. | Agent | Medium | Sprint 6 open |
| 2 | Either add a "Status" column to the sprint plan task table (Pending / Done / commit hash), or adopt a strikethrough convention as tasks land. The plan should be readable mid-sprint as a live status doc, not just a static intent doc. | Nathanial | Medium | Sprint 6 plan |
| 3 | Decide pose-frame transport for Sprint 6 renderer wire-up: write JSON to `production/session-state/` and have the renderer fetch, OR run `runSim` in-process inside the renderer entry and consume `SimResult` directly. JSON is closer to the v1.x replay-from-server vision; in-process is faster and less I/O. Pick one in the Sprint 6 plan. | Nathanial | High | Before Sprint 6 first task |
| 4 | Document auto-mode etiquette in `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`: when activated mid-session, the agent acknowledges the mode change and lists the kinds of decisions it will now batch through without prompting. Keeps the boundary explicit. | Nathanial + agent | Low | Sprint 6 close |

---

## Process Improvements

- **Spike-first is now the project's default for non-trivial systems.** S4-04
  proposed it; S5-04 and S5-05 confirmed it. The pattern: build the smallest
  thing that exercises every code path, write tests against it, then
  reverse-document the GDD from the working code. The L-tier GDD for the
  Sim Engine was authored in one shot from working code in ~10 minutes;
  attempting it cold would have produced a doc with abstractions that
  didn't survive contact with implementation. Carry forward to Sprint 6
  for the renderer integration.

- **Determinism is a structural property, not a runtime behavior.** Sprint
  5's mitigation strategy worked: single RNG seeded from `opts.seed` at
  the engine boundary, passed through `TickContext`, never re-instantiated;
  id-sorted iteration everywhere; no real-time clock reads. The
  `Math.random` spy assertion is cheap and catches future regressions in
  one line. Replicate this discipline in Sprint 6 wherever the renderer
  consumes sim state.

- **Test fixtures should match the real-asset shape.** Carryover from
  Sprint 4. The 85-robot synthetic roster in `sprint-race.test.ts` mirrors
  the production roster size and distribution; the `arena01()` helper in
  the same file uses the actual `arena-01.json` values. Sprint 6 will need
  pose-frame fixtures of comparable fidelity; budget for that explicitly
  in the sprint plan.

- **Stop trying to make estimates predict time.** Five sprints, five
  identical underrun patterns. The estimation column has been useful for
  ordering, sizing, and dependency decisions; it has never been useful for
  capacity planning. This is the convention going forward; no further
  process work needed on this front.

- **The sprint plan should be a live document, not a static one.** Action
  item #2 above. Sprint 5's plan was committed and immediately had three
  tasks completed in the next 21 seconds without the plan reflecting it.
  A live status indicator (column or strikethrough) prevents picking-up
  agents from re-doing committed work.

---

## Summary

Sprint 5 delivered the entire simulation tier in two short sessions: trait
math, roster + arena loaders, the Three.js-agnostic Sim Engine Core, the
Sprint Race Event Module, and a headless CLI harness that emits
deterministic JSON in under half a second. Every Must, Should, and
Nice-to-Have task shipped. Determinism — the project-level highest-impact
risk — was retired by structural discipline rather than debugging. The
test suite grew 70 → 178 (+154%); the bundle didn't move. Spike-first
graduated from a one-off pattern (S4-04) to the project default. All four
Sprint 4 retro action items closed; no Sprint 5 items roll over.

Sprint 6 starts with a working headless sim consuming hand-authored arena
JSON, ready to wire into the renderer. The first decision (action item #3
above) is whether to plumb pose frames through JSON-on-disk or in-process
— that choice gates the rest of Sprint 6's task ordering.

The single notable miss — the agent re-doing S5-07/08/09 at sprint close
because it didn't reconcile against the plan-open commits — costs nothing
on disk (every edit was additive) but is a pattern worth fixing before it
recurs. Action items #1 and #2 address it.
