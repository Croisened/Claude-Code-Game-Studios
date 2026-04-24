# Systems Index: Robo Rhapsody Sim

> **Status**: Draft
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Source Concept**: design/gdd/game-concept.md

---

## Overview

Robo Rhapsody Sim is a browser-based passive-watch event simulator. 85 trait-driven
robots compete in procedurally-decided but hand-authored arenas, and viewers tune
in to watch the results unfold. The mechanical scope of **v1** is deliberately
narrow: prove that 85 animated robots can run a deterministic Sprint Race in the
browser and be watched live with a usable camera. No persistence, no replay JSON,
no Supabase, no leaderboard, no boosts, no scheduled automation — all deferred
behind a working demo. The system architecture reflects this: 13 MVP systems that
together produce one watchable Sprint event triggered by a button click, and a
roadmap of ~14 deferred systems that re-enter across v1.1 / v1.2 / v2 as
persistence, variety, and automation become warranted.

This index is a complete pivot from the prior project ("Neon Fugitive" endless
runner). The runner's concept, GDDs, and source code are archived under
`archive/endless-runner/`. The only assets that carry forward are the rigged
robot GLB, the 85 skin textures in `assets/art/characters/robot/skins/`, and the
technology stack (Three.js r168 + TypeScript + Vite + Supabase — though Supabase
is unused in v1).

---

## Systems Enumeration

| # | System Name | Category | Priority | Status | Design Doc | Depends On |
|---|-------------|----------|----------|--------|------------|------------|
| 1 | Config Module | Core | MVP | Approved | design/gdd/config-module.md | — |
| 2 | Seedable PRNG | Core | MVP | Approved | design/gdd/seedable-prng.md | — |
| 3 | Build / Deploy Pipeline | Core | MVP | Approved | design/gdd/build-deploy-pipeline.md | — |
| 4 | 85-Instance Skinned Mesh Renderer | Rendering | MVP | Not Started | — | Robot Roster Loader |
| 5 | Animation State Switcher | Rendering | MVP | Not Started | — | 85-Instance Skinned Mesh Renderer, Sim Engine Core |
| 6 | Trait → Stat Derivation | Core | MVP | Not Started | — | Config Module |
| 7 | Robot Roster Loader | Core | MVP | Not Started | — | Config Module |
| 8 | Arena Loader + Sprint Arena JSON | Core | MVP | Not Started | — | Config Module |
| 9 | Sim Engine Core | Gameplay | MVP | Not Started | — | Config Module, Seedable PRNG, Trait → Stat Derivation, Robot Roster Loader |
| 10 | Sprint Race Event Module | Gameplay | MVP | Not Started | — | Sim Engine Core, Arena Loader |
| 11 | Camera System | Presentation | MVP | Not Started | — | 85-Instance Skinned Mesh Renderer, Sim Engine Core |
| 12 | Winner VFX | Presentation | MVP | Not Started | — | Sim Engine Core, 85-Instance Skinned Mesh Renderer |
| 13 | Preact App Shell | UI | MVP | Not Started | — | Sim Engine Core, Camera System, 85-Instance Skinned Mesh Renderer, Winner VFX |

> Systems 4, 5, 8, 11, 12, 13 were explicit in the spec. Systems 1, 2, 3, 6, 7, 9, 10
> are implicit — required for the explicit systems to function, enumerated during
> dependency analysis in Phase 2 of `/map-systems` on 2026-04-24.

---

## Categories

| Category | Description | Systems in v1 |
|----------|-------------|---------------|
| **Core** | Foundation systems everything depends on | Config, PRNG, Build/Deploy, Trait→Stat, Roster Loader, Arena Loader |
| **Gameplay** | The systems that drive the sim | Sim Engine Core, Sprint Race Event Module |
| **Rendering** | Visual presentation of sim state | 85-Instance Renderer, Animation State Switcher |
| **Presentation** | Viewer-facing feedback and control | Camera System, Winner VFX |
| **UI** | Shell and interactive controls | Preact App Shell |

Categories not used in v1: **Progression, Economy, Persistence, Audio, Narrative, Meta**.
Audio and Persistence re-enter in v1.1+; the others are unlikely to apply to this game's shape.

---

## Priority Tiers

| Tier | Definition | Target Milestone | Design Urgency |
|------|------------|------------------|----------------|
| **MVP** | Required to run one watchable Sprint Race event triggered by a button. | First playable v1 | Design ALL |
| **v1.1** | Persistence + second event type + light community hooks | ~2 months post-launch | Design after v1 ships |
| **v1.2** | Third event type + leaderboard + robot profiles | ~3–4 months post-launch | Design after v1.1 ships |
| **v2** | Automation (cron, X API) + full-featured retention loop | 6+ months post-launch | Design only when engagement data justifies |

All 13 v1 systems are MVP. This is intentional — the scope was pared down in
`/map-systems` to "prove the sim works" and nothing beyond. There is no
Vertical Slice / Alpha / Beta progression for v1; there is only "shippable demo"
or "not yet."

---

## Dependency Map

### Foundation Layer (no dependencies)

1. **Config Module** — Single source of truth for tunables (sim coefficients, arena constants, camera presets, asset paths, future showtime). Shape it once; everyone plugs in.
2. **Seedable PRNG** — `mulberry32` (or equivalent). Pure function. Foundation of determinism; every stochastic decision in the sim routes through it.
3. **Build / Deploy Pipeline** — Vite + Render static site. CSV→JSON transform step for trait data. Not a runtime system, but everything deploys through it.

### Core Layer (depends on foundation)

1. **Trait → Stat Derivation** — depends on: Config Module. Pure function: CSV row (5 traits) → sim stats (speed, acceleration, handling, pathfinding, caution, chaos). Coefficients live in Config.
2. **Robot Roster Loader** — depends on: Config Module. Loads `robots-traits.json` (built from CSV) + resolves texture paths for the 85 skins.
3. **Arena Loader + Sprint Arena JSON** — depends on: Config Module. Reads hand-authored arena JSON files (starting with `sprint-01.json`) and produces in-memory arena geometry for both sim and renderer.

### Feature Layer (depends on core)

1. **Sim Engine Core** — depends on: Config, PRNG, Trait→Stat, Roster Loader. Fixed-timestep tick loop, active-robot array, elimination bookkeeping, position/rotation updates. Three.js-agnostic.
2. **Sprint Race Event Module** — depends on: Sim Engine Core, Arena Loader. AI decisions per tick, gate logic, stage culls (85→28→10→1 or similar — final numbers tuned during design).

### Rendering Layer (depends on core + feature)

1. **85-Instance Skinned Mesh Renderer** — depends on: Robot Roster Loader. Shared skinned geometry, material swapped per robot, frustum-culled skeleton updates. **Highest-risk system; prototype first.** Runs against placeholder position data before sim is written.
2. **Animation State Switcher** — depends on: 85-Instance Renderer, Sim Engine Core. Bridges sim state ("running", "dying", "finished") to AnimationMixer transitions (`run` / `death` / `idle`). v1 uses only those three animation states.

### Presentation Layer (depends on features + rendering)

1. **Camera System** — depends on: 85-Instance Renderer, Sim Engine Core. Three modes user-selectable via toggle: **Follow Leader** (auto-cuts to current first-place), **Fixed Cameras** (several authored presets per arena), **Follow ID** (viewer enters any robot ID and camera tracks that robot through the entire event including death/ragdoll).
2. **Winner VFX** — depends on: Sim Engine Core (winner signal), 85-Instance Renderer (target). Particle burst + spotlight + slow camera orbit on the winning robot at finish. No custom victory animation in v1 per locked decision — winner plays `idle`.

### UI Layer (depends on everything)

1. **Preact App Shell** — depends on: Sim Engine Core, Camera System, 85-Instance Renderer, Winner VFX. Single-page v1: Three.js canvas + "Start Sim" button + camera mode toggle + robot ID input for Follow ID + winner readout. No routing in v1 (single page). Preact is chosen for v1 to front-load the framework decision; the richer 4-route structure (leaderboard, profile, archive) arrives in v1.1–v1.2.

---

## Recommended Design Order

Combines dependency sort with one deliberate deviation: the **85-Instance Skinned
Mesh Renderer** is pulled forward to position 4 (would normally be ~8 by strict
dependency order) to de-risk the project's core technical bet before deep
investment in sim and arena design. If the renderer can't hit 60fps with 85
animated robots, every other system has to change.

| Order | System | Priority | Layer | Agent(s) | Est. Effort |
|-------|--------|----------|-------|----------|-------------|
| 1 | Config Module | MVP | Foundation | game-designer, lead-programmer | S |
| 2 | Seedable PRNG | MVP | Foundation | lead-programmer | S |
| 3 | Build / Deploy Pipeline | MVP | Foundation | devops-engineer | S |
| 4 | **85-Instance Skinned Mesh Renderer** | MVP | Rendering (pulled forward — RISK FIRST) | technical-artist, gameplay-programmer | **L** |
| 5 | Animation State Switcher | MVP | Rendering | gameplay-programmer | M |
| 6 | Trait → Stat Derivation | MVP | Core | systems-designer | S |
| 7 | Robot Roster Loader | MVP | Core | gameplay-programmer | S |
| 8 | Arena Loader + Sprint Arena JSON | MVP | Core | level-designer, gameplay-programmer | M |
| 9 | Sim Engine Core | MVP | Gameplay | systems-designer, ai-programmer | L |
| 10 | Sprint Race Event Module | MVP | Gameplay | systems-designer, ai-programmer | M |
| 11 | Camera System | MVP | Presentation | game-designer, gameplay-programmer | M |
| 12 | Winner VFX | MVP | Presentation | technical-artist | S |
| 13 | Preact App Shell | MVP | UI | ui-programmer | M |

Effort scale: **S** = 1 design session (30–60 min). **M** = 2–3 sessions. **L** =
4+ sessions, likely spanning a sprint with a prototype component. Two L-tier
systems (Renderer, Sim Engine Core) are the load-bearing risks of the project.

### Suggested sprint grouping

| Sprint | Systems | Sprint Goal |
|--------|---------|-------------|
| **Sprint 4** | 1, 2, 3, **4**, 5 | Foundation deployable to `robo-rhapsody.onrender.com` + 85 robots animating on a flat plane with placeholder positions. Technical bet de-risked. |
| **Sprint 5** | 6, 7, 8, 9 | Trait math + arena loading + headless sim producing an event timeline. No rendering of actual sim yet. |
| **Sprint 6** | 10, 11, 12, 13 | Sprint Race event logic wired to renderer. Camera modes. Winner VFX. Shell + Start button. Shippable v1. |

Estimated total v1 build: 3 sprints (~6 weeks) at Sprint 3 velocity. This is a
projection, not a commitment — Sprint 4's result on the Renderer may force scope
adjustments.

---

## Circular Dependencies

None detected. The DAG is clean, with the Preact App Shell as the single
consumer of most other systems.

One near-miss worth noting: **Animation State Switcher** reads from both the
Renderer (to drive bones) and the Sim Engine Core (to know which state to
transition to). This is a bridge, not a cycle — it's a one-way consumer of both.
If it ever tried to push state back into the sim (e.g., "death animation finished,
confirm elimination"), we'd have a cycle. Prevention: animation state is a pure
consequence of sim state; the sim is the single source of truth for what a robot
is doing.

---

## High-Risk Systems

| System | Risk Type | Risk Description | Mitigation |
|--------|-----------|-----------------|------------|
| **85-Instance Skinned Mesh Renderer** | Technical | Three.js has no native `InstancedSkinnedMesh`. 85 independently-animated skinned meshes may not hit 60fps with full skeleton updates every frame. If this fails, the whole project is unshippable at the current scope. | **Pulled forward to design order position 4.** Build a standalone prototype early in Sprint 4 against fake position data. If performance is unworkable, scope fallbacks in order: (a) reduce to 40 robots, (b) skip skeleton updates for off-screen robots, (c) bake animations to texture (VAT), (d) drop to non-skinned instanced meshes with rigid poses. |
| **Sim Engine Core** | Technical | Determinism requires every stochastic decision to route through the seeded PRNG. A single accidental `Math.random()` call breaks reproducibility, which matters less in v1 (no replay) but will matter when persistence returns in v1.1. Fixed-timestep vs. `requestAnimationFrame` drift is subtle. | Lint rule or code review checklist forbidding `Math.random`. Fixed internal 60Hz timestep, independent of render frame rate. Write determinism tests (same seed → same event outcome) from the start, even if we don't use replay files yet. |
| **Config Module** | Design | Bottleneck: everyone depends on it. If the shape is wrong, everyone refactors. | Spend 30–60 min in Sprint 4 actually thinking about the config shape (nested by subsystem? flat? TypeScript interface?) before writing it. Make it read-only at runtime. |
| **Camera System: Follow ID** | Design | "Follow my robot even when it's off a cliff" is a great viewer-loyalty feature but has edge cases: robot is eliminated before user enters the ID, robot ID doesn't exist (invalid input), robot despawns off the world. | Design doc explicitly enumerates these. Fallback: if the tracked robot disappears or is invalid, camera gracefully transitions to Follow Leader with a small on-screen message. |

---

## Progress Tracker

| Metric | Count |
|--------|-------|
| Total systems identified (v1) | 13 |
| Deferred systems (v1.1+) | 14 |
| Design docs started | 3 |
| Design docs reviewed | 3 |
| Design docs approved | 3 |
| MVP systems designed | 3 / 13 |

---

## Deferred Roadmap (v1.1 → v2)

Ordered by expected re-entry. Each deferred system has a **trigger** — the
condition under which it should re-enter the backlog.

| Tier | System | Re-entry Trigger |
|------|--------|------------------|
| v1.1 | Replay Pipeline (writer + Storage client, combined) | Want to share winning runs or rewatch events |
| v1.1 | Database Schema — `robots` + basic `events` table | Want any persistence of event results |
| v1.1 | Maze Run event module + Maze Arena JSON | Need second event type for viewer variety |
| v1.1 | Arena Editor Tool | Once 2–3 arenas have been hand-authored and the schema is stable |
| v1.2 | Obstacle Gauntlet event module + Gauntlet Arena JSON | Third event type, completes the v1 spec's variety claim |
| v1.2 | Leaderboard + ELO + `/leaderboard` page | Enough events in the system to produce meaningful rankings |
| v1.2 | `/robot/:id` profile page + trait radar chart | Leaderboard creates demand for per-robot detail views |
| v1.2 | Event Lifecycle State Machine + Countdown Timer | Multiple events per rotation + scheduled showtime are meaningful |
| v1.3 | Boost System (modal + DB constraint + sim effect + realtime subscription) | Community engagement hook after core is proven |
| v1.3 | `/archive` page | Replay pipeline exists, enough archive content to browse |
| v2 | Scheduled jobs (`schedule_event`, `run_simulation`, `go_live`, `finalize_event`) | Manual operation becomes tedious or risks missing showtimes |
| v2 | X Integration (automated announcement + winner tweets) | Engagement data justifies the API cost and ongoing maintenance |
| v2 | Victory animation | Art budget available; existing VFX-only treatment feels insufficient |
| v2+ | Additional event types beyond the v1 three | Community demand for fresh content |

Systems permanently out of scope (spec: "Explicitly NOT in v1"): wallet connect,
NFT ownership verification, team events, Altruist-dependent mechanics, real-time
viewer input during playback, betting / prediction markets.

---

## Next Steps

- [ ] Review and approve this systems enumeration
- [ ] Plan Sprint 4 against the first 5 systems (`/sprint-plan new`)
- [ ] Archive runner source code from `src/` to `archive/endless-runner/`
- [ ] Scaffold new `src/` structure for the sim project (Preact + TypeScript + Three.js)
- [ ] Design Config Module (use `/design-system "Config Module"` — first in the design order)
- [ ] Prototype the 85-Instance Skinned Mesh Renderer early in Sprint 4 to de-risk the technical bet
- [ ] Run `/design-review` on each completed GDD
- [ ] Run `/gate-check pre-production` once Sprint 4 systems are designed and the Renderer prototype proves out
