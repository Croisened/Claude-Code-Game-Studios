# ADR-001: Web Runner Architecture — Three.js + enable3d + Rapier

> **Status**: Accepted
> **Date**: 2026-03-27
> **Authors**: Nathanial Ryan + Claude Code

---

## Context

Robo Rhapsody — Neon Fugitive is a 3-lane endless runner targeting desktop web
browsers (Chrome/Firefox/Safari latest). The game requires:

- 3D rendering with a neon cyberpunk aesthetic
- Physics-based jump arc and collision detection
- Smooth 60fps performance on mid-range 2020+ integrated GPUs
- Web3 wallet integration (browser-native)
- A two-week build timeline (solo developer)

An engine and physics stack must be chosen before prototyping begins.

---

## Decision

**Use Three.js r168+ with enable3d 2.x (Rapier physics integration and game loop).**

- Three.js handles all 3D rendering: scene graph, camera, geometry, materials, GLB model loading.
- enable3d wraps Rapier 3D (`@dimforge/rapier3d-compat`) and provides the physics world,
  rigid body management, and per-frame sync between Rapier body transforms and Three.js
  Object3D positions.
- Vite is the build tool and dev server.
- TypeScript in strict mode is the primary language.

---

## Alternatives Considered

### Option A: Babylon.js

**Pros**: Full-featured built-in physics (Havok or Ammo.js), built-in GLTF loader,
active community, excellent TypeScript support.

**Cons**: Larger bundle than Three.js. Less community-standardized for minimal runners.
Developer (Nathanial) is building on existing Three.js familiarity from the Robo Rhapsody
NFT art pipeline. Switching to Babylon.js introduces a new API at the same time as
learning 3D game development — doubles the ramp.

**Rejected**: Developer familiarity advantage and bundle size favor Three.js.

### Option B: Godot 4 HTML5 Export

**Pros**: Full game engine with built-in physics, animation, scene system, and input
handling. Proven for browser games via Godot Web export.

**Cons**: Godot Web export bundles Emscripten WASM — initial load 5–10MB+ for a simple
runner. No native Web3 integration — requires JavaScript bridge hacks. Godot 4.6 post-
dates LLM training data, increasing risk of hallucinated API calls. Two-week discipline
makes the engine's full scope overkill for an 8-system MVP.

**Rejected**: Bundle size, Web3 friction, and two-week scope constraint.

### Option C: Unity WebGL

**Pros**: Mature engine, large ecosystem, Unity WebGL export is stable.

**Cons**: WebGL build sizes routinely exceed 20MB even for minimal games. Unity WebGL
requires WebAssembly WASM runtime. No native Web3 — requires JS plugin bridge. License
cost. Significantly heavier than required for an endless runner.

**Rejected**: Bundle size and complexity for a web-first, two-week project.

---

## Architecture Consequences

### World Model: World Scrolls, Robot Fixed

The runner uses a "world-scroll" model rather than a "player moves forward" model:

- The robot is fixed at `Z = 0` in world space at all times.
- The Environment Renderer scrolls the world geometry in the +Z direction each frame
  via `scrollSpeed` applied to chunk positions.
- Obstacles move in the +Z direction each frame at `RS.currentSpeed`.
- The camera is fixed relative to the robot's X position (lane), not the world Z.

**Consequence**: There is no "forward position" for the robot — distance is tracked
by the Score & Distance Tracker accumulating `scrollSpeed × delta` each tick. Obstacle
spawn distance is a fixed Z offset (e.g., `spawnZ = -30`) that is always ahead of the
robot.

### Physics Ownership: Rapier Owns Position for Physics Bodies

enable3d syncs Rapier rigid body transforms to Three.js Object3D transforms each frame.

**Rule**: For any Object3D that has a Rapier body attached, position must be set via
Rapier API, never via direct `object.position.set()`:
- Robot lane changes: `rapierBody.setTranslation()` or `setNextKinematicTranslation()`
- Obstacle movement: `rapierBody.setNextKinematicTranslation()`
- Direct `position.x` writes will be overridden by the Rapier sync on the next frame.

**Consequence**: Coded as a Forbidden Pattern in `technical-preferences.md`.

### Collision Detection: OBSTACLE_GROUP Filter

Rapier collision groups are used to distinguish collision types:

- `OBSTACLE_GROUP`: obstacles and robot collider are members; ground is excluded.
- Collision callback fires only when robot collider intersects an `OBSTACLE_GROUP` member.
- Avoids spurious "ground contact = death" events during the jump arc.

### Obstacle Lifecycle: Object Pool, No Runtime Allocation

To satisfy the `< 50 draw calls` and `< 200MB heap` budgets, obstacles are pre-allocated
at startup (6 objects: 3 Barrier + 3 Drone) and recycled. No `new` calls for obstacle
objects inside the game loop.

**Consequence**: Coded as a Forbidden Pattern in `technical-preferences.md`.

### Environment Renderer Scroll Speed Ownership

`ER.setScrollSpeed()` is called exclusively by the Runner System. The Difficulty Curve
system routes speed changes through `RS.setSpeed()`, which propagates to the ER.
No other system calls `ER.setScrollSpeed()` directly.

**Consequence**: Coded as a Forbidden Pattern in `technical-preferences.md`.

---

## Trade-offs Accepted

| Trade-off | Decision | Rationale |
|-----------|----------|-----------|
| No engine editor | Hand-coded scene graph | Three.js has no editor; all geometry is code. Acceptable for an 8-system MVP. |
| Manual physics setup | enable3d wrapper | enable3d reduces Rapier boilerplate significantly; acceptable abstraction for this scope. |
| No built-in audio | Web Audio API or Howler.js | Audio System is v1 (not MVP); deferred. |
| WASM load time | ~200–400ms Rapier WASM init | Acceptable for desktop web; add loading screen in v1. |
| No mobile touch | Keyboard input only at MVP | Two-week discipline; mobile is a v2 consideration. |

---

## References

- Three.js r168 release notes: https://github.com/mrdoob/three.js/releases
- enable3d GitHub: https://github.com/yandeu/enable3d
- Rapier 3D documentation: https://rapier.rs/docs/
- `design/gdd/runner-system.md` — physics body rules for robot movement
- `design/gdd/obstacle-system.md` — kinematic body rules for obstacle movement
- `.claude/docs/technical-preferences.md` — forbidden patterns derived from this ADR
