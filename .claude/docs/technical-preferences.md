# Technical Preferences

<!-- Updated 2026-03-27 for Robo Rhapsody — Neon Fugitive (Three.js web runner) -->
<!-- All agents reference this file for project-specific standards and conventions. -->

## Engine & Language

- **Engine**: Three.js r168+ + enable3d 2.x (Rapier physics integration + game loop)
- **Language**: TypeScript (strict mode, `"strict": true` in tsconfig)
- **Rendering**: Three.js WebGL renderer — desktop web, Chrome/Firefox/Safari latest
- **Physics**: Rapier 3D via enable3d (`@dimforge/rapier3d-compat`)

## Naming Conventions

- **Classes**: PascalCase — `RunnerSystem`, `ObstacleSystem`, `GameStateManager`
- **Variables / Functions**: camelCase — `currentSpeed`, `spawnInterval`, `trySpawn()`
- **Events / Actions**: camelCase string constants — `'stateChanged'`, `'collisionDetected'`, `'action'`
- **Files**: kebab-case — `runner-system.ts`, `obstacle-system.ts`, `game-state-manager.ts`
- **Config objects**: SCREAMING_SNAKE_CASE — `RUNNER_SYSTEM_CONFIG`, `OBSTACLE_TYPE_REGISTRY`
- **Game constants**: SCREAMING_SNAKE_CASE — `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT`, `OBSTACLE_GROUP`
- **Scenes/Prefabs**: N/A — Three.js scene graph managed in code, no scene files

## Performance Budgets

- **Target Framerate**: 60fps on mid-range desktop hardware (2020+ integrated GPU)
- **Frame Budget**: ~16.7ms total
  - Game logic (all systems): < 1ms
  - Rapier physics step: < 2ms
  - Three.js render + draw calls: < 10ms
  - Headroom / misc: ~3.7ms
- **Draw Calls**: < 50 per frame (use instanced geometry for repeated obstacle meshes)
- **Memory Ceiling**: < 200MB JS heap during an active run

## Testing

- **Framework**: Vitest (TypeScript-native, fast, browser-compatible mocks)
- **Minimum Coverage**: All systems with formulas or state machines
- **Required Tests**:
  - All tuning formula calculations (jump arc, speed ramp, hitbox clearance)
  - GSM state machine: all valid and invalid transitions
  - Collision group assignments (OBSTACLE_GROUP filter)
  - Input System: enable/disable idempotency, key repeat suppression

## Forbidden Patterns

- **Magic numbers in gameplay code** — all configurable values must live in named
  config objects (`RUNNER_SYSTEM_CONFIG`, `OBSTACLE_SYSTEM_CONFIG`, etc.)
- **Non-Runner callers of `ER.setScrollSpeed()`** — Runner System is the sole caller
  per the Environment Renderer GDD contract
- **Difficulty Curve calling `ER.setScrollSpeed()` directly** — must go through
  `RS.setSpeed()` (Runner System propagates to ER)
- **Dynamic obstacle allocation during a run** — obstacle pool is pre-allocated at
  startup; no `new` calls for obstacle objects inside the game loop
- **Direct Three.js `position.x` writes for physics-owned objects** — set Rapier body
  translation via `setTranslation()` or `setNextKinematicTranslation()`; let enable3d
  sync to the Three.js object

## Allowed Libraries / Addons

| Library | Version | Purpose |
|---------|---------|---------|
| `three` | r168+ | 3D rendering, scene graph, camera, geometry |
| `enable3d` | 2.x | Rapier physics integration, game loop, input helpers |
| `@dimforge/rapier3d-compat` | bundled via enable3d | Physics engine (Rapier 3D WASM) |
| `vite` | latest | Build tool, dev server, HMR |
| Web3 library | TBD (pending spike) | Wallet connection + NFT ownership query |

> Web3 library decision (ethers.js vs. viem vs. wagmi) is deferred to a 2-hour
> technical spike at the start of Week 2 (v1 scope). Do not add any Web3 library
> until the spike concludes.

## Architecture Decisions Log

| ADR | Decision | Date |
|-----|----------|------|
| [ADR-001](../../../docs/architecture/ADR-001-web-runner-architecture.md) | Three.js + enable3d for web runner rendering and physics | 2026-03-27 |
