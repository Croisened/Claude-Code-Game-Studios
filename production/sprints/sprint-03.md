# Sprint 3 — 2026-04-01 to 2026-04-07

> **Status**: Active
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-04-01

---

## Sprint Goal

Ship three engagement hooks that give players a named goal (milestones), a personal rival (ghost), and a better-feeling run (neon trail) — without touching the obstacle spawner or backend.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for unplanned work |
| **Available** | 4 days |

> Per retro pattern: estimates are upper bounds; agent pair-programming consistently delivers 5–10× faster. Plan for task count, not hours.

---

## Tasks

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S3-01 | **Pre-sprint action items** — add browser smoke test checklist; make all persistent state defaults explicit in config | 0.1d | — | Smoke test doc exists; all localStorage defaults are named constants in config objects |
| S3-02 | **Distance Milestone Badges** — GDD + implementation; named thresholds (500m, 1000m, 2500m, 5000m) persisted in localStorage; badge shown on death screen | 0.25d | S3-06 | Milestones unlock on crossing threshold; persist across sessions; death screen shows current and next badge |
| S3-03 | **Personal Best Ghost** — GDD + implementation; sample `{lane, isJumping, timestamp}` every 100ms; replay as low-opacity ghost robot on subsequent runs | 0.5d | S3-02, S3-06 | Ghost appears on run 2+; tracks lane/jump accurately; no collision with ghost; resets when a new PB is set |

### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S3-04 | **Neon Trail Visual** — particle trail or position-queue fade behind robot during movement; color pulled from per-skin lookup table | 0.25d | — | Trail renders during lane changes and at speed; fades over ~10 frames; color matches active skin; no framerate impact at 60fps |

### Nice to Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S3-05 | Track unplanned tasks in sprint doc as they arise (process improvement from retro) | — | — | No untracked out-of-plan work at sprint close |
| S3-06 | Write GDDs before implementation for S3-02 and S3-03 | 0.1d | — | Both GDDs meet 8-section standard before code is written |

---

## Sprint Action Items (from Sprint 2 Retro)

| # | Action | Status |
|---|--------|--------|
| 1 | Browser smoke test checklist before rendering commits | → S3-01 |
| 2 | External service deps listed in sprint plan | N/A this sprint (no external services) |
| 3 | Explicit persistent state defaults in config | → S3-01 |
| 4 | Track unplanned tasks in sprint doc as added | → S3-05 (ongoing) |

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Ghost replay drifts from speed ramp delta-time | Medium | Medium | Sample timestamps with `performance.now()`; replay uses same delta-time logic as live run |
| Neon trail particle cost exceeds frame budget | Low | Low | Use position-queue + opacity fade (not a particle system); max ~20 quads per frame |
| Ghost mesh draw call doubles robot rendering | Low | Low | Reuse same geometry with cloned low-opacity material; one extra draw call only |

---

## Dependencies on External Factors

- None. All three features are purely client-side with no backend or external service requirements.

---

## Build Order

```
S3-01 (smoke test + config defaults)   ← immediate, standalone
S3-06 (GDDs before implementation)     ← before S3-02 and S3-03

S3-02 (Milestone Badges)               ← first feature; simplest, standalone
S3-04 (Neon Trail)                     ← parallel with S3-02; no dependencies
  └── S3-03 (Ghost)                    ← after milestones (ghost targets next milestone)
```

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All existing tests green; new tests added for milestone badge logic and ghost data capture
- [ ] Browser smoke test run before each rendering-adjacent commit
- [ ] GDDs written for Milestone Badges and Personal Best Ghost before implementation begins
- [ ] No S1–S2 bugs in delivered features
- [ ] Game playable end-to-end: menu → run → ghost visible → milestone badge on death → restart
