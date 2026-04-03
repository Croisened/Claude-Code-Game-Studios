# Retrospective: Sprint 3
Period: 2026-04-02 — 2026-04-03
Generated: 2026-04-03

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 2 (S3-01, S3-02) | 2 completed | 0 |
| Should Have tasks | 1 (S3-04) | 1 completed | 0 |
| Nice to Have tasks | 2 (S3-05, S3-06) | 2 completed | 0 |
| Active tasks completed | 4 | 4 | 0 |
| Completion Rate | 100% | 100% | — |
| Scope descoped (pre-sprint) | — | 1 (S3-03 Personal Best Ghost — dropped before sprint start) | — |
| Unplanned tasks added | — | 2 (milestone city alerts during run; alert fires every run not just new unlocks) | +2 |
| Bug fix iterations | — | 3 (trail Z direction reversed; trail Y fixed for jump; alert opacity reversed) | — |
| Commits (sprint) | — | 3 | — |
| New tests added | — | 28 (milestone-system.test.ts) | — |
| Tests at close | 204 | 204 | 0 |
| TODOs at close | 2 | 2 | 0 |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 (incl. 2 NTH) | 120% |
| Sprint 2 | 7 active (4 descoped) | 10 (incl. 3 NTH) | 143% |
| Sprint 3 (current) | 3 active | 4 (incl. 2 NTH) + 2 unplanned | 133% |

**Trend**: Stable at high rate.
The agent pair-programming working mode continues to deliver all planned tasks plus
Nice-to-Haves in a single session. Unplanned work has appeared in every sprint —
this is now a predictable pattern, not a variance.

---

## What Went Well

- **All sprint action items from Sprint 2 retro fully resolved.** Browser smoke test
  checklist shipped (S3-01), persistent state defaults are now named constants, and
  external Supabase dependency was documented in the sprint plan before implementation
  began. 4 for 4.
- **GDD-first discipline held.** The Milestone Badges GDD was written and approved
  before a single line of implementation code was touched. The design captured the
  Supabase persistence decision, lightning VFX spec, edge cases, and SQL migration
  upfront — the implementation had zero design surprises.
- **Design scope decision was fast and clean.** Personal Best Ghost was dropped from
  the sprint before planning was finalised, with no sunk cost. The resulting sprint
  was correctly sized and delivered cleanly.
- **28 new tests covered every GDD acceptance criterion.** Milestone unlock logic,
  localStorage persistence, Supabase fallback, lightning trigger timing, and scene
  integration were all tested before the system was wired into the game. The bug
  found during testing (ascending vs. descending threshold scan) was caught by tests,
  not by manual play.
- **Player-driven design improvements shipped same session.** Two unplanned features
  — city alert messages during the run, and always-on alerts per run — were both
  proposed mid-playtest and shipped immediately. The codebase absorbed them cleanly
  with no rework.

---

## What Went Poorly

- **Three visual iteration rounds needed for the neon trail.** Z direction was
  reversed (trail appeared ahead of robot), trail didn't track Y during jumps, and
  opacity gradient was backwards. All three were caught during live playtesting, not
  before commit. The browser smoke test checklist added this sprint didn't include a
  "new visual system" checklist item.
- **Supabase milestones table was not migrated before the sprint closed.** The SQL
  spec was written in the GDD and flagged in the sprint plan as a pre-implementation
  dependency, but the actual migration was not run. Supabase persistence is silently
  falling back to localStorage for all players. This is non-breaking but is an open
  action item.
- **Unplanned scope pattern persists.** Two out-of-plan features were built and
  shipped this sprint (city alerts, always-on alert behaviour). Both were right calls,
  but neither was tracked in the sprint doc until retrospective time, which is the
  exact pattern flagged in Sprint 2 retro action item #4.

---

## Blockers Encountered

| Blocker | Duration | Resolution | Prevention |
|---------|----------|------------|------------|
| localStorage cached milestones blocked alert testing | ~5 min | User cleared localStorage manually | Always-on alert behaviour (shipped this sprint) eliminates this permanently |
| Supabase milestones table not migrated | Ongoing | localStorage fallback active; game unaffected | Add "run migration" as a checkbox in the sprint Definition of Done |

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S3-01 Pre-sprint housekeeping | 0.1d | ~20 min | −75% | Straightforward constant extraction + file creation |
| S3-06 Milestone Badges GDD | 0.1d | ~45 min | −50% | Collaborative section-by-section flow worked smoothly |
| S3-02 Milestone Badges impl | 0.25d | ~1h | −75% | GDD upfront eliminated all design decisions at implementation time |
| S3-04 Neon Trail | 0.25d | ~30 min (+ 3 tuning rounds) | −60% | Core implementation fast; visual tuning rounds not estimated |

**Overall estimation accuracy**: 0% of tasks within +/- 20% of estimate. All tasks
dramatically underran — consistent with Sprint 1 and 2 patterns.

**Analysis**: Estimates remain useful only for sequencing and relative sizing, not
capacity planning. The recurring pattern is that agent pair-programming compresses
implementation to 10–20% of estimated time. The actual time cost is in design
decisions (GDD sessions) and visual tuning (iteration rounds), neither of which maps
cleanly to effort-day estimates.

---

## Carryover Analysis

No active tasks carried over.

| Descoped Item | Decision | Rationale |
|---------------|----------|-----------|
| S3-03 Personal Best Ghost | Dropped before sprint start | User decided against the feature; clean cut with no sunk cost |

---

## Technical Debt Status

- **TODO count**: 2 (previous: 2) →
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Stable — no new debt introduced, existing 2 TODOs remain intentional
  deferrals (Rapier physics swap, unchanged since Sprint 1).

---

## Previous Action Items Follow-Up

| Action Item (from Sprint 2) | Status | Notes |
|-----------------------------|--------|-------|
| Browser smoke test checklist before rendering commits | ✅ Done | docs/smoke-test.md created in S3-01 |
| External service deps listed in sprint plan | ✅ Done | Supabase milestones table flagged with SQL spec in sprint plan |
| Explicit persistent state defaults in config | ✅ Done | SKIN_ID_DEFAULT, SKIN_ID_MIN, SKIN_ID_MAX exported constants in game-ui.ts |
| Track unplanned tasks in sprint doc as added | ⚠️ Partial | City alerts and always-on behaviour were not tracked mid-sprint; caught at retro |

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | Run Supabase milestones table migration (`CREATE TABLE milestones…` from GDD) | Nathanial | High | Before Sprint 4 start |
| 2 | Add "new visual system" to browser smoke test checklist — include direction, opacity gradient, state transitions | Nathanial | Medium | Sprint 4 start |
| 3 | Track unplanned tasks in sprint doc immediately when they are added — not at retro time | Nathanial | Low | Sprint 4 (ongoing) |

---

## Process Improvements

- **Visual systems need a pre-commit direction/gradient/state checklist.** The three
  neon trail iteration rounds (Z direction, Y tracking, opacity) were all catchable
  with a 60-second "does the visual behave correctly in Running, Jump, Dead states?"
  check. Adding this to the smoke test doc prevents the same class of rework.
- **GDD-first works — protect it.** The milestone system had zero design surprises
  during implementation because the GDD resolved every decision first (Supabase vs.
  localStorage, lightning interval, edge cases). This is the pattern to maintain for
  every new system in Sprint 4+.

---

## Summary

Sprint 3 delivered cleanly: all planned tasks completed, two unplanned features
shipped from player feedback in the same session, and all four Sprint 2 action
items resolved. The neon trail required three visual tuning rounds that would have
been avoidable with a more rigorous pre-commit visual checklist — that's the single
process gap to close in Sprint 4. The Supabase milestones migration remains the
one open infrastructure item before milestone persistence is fully live.
