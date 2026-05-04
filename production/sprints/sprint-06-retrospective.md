# Retrospective: Sprint 6
Period: 2026-04-25 → 2026-05-01 (sprint window); closed 2026-05-04 (3 days post-window)
Generated: 2026-05-04

> **Context**: Sprint 6 wired the deterministic sim from Sprint 5 into the
> Three.js renderer from Sprint 4 and gave a viewer a watchable race in the
> browser. The sprint goal — "A user can watch a deterministic sprint race
> in the browser, end to end" — was met inside the sprint window. Then
> additional work landed unplanned: a second arena (maze), a maze-race
> event module, a third camera mode (over-the-shoulder), a fourth
> (winner-portrait), a cyberpunk landing page, a WinnerCard panel, and a
> Cipher rebalance. The bookkeeping (GDDs, status column, systems index)
> drifted three days past the window before being reconciled in this
> close-out session.

---

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Must Have tasks | 4 (S6-01 → S6-04) | 4 completed | 0 |
| Should Have tasks | 1 (S6-05) | 1 completed (scope reshaped — see below) | 0 |
| Nice to Have tasks | 3 (S6-06 → S6-08) | 3 completed (at close-out) | 0 |
| Active tasks completed | 8 | 8 | 0 |
| Completion Rate | 100% | 100% | — |
| Unplanned tasks added | — | 8+ (arena-02 maze, maze-race module, maze-walls visuals, finish-tree, robot-shoulder camera, winner camera, WinnerCard, Cipher rebalance, Race Again, seeded starts, cyberpunk landing styling) | +8 |
| Sprint 5 carryover items | 0 | 0 | 0 |
| Bug iterations | — | 1 (face-of-motion rotation in `88165a9` — pose.yaw orientation off by π/2 against the GLB's authored forward) | — |
| Sprint-tagged commits | — | 3 (S6-01, S6-02, S6-03 spike) | — |
| Total commits in window | — | 10 | — |
| Tests at close | 178 | **257** | +79 (+44%) |
| Test files | — | 15 | — |
| New GDDs approved (in-window) | 4 (S6-01 + S6-03 + S6-04 + S6-05) | 1 (Sim Driver, S6-01) | -3 |
| New GDDs approved (close-out) | — | 3 (Camera, Winner Presentation, App Shell — reverse-doc) | +3 |
| Bundle size delta | budgeted +30 kB gzip | **+14.67 kB** (158.93 → 173.60 kB) | -50% under budget |
| Initial-Landing JS gzip | < 200 kB defensibility | 173.60 kB | 26.4 kB headroom remaining |

---

## Velocity Trend

| Sprint | Active Tasks Planned | Completed | Rate |
|--------|---------------------|-----------|------|
| Sprint 1 | 10 Must+Should | 12 (incl. 2 NTH) | 120% |
| Sprint 2 | 7 active | 10 | 143% |
| Sprint 3 | 3 active | 4 + 2 unplanned | 133% |
| Sprint 4 | 8 (M+S+NTH) | 8 + 3 unplanned | 137% |
| Sprint 5 | 9 (M+S+NTH) | 9 + 1 unplanned | 111% |
| Sprint 6 (current) | 8 (M+S+NTH) | 8 + 8 unplanned | **200%** |

**Trend**: Sharp upward spike. Sprint 6 is the highest unplanned-work
ratio of the project. The sprint plan correctly scoped the **mechanical
spine** (sim driver → bridge → camera → app shell → winner reveal) but
underestimated the **content/polish surface area** that would naturally
land on top of it once the spine was watchable. Maze arena + maze-race
module + Cipher rebalance + cyberpunk landing styling are all examples
of "now that I can see it, I want to make it better" work that only
becomes legible once the prior layer is real.

---

## What Went Well

- **Spike-first held for the third sprint running.** S6-01 (Sim Driver)
  and S6-03 (Camera spike) followed the now-default pattern: implementation
  + tests in one shot, GDD reverse-documented from the working code. The
  Sim Driver shipped with 29 tests covering AC-1..AC-22 mechanically and
  zero subsequent bugfix commits. The Follow-Leader camera spike accreted
  three more modes (Static, Shoulder, Winner) over the sprint without
  touching the original spike's contract — the pluggable `LeaderResolver`
  + `FollowCameraSettings` API absorbed every new requirement.

- **The bundle delta came in 50% under budget.** S6-08's task description
  warned a > +30 kB delta would need a special rationale. Actual delta:
  +14.67 kB gzip. The Sim Driver, Sim ↔ Renderer Bridge, four camera
  modules, maze-walls + finish-tree visuals, and the WinnerCard all
  together fit in less than half the warning threshold. Three.js remains
  the dominant cost; the new app-side code is small relative to it.
  173.60 kB gzip leaves ~26 kB of headroom against the 200 kB
  defensibility threshold for v1.

- **Determinism survived the renderer integration.** The S5 risk register
  flagged "determinism breaks subtly" as the highest-impact project-level
  risk. The Sim Driver's `getPose` was tested for byte-identical output
  across two drivers fed the same `update(dt)` sequence (AC-20). The
  bridge writes from the same deterministic `SimResult`. The camera reads
  positions and adds no randomness of its own. End to end: same seed,
  same race, in browser AND headless harness. Zero debugging.

- **The Sprint 5 retro AI #3 transport decision was vindicated.**
  In-process pose-frame transport (no JSON-on-disk, no network
  round-trip) means a fresh sim runs on every page-view in ~34 ms.
  No measurable jank; the user experience is "click → race plays."
  The trade-off (browser pays the sim cost) is invisible in practice.
  When v1.1 brings replay-from-server, the JSON path becomes a thin
  adapter, not a redesign — the contract stayed stable the whole sprint.

- **Test suite grew 178 → 257 (+44%).** Driven by the Sim Driver's 29
  tests, the Follow-Leader camera's 12 ACs (385 LOC of test setup with
  `THREE.Object3D` fakes), and unplanned coverage of maze layout
  generation, finish-line geometry, and per-tick sprint-race separation
  forces. Three.js-agnostic discipline — fakes that look like
  `RobotInstance` without an actual WebGL context — kept the suite
  fully Node-runnable.

- **The four-mode camera composition feels right.** Follow-Leader
  with z-tracking (so the leader stays laterally centred during
  separation drift), the over-the-shoulder cam smoothing forward
  through 90° corners (so a maze junction orbits instead of
  teleports), the static maze cam (the maze is the subject; robots
  move within frame), and the Winner Camera with the face-the-camera
  rotation override (winner always presents to the lens regardless of
  finish heading). Each mode has a clear job; no mode tries to do
  more than one thing.

- **Maze arena landing was the sprint's hidden win.** Originally a
  v1.1-deferred system (per the systems index "Deferred Roadmap"
  table), the maze-race event module + arena-02 + maze-walls visuals
  + finish-tree + grove ground colour all landed in `a340919` on top
  of a working sprint-race spine. The sim's `EventModule` interface
  absorbed the new event type without a single refactor — a clean
  validation of the engine's pluggability contract from S5-04.

- **The cyberpunk landing + WinnerCard composition gave the sim a
  *brand*.** Pre-sprint, the Sneak Peek route showed a flat canvas and
  a dev HUD. Post-sprint, the landing page has typography, palette,
  brand glow, and the WinnerCard echoes that vocabulary on race-end.
  The system now reads as a *product*, not a tech demo. Captured in
  Winner Presentation GDD §1.

- **All four planned Must-Have tasks shipped inside the sprint
  window.** S6-01 (`5847bd2`, 04-25), S6-02 (`45f90aa`, 04-25),
  S6-03 spike (`88165a9`, 04-26), S6-04 — App Shell mounting via
  `45f90aa` and accreting through the rest of the sprint. The spine
  was watchable end-to-end well before 05-01.

---

## What Went Poorly

- **Three GDDs went unwritten until close-out.** S6-03 (Camera),
  S6-04 (App Shell), and S6-05 (Winner VFX → Winner Presentation)
  all shipped working code during the sprint window without their
  required GDDs. The sprint Definition of Done explicitly required
  "All Must-Have GDDs (S6-01, S6-03, S6-04) written and approved
  before their implementation commits" — that gate was missed for
  S6-03 and S6-04. The reverse-doc happened today, three days past
  the sprint window, in this close-out session. Captured as Action
  Item #1 below.

- **The sprint plan's Status column drifted.** S5 retro AI #2
  introduced the live-status convention specifically to prevent
  this. S6-03 stayed at "Spike" while three more camera modes
  accreted on top of it; S6-04 stayed at "Pending" while a full
  Preact App Shell shipped; S6-05 stayed at "Pending" while
  WinnerCard + Winner Camera shipped. The plan was a static intent
  doc again, exactly the failure mode S6-07 was meant to codify
  against. The irony: S6-07 itself was also marked "Pending" until
  close-out. Captured as Action Item #2.

- **Original Sprint 6 plan called for cull-stage camera target
  switching that did not ship.** The Camera System acceptance criteria
  in the plan said "tests cover target selection across all four
  race phases" referring to leader-of-pack / contested-pack / top-N
  / winner. None of that landed. The four-mode system that did ship
  (Follow-Leader / Static / Shoulder / Winner) is *different in
  shape*: not phases of a single tracking camera, but four
  user-selectable / event-triggered modes. The shipped architecture
  is arguably better (clearer separation of concerns, no implicit
  state machine) but it is **not what the plan specified**, and the
  plan was never updated to reflect the redirect. Captured in
  Camera System GDD §1 and the Sprint 6 status column.

- **Original Sprint 6 plan called for "Winner VFX" — rim/emissive/
  particles — that did not ship.** What shipped is a presentation
  composition (camera + UI card + face-camera rotation) that
  satisfies the acceptance criterion "winner is unambiguously
  visually distinguished from non-winners" via a different visual
  language than the plan envisioned. The systems index entry was
  renamed at close-out from "Winner VFX" to "Winner Presentation"
  to match. Literal VFX moved to v1.x deferred polish. The decision
  itself is fine — but it should have been logged when made, not
  inferred at close-out three days later. Captured as Action Item
  #3.

- **Hash-routing scheme drifted from spec.** The plan called for
  `#/`, `#/race`, `#/winner` as three separate routes. What shipped
  is `#peek`, `#peek-maze`, `#landing` (dev preview), with the
  winner reveal mounting **in-place** rather than on its own route.
  Same trade-off as the camera change: the shipped architecture is
  arguably simpler (no route transition between race and winner;
  the cut + card mount carries the moment), but it is not what the
  plan said. Captured in App Shell GDD §3 R2 and "Implementation
  Notes."

- **One bug iteration mid-sprint.** `88165a9` ("S6-02 fix + S6-03
  spike: face-of-motion rotation") fixed the bridge's pose.yaw → GLB
  rotation.y conversion, which was off by π/2 because the GLB is
  authored facing +Z while the sim's yaw=0 convention is +X. Caught
  on visual smoke test, fixed in the same commit that landed the
  Camera spike. No production impact (it was caught before any
  unplanned consumer of `rotation.y` shipped) but a reminder that
  the asset/sim convention seam is the kind of place where small
  bugs hide.

- **The dev HUD label still reads `S6-02 — Sim ↔ Renderer Bridge`.**
  Cosmetic; developer-facing only; never visible to viewers (peek
  mode hides the dev HUD). Captured in App Shell GDD §Implementation
  Notes as a one-line follow-up for Sprint 7.

- **Estimation continues to be useless for time budgeting.** Sixth
  consecutive sprint with the same pattern. Plan budgeted 4
  available days and 5 working days; actual delivery spread across
  multiple sessions over ~10 days. The Sprint 5 retro called this
  pattern stable; Sprint 6 confirms it. Per Sprint 5 retro process
  improvement: estimates remain useful only as relative-size labels
  (XS/S/M/L), not as time predictors. No further process work needed.

---

## Blockers Encountered

None. The face-of-motion rotation bug took ~5 minutes to diagnose
(the visual was obvious — robots running sideways) and another commit
to fix. No tests broke; no debugging sessions; no design rework.

---

## Estimation Accuracy

| Task | Estimated | Actual | Variance | Likely Cause |
|------|-----------|--------|----------|--------------|
| S6-01 Sim Driver (M, GDD + impl) | 1.0d | ~30 min | -94% | Spike-first; 29 tests passed first run |
| S6-02 Renderer wire-up (S) | 0.5d | ~25 min + 5 min bugfix | -90% | Bridge contract well-specified by Sim Driver GDD |
| S6-03 Camera System (M, GDD + impl) | 1.0d | ~3 sessions × ~30 min (spike + 3 mode additions) | -75% | More work than planned because of unplanned mode additions; less work per piece because of the pluggable resolver API |
| S6-04 Preact App Shell (M, GDD + impl) | 1.0d | accreted across all 10 sprint commits | n/a | Touched by every commit; no single delivery moment |
| S6-05 Winner VFX → Presentation (S, GDD + impl) | 0.5d | ~45 min (`34829ce`) | n/a | Scope reshaped late; original spec didn't ship |
| S6-06/07/08 NTH | 0.10d each | ~5 min each at close-out | — | Trivial as expected |

**Overall estimation accuracy**: 0% of tasks within ±20% of estimate.
Same six-sprint pattern.

**Analysis**: The interesting variance this sprint was *upward*: S6-03
took longer than planned because the system grew, not because the
work-per-piece took longer. Spike-first compresses each piece, but
unplanned scope expansion is invisible to the original estimate. This
is the first sprint where "M-tier estimate underran by 75% on
work-per-piece while the system as delivered was 4x the original
scope." A useful nuance.

**Recommendation for Sprint 7**: same as the last three sprints — keep
estimates as relative-size labels (XS / S / M / L) for sequencing and
decision-making, do not use them for time budgeting.

---

## Carryover Analysis

No active tasks carry over. Sprint 6 closes with all 8 planned tasks
complete plus 8+ unplanned items merged. No deferred GDDs (close-out
caught all three), no half-finished implementations.

The cosmetic dev HUD label and the hash-routing rename are noted in
the App Shell GDD's Implementation Notes for Sprint 7 polish but do
not gate anything.

---

## Technical Debt Status

- **TODO count**: 0 (previous: 0) → No new debt markers. Three
  reverse-doc GDDs caught the documentation debt at close-out before
  it could ossify.
- **FIXME count**: 0 (previous: 0) →
- **HACK count**: 0 (previous: 0) →
- **Trend**: Stable at zero. The Camera System GDD documents the
  Winner Camera's `rotation.y` write-back as the **only documented
  exception** to the "no non-sim writes to instance rotation"
  forbidden-pattern; the renderer GDD will need a one-line
  cross-reference when next touched (logged for Sprint 7).
- **Documentation debt at close-out** (now resolved): 3 missing GDDs
  (Camera, Winner Presentation, App Shell). Caught and reverse-doc'd
  in this session.

---

## Previous Action Items Follow-Up (Sprint 5 retro)

| Action Item | Status | Notes |
|-------------|--------|-------|
| #1 — Reconcile against `git log --grep="^SN-"` before starting work mid-stream | ✅ Done | Codified in `.claude/docs/coordination-rules.md` rule #6 (S6-07). Used during this close-out session to enumerate sprint commits before reverse-doc'ing. |
| #2 — Add Status column to sprint plan task table | ⚠️ Partially | Column was added to `sprint-06.md`, but kept drifting during the sprint. The convention is documented (S6-07) but the discipline didn't hold. New action item #2 for Sprint 7. |
| #3 — Decide pose-frame transport for Sprint 6 (JSON vs in-process) | ✅ Done | `sprint-06.md` "Pose-Frame Transport Decision" section made the in-process call. Validated in practice — works perfectly, no jank. |
| #4 — Document auto-mode etiquette | ✅ Done | Section added in `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` under "Commit Signal" (S6-06). This close-out session is the canonical example. |

3 of 4 closed cleanly; #2 partially closed (docs in place, discipline still developing) and re-issued for Sprint 7.

---

## Action Items for Next Iteration

| # | Action | Owner | Priority | Deadline |
|---|--------|-------|----------|----------|
| 1 | **GDD-or-it-doesn't-ship gate.** When a system spike lands without its GDD, the sprint plan task stays at "Spike" until the reverse-doc commit lands, AND the work cannot proceed past spike → polish without the GDD. The three Sprint 6 GDDs being reverse-doc'd 3 days post-window was a process miss; surface it earlier. | Agent | High | Sprint 7 first task |
| 2 | **Status column discipline check at every commit boundary.** When the agent commits sprint-tagged work, it also updates the sprint plan's Status column for that task in the same commit. The convention exists (S6-07); the practice did not hold this sprint. Make it part of the commit ritual. | Agent | High | Sprint 7 open |
| 3 | **Log scope changes as they happen.** When a planned task is reshaped (Camera cull-stages → 4 modes; Winner VFX → Presentation; routes `#/race` `#/winner` → in-place), the sprint plan task gets a same-day note ("scope reshaped: …") rather than the close-out reconciling it weeks later. Either inline edits to the task description or a per-sprint "Scope Changes Log" appendix at the bottom of `sprint-NN.md`. | Nathanial + agent | Medium | Sprint 7 plan |
| 4 | **Fix the dev HUD label.** `src/app.tsx:665` reads `S6-02 — Sim ↔ Renderer Bridge`. Either remove or replace with a sprint-agnostic label. Trivial. | Agent | Low | Sprint 7 polish window |
| 5 | **Update the renderer GDD with the Winner Camera rotation-write exception.** The renderer GDD currently asserts "no non-sim writes to instance rotation." Camera System GDD §3 R23 documents the exception. Add a one-line cross-reference to the renderer GDD's forbidden-patterns or invariants section. | Agent | Low | Sprint 7 |
| 6 | **Decide Sprint 7 sprint goal.** Three natural candidates: (a) **Sound** (zero audio in repo today; the most user-visible quality jump available), (b) **NFT/wallet integration** (memory flags this as a non-negotiable pillar that's gone untouched), (c) **Third event/arena + Maze GDD** (maze-race module shipped without a GDD; another arena would round out v1's variety claim). Pick one for the Sprint 7 plan. | Nathanial | High | Sprint 7 plan |
| 7 | **Author maze-race GDD as reverse-doc.** Maze-race module + Arena-02 + maze-walls + finish-tree all shipped unplanned; per S5 retro AI #3 spike-first endorsement, they need GDDs. Bundle into Sprint 7's documentation pass. | Agent | Medium | Sprint 7 |

---

## Process Improvements

- **Spike-first remains the default for non-trivial systems.** Sixth
  consecutive sprint validating it. Sprint 6's wrinkle: the *system*
  expanded (one camera mode → four), but the spike's contract held
  through every expansion. Pluggable APIs (`LeaderResolver`,
  `FollowCameraSettings`, `ArenaSetup` shape) absorbed scope without
  refactoring. Carry forward.

- **Reverse-doc *during* the spike, not at sprint close.** The S6-01
  GDD was authored same-day as the spike; the S6-03/04/05 GDDs
  weren't. The same-day discipline produced a cleaner doc (one
  context, one contract); the close-out reverse-doc requires
  re-reading 10 commits and reconstructing intent. Action Item #1
  formalises this.

- **Pluggable APIs are the architectural unit of scope absorption.**
  Sprint 6's most valuable seams: `EventModule` (sim accepts
  sprint-race or maze-race interchangeably), `LeaderResolver`
  (camera's "what to look at" is a function pointer per arena),
  `ArenaSetup` (event + scene objects + camera config bundled per
  arena type). Each one was added when needed, never speculatively.
  This is now a project-level pattern: the seam exists when the
  second thing needs it, not before.

- **Bundle headroom is real and shrinking.** First post-pivot sprint
  to materially move the bundle (+14.67 kB). The 200 kB defensibility
  threshold from `bundle-baseline.md` has 26.4 kB of headroom for
  the entire rest of v1. Sprint 7+ work that adds runtime
  dependencies (an audio engine? a wallet library?) needs to budget
  against this number and consider code-splitting if the threshold
  is approached.

- **The plan should narrate, not enumerate.** The sprint plan worked
  best when it answered "what are we trying to do, in what order,
  and why" (the Pose-Frame Transport Decision section, the Sprint
  Goal narrative, the Build Order diagram). It worked worst as a
  static task table that didn't track delivery (Status column
  drift). Action Items #1, #2, #3 are different facets of the same
  thing: the plan must be a *living document* of intent + state,
  or it stops being useful.

---

## Summary

Sprint 6 turned a working headless sim into a watchable, branded race
in the browser, end to end. All four Must-Have tasks shipped inside
the sprint window. The bundle came in 50% under its delta budget.
Determinism survived the renderer integration without a single
debugging session. The pluggable spike-first pattern absorbed an
unplanned second arena (maze), an unplanned third and fourth camera
mode (shoulder, winner), an unplanned UI panel (WinnerCard), and a
Cipher rebalance — all on top of the planned spine, without
refactoring.

The trade-off was bookkeeping debt: three GDDs (Camera, Winner
Presentation, App Shell) went unwritten until this 2026-05-04
close-out session, three days past the sprint window. The sprint
plan's Status column — added specifically to prevent this kind of
drift per S5 retro AI #2 — was itself one of the things that drifted.
Action items #1 and #2 are pointed at preventing the same pattern in
Sprint 7.

The mechanical spine is now in place. Sprint 7 opens on a polished,
playable v1 spine with three open directions for the next sprint
goal: sound, wallet/NFT integration, or a third event/arena. The
choice is the Sprint 7 plan's first decision.
