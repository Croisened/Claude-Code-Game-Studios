# Sprint 3 — 2026-04-01 to 2026-04-07

> **Status**: Active
> **Stage**: Pre-Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-04-01

---

## Sprint Goal

Ship two engagement hooks that give players a named goal (milestones) and a better-feeling run (neon trail) — without touching the obstacle spawner or backend.

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
### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S3-04 | **Neon Trail Visual** — particle trail or position-queue fade behind robot during movement; color pulled from per-skin lookup table | 0.25d | — | Trail renders during lane changes and at speed; fades over ~10 frames; color matches active skin; no framerate impact at 60fps |

### Nice to Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S3-05 | Track unplanned tasks in sprint doc as they arise (process improvement from retro) | — | — | No untracked out-of-plan work at sprint close |
| S3-06 | Write GDD before implementation for S3-02 | 0.1d | — | Milestone Badges GDD meets 8-section standard before code is written |

---

## Sprint Action Items (from Sprint 2 Retro)

| # | Action | Status |
|---|--------|--------|
| 1 | Browser smoke test checklist before rendering commits | → S3-01 |
| 2 | External service deps listed in sprint plan | Supabase milestones table required — SQL spec in distance-milestone-badges.md |
| 3 | Explicit persistent state defaults in config | → S3-01 |
| 4 | Track unplanned tasks in sprint doc as added | → S3-05 (ongoing) |

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Supabase milestones table not yet created | Medium | Medium | SQL spec in GDD; run migration before implementation begins |
| Neon trail particle cost exceeds frame budget | Low | Low | Use position-queue + opacity fade (not a particle system); max ~20 quads per frame |
| Lightning VFX interferes with obstacle visibility | Low | Low | Cap bolt opacity and duration per tuning knobs in GDD |

---

## Dependencies on External Factors

- **Supabase**: `milestones` table must be created before S3-02 implementation. SQL migration spec in `design/gdd/distance-milestone-badges.md` § Dependencies.

---

## Build Order

```
S3-01 (smoke test + config defaults)   ← done ✓
S3-06 (Milestone Badges GDD)           ← done ✓

S3-02 (Milestone Badges impl)          ← next; requires Supabase migration first
S3-04 (Neon Trail)                     ← parallel; no dependencies
```

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All existing tests green; new tests added for milestone badge logic
- [ ] Browser smoke test run before each rendering-adjacent commit
- [ ] GDD written for Milestone Badges before implementation begins ✓
- [ ] Supabase `milestones` table migration run before S3-02 implementation
- [ ] No S1–S2 bugs in delivered features
- [ ] Game playable end-to-end: menu → run → lightning VFX on 1000m → milestone badge on death → restart
