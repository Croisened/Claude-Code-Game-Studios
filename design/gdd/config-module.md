# Config Module — Game Design Document

> **Status**: Draft Complete (Sections 1–8 written, ready for review)
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S4-01
> **System Index**: design/gdd/systems-index.md (#1)

---

## 1. Overview

The Config Module is the single source of truth for all tunable values in the
Robo Rhapsody Sim. Every coefficient, threshold, asset path, and tuning knob
that any other system reads — sim coefficients, arena constants, camera
presets, render budgets, animation timings — lives here. No other system is
permitted to hardcode these values; they MUST be imported from `CONFIG`.

Shape: a single nested-by-subsystem object exported as `CONFIG`, marked
`as const` so TypeScript narrows literal types and enforces read-only access.
Subsystems each own a top-level key (`CONFIG.sim`, `CONFIG.renderer`,
`CONFIG.arena`, `CONFIG.camera`, `CONFIG.build`, etc.). Adding a new subsystem
is an additive change with zero coupling to other subsystems.

Why it goes first in the design order: every other system depends on Config in
some form (Trait → Stat needs coefficients, Sim Engine needs PRNG seed
defaults, Arena Loader needs asset paths, Camera needs presets). Settling the
shape and idioms in Sprint 4 prevents every downstream system from refactoring
when Config inevitably grows.

---

## 2. Developer Experience Goals

*(adapted from "Player Fantasy" — this is an infrastructure system; the
"player" here is the developer iterating on values.)*

When a developer needs to change a tuning value — the magnitude of the boost
stat nudge, the camera follow distance, the cull-stage thresholds for the
Sprint Race — the workflow should be: open `CONFIG`, find the relevant
subsystem, change one number, save, see the result. No hunting through
gameplay code for hardcoded constants. No coordinating mutations across
modules. No risk of a stale value reaching production because two files held
the same magic number out of sync.

Concretely, the system should produce these felt experiences:

- **Discoverability.** Every tunable lives under a predictable path (e.g.,
  `CONFIG.camera.followDistance`, `CONFIG.sim.tickRateHz`). A developer
  scanning the file finds what they need in seconds.
- **Type safety.** TypeScript narrows literal types via `as const`. Typos in
  subsystem keys are compile errors. Numeric constants retain their exact
  literal type where useful.
- **Read-only at runtime.** No system can mutate a config value mid-run. If a
  value needs to change at runtime, it's not config — it's state.
- **No magic numbers anywhere else.** A `grep` for hardcoded thresholds in
  `src/` (excluding `src/config/`) returns nothing meaningful. This is
  enforced by code review until a lint rule exists.
- **Cheap to extend.** Adding a new subsystem is an additive merge — no other
  subsystems are touched. Removing one breaks only its own consumers.
- **Self-documenting.** Each value has a short comment explaining what it
  does and (where applicable) the safe range. The config file reads like a
  tuning manual.

---

## 3. Detailed Rules

**File location.** All config lives at `src/config/index.ts`. As subsystems grow,
values may be split into per-subsystem files (`src/config/sim.config.ts`,
`src/config/renderer.config.ts`, etc.) re-composed in `index.ts`. v1 starts
single-file; the split is a refactor, not a redesign.

**Export shape.**

```ts
export const CONFIG = {
  sim: { ... },
  renderer: { ... },
  arena: { ... },
  camera: { ... },
  build: { ... },
} as const;

export type Config = typeof CONFIG;
```

The `as const` is mandatory — it narrows literal types and makes every nested
property `readonly` at the type level.

**Allowed value types.**
- Numbers, strings, booleans
- Nested plain objects of the above
- Arrays of primitives or plain objects
- Tuple literals (typed as `readonly [...]` via `as const`)

**Disallowed value types.**
- Functions (derived values are computed at use site, not in config)
- Class instances, Maps, Sets
- `Date` objects (store ISO strings if needed)
- Cross-module imports at value sites (config is a leaf in the dependency graph)

**Naming conventions.**
- Top-level keys = subsystem names, lowercase (`sim`, not `Sim` or `SIM_CONFIG`)
- Nested keys = camelCase
- Numeric values include units in the key suffix where meaningful: `tickRateHz`,
  `followDistanceMeters`, `crossfadeDurationMs`. Bare `speed: 5` is rejected in
  review; use `maxSpeedMps: 5`.

**Documentation.** Every value gets a JSDoc comment with purpose and safe range:

```ts
/** Hz. Internal sim tick rate; 60 default, 30–120 valid. Higher = smoother, more CPU. */
tickRateHz: 60,
```

**Import idiom.** Always `import { CONFIG } from '@/config';`. Never destructure
at import time (`import { CONFIG: { sim } }` is forbidden) — the full path
improves grep-ability and consistency across the codebase.

**What is NOT config.**
- Runtime state (robot positions, current scores, elimination status)
- Per-session derived values (computed stats, leader pointer)
- Secrets, API keys, environment variables (those go in `.env`, read via
  `import.meta.env.*`, never imported through `CONFIG`)
- Asset binaries (config holds *paths to* assets, never the bytes)

**Mutation.** Direct mutation is a TypeScript error because of `as const`.
Runtime mutation attempts (e.g., `(CONFIG as any).sim.tickRateHz = 30`) are
forbidden by code review. If a value needs to change at runtime, it's state —
not config.

---

## 4. Data Shape / Schema

*(adapted from "Formulas" — config has a TypeScript schema, not gameplay math.)*

**Top-level subsystems** (v1 set, ordered by appearance in the build order):

| Key | Purpose | First appears in |
|-----|---------|------------------|
| `sim` | Sim engine tunables (tick rate, default seed) | S4-01 |
| `renderer` | Three.js rendering tunables (robot count, asset paths, frustum cull) | S4-04 |
| `animation` | AnimationMixer crossfade timings, valid state names | S4-05 |
| `arena` | Arena geometry constants (gate positions, lane width) | Sprint 5 |
| `camera` | Per-mode camera presets (Follow Leader / Fixed / Follow ID) | Sprint 6 |
| `build` | Build artifact paths (trait JSON, asset URLs) | S4-03 |

**Per-subsystem schema rules:**

- **`sim`** — physics-style scalars (Hz, seconds, dimensionless coefficients).
  Trait→stat coefficients live here in Sprint 5.
- **`renderer`** — counts, asset paths, render-budget thresholds (target FPS,
  max draw calls).
- **`animation`** — durations in seconds, state name string-literal unions,
  blend curves.
- **`arena`** — geometric constants, lane counts, gate t-values, finish-line
  offsets. Per-arena-instance data lives in JSON arena files, NOT here.
- **`camera`** — distances, FOV, transition timings, preset positions for
  fixed cameras.
- **`build`** — paths only. No build flags or env vars (those go in
  `import.meta.env`).

**v1 starter shape** (the concrete config as it should exist when S4-01 is
committed):

```ts
export const CONFIG = {
  sim: {
    /** Hz. Internal sim tick rate. Higher = smoother, more CPU. Range 30–120. */
    tickRateHz: 60,
    /** Default RNG seed for ad-hoc dev runs. Production sims pass an explicit seed. */
    defaultSeed: 1,
  },

  renderer: {
    /** Total robot instances rendered each event. Spec calls for 85; lower
     *  as performance fallback. Range 10–85. */
    robotCount: 85,
    /** Path to the rigged robot GLB. */
    robotGlbPath: 'assets/art/characters/robot/robot_run.glb',
    /** Filename pattern for per-robot skin textures; `{id}` substitutes 0–84. */
    skinTexturePathPattern: 'assets/art/characters/robot/skins/{id}.png',
    /** When true, skip skeleton updates for robots outside the camera frustum.
     *  Performance fallback if 85-instance rendering can't sustain 60fps. */
    frustumCullSkeletons: false,
    /** Target render frame rate, used for diagnostics. */
    targetFps: 60,
  },

  animation: {
    /** Seconds. Crossfade duration between animation states. Range 0.05–1.0. */
    crossfadeSeconds: 0.2,
    /** State played by default for living robots in motion. */
    defaultState: 'run',
    /** Animation states recognised in v1. */
    validStates: ['run', 'idle', 'death'],
  },

  arena: {
    // Subsystem reserved — populated in Sprint 5 with Arena Loader.
  },

  camera: {
    // Subsystem reserved — populated in Sprint 6 with Camera System.
  },

  build: {
    /** Built-time trait JSON, generated from design/data/robots-traits.csv. */
    traitsJsonPath: '/traits.json',
  },
} as const;

export type Config = typeof CONFIG;
```

Empty subsystem objects (`arena`, `camera`) are intentional — they reserve
the namespace and signal where future values land, without being load-bearing
yet.

**Type assertions.** Where literal types matter for downstream type-narrowing
(e.g., a state name union), `as const` already promotes literal unions; no
additional `as` is needed. If a value needs a wider type than its literal,
use a TypeScript-level cast at the consumer, not in config.

---

## 5. Edge Cases

1. **Typo in subsystem key.** `CONFIG.sims.tickRateHz` — TypeScript compile
   error. No runtime undefined. `tsc --noEmit` in CI catches before merge.

2. **Mutation attempt at runtime.** `CONFIG.sim.tickRateHz = 30` is a
   TypeScript error (Cannot assign to read-only property). Bypassing via
   `(CONFIG as any).sim.tickRateHz = 30` would compile but is forbidden by
   code review. If discovered in a PR: reject and require the value to move
   to runtime state instead.

3. **Test needs non-default values.** Tests do NOT mutate `CONFIG`. Instead,
   the system under test takes its config as a parameter (dependency
   injection):

   ```ts
   // GOOD
   function createSimEngine(cfg: Config['sim'] = CONFIG.sim) { ... }

   // BAD
   (CONFIG as any).sim.tickRateHz = 30;  // never
   ```

   This makes tests portable and removes hidden global state.

4. **HMR reload during dev.** Vite reloads modules on file change; consumers
   of `CONFIG` re-import the new module instance. If a system caches a config
   value in a closure or class field, the cached value goes stale on HMR.
   Mitigation: read from `CONFIG` at use-site, not at module-load time, when
   the value will be tuned during dev.

5. **Per-environment values (dev vs prod).** Out of scope for `CONFIG`. Use
   `import.meta.env.DEV` / `import.meta.env.PROD` at the consumer. `CONFIG`
   is constant across all builds; behavior that differs by environment is a
   runtime concern.

6. **Async config loading.** Forbidden. `CONFIG` is always synchronously
   imported. If a value can only be known at runtime (server-fetched,
   user-set, URL-parameter-driven), it's state — not config. State systems
   read `CONFIG` for defaults; they do not write to it.

7. **Renaming or restructuring a config value.** An atomic refactor: update
   `CONFIG`, update all consumers, run `tsc --noEmit`, commit in one change.
   Never split across two PRs.

8. **Magic number leaks into gameplay code.** Code review's responsibility.
   Reviewers grep for hardcoded numerics in `src/` (excluding `src/config/`)
   on PRs touching gameplay code. v1.1 work item: add an ESLint rule
   (`no-magic-numbers` with `enforceConst: true` and a strict ignore list).

9. **Subsystem grows past single-file readability.** Refactor to
   per-subsystem files (`src/config/sim.config.ts` etc.) and re-compose in
   `src/config/index.ts`. This is a one-shot refactor with no external API
   change — consumers still import `CONFIG` from the same path.

---

## 6. Dependencies

**Upstream dependencies (Config depends on):** None. The Config Module is a
leaf in the dependency graph. It does not import anything from `src/` and
does not depend on Three.js, Preact, or any third-party runtime library. The
only imports allowed inside `src/config/` are TypeScript type imports.

**Downstream dependents (systems that depend on Config):** Every other
system in the project, directly or transitively. v1 systems that read
`CONFIG`:

| System | Reads from | First read appears in |
|--------|------------|------------------------|
| Seedable PRNG | `CONFIG.sim.defaultSeed` | S4-02 |
| Build / Deploy Pipeline | `CONFIG.build.traitsJsonPath` | S4-03 |
| 85-Instance Skinned Mesh Renderer | `CONFIG.renderer.*` | S4-04 |
| Animation State Switcher | `CONFIG.animation.*` | S4-05 |
| Trait → Stat Derivation | `CONFIG.sim.*` (Sprint 5 coefficients) | Sprint 5 |
| Robot Roster Loader | `CONFIG.build.traitsJsonPath`, `CONFIG.renderer.skinTexturePathPattern` | Sprint 5 |
| Arena Loader | `CONFIG.arena.*` | Sprint 5 |
| Sim Engine Core | `CONFIG.sim.*` | Sprint 5 |
| Sprint Race Event Module | `CONFIG.sim.*`, `CONFIG.arena.*` | Sprint 6 |
| Camera System | `CONFIG.camera.*` | Sprint 6 |
| Winner VFX | `CONFIG.renderer.*` | Sprint 6 |
| Preact App Shell | `CONFIG.renderer.targetFps`, etc. | Sprint 6 |

Per `design-docs.md` rule, each downstream system's GDD must list Config
Module in its own Dependencies section when authored.

**Integration contract:**

- Single canonical import: `import { CONFIG } from '@/config';`
- Optional type import: `import type { Config } from '@/config';`
- All consumers receive `readonly` types via `as const`. Mutating any
  returned value is a TypeScript error.

**Forbidden dependencies:**

- Config does not depend on any runtime state. There is no "current config"
  that varies by session.
- Config does not depend on `import.meta.env`. Environment-derived values
  are read directly at consumers, not piped through `CONFIG`.
- Config does not depend on the file system, network, or any async loading.
  The value is fully resolved at module-load time.

---

## 7. Tuning Knobs

Every value in the v1 starter shape is a tuning knob. Below is a reference
of what each one affects and its safe range. Values not listed here are
paths or structural keys, not tuning targets.

| Path | Default | Safe Range | Affects | Notes |
|------|---------|------------|---------|-------|
| `sim.tickRateHz` | 60 | 30–120 | Sim simulation smoothness vs. CPU cost | Higher = smoother sim, more CPU. Decoupled from render frame rate. |
| `sim.defaultSeed` | 1 | any int32 | RNG starting point for ad-hoc dev runs | Production sims must pass an explicit seed. Default is for "click Start, see something happen" dev workflow. |
| `renderer.robotCount` | 85 | 10–85 | Number of robots rendered per event | Performance fallback. Keep at 85 unless S4-04 prototype fails the 60fps target. |
| `renderer.frustumCullSkeletons` | `false` | boolean | Skips skeleton updates for off-screen robots | Set `true` as a performance fallback if 85 in-frustum animations can't sustain 60fps. |
| `renderer.targetFps` | 60 | 30 or 60 | Diagnostic threshold for FPS warnings | Informational; does not change render behavior. Used by perf overlays. |
| `animation.crossfadeSeconds` | 0.2 | 0.05–1.0 | Smoothness of animation-state transitions | Lower = snappier (good for sudden death), higher = more cinematic. 0.2 reads as "responsive but soft." |
| `animation.defaultState` | `'run'` | one of `validStates` | What animation living robots play during motion | Only change if the rig gains a new motion state. |
| `animation.validStates` | `['run','idle','death']` | string[] of rig animation names | Recognized animation states | Expanding requires Animation State Switcher GDD update. |

**Path values** (not tuning knobs, but listed for completeness):

| Path | Default | Notes |
|------|---------|-------|
| `renderer.robotGlbPath` | `'assets/art/characters/robot/robot_run.glb'` | Path to rigged robot model |
| `renderer.skinTexturePathPattern` | `'assets/art/characters/robot/skins/{id}.png'` | `{id}` is replaced 0–84 at load time |
| `build.traitsJsonPath` | `'/traits.json'` | Set by build pipeline (S4-03); rarely changed |

**Subsystems with no tuning knobs in v1 Sprint 4:**

- `arena` — placeholder, populated Sprint 5
- `camera` — placeholder, populated Sprint 6

**Tuning workflow.** Edit the value in `src/config/index.ts`, save. In
`npm run dev`, Vite HMR reloads the affected modules. Verify visually or
via tests, then commit. For tuning sessions on the renderer specifically,
the dev server reloads the canvas — expect a brief black frame.

---

## 8. Acceptance Criteria

**Direct criteria** (testable on S4-01 commit):

1. **File exists.** `src/config/index.ts` is present and committed.

2. **Exports correct.** `import { CONFIG } from '@/config'` and
   `import type { Config } from '@/config'` both resolve. `CONFIG` is a
   runtime value; `Config` is a type alias of `typeof CONFIG`.

3. **Shape matches v1 starter.** `CONFIG` has exactly these top-level keys:
   `sim`, `renderer`, `animation`, `arena`, `camera`, `build`. Verified by
   unit test:

   ```ts
   expect(Object.keys(CONFIG).sort()).toEqual(
     ['animation', 'arena', 'build', 'camera', 'renderer', 'sim']
   );
   ```

4. **Starter values exact.** Unit test asserts each v1 default:

   ```ts
   expect(CONFIG.sim.tickRateHz).toBe(60);
   expect(CONFIG.sim.defaultSeed).toBe(1);
   expect(CONFIG.renderer.robotCount).toBe(85);
   expect(CONFIG.renderer.targetFps).toBe(60);
   expect(CONFIG.renderer.frustumCullSkeletons).toBe(false);
   expect(CONFIG.animation.crossfadeSeconds).toBe(0.2);
   expect(CONFIG.animation.defaultState).toBe('run');
   expect(CONFIG.animation.validStates).toEqual(['run', 'idle', 'death']);
   expect(CONFIG.build.traitsJsonPath).toBe('/traits.json');
   ```

5. **`as const` applied.** Compile-time mutation rejection. Verified
   informally by attempting `CONFIG.sim.tickRateHz = 99` in a scratch file
   and confirming `tsc --noEmit` errors. (Not a permanent test — would fail
   compilation.)

6. **JSDoc on every leaf value.** Manual review. Reviewer scans the file
   and confirms every numeric, string, or array value has a `/** ... */`
   comment above it.

7. **No `src/` imports from inside `src/config/`.** Grep verifies:
   `grep -rE "^import.*from ['\"](\.|@/)" src/config/` returns zero matches
   excluding type-only imports.

8. **Typecheck green.** `npm run typecheck` exits 0.

9. **Test green.** `npm test` exits 0 with the new config test passing.

**Discipline criteria** (enforced per PR going forward, not testable on
S4-01 alone):

10. **No magic numbers in downstream systems.** PRs implementing S4-02
    (PRNG), S4-03 (Build), S4-04 (Renderer), S4-05 (Animation State
    Switcher) contain no hardcoded numerics that should live in `CONFIG`.
    Reviewer greps the diff for naked numerics in gameplay/render code.

11. **Each downstream GDD declares dependency on Config.** Per
    `design-docs.md` bidirectionality rule, every system GDD that reads
    `CONFIG` lists Config Module in its own Dependencies section.
