# Sprint 4 — 2026-04-24 to 2026-04-30

> **Status**: Active
> **Stage**: Pre-Production (post-pivot)
> **Developer**: Nathanial Ryan
> **Created**: 2026-04-24

---

## Context: Project Pivot

Sprints 1–3 built "Neon Fugitive," a 3-lane endless runner. The game shipped
cleanly but demonstrated low holding power with target users. The project has
pivoted to **Robo Rhapsody Sim** — a browser-based passive-watch event
simulator where 85 trait-driven robots compete in daily events.

Sprint 4 is the first sprint of the new project. It establishes the foundation
and de-risks the single biggest technical bet: rendering 85 animated skinned
meshes at 60fps in the browser.

Reference documents:
- [design/gdd/game-concept.md](../../design/gdd/game-concept.md) — full v1 spec
- [design/gdd/systems-index.md](../../design/gdd/systems-index.md) — 13 MVP systems + deferred roadmap
- [design/data/robots-traits.csv](../../design/data/robots-traits.csv) — 85 robots trait table
- [archive/endless-runner/](../../archive/endless-runner/) — Sprint 1–3 artifacts preserved

---

## Sprint Goal

Foundation deployable to `robo-rhapsody.onrender.com` + 85 robots animating on a
flat plane with placeholder positions. Technical bet de-risked.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for unplanned work |
| **Available** | 4 days |

> Per Sprint 1–3 retro pattern: estimates are upper bounds; agent pair-programming
> consistently delivers 5–10× faster than estimated. Plan for task count, not hours.

---

## Tasks

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|--------------|---------------------|
| S4-00 | **Pivot housekeeping** — `git mv` runner `src/` + runner tests to `archive/endless-runner/`; scaffold fresh `src/` layout (Preact + TS + Three.js); install Preact + `@preact/preset-vite`; remove `enable3d` + `@dimforge/rapier3d-compat` from `package.json`; update `vite.config.ts`; commit a working "Hello, Robo Rhapsody" Preact page | 0.25d | — | `npm run dev` serves a Preact hello-world page; `tsc --noEmit` passes; runner code is gone from `src/` but preserved under `archive/`; tests dir reorganized (runner tests archived, empty new `tests/` structure in place) |
| S4-01 | **Config Module** — GDD (8-section, S-tier) + implementation; nested-by-subsystem shape (`CONFIG.sim`, `CONFIG.renderer`, `CONFIG.camera`, `CONFIG.arena`, `CONFIG.build`); exported as `as const` for type-narrowing; read-only at runtime | 0.25d | S4-00 | GDD approved; `CONFIG` importable from any module; TypeScript rejects mutation; unit tests cover structure; no magic numbers remain in S4-02–S4-05 code |
| S4-02 | **Seedable PRNG** — `mulberry32` implementation; determinism unit tests (same seed → same output sequence across 1000 calls); exported as `createRng(seed: number): () => number` | 0.1d | S4-00 | Unit tests green; API ergonomic for sim use; no use of `Math.random` in the module |
| S4-03 | **Build / Deploy Pipeline** — author CSV→JSON transform script (`tools/build/traits-csv-to-json.ts`); wire as Vite pre-build step; create Render static-site config; deploy to `robo-rhapsody.onrender.com`; verify live | 0.25d | S4-00 | Build produces `dist/` with trait JSON embedded or served as static; `robo-rhapsody.onrender.com` serves the Preact hello-world; CSV changes trigger re-transform; deploy is one `git push` |
| S4-04 | **85-Instance Skinned Mesh Renderer — GDD + prototype + de-risk** — write GDD (L-tier, 8-section); implement prototype scene that loads the rigged robot GLB once, spawns 85 instances arranged in a grid, each with its own texture (load all 85 skins from `assets/art/characters/robot/skins/`), plays `run` animation on all of them, sustained 60fps on mid-range desktop; document fallback decision if performance fails | 1.0d | S4-00, S4-01, S4-03 | **Primary:** 85 robots, each with unique texture, all playing `run` animation, 60fps sustained for 60 seconds on Chrome on mid-range desktop. **Secondary:** GDD captures the rendering approach (single shared `SkinnedMesh` geometry + per-instance material + manual skeleton update, OR instanced alternative if chosen), and documents which of the four fallbacks (reduce to 40 robots / frustum-culled skeleton updates / VAT / static poses) applies if the primary approach fails. **Tertiary:** GDD includes measured frame time breakdown (skeleton update cost, draw call count, texture memory). |

### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|--------------|---------------------|
| S4-05 | **Animation State Switcher** — GDD (M-tier) + implementation; bridge layer that maps per-robot state (`"running"` / `"idle"` / `"dying"`) to `AnimationMixer` crossfades; tested against fake state-change script (no sim yet) | 0.5d | S4-04 | GDD approved; 85 instances smoothly transition between `run` / `idle` / `death` on scripted state changes; no animation tearing; death animation plays once and holds final pose |

### Nice to Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|--------------|---------------------|
| S4-06 | Extend [docs/smoke-test.md](../../docs/smoke-test.md) with "new visual system" checklist — direction, opacity/alpha gradient, state transitions (idle/running/dying), per-instance correctness, camera-angle sanity | 0.1d | — | Checklist exists; applied to S4-04 before commit |
| S4-07 | Update [CLAUDE.md](../../CLAUDE.md) tech stack section — add Preact to allowed libraries, remove enable3d + Rapier references, update Engine Version Reference pointer if needed | 0.1d | S4-00 | Stack section reflects current reality; `three-js/VERSION.md` updated or deferred with a noted TODO |

---

## Carryover from Sprint 3

| Action Item | Status | Notes |
|-------------|--------|-------|
| Run Supabase `milestones` table migration | **Obsolete** | Supabase dropped from v1 scope during pivot. Milestone Badges feature lives only in archived runner code. |
| "New visual system" smoke-test checklist addition | → S4-06 | Still relevant — S4-04 is a net-new visual system and benefits from it |
| Track unplanned tasks in sprint doc when added | **Ongoing discipline** | Not a task; carry into Sprint 4 execution |

---

## Sprint 3 Action Items Still Open

None carrying as tasks; Supabase migration is obsolete.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| 85-instance skinned-mesh renderer cannot sustain 60fps | Medium | **High (project-level)** | S4-04 is explicitly a de-risk task, pulled forward from its natural dependency position. Fallbacks in priority order: (a) reduce to 40 robots, (b) skip skeleton updates for off-screen robots (frustum cull), (c) bake animations to texture (VAT), (d) drop to static poses on non-skinned instanced meshes. All four paths enumerated in `systems-index.md` § High-Risk Systems. Decision captured in S4-04 GDD. |
| Preact + Three.js + Vite integration has unknown friction | Low | Medium | S4-00 validates all three in a hello-world before any real code lands. Preact + Vite is a supported first-class integration (`@preact/preset-vite`). Three.js is framework-agnostic. |
| Render static-site first-time setup eats half a day | Low | Low | Project has prior Render deploy muscle memory. Treat hello-world deploy as a Day 1 smoke test, not a Day 5 surprise. |
| CSV → JSON transform timing (build-time vs. runtime) unclear | Low | Low | S4-03 settles this during design. Recommended: build-time transform to static JSON, imported as a module. No runtime CSV parsing. |
| Texture memory for 85 × skin-PNG exceeds budget | Low | Medium | Check in S4-04. Skins are 2D textures, not complex materials. 85 × ~200KB ≈ 17MB — well within the 200MB JS heap ceiling from `technical-preferences.md`. Mitigation if needed: smaller texture size, texture atlas. |
| Adding Preact tangles with existing vanilla-TS UI patterns in `src/ui/` | — | — | **Not a risk this sprint** — runner `src/ui/` is archived in S4-00; fresh start. |

---

## Dependencies on External Factors

- **Render account** — presumed active from runner-era deploys. First deploy of this project creates a new Render service pointed at the repo's `main` branch.
- **None else.** No Supabase, no Twitter API, no external data sources for v1.

---

## Build Order

```
S4-00 (archive + scaffold)                    ← must go first; blocks everything
  │
  ├─► S4-01 (Config Module)       ┐
  ├─► S4-02 (Seedable PRNG)       ├─► parallel; no inter-dependencies
  └─► S4-03 (Build/Deploy)        ┘
                  │
                  ▼
              S4-04 (85-Instance Renderer)    ← the bet; GDD + prototype
                  │
                  ▼
              S4-05 (Animation State Switcher)

              S4-06 (smoke-test doc)          ← any time; independent
              S4-07 (CLAUDE.md update)        ← any time after S4-00
```

Critical path: **S4-00 → S4-04 → S4-05**. If S4-04 discovers the technical bet
doesn't hold, S4-05 may be replaced with fallback-implementation work (e.g.,
"implement 40-robot variant" or "implement VAT baking").

---

## Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] Runner code archived to `archive/endless-runner/`, not present in `src/`
- [ ] Fresh `src/` structure scaffolded and Preact hello-world visible at `npm run dev`
- [ ] Deployed build visible at `robo-rhapsody.onrender.com`
- [ ] Config Module GDD written and approved before implementation
- [ ] 85-Instance Renderer GDD written (even if fallback path taken)
- [ ] 85 robots visibly animating at 60fps on dev machine (or documented fallback shipped)
- [ ] Animation State Switcher demonstrates `run` → `idle` → `death` transitions
- [ ] No S1–S2 bugs in delivered features
- [ ] All new code reviewed per `coding-standards.md` (doc comments, tests, no magic numbers)
- [ ] Sprint retrospective written at close (`sprint-04-retrospective.md`)

---

## Sprint Exit Criteria (stretch)

**v1 Sprint 4 "Good":** S4-00 through S4-04 complete, renderer hits 60fps on dev
machine. Sprint 5 can proceed as planned.

**v1 Sprint 4 "Great":** All Must + Should tasks complete, Animation State
Switcher demoing all three states. Sprint 5 can start immediately.

**v1 Sprint 4 "Concerning":** S4-04 fails 60fps target. Sprint closes with
fallback decision documented; Sprint 5 plan revises to include fallback
implementation as its first task (pushing sim-engine work to Sprint 6).
