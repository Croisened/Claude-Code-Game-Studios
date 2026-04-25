# Retrospective: Sprint 4
Period: 2026-04-24 (single-day delivery; sprint window was 2026-04-24 → 2026-04-30)
Generated: 2026-04-24

> **Context**: Sprint 4 is the first sprint of the post-pivot Robo Rhapsody Sim
> project. Sprints 1–3 built the now-archived endless-runner. The sprint plan
> set the foundation (pivot housekeeping, config, PRNG, build pipeline) and
> de-risked the project's central technical bet (85-instance skinned mesh
> renderer at 60 FPS).

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 5 (S4-00 → S4-04) | 5 completed | 0 |
| Should Have tasks | 1 (S4-05) | 1 completed | 0 |
| Nice to Have tasks | 2 (S4-06, S4-07) | 2 completed | 0 |
| Active tasks completed | 8 | 8 | 0 |
| Completion Rate | 100% | 100% | — |
| Unplanned tasks added | — | 3 (lighting+metallic, camera+cycle demo, Sneak Peek route) | +3 |
| Sprint 3 carryover items | 1 | 1 (smoke-test "new visual system" — S3 retro AI #2) | 0 |
| Bug iterations | — | 1 (SkeletonUtils clone-the-mesh-not-scene bone bug) | — |
| Commits | — | 20 | — |
| New tests added | — | 70 (asset-loader 7, renderer 30, state-switcher 16, plus carry-fwd config 7 + rng 10) | +70 |
| Tests at close | 70 | 70 | 0 |
| TODOs at close | 1 | 1 | 0 (Sprint 3 closed at 2) |
| Time in sprint window used | 5 days | ~3.5 hours single session (17:13–20:49) | -91% |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 (incl. 2 NTH) | 120% |
| Sprint 2 | 7 active | 10 | 143% |
| Sprint 3 | 3 active | 4 + 2 unplanned | 133% |
| Sprint 4 (current) | 8 (M+S+NTH) | 8 + 3 unplanned | 137% |

**Trend**: Stable at the elevated rate established in Sprints 1–3.

The post-pivot reset did not cost velocity. Sprint 4 was the first sprint of an
entirely new codebase (runner archived, fresh `src/` scaffold, new test suite
from zero), and still delivered every planned task plus three unplanned polish
items in a single ~3.5 hour session.

---

## What Went Well

- **Pivot housekeeping landed surgically.** S4-00 archived the runner's
  `src/`, `tests/`, and prototype directories under `archive/endless-runner/`,
  scaffolded fresh Preact + Three.js + TS, and committed a working Hello
  World — all in one task. Zero contamination of the new codebase by runner
  code; runner reference preserved for future inspection.

- **GDD-first discipline held perfectly.** Every system (Config, PRNG, Build/Deploy,
  85-Instance Renderer, Animation State Switcher) was authored, reviewed, and
  approved as a separate commit before its implementation commit. Five GDD-Approved
  commits, five implementation commits — clean separation, full audit trail.

- **The renderer GDD review caught six real issues before implementation.**
  The design-review pass on `85-instance-renderer.md` flagged: `mount()`
  signature/camera contradiction, missing scene exposure for downstream
  consumers, edge-case range mismatch, missing GLB paths in CONFIG, public
  observable for AC #5, test-strategy ambiguity. Fixing these in the GDD before
  coding meant the implementation pass had zero design surprises.

- **Sprint 3 action items both resolved.** The "new visual system" smoke-test
  checklist was the explicit S3 retro AI #2; it shipped in S4-06 with five
  generic categories (direction, opacity, state transitions, per-instance,
  camera). The "Supabase migrations" S3 AI was correctly marked obsolete during
  the pivot — Supabase is out of v1 scope.

- **Browser smoke test caught the SkeletonUtils bone-binding bug.** The unit
  tests passed (54/54) with a mock fixture whose clip targeted `.position`
  directly. The real GLBs use bone-named clip tracks, which exposed that
  `cloneSkinned(sourceMesh)` strips the bone hierarchy. Smoke testing in the
  browser revealed the crash within seconds; the test fixture was strengthened
  to mirror real GLB structure (bone as sibling of mesh, clip targeting bone
  by name) so future bugs of this class fail unit tests too.

- **Test seam pattern paid off.** `createRenderer` accepting injectable
  `webGLRendererFactory`, `loadAssets`, `raf`/`cancelRaf`, `resizeTarget`
  meant 30 renderer tests + 16 switcher tests run cleanly in Node with no DOM,
  no jsdom, no WebGL context. The seam also gates production-only PMREM
  environment-map setup so metallic robots reflect properly.

- **Spike-first paid off again.** The S4-04 SPIKE prototype hit 60.0 FPS / 86
  draw calls / 31.6 MB heap on Day 1, before the GDD was even drafted. This
  measured-and-known-good baseline made the GDD's design choices concrete (no
  fallbacks adopted; all four scope-relief levers documented and shelved for
  v1.1+) and fed exact numbers into Implementation Approach §4 and Acceptance
  Criteria §8.

- **Public Sneak Peek shipped same-sprint.** Hash-based routing replaced the
  build-time DEV/Landing switch, the Landing page got a pill-shape "Sneak Peek →"
  CTA, and peek mode strips the dev HUD in favor of a "ROBOT TRAINING · DAY 1"
  caption + back link. Public visitors can now preview the test scene without
  leaving the marketing surface area.

---

## What Went Poorly

- **One commit shipped before the user was ready.** The lighting + metallic
  changes were committed when the user said "Now we are looking good! Nice
  work!" but the user actually wanted to add more changes before commit. The
  commit landed on origin/main; recovery was a follow-up commit (camera +
  cycle) rather than a force-push rewrite. Cost: ~5 minutes of apology +
  course correction. Root cause: ambiguous phrasing parsed as approval.

- **Mid-sprint unplanned tasks were tracked only verbally.** Three unplanned
  items shipped (lighting+metallic, camera+cycle demo, Sneak Peek) without
  ever being added to `sprint-04.md` as they were taken on. This is the third
  sprint in a row where this gap persists. Sprint 3 retro flagged it as AI #3;
  pattern remains. (Note: the items themselves were the right calls — issue is
  documentation hygiene, not scope.)

- **Initial test fixture for the renderer was too lenient.** The
  `.position`-targeted track passed unit tests for instance assembly but
  failed against real GLBs whose clips target named bones via `SkeletonUtils.clone()`.
  Strengthened during the S4-04 fix; the lesson is "test fixtures should mirror
  real-asset structure," which is now codified in the smoke-test "New Visual
  System" checklist.

- **Bundle size impact of Sneak Peek not measured or budgeted.** Switching
  from build-time DEV/Landing to runtime hash routing means the production
  bundle now includes App + renderer + state-switcher (Three.js, addons,
  RoomEnvironment, animation system) for all Landing visitors. The 17 MB of
  GLBs/textures only loads on `/#peek` click, but the JS bundle size grew. No
  bundle analysis was run; impact is presumed acceptable but unverified.

- **Estimation continues to be useless for capacity planning.** Sprint plan
  estimated 5 working days. Actual delivery was 3.5 hours of a single afternoon.
  This matches Sprints 1–3 exactly. Estimates remain useful for sequencing
  and relative sizing but should not be treated as time budgets.

---

## Blockers Encountered

| Blocker | Duration | Resolution | Prevention |
|---------|----------|------------|------------|
| SkeletonUtils.clone() applied to mesh strips bone hierarchy → AnimationMixer crash on bone lookup | ~10 min | Cloned the scene root instead of the SkinnedMesh. Strengthened test fixture so unit tests would catch the same bug class. | "Test fixtures must mirror real-asset graph structure" — added to coding standards informally; codified in smoke-test "New Visual System" §Per-Instance Correctness. |
| Premature commit of lighting changes ("looking good" misread as approval) | ~5 min | Acknowledged, offered force-push rewrite vs follow-up commit; user chose follow-up. | Treat unqualified "approve" / "commit" / "ready to commit" as the explicit signal; treat feedback ("looking good", "nice work") as feedback, not approval. |

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S4-00 Pivot housekeeping | 0.25d | ~10 min | -92% | Mostly `git mv` + scaffolding |
| S4-01 Config Module (GDD + impl) | 0.25d | ~15 min | -88% | Small surface, clear shape |
| S4-02 Seedable PRNG (GDD + impl) | 0.10d | ~10 min | -79% | mulberry32 is well-known |
| S4-03 Build/Deploy Pipeline | 0.25d | ~15 min | -88% | CSV→JSON transform + Render config |
| S4-04 85-Instance Renderer (spike + GDD + impl + smoke) | 1.0d | ~75 min | -84% | Spike+GDD+impl all in one session; smoke caught bone bug |
| S4-05 Animation State Switcher (GDD + impl + renderer GDD update + spike delete) | 0.5d | ~45 min | -85% | Crisp scope, renderer ownership clear |
| S4-06 Smoke-test rewrite | 0.10d | ~15 min | -69% | Full rewrite for current project |
| S4-07 CLAUDE.md + tech-pref refresh | 0.10d | ~15 min | -69% | Targeted edits |

**Overall estimation accuracy**: 0% of tasks within ±20% of estimate. Every
task underran by 70–95%. Same pattern as Sprints 1–3.

**Analysis**: The estimation pattern is now four sprints stable. Estimates work
for sequencing (which task blocks which) but should not be used for time
budgets. Pair-programming with agents compresses implementation to 10–20% of
the developer-day estimate. The actual time cost is in design decisions (GDD
sessions) and visual tuning (e.g., the lighting + metallic + env-map iteration),
neither of which maps cleanly to effort-day estimates.

**Recommendation for Sprint 5**: continue using estimates for relative sizing
(S vs M vs L) and dependency sequencing, but stop trying to make them sum to
"days." The unit of measure is "tasks per session," not "hours per task."

---

## Carryover Analysis

No active tasks carried over. Sprint 4 closes with all 8 planned + 3 unplanned
tasks complete.

| Item from Sprint 3 retro | Status | Notes |
|--------------------------|--------|-------|
| Run Supabase milestones table migration | **Obsolete** | Supabase dropped from v1 scope during pivot |
| Add "new visual system" to smoke-test checklist | ✅ Done | S4-06 ships the full checklist |
| Track unplanned tasks in sprint doc as added | ⚠️ Recurring miss | Same pattern as S2 → S3; still verbal-only |

---

## Technical Debt Status

- **TODO count**: 1 (previous: 2) ↓
  - Real TODO: cross-reference note in `design/gdd/85-instance-renderer.md` §7
    pointing to `config-module.md`. Already resolved by S4-04 follow-ups commit
    `44061a2`; the note is harmless but could be cleaned up in Sprint 5.
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Cleaner than Sprint 3. Pivot wiped runner-era debt; new code
  shipped without introducing any.

---

## Previous Action Items Follow-Up

| Action Item (from Sprint 3) | Status | Notes |
|-----------------------------|--------|-------|
| Run Supabase milestones table migration | **Obsolete** (pivot) | Supabase out of v1 scope |
| Add "new visual system" to smoke-test checklist | ✅ Done | S4-06 ships |
| Track unplanned tasks in sprint doc immediately | ⚠️ Recurring miss | Third sprint with this gap; pattern is predictable |

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | Clarify the "approve to commit" protocol — only unqualified "approve" / "commit" / "ready to commit" counts as commit signal; feedback like "looking good" is feedback, not approval | Nathanial + agent | High | Immediate (already adjusted; codify in `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` if not already there) |
| 2 | Run a bundle-size audit on the production build (`vite build` + check `dist/assets/*.js` size). Document the post-Sneak-Peek bundle baseline so we have a number to defend if Sprint 5+ adds more code | Nathanial | Medium | Before Sprint 5 close |
| 3 | Stop trying to track unplanned mid-sprint tasks in `sprint-NN.md`. Three sprints, still missed. Accept the pattern: capture unplanned work in the retrospective only. Update `sprint-04.md`'s Carryover/Pattern note to reflect this convention going forward. | Nathanial | Low | Sprint 5 plan |
| 4 | Remove the resolved "Cross-reference TODO" note from `design/gdd/85-instance-renderer.md` §7. The work is done; the note is stale | Nathanial | Low | Sprint 5 (drive-by) |

---

## Process Improvements

- **"Approve" means commit.** "Looking good" / "nice work" / "this is great" are
  positive feedback, not commit signals. The Sprint 4 misfire was a one-instance
  cost; the protocol fix is one-line. Going forward: agent waits for explicit
  unqualified approval before any commit; user can always say "commit" or
  "approve and commit" to be unambiguous.

- **Test fixtures must mirror real-asset structure.** The renderer's bone-binding
  bug was avoidable: a fixture with a named bone as a sibling of the mesh and
  a clip targeting that bone by name would have failed unit tests. This pattern
  is now codified in `docs/smoke-test.md` "New Visual System" §Per-Instance
  Correctness; carry it forward.

- **Smoke test before declaring victory.** Browser smoke test caught the bone
  bug in 5 seconds. Unit tests ran green for 30+ seconds before that. Smoke is
  a different layer of coverage and continues to be worth the 60 seconds it
  costs.

- **Stop trying to fix the "unplanned tasks not tracked in sprint doc" gap.**
  Three sprints, three retros, no improvement. The work always gets done; the
  retro always captures it. The mid-sprint tracking step is process overhead
  the developer doesn't naturally want to do. Accept the pattern and move on.

---

## Summary

Sprint 4 delivered the entire post-pivot foundation in a single afternoon:
pivot housekeeping, config, PRNG, build pipeline, the de-risked 85-instance
renderer, the animation state switcher, lighting/metallic polish, a closer
camera with a cycling animation demo, a public Sneak Peek route, and full
documentation refresh. The project's biggest technical risk (60 FPS / 85
animated robots) was retired on Day 1 with measured headroom. The single
process miss — premature commit on ambiguous approval — cost five minutes
and is fixed by treating "approve" as the explicit signal. Sprint 5 starts
from a clean foundation with no carryover and the central technical bet
already won.
