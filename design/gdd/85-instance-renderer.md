# 85-Instance Skinned Mesh Renderer — Game Design Document

> **Status**: Revision 1 (post-review — 6 edits applied)
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S4-04
> **System Index**: design/gdd/systems-index.md (#4)
> **Spike Reference**: src/renderer/renderer-spike.ts (commit `2fe3668`)

---

## 1. Overview

The 85-Instance Skinned Mesh Renderer is the visual foundation of the Robo
Rhapsody Sim. It loads the rigged robot GLB once, instantiates 85
independently-animated copies via Three.js `SkeletonUtils.clone()`, applies a
unique skin texture to each via per-instance material clone, and renders all
of them at sustained 60 FPS with full skeletal animation every frame.

This system is the project's main technical bet. A spike prototype
(`src/renderer/renderer-spike.ts`, commit `2fe3668`) measured 60.0 FPS
sustained / 86 draw calls / 31.6 MB JS heap on Chrome 147 at retina 2x DPR —
a clean pass with significant headroom. The four fallback strategies
enumerated in the systems-index (reduce to 40 robots / frustum-cull skeleton
updates / VAT bake / static poses on instanced meshes) are documented but
**not adopted** in v1. They remain available as v1.1+ scope-relief levers if
downstream additions (lights, post-processing, particles, larger arenas) eat
into the budget.

The renderer's responsibilities are deliberately bounded:

1. **Asset loading** — GLB + 85 textures, with a deterministic completion
   signal so consumers know when the renderer is ready.
2. **Instance assembly** — 85 independent skinned-mesh clones with
   per-instance materials and per-instance animation mixers.
3. **Animation** — every instance plays the `run` clip by default; the
   Animation State Switcher (S4-05) drives transitions to `idle`/`death`.
4. **Render loop** — tick mixers, render scene to canvas at 60 FPS.
5. **Resize** — respond to viewport changes without losing animation state.
6. **Disposal** — clean tear-down of WebGL context, textures, geometry, and
   event listeners.

What it does NOT own:

- **Camera control** — S4-11 Camera System owns mode toggling and Follow
  Leader / Fixed / Follow ID.
- **Sim state** — no game logic; positions and animation states are inputs
  from the Sim Engine in Sprint 5+.
- **Winner VFX** — S4-12 owns particle/spotlight/orbit at the finish moment.
- **UI overlays** — the Preact App Shell owns FPS counters, mode toggles,
  buttons.

Why it goes in Sprint 4: the Animation State Switcher (S4-05), Camera System
(Sprint 6), and Sim Engine consumers (Sprint 5) all need the renderer's
instance handles to operate. Settling the renderer's API surface in Sprint 4
unblocks every downstream consumer.

---

## 2. Viewer Experience Goals

*(adapted from "Player Fantasy" — players in this game are viewers; the
renderer's felt experience is what they see on the screen.)*

When a viewer opens `robo-rhapsody.onrender.com` and the simulation begins,
the experience should feel: **alive, distinct, recognizable, smooth.**

- **Alive.** All 85 robots are running, not posing. The whole field is in
  motion the moment the scene loads. No "wait for the camera to find
  them" pause; no static lineup before the action starts.

- **Distinct.** Every robot is visually identifiable. The 85 unique skins
  are clearly different at glance distance — when a viewer says "follow
  #47," they can find that robot by its silhouette + texture. No two
  robots look interchangeable.

- **Recognizable.** A holder watching their robot specifically — via
  Follow ID camera mode (S4-11) or just by knowing its texture — sees a
  consistent rendering of that robot from arrival to elimination. Skin
  does not pop, swap, or distort during the run.

- **Smooth.** Animation runs at 60 FPS sustained. No jitter on stage
  culls, no frame drops when robots near the camera, no stutter when the
  tab regains focus after a pause. The rolling 60-frame budget is a hard
  floor measured in production.

Concretely, the system should produce these felt experiences:

- **First-paint within 3 seconds.** From "robots have data" to "robots
  are visible and running" must be fast enough that viewers tuning in at
  showtime do not see a long blank scene. The 17 MB asset payload loads
  in parallel; the render loop starts the moment GLB + textures are ready.

- **No visual regressions across builds.** The same scene renders the
  same way across deploys. Texture color space, shadow setup (currently
  disabled), and material parameters are pinned and deterministic.

- **Graceful recovery from tab-throttle.** When a viewer switches tabs
  and returns, animations resume without a "skip ahead" or "stall"
  artifact. (Implementation detail: `Clock.getDelta()` clamping, deferred
  to S4-04 implementation.)

- **Predictable instance handles for downstream code.** Each instance
  exposes its `id` (0–84), root `Object3D`, and `AnimationMixer` so the
  Animation State Switcher (S4-05) and Camera System (S4-11) can find
  any robot by id without iteration.

- **Clean dispose.** When the renderer unmounts (Preact useEffect
  cleanup), the WebGL context is released, textures freed, animation
  loop cancelled, resize listener removed. No leaks across hot reloads
  or page navigation.

---

## 3. Detailed Rules

**File location.** `src/renderer/renderer.ts` is the production module
(the spike at `src/renderer/renderer-spike.ts` is the predecessor — kept
through Sprint 4 then deleted in S4-05). Helper modules split as the
system grows: `scene-setup.ts`, `robot-instance.ts`, `asset-loader.ts`.
v1 starts with one file; the split is a refactor, not a redesign.

**Public API.**

```ts
export function createRenderer(): Renderer;

export interface Renderer {
  /** Attach the renderer to a DOM container and begin loading + animating.
   *  Resolves when 85 instances are visible and animating.
   *  If `camera` is omitted (Sprint 4 transitional path), the renderer uses
   *  a temporary internal PerspectiveCamera. Sprint 6 (S4-11 Camera System)
   *  will always pass its owned camera. */
  mount(container: HTMLElement, camera?: THREE.PerspectiveCamera): Promise<void>;

  /** Look up a single robot by id (0..robotCount-1). Returns undefined before
   *  mount resolves or for any out-of-range id. */
  getInstance(id: number): RobotInstance | undefined;

  /** All instances in load order. Stable references after mount resolves. */
  getAllInstances(): readonly RobotInstance[];

  /** Returns the Three.js scene. Prefer `addToScene` for additions;
   *  direct mutation of the scene graph is discouraged. */
  getScene(): THREE.Scene;

  /** Attach an Object3D (camera helper, light, particle emitter, debug overlay)
   *  to the scene. The renderer does not track added objects; callers that need
   *  removal retain their own references. */
  addToScene(obj: THREE.Object3D): void;

  /** Tear down WebGL context, textures, geometry, and event listeners. */
  dispose(): void;
}

export interface RobotInstance {
  readonly id: number;            // 0..84 — matches NFT token id
  readonly root: THREE.Object3D;  // owns position/rotation
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ReadonlyMap<'run' | 'idle' | 'death', THREE.AnimationClip>;
}
```

Three exports total: `createRenderer`, `Renderer`, `RobotInstance`. No
default export, no class — closure-style construction matches the rest
of the project (Seedable PRNG, Config Module).

The `getScene` / `addToScene` pair is the sanctioned extension point for
downstream systems (Camera System, Winner VFX) that need to attach objects
to the rendered scene without the renderer importing from their modules.

**Asset loading rules.**

- Three GLBs load: `robot_run.glb`, `robot_idle.glb`, `robot_death.glb`.
  Only `robot_run.glb` provides geometry/skeleton; the others are loaded
  only to extract `AnimationClip`s (per the spec:
  `validStates: ['run', 'idle', 'death']`).
- 85 skin textures load in parallel via `THREE.TextureLoader`.
- Total payload: GLB geometry (~1.25 MB) + 2 animation-only GLBs (~2.6 MB
  if loaded; can be optimized later by extracting clip-only data) +
  85 × ~200 KB skins (~17 MB) = ~21 MB.
- All loads happen via `Promise.all`. `mount()` rejects if any single
  asset fails — partial load is not a valid state for v1.
- No retries v1. A failure in dev → user reloads. A failure in prod →
  fallback content (deferred system, post-v1.1).

**Per-instance setup rules.**

- Use `SkeletonUtils.clone()` from `three/addons/utils/SkeletonUtils.js`
  to clone the skinned mesh from `robot_run.glb`. This produces a fresh
  skeleton + bones for each instance — required for independent
  animation. `mesh.clone()` would NOT work (skeleton stays shared,
  animation mutations on one instance would affect all).
- Per-instance material: clone the source material via `material.clone()`
  and set `material.map = textures[id]`. Materials are not shared across
  instances (texture swap on a shared material would affect all 85).
- Per-instance `AnimationMixer`. Each instance owns its mixer and its
  clip-to-action map. Sim-driven state changes operate on this mixer
  exclusively — no global mixer pool.
- **No auto-play.** The renderer constructs `mixer.clipAction()` references
  for run / idle / death but does **not** call `.play()` on any of them.
  The Animation State Switcher (S4-05) is the sole owner of `play()` and
  `crossFadeTo()` calls codebase-wide. Robots remain in their bind pose
  until the switcher is constructed and starts the initial `idle` action.
  The per-instance phase-offset desync (`id * 0.07` seconds) lives in the
  switcher's constructor, not here.

**Render loop rules.**

- Single `requestAnimationFrame` loop owned by the renderer.
- Time delta computed via `THREE.Clock.getDelta()`. Clamped to a maximum
  of 0.1 seconds to prevent skip-ahead artifacts when the tab regains
  focus after throttling.
- Mixer update + scene render happen every frame, no skipping.
- `frustumCullSkeletons` config flag is honored: when true, instances
  outside the camera frustum skip their `mixer.update(dt)` call. False
  by default (the spike showed it's not needed at 85 instances).

**Resize rules.**

- `window.addEventListener('resize')` updates renderer size and camera
  aspect ratio.
- Pixel ratio capped at `Math.min(window.devicePixelRatio, 2)`. Higher
  DPRs (3x phones) are clamped to 2x — visual quality is identical at
  typical viewing distances and the GPU saves work.
- Listener is removed on dispose.

**Disposal rules.**

- `dispose()` MUST be idempotent — calling twice is safe.
- Order: cancel `requestAnimationFrame`, remove resize listener, dispose
  geometries (`mesh.geometry.dispose()`), dispose materials and their
  maps, dispose renderer (`renderer.dispose()`), remove canvas from DOM.
- Mixers stop themselves when their root `Object3D` is removed from the
  scene; explicit cleanup is unnecessary.

**Forbidden patterns.**

- `Math.random()` anywhere in the renderer — even for cosmetic offsets,
  use a seeded RNG (`createRng` from `@/sim/rng`).
- Sharing a single material across instances. Per-skin texture means
  per-instance material; sharing breaks the "85 distinct" goal.
- Mutating geometry per instance. The base mesh's geometry is shared
  across all 85 clones via `SkeletonUtils.clone()` — that's the cheap
  path. Per-instance geometry would 85× the GPU memory.
- Loading more than three GLB files. v1 uses `run` / `idle` / `death`
  only. Adding `jump`/`slide` is a Sprint 5+ decision, not a v1 ship-it.
- Calling `mount()` more than once on the same renderer instance. The
  contract is mount-once-then-dispose; re-mount creates a new renderer
  via `createRenderer()`.

---

## 4. Implementation Approach

*(adapted from "Formulas" — this section documents the measured-and-chosen
implementation, not derived math.)*

**Chosen approach: `SkeletonUtils.clone()` per instance, naive runtime
skinning.**

Rejected alternatives (in order of how seriously they were considered
before the spike):

| Approach | Why rejected (post-spike) |
|----------|----------------------------|
| `InstancedSkinnedMesh` (custom shader / community plugin) | Not needed. Spike hit 60 FPS with the naive path. |
| Vertex Animation Texture (VAT) bake | Not needed. Adds asset-pipeline complexity for zero measured benefit at 85 instances. |
| Single AnimationMixer with multiple roots | Limits per-instance state independence. Per-instance mixer is cleaner, costs nothing measurable. |
| Static instanced poses (no skeletal animation per frame) | Defeats the "alive" goal in Section 2. |

**Measured baseline (spike, commit `2fe3668`):**

| Metric | Spike measurement | Notes |
|--------|-------------------|-------|
| Sustained FPS | 60.0 | 60-frame rolling average |
| Draw calls | 86 | 85 robots + 1 ground plane |
| JS heap | 31.6 MB | 6× under 200 MB ceiling |
| Pixel ratio | 2x (clamped) | retina @ 1440×900 viewport |
| Asset load time | ~2 sec dev, ~1 sec prod (estimated) | Vite serves uncompressed in dev |
| Hardware | Chrome 147 / macOS / 2020-era integrated GPU | Mid-range target hardware |

**Memory model (what's shared, what's per-instance):**

| Resource | Shared? | Why |
|----------|---------|-----|
| Geometry (vertex buffers) | **Shared across all 85** | `SkeletonUtils.clone()` reuses the source `BufferGeometry`. ~1.25 MB total, not 85×. |
| Skeleton + bones | **Per-instance** | Required for independent animation; clone produces a fresh bone hierarchy. |
| Skin texture | **Per-instance** | Each robot has a unique texture; ~85 × ~200 KB ≈ 17 MB GPU. |
| Material | **Per-instance** | Material wraps the texture; cloned to allow per-instance map without affecting siblings. ~85 × small JS object. |
| AnimationMixer | **Per-instance** | Each instance has its own playback state. ~85 × small JS object. |
| AnimationClip data | **Shared** | Clips are immutable; same clip is fed to every mixer. |

**Render-loop pattern (canonical):**

```ts
const clock = new THREE.Clock();
const MAX_DT = 0.1; // seconds — clamps tab-throttle skip-ahead

function tick() {
  if (disposed) return;
  rafId = requestAnimationFrame(tick);

  const dt = Math.min(clock.getDelta(), MAX_DT);
  for (const inst of instances) inst.mixer.update(dt);

  renderer.render(scene, camera);
}
```

Three.js's WebGLRenderer batches draw calls automatically based on
material identity — but since each instance has its own material (per the
"distinct skins" requirement), draw calls scale O(n) with instance count.
86 calls is the unavoidable floor at 85 unique-textured instances. The
spec's "<50 draw calls" budget from `technical-preferences.md` was
written for the runner; this system explicitly exceeds it and that's OK.

**Per-instance setup pattern (canonical):**

```ts
const sourceMesh = findSkinnedMesh(runGltf.scene);
const sourceMaterial = sourceMesh.material as THREE.MeshStandardMaterial;

const instances: RobotInstance[] = [];
for (let id = 0; id < 85; id++) {
  const root = SkeletonUtils.clone(sourceMesh);

  const mat = sourceMaterial.clone();
  mat.map = textures[id];
  mat.needsUpdate = true;
  findSkinnedMesh(root).material = mat;

  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map([
    ['run', runGltf.animations[0]],
    ['idle', idleGltf.animations[0]],
    ['death', deathGltf.animations[0]],
  ]);

  // No play() call here — the Animation State Switcher (S4-05) owns all
  // play() and crossFadeTo() invocations. The renderer hands the caller
  // mixer + clips; the switcher does the rest.

  scene.add(root);
  instances.push({ id, root, mixer, clips });
}
```

The exact code in `src/renderer/renderer.ts` will tighten the casts and
error handling, but the shape is fixed. The spike's `renderer-spike.ts`
implements an earlier (auto-play-on-mount) variant of this pattern;
productionizing in S4-04 + S4-05 added clip extraction, instance lookup,
disposal, and the no-auto-play contract.

**Camera ownership.** The Camera System (S4-11, Sprint 6) owns the
`PerspectiveCamera` instance, its position, lookAt, FOV, and any mode
transitions. The `mount()` signature accepts an optional camera argument:

- **Sprint 4 (v1):** `mount(container)` called with no camera. The renderer
  constructs a temporary internal `PerspectiveCamera` with hardcoded FOV,
  position, and lookAt sufficient to frame the 85-robot grid. This camera
  is for visual verification only.
- **Sprint 6 onwards:** `mount(container, camera)` called with the Camera
  System's owned camera. The internal camera is not constructed; the
  supplied camera is used for all renders.

The renderer never mutates camera state (position, rotation, FOV, lookAt)
regardless of which path is taken. This is enforced as acceptance criterion
#19 (§8).

**Three.js API touchpoints:**

- `THREE.WebGLRenderer` — `outputColorSpace = SRGBColorSpace`,
  `setPixelRatio(min(window.devicePixelRatio, 2))`,
  `shadowMap.enabled = false` (v1 — performance, not necessary visually)
- `THREE.PerspectiveCamera` — owned by Camera System (S4-11), passed in at
  mount
- `THREE.Scene` — owned by the renderer; downstream systems add objects
  via the `Renderer` API (or by acquiring the scene reference if/when
  exposed)
- `GLTFLoader` (from `three/addons/loaders/GLTFLoader.js`)
- `SkeletonUtils.clone` (from `three/addons/utils/SkeletonUtils.js`)
- `THREE.TextureLoader` — for skin PNGs
- `THREE.AnimationMixer` + `THREE.Clock` for animation timing

---

## 5. Edge Cases

1. **GLB file 404.** `mount()` rejects with the missing path. Caller (Preact App Shell) surfaces an error overlay. v1 has no auto-retry; fix the deploy and reload.

2. **GLB has no `SkinnedMesh`.** Asset corrupt or wrong export. `mount()` rejects with `"No SkinnedMesh found in {path}"`. Should never happen if the GLB is the canonical `assets/art/characters/robot/robot_run.glb`; if it does, the GLB must be re-exported.

3. **GLB has no `AnimationClip`.** Same path, same rejection wording: `"No AnimationClip found in {path}"`. The three GLBs (`run`/`idle`/`death`) each must contribute exactly one clip.

4. **Skin texture 404 for some `id`.** `mount()` rejects with the failing id and path. v1 treats partial texture sets as invalid (the "85 distinct" goal cannot be met).

5. **Texture load returns malformed image.** Three.js `TextureLoader` rejects in this case — same handling as #4.

6. **WebGL context lost.** `WebGLRenderer` emits `webglcontextlost` event. v1 logs the event and stops the render loop; the user sees a frozen frame until reload. Auto-recovery via `webglcontextrestored` is a v1.1 candidate (deferred — most modern browsers preserve context aggressively).

7. **Container resized to `0×0`.** Renderer's resize handler computes a degenerate aspect ratio. The renderer skips the render call when either dimension is zero, and resumes when the container is re-sized to non-zero. No crash, no leak.

8. **Container removed from DOM before `dispose()`.** The renderer's `domElement` is now orphaned. The render loop continues to operate on a detached canvas (no visible side effect, small wasted GPU work). `dispose()` cleanly removes its listener regardless. Caller is expected to call `dispose()` in the Preact useEffect cleanup, which fires before unmount.

9. **Tab throttling / background tab.** `requestAnimationFrame` rate drops to ~1 Hz. `Clock.getDelta()` returns large values. The `Math.min(dt, MAX_DT)` clamp at 0.1 seconds prevents animation-skip-ahead when the tab returns to focus. Mixers stay in valid state.

10. **Multiple `mount()` calls.** Forbidden by the contract. Subsequent calls reject with `"Renderer already mounted"`. Caller must `createRenderer()` a fresh instance for re-mount.

11. **`dispose()` called before `mount()` resolves.** Pending asset loads continue (their promises resolve normally), but their results are discarded — the disposed flag short-circuits before scene insertion. No leak, no half-mounted state.

12. **`dispose()` called twice.** Idempotent. Second call is a no-op.

13. **Very high `devicePixelRatio` (3x or 4x).** Clamped to 2x in renderer setup. GPU work bounded; visual quality unchanged at typical viewing distances.

14. **Zero `dt` between frames.** Possible at the first frame (Clock just initialized). Mixers handle `dt = 0` correctly (no advancement, no error). Output is identical to the prior frame.

15. **`CONFIG.renderer.robotCount` set to a value other than 85.** Legal within the 10–85 safe range (see §7). Renderer instantiates `robotCount` instances using texture ids `0..robotCount-1`; the remaining skin textures are not loaded. This supports the "reduce to 40 robots" fallback (Section 1). The renderer asserts the value is in `[10, 85]` at the start of `mount()`; out-of-range values throw in development. Production behavior on out-of-range values is to clamp to the bounds and log a warning, so a misconfigured deploy still renders something rather than a blank canvas.

16. **`getInstance(id)` for invalid id.** Returns `undefined`. Documented in the API. Callers must handle the missing case (typical idiom: `const inst = renderer.getInstance(id); if (!inst) return;`).

17. **`getInstance(id)` called before `mount()` resolves.** Returns `undefined`. Same caller idiom as #16.

18. **Browser without `Math.imul` / WebGL2.** v1 targets modern browsers only (Chrome/Firefox/Safari current). No fallback. Render fails gracefully with a "browser not supported" message — implementation deferred to a v1.1 detection pass.

19. **Texture color space wrong.** Each texture is set to `THREE.SRGBColorSpace` and `flipY = false` (GLTF convention) at load time. Wrong color space produces visibly wrong colors but no crash. Tests verify the assignments at the API level.

20. **Memory leak on hot reload (Vite HMR).** Vite re-runs the module on save. The previous renderer's `dispose()` is invoked via Preact's useEffect cleanup before the new one mounts. As long as `dispose()` is implemented correctly (idempotent, full teardown), HMR is leak-free. A failure here would manifest as JS heap growth across saves; verified during S4-04 implementation by leaving the dev server running with frequent edits.

---

## 6. Dependencies

**Upstream dependencies (Renderer depends on):**

- **Config Module** — reads `CONFIG.renderer.*` (robotCount, robotGlbPath,
  skinTexturePathPattern, frustumCullSkeletons, targetFps).
- **Three.js + addons** — `three`, `three/addons/loaders/GLTFLoader.js`,
  `three/addons/utils/SkeletonUtils.js`. Locked at r168+ per
  `docs/engine-reference/three-js/VERSION.md`.
- **Build / Deploy Pipeline** — provides the served asset URLs (GLBs at
  `assets/art/characters/robot/*.glb`, skin PNGs at
  `assets/art/characters/robot/skins/{id}.png`). Indirectly via
  `vite-plugin-static-copy`.

**Downstream dependents (systems that depend on Renderer):**

| System | What it consumes | First read appears in |
|--------|------------------|------------------------|
| Animation State Switcher | `RobotInstance.mixer`, `RobotInstance.clips` for state transitions | S4-05 |
| Camera System | Scene reference (for camera attachment), `RobotInstance.root.position` for Follow Leader/ID modes | Sprint 6 |
| Sim Engine Core | Indirectly — produces the `SimResult` the [Sim Driver](./sim-driver.md) replays into `RobotInstance.root.position` / `.rotation` per frame | Sprint 5 |
| [Sim ↔ Renderer Bridge](./sim-driver.md) | `RobotInstance.root.position` and `.rotation` writes per render frame, `getAllInstances()` to enumerate write targets | S6-02 |
| Winner VFX | `RobotInstance.root` as spotlight target + camera orbit anchor | Sprint 6 |
| Preact App Shell | `Renderer` instance via `useEffect` mount/dispose; canvas attached to a `ref` div | Sprint 6 |

Per `design-docs.md` rule, each downstream system's GDD must list
85-Instance Renderer in its own Dependencies section when authored.

**Explicitly NOT a dependency:**

- **[Robot Roster Loader](./robot-roster-loader.md) (S5-02)** — the renderer
  only needs counts and asset paths from `CONFIG`, not the trait data. The
  roster loader is a sim concern; the renderer reads its texture pattern
  directly. Trait data and rendering remain decoupled. Both compute skin
  texture paths from the same `CONFIG.renderer.skinTexturePathPattern` —
  CONFIG is the single source of truth, so the duplication is consistent
  by construction.
- **Sim Engine** — the renderer is driven by sim state, not the other way
  around. The [Sim ↔ Renderer Bridge](./sim-driver.md) (S6-02) is the
  authoritative writer of `RobotInstance.root.position` / `.rotation`
  per render frame; the renderer just renders. No back-channel.
- **Seedable PRNG** — the renderer uses fixed per-instance time offsets
  (`id * 0.07`) for the visual phase desync, not random offsets. No RNG
  dependency.

**Forbidden dependencies:**

- No imports from `src/sim/`. Renderer is rendering-only; sim logic
  stays out.
- No imports from any UI or app-shell module. The renderer accepts a
  `container: HTMLElement` and mounts itself; it does not know what's
  around it.
- No async work outside `mount()`. Once mount resolves, the render loop
  is sync per-frame.

---

## 7. Tuning Knobs

All tunable values live in `CONFIG.renderer` (see
[Config Module GDD](./config-module.md) §4).

| Path | Default | Safe Range | Affects | Notes |
|------|---------|------------|---------|-------|
| `renderer.robotCount` | 85 | 10–85 | Number of instances | The fallback lever. Spike showed 85 sustains 60 FPS; reduce only if v1.1+ scope eats budget. |
| `renderer.robotGlbPath` | `assets/art/characters/robot/robot_run.glb` | path | Geometry + run clip source | Don't change unless the asset moves. |
| `renderer.idleGlbPath` | `assets/art/characters/robot/robot_idle.glb` | path | Idle clip source (clip-only; geometry from `robotGlbPath`) | Don't change unless the asset moves. |
| `renderer.deathGlbPath` | `assets/art/characters/robot/robot_death.glb` | path | Death clip source (clip-only; geometry from `robotGlbPath`) | Don't change unless the asset moves. |
| `renderer.skinTexturePathPattern` | `assets/art/characters/robot/skins/{id}.png` | path with `{id}` token | Skin source | Don't change unless skins move. |
| `renderer.frustumCullSkeletons` | `false` | boolean | Whether off-screen instances skip mixer updates | v1.1 perf lever. False by default per spike measurements. |
| `renderer.targetFps` | 60 | 30 or 60 | Diagnostic threshold for FPS warnings | Informational only. Used by the App Shell's debug HUD. |

**Implementation-detail constants** (in `src/renderer/renderer.ts`, not
`CONFIG`):

| Constant | Value | Reason it's not in CONFIG |
|----------|-------|----------------------------|
| `MAX_DT` (animation delta clamp) | `0.1` seconds | A correctness invariant, not a tuning knob. Changing it would cause animation skip-ahead bugs. |
| `PIXEL_RATIO_CAP` | `2` | A platform invariant. 3x+ DPR doesn't visually improve the scene at typical viewing distances. |
| Per-instance time offset coefficient | `0.07` seconds × id | Visual-only. Hardcoded value matches the spike; tweaking it is not a knob, it's a code change. |

**No tuning knobs for v1 lighting** — single directional + ambient with
hardcoded intensities. Lighting becomes a tunable surface in v1.1+ when
arena variation lands.

---

## 8. Acceptance Criteria

**Direct criteria** (testable on S4-04 implementation commit):

1. **File exists.** `src/renderer/renderer.ts` is present, with
   `createRenderer`, `Renderer`, `RobotInstance` exports.

2. **Mount API.** `createRenderer().mount(container)` returns a
   `Promise<void>` that resolves only after all 85 instances are added
   to the scene.

3. **Instance count.** `getAllInstances().length === CONFIG.renderer.robotCount`.
   Default 85.

4. **Unique textures.** Each `RobotInstance.root.material.map`
   references a distinct `THREE.Texture`. No two instances share the
   same map. Verified by traversing all instances and asserting
   `Set(maps).size === robotCount`.

5. **Mixers are functional and clip references are populated.** After
   `mount()` resolves, every `RobotInstance.mixer` is a `THREE.AnimationMixer`
   instance, and `RobotInstance.clips` contains exactly the three keys
   `'run'`, `'idle'`, `'death'`. The renderer no longer auto-plays any
   action (the Animation State Switcher owns that responsibility per
   S4-05); a corollary mixer-time test belongs in the switcher's test
   suite, not here.

6. **Sustained 60 FPS.** Spike-measured 60.0 FPS. The implementation
   acceptance criterion: **measured FPS ≥ 55 over a continuous 10-second
   sample on the dev hardware** (5 FPS margin under the 60 ceiling for
   stability).

7. **JS heap budget.** `performance.memory.usedJSHeapSize < 100 MB`
   after mount resolves on dev hardware. Spike measured 31.6 MB; 100 MB
   is a 3× margin to allow for production additions (camera mode UI
   state, sim arrays, etc.) without breaching the 200 MB ceiling.

8. **First-paint within 3 seconds.** From `mount()` start to the
   resolution of its returned Promise, in dev mode, ≤ 3 seconds on dev
   hardware. Production with gzipped assets is expected to be faster.

9. **`getInstance(id)` returns valid instance.** For `id ∈ [0, robotCount)`,
   returns the matching `RobotInstance` with `.id === id`.

10. **`getInstance(id)` returns undefined.** For `id < 0`,
    `id >= robotCount`, or before `mount()` resolves, returns
    `undefined`.

11. **`dispose()` is idempotent.** Calling twice is safe and has no
    observable effect on the second call.

12. **`dispose()` cancels animation.** After `dispose()`, the render
    loop is stopped (verified by `requestAnimationFrame` callback never
    firing afterward).

13. **Color space correct.**
    `renderer.outputColorSpace === THREE.SRGBColorSpace`. Each texture's
    `colorSpace === THREE.SRGBColorSpace` and `flipY === false`.

14. **Pixel ratio clamped.**
    `renderer.getPixelRatio() === Math.min(window.devicePixelRatio, 2)`.

15. **No `Math.random` in `src/renderer/`.** Reviewer greps. Hits are
    rejected unless commented and justified (no expected case for v1).

16. **Typecheck green.** `npm run typecheck` exits 0.

17. **Test green.** `npm test` exits 0 with renderer tests passing.
    Tests use an injectable `WebGLRenderer` factory: production code
    constructs `new THREE.WebGLRenderer(...)`; tests substitute a stub
    that records calls without touching a real GL context. This avoids
    jsdom's incomplete WebGL surface and keeps the test run fast and
    deterministic.

**Discipline criteria** (enforced per PR going forward):

18. **Spike module deleted by S4-05.**
    `src/renderer/renderer-spike.ts` is removed when S4-05 completes —
    `renderer.ts` supersedes it. PRs that leave both files in `src/`
    are rejected (one is dead code).

19. **No camera mutation in renderer.** Reviewers verify the renderer
    only reads camera state (for rendering); does not mutate
    `position`, `lookAt`, `fov`, etc. Camera ownership belongs to S4-11.
