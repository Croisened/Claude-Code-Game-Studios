# Technical Preferences

<!-- Updated 2026-04-24 for Robo Rhapsody Sim (Three.js + Preact passive-watch simulator) -->
<!-- All agents reference this file for project-specific standards and conventions. -->

## Engine & Language

- **Engine**: Three.js r168+ (web 3D rendering — scene graph, materials, animation)
- **UI Framework**: Preact 10.22+ via `@preact/preset-vite` (single-page app shell, hash routing)
- **Language**: TypeScript (strict mode, `"strict": true` in tsconfig)
- **Rendering**: Three.js WebGL renderer — desktop web, Chrome/Firefox/Safari latest
- **Physics**: None. v1 robots are kinematic, position-driven by the sim.

> **Pivot history**: Sprints 1–3 used `enable3d` + Rapier 3D for an endless-runner
> prototype. After the pivot to Robo Rhapsody Sim, physics was removed; the runner
> code lives at `archive/endless-runner/` for reference.

## Naming Conventions

- **Functions / Factories**: camelCase — `createRenderer`, `createAnimationStateSwitcher`, `createRng`
- **Variables / Methods**: camelCase — `setState`, `getInstance`, `dispose`
- **Events / Action names**: camelCase string constants when needed — `'cycleAdvance'`, `'mountReady'`
- **Files**: kebab-case — `state-switcher.ts`, `asset-loader.ts`, `renderer.test.ts`
- **Config objects**: SCREAMING_SNAKE_CASE for module-level constants — `CYCLE_ORDER`, `MAX_DT`, `INTERNAL_CAMERA_FOV`
- **Type aliases / Interfaces**: PascalCase — `Renderer`, `RobotInstance`, `RobotAnimationState`, `AnimationStateSwitcher`
- **Project-wide config**: `CONFIG.<subsystem>.<key>` — read-only at runtime, declared in `src/config/index.ts`
- **Scenes/Prefabs**: N/A — Three.js scene graph managed in code, no scene files

## Performance Budgets

- **Target Framerate**: 60fps sustained on mid-range desktop hardware (2020+ integrated GPU)
- **Frame Budget**: ~16.7ms total
  - Sim tick (Sprint 5+): < 2ms
  - Renderer mixer updates (85 instances): < 3ms
  - Three.js render + draw calls: < 10ms
  - Headroom / misc: ~1.7ms
- **Draw Calls**: ~86 baseline (85 robots + 1 ground plane). Per-instance materials
  forbid further automatic batching; this is acceptable for v1 per the renderer GDD.
- **Memory Ceiling**: < 200MB JS heap. Currently ~50MB at idle, ~70MB during run cycles.

## Testing

- **Framework**: Vitest (TypeScript-native, fast, Node test environment)
- **Minimum Coverage**: All systems with formulas, state machines, or public APIs
- **Required Tests**:
  - All tuning formula calculations (sim trait→stat curves, when authored Sprint 5+)
  - State machines: all valid and invalid transitions (e.g., AnimationStateSwitcher
    covers every run/idle/death pair)
  - Public API contracts: input validation, error paths, idempotent dispose
  - Determinism: same seed produces same RNG sequence (PRNG)
- **Test seams**: Modules that depend on a real WebGL context, DOM, or `requestAnimationFrame`
  expose injectable factories (e.g., `webGLRendererFactory`, `loadAssets`, `raf`)
  so tests run headlessly in Node. See `src/renderer/renderer.ts` for the canonical
  pattern.

## Forbidden Patterns

- **Magic numbers in user-facing code** — all configurable values must live in
  `CONFIG.<subsystem>.<key>` (Config Module GDD). Implementation-detail constants
  that are NOT tuning surfaces (e.g., `MAX_DT`, `PHASE_OFFSET_COEFF`) live in module
  scope as named constants and are documented in their owning GDD §7.
- **`Math.random()` anywhere in `src/`** — use the seeded RNG (`createRng` from
  `@/sim/rng`). Determinism matters when sim replay returns in v1.1+.
- **`AnimationAction.play()` outside the Animation State Switcher** — the switcher
  is the sole owner of `play()` and `crossFadeTo()` calls codebase-wide. Renderer
  builds mixers + clipAction refs only.
- **Direct mutation of `RobotInstance.root.position`/`rotation` from non-sim code** —
  the [Sim ↔ Renderer Bridge](../../design/gdd/sim-driver.md) (`src/sim/sim-renderer-bridge.ts`)
  is the sole writer of per-tick instance pose. It reads from a `SimDriver`
  (which replays a deterministic `SimResult` from the engine) and writes to
  `RobotInstance.root.position` / `rotation.y`. Camera and VFX systems read
  positions but do not write them.
- **Mounting the renderer twice on the same instance** — call sites must dispose
  and create a fresh `createRenderer()` for re-mount.

## Allowed Libraries / Addons

| Library | Version | Purpose |
|---------|---------|---------|
| `three` | r168+ | 3D rendering, scene graph, camera, geometry, animation |
| `preact` | ^10.22.0 | UI framework — App shell, Landing, hash routing |
| `@preact/preset-vite` | ^2.8.2 | Vite plugin for Preact JSX + HMR |
| `vite` | ^5.2.0 | Build tool, dev server, HMR |
| `vite-plugin-static-copy` | ^1.0.6 | Copy `assets/` into the production build |
| `vitest` | ^1.6.0 | Test runner |
| `tsx` | ^4.21.0 | TS execution for build scripts (e.g., CSV→JSON transform) |
| `jsdom` | ^29.0.1 | Optional DOM mock for tests that need it (most use Node + injectable seams) |

## Architecture Decisions Log

| ADR | Decision | Date | Status |
|-----|----------|------|--------|
| [ADR-001](../../../docs/architecture/ADR-001-web-runner-architecture.md) | Three.js + enable3d for the endless-runner prototype | 2026-03-27 | Superseded — runner archived after pivot |
| [ADR-002](../../../docs/architecture/ADR-002-web3-library.md) | Web3 library selection for the runner's wallet integration | 2026-03-27 | Superseded — Web3 dropped from v1 scope |
