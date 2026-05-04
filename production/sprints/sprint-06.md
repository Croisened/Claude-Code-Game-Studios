# Sprint 6 — 2026-04-25 to 2026-05-01

> **Status**: Closed (2026-05-04, three days post-window)
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-04-25

---

## Context

Sprint 5 delivered the entire simulation tier in two short sessions: trait math,
roster + arena loaders, the Three.js-agnostic Sim Engine Core, the Sprint Race
Event Module, and a headless harness emitting deterministic pose-frame +
event-timeline JSON. 178 tests green, bundle unmoved, no carryover.

Sprint 6 turns from simulation back to **rendering** and joins the two halves.
The 85-instance renderer + Animation State Switcher (Sprint 4) and the Sim
Engine + Sprint Race Module (Sprint 5) get wired together. By sprint close, a
user opens the site in a browser, clicks a button, and watches an 85-robot
sprint race resolve to a winner — with a tracking camera and a winner reveal.

Reference documents:
- [design/gdd/game-concept.md](../../design/gdd/game-concept.md)
- [design/gdd/systems-index.md](../../design/gdd/systems-index.md)
- [production/sprints/sprint-05-retrospective.md](sprint-05-retrospective.md)

---

## Sprint Goal

**A user can watch a deterministic sprint race in the browser, end to end.**
Sim drives renderer; camera follows the action; UI shell wraps it; winner is
visually announced. Three v1 MVP systems still listed `Not Started` in the
systems index (Camera, Winner VFX, Preact App Shell) all land approved and
implemented this sprint.

---

## Pose-Frame Transport Decision (per Sprint 5 retro AI #3)

**In-process.** `runSim()` is invoked inside the browser entry; the returned
`SimResult` (poses + events + finish order) is consumed directly by a Sim
Driver module that paces frames against the render loop's clock.

**Why**:
- A single sprint race emits ~4.57 MB of JSON. Shipping that to the browser
  would be a non-trivial network cost for what is currently a free-to-watch
  experience.
- The `SimResult` type is already a stable, well-tested contract. A
  JSON-on-disk variant becomes a thin adapter (`SimResult` ⇆ JSON) when the
  v1.x replay-from-server vision arrives, not a redesign.
- Faster dev loop, no I/O, no server-side simulation work needed in v1.
- Sim still runs deterministically client-side; same seed → same race.

**Tradeoff accepted**: the browser pays the sim cost (~34 ms per race per the
Sprint 5 harness measurement). At one race per page-view this is negligible;
if/when batch pre-baking is needed for v1.1+, the JSON path returns.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for unplanned work |
| **Available** | 4 days |

> Per Sprint 1–5 retro pattern: estimates are upper bounds and useful for
> sequencing, not time budgets. Treat the Est. column as relative size only.

---

## Tasks

> **Live status convention (per Sprint 5 retro AI #2)**: the Status column is
> updated as work lands. Pending → In Progress → Done (commit hash). The plan
> reads as a live status doc mid-sprint, not a static intent doc.

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Status | Acceptance Criteria |
|----|------|------|--------------|--------|---------------------|
| S6-01 | **Sim Driver** — GDD (M-tier, 8-section) + implementation. In-process module that owns a `SimResult` and a playback clock. Per-frame it interpolates between `PoseFrame[i]` and `PoseFrame[i+1]`, emits pose updates, and fires timeline events (`simStart`, `elimination` reasons including `gate_a_closed` / `gate_b_closed` / `race_over`, `finish`, `simEnd`) to subscribers as their `tick` is crossed. Three.js-agnostic; testable in Node. | M | Sim Engine Core, Sprint Race Event Module | **Done** (`5847bd2`) | GDD approved; same seed → same playback frames; playback clock supports pause / resume / restart; events fire at correct frame; tests cover interpolation math, event-fire ordering, restart determinism |
| S6-02 | **Renderer ↔ Sim wire-up** — connects Sim Driver pose stream to the 85-instance renderer's per-tick pose write, and bridges timeline events to the Animation State Switcher (`run` at start, `death` on `eliminated`, `idle` on `race_over` / `finish`). Reverse-documents into the existing renderer GDD §X if needed; no new GDD. | S | S6-01, 85-Instance Renderer, Animation State Switcher | **Done** (`45f90aa`) | 85 robots animate from sim poses in the browser; eliminated robots transition to `death` on the correct frame; winner finishes in `idle`; visual smoke test against `--seed 1` matches the harness's recorded finish order (winner = robot 57 in both) |
| S6-03 | **Camera System** — GDD (M-tier) + implementation. Tracking camera that follows "the action" through cull stages: leader-of-pack pre-gate-A, contested-pack between gates, top-N during cull, single winner post-finish. Smooth interpolation between targets; respects arena bounds. | M | S6-01, Sim Engine Core | **Done** (`88165a9` spike + reverse-doc at close) — scope reshaped: cull-stage target switching cut; four-mode system shipped instead (Follow-Leader, Static Arena, Robot Shoulder, Winner Camera). See [camera-system.md](../../design/gdd/camera-system.md). | GDD approved; four modes function in browser; smoothing uses frame-rate-independent exponential lerp; no `Math.random`; Follow-Leader test suite (385 LOC) covers AC-1 through AC-8 mechanically; static / shoulder / winner verified by manual playtest |
| S6-04 | **Preact App Shell** — GDD (M-tier) + implementation. Landing → Race View → Winner Reveal flow. Hash routing (`#/`, `#/race`, `#/winner`). Race View hosts the Three.js canvas + a pause/restart control bar. Winner Reveal shows the winning robot's portrait, name, traits, and a "Watch Again" button. | M | S6-01, S6-02, S6-03 | **Done** (`45f90aa` → `34829ce`) — route names changed to `#peek` / `#peek-maze` / `#landing` (dev preview); winner reveal mounts in-place rather than on a separate route. See [preact-app-shell.md](../../design/gdd/preact-app-shell.md). | GDD approved; routes navigable; full flow works on random seed each Race Again; renderer disposes cleanly across teardown cycles; no rAF accumulation across repeated Race Again clicks |

### Should Have

| ID | Task | Est. | Dependencies | Status | Acceptance Criteria |
|----|------|------|--------------|--------|---------------------|
| S6-05 | **Winner VFX** → renamed **Winner Presentation** at sprint close. Originally: minimum a tinted rim light / emissive boost; ideally a particle accent. | S | S6-02, S6-03 | **Done** (`34829ce`) — scope reshaped: literal VFX (rim/emissive/particles) **cut**; shipped as Winner Camera composition (45° framing of winner + arena landmark) + cyberpunk WinnerCard panel + face-the-camera rotation override. See [winner-presentation.md](../../design/gdd/winner-presentation.md). Literal VFX moves to v1.x deferred polish. | GDD approved; winner is unambiguously visually distinguished via cam + card + face-camera rotation; no per-frame allocations in the WinnerCard render; unmounts cleanly on Race Again, Arena, and Robot # input |

### Nice to Have

| ID | Task | Est. | Source | Status | Acceptance Criteria |
|----|------|------|--------|--------|---------------------|
| S6-06 | **Auto-mode etiquette** — addition to `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` per Sprint 5 retro AI #4. When auto mode activates mid-session, the agent acknowledges the mode change and lists which decision categories it will batch through. | XS | S5 retro AI #4 | **Done** (sprint close) — section added in `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` under "Commit Signal" with the canonical acknowledgement example. | Section added; one example of "I'll batch through X, will pause for Y"; anti-pattern (silent autonomous execution) called out |
| S6-07 | **Sprint plan live-status convention codified** — short note in `.claude/docs/coordination-rules.md` (or a sibling) describing the Status-column convention used in this plan, so future sprints don't have to re-derive it. | XS | S5 retro AI #2 | **Done** (sprint close) — rule #6 added in `.claude/docs/coordination-rules.md` referencing this sprint plan as the canonical example. | Convention documented; Sprint 6 plan referenced; reconcile-against-git-log step included from S5 retro AI #1 |
| S6-08 | **Bundle-size delta check** — run `vite build` at sprint close, append a Sprint 6 trend row to `docs/performance/bundle-baseline.md`. The renderer-wire-up will materially move the bundle for the first time since the pivot; record where it lands. | XS | S6-04 done | **Done** (sprint close) — Sprint 6 row appended: 158.93 → **173.60 kB gzip** (+14.67 kB). Within 200 kB defensibility threshold. | Bundle row appended; delta is below the +30 kB threshold so no special rationale required, but the composition note (Sim Driver + Bridge + Camera × 4 + maze visuals + WinnerCard + landing styling) is included |

---

## Carryover from Sprint 5

None active. All four Sprint 4 retro AIs closed in Sprint 5; Sprint 5 retro AIs
#1, #2, #3, #4 are addressed by S6 process choices and tasks S6-06 / S6-07.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Sim Driver interpolation produces visible jitter at frame boundaries | Medium | Medium | The sim runs at fixed 60 Hz and the render loop targets 60 fps, so most frames are 1:1. Interpolate linearly between `PoseFrame[i]` and `PoseFrame[i+1]` using `(now - tickStart) / tickDuration`; same approach as classic fixed-timestep games. Test against rAF jitter explicitly. |
| Camera target-switching snaps look jarring | Medium | Medium | Spec smooth interpolation in the Camera GDD up front: target position lerps at a configurable speed, never teleports. Acceptance criterion explicitly forbids snaps. Spike-first the camera if the GDD-first approach feels speculative. |
| Preact + Three.js mount/unmount lifecycle leaks | Low | Medium | The renderer GDD already mandates `dispose()` and forbids re-mount on the same instance. App Shell creates a fresh `createRenderer()` on each entry into Race View; tests assert no event-listener growth across mount/unmount cycles. |
| Bundle size jumps materially when Three.js + sim + Preact land in the same build | High | Low | Expected. S6-08 records the new baseline. Three.js gzip is ~150–170 kB on its own; the existing bundle is 158.93 kB gzip but does not yet include the renderer entry. Treat the post-wire-up number as the new floor, not as a regression. |
| Winner VFX scope creep | Medium | Low | S6-05 is Should Have, not Must Have. If S6-01..04 take the full sprint, ship without VFX and pull S6-05 into Sprint 7. Spec the GDD for the minimal-viable visual; stretch goals are explicit. |
| Sim re-runs on every page reload waste ~34 ms | Low | Low | Acceptable per the transport decision. If user-perceptible, cache `SimResult` in `sessionStorage` keyed by seed; this is a one-line follow-up, not a sprint task. |

---

## Dependencies on External Factors

- **None.** Sprint 6 is local: TypeScript + Vitest + Vite + Three.js + Preact.
  No new APIs, no Render deploy work, no Supabase. The Render deploy from
  Sprint 4 still serves the build; final smoke test will be a manual deploy at
  sprint close.

---

## Build Order

```
S6-01 (Sim Driver)  ─►  S6-02 (Renderer wire-up)  ─┬─►  S6-03 (Camera)  ─┐
                                                   │                     ├─►  S6-04 (App Shell)  ─►  S6-05 (Winner VFX)
                                                   └─────────────────────┘

S6-06 (auto-mode etiquette)  ┐
S6-07 (live-status convention) ├─ independent; any time
S6-08 (bundle delta)         ┘  ← runs after S6-04
```

Critical path: **S6-01 → S6-02 → (S6-03 ∥ S6-04) → S6-05**.

S6-03 and S6-04 are parallelizable once S6-02 lands — Camera depends on the
sim-driven renderer being live; App Shell depends on the renderer being
mountable into a Preact tree. Neither blocks the other.

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All Must-Have GDDs (S6-01, S6-03, S6-04) written and approved before their implementation commits
- [ ] `npm run dev` → open browser → click "Watch Race" → race plays → winner reveal screen appears
- [ ] Determinism preserved: `--seed 42` produces the same finish order in browser as in the headless harness
- [ ] No `Math.random` use anywhere in `src/` (existing invariant, re-checked)
- [ ] All new code reviewed per `coding-standards.md` (doc comments, tests, no magic numbers, `CONFIG` for tuning)
- [ ] Systems index updated: Camera, Winner VFX, App Shell move from `Not Started` → `Approved`
- [ ] Sprint retrospective written at close (`sprint-06-retrospective.md`)

---

## Sprint Exit Criteria

**Good**: S6-01 and S6-02 complete. The browser shows 85 sim-driven robots
animating to a winner, but the camera is static and the UI is the bare canvas.
S6-03 / S6-04 / S6-05 slip to Sprint 7.

**Great**: All Must + Should tasks complete. A user can hit the deployed URL,
watch a full race with a tracking camera, and see the winner reveal. Sprint 7
opens with polish work (Sound, additional event types, real arena content) on
a fully playable v1 spine.

**Concerning**: Determinism diverges between headless and browser runs. This
would mean the sim is leaking non-determinism through the browser's environment
(rAF timing, JIT, etc.) — a Sprint 7 debugging task before any further feature
work.

---

## Process Notes (Sprint 5 retro carry-forward)

- **Spike-first remains the default** for non-trivial systems. S6-01 (Sim
  Driver), S6-03 (Camera), and S6-05 (Winner VFX) are all candidates: write
  the smallest working thing, write the tests, reverse-document the GDD.
- **Reconcile against `git log` before starting** any task — `git log --oneline --grep="^S6-"`
  catches the "already done in a prior session" case that bit Sprint 5's
  S5-07/08/09 (retro AI #1).
- **Update this plan's Status column as work lands.** That is the convention
  this sprint demonstrates and S6-07 codifies.
