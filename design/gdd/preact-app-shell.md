# Preact App Shell — Game Design Document

> **Status**: Approved
> **Created**: 2026-05-04
> **Last Updated**: 2026-05-04
> **Sprint Task**: S6-04 (shipped across `45f90aa` → `34829ce`; reverse-doc as part of Sprint 6 close-out)
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Preact App Shell** is the v1 single-page web entry point. It owns:

- **Hash routing** between Landing (`#` / no hash in production) and the
  race scene (`#peek`, `#peek-maze`). Production defaults to Landing;
  development defaults to the race scene with `#landing` available as
  an opt-in preview.
- The **App component lifecycle**: arena + roster load, renderer
  construction, sim run, sim driver + bridge wire-up, animation state
  switcher attachment, FPS sampler, and clean teardown on unmount /
  Race Again.
- The **Camera mode selection effect** that picks between Static /
  Follow-Leader / Robot Shoulder / Winner Camera (see
  [Camera System GDD](camera-system.md) for the per-mode rules).
- The **dev HUD** (visible in the default scene route, `#peek-maze`)
  and the **peek overlay** (visible on `#peek` / `#peek-maze`):
  - Dev HUD shows seed, arena id, FPS, robot count, current tick,
    progress %, and winner id once known.
  - Peek overlay shows a "Back" link, a "Race Again" button (which
    re-rolls the seed), and a bottom-left training caption naming the
    current arena.
- The **camera control bar** (top-right): an **Arena** button, a
  **Robot #** numeric input, and a **WIN** state-indicator pill.
- The **WinnerCard** (right-anchored) — see
  [Winner Presentation GDD §3](winner-presentation.md).

The shell is intentionally one-page: routing exists only to differentiate
"marketing landing" from "race scene." Per the systems index, the
richer 4-route structure (leaderboard, profile, archive) is deferred
to v1.1+.

---

## 2. Player Fantasy

> **"Click. Watch. Watch again."**

The shell delivers two interaction beats per visit:

1. **Click into a race.** From Landing, click "Sprint Race →" (sends to
   `#peek`) or "Maze Race →" (sends to `#peek-maze`). The race plays
   automatically; the user is a viewer, not an operator.
2. **Watch again.** When a race ends, click **Race Again** for a
   freshly-seeded race in the same arena. Click **Arena** to dismiss
   the winner presentation and pan back. Type a robot id into
   **Robot #** to follow that robot in third-person.

Everything else — the dev HUD, the `#landing` dev preview, hash-driven
arena selection — exists for the developer, not the viewer. The viewer
sees a clean canvas with a small set of low-key controls and a winner
moment.

---

## 3. Detailed Rules

### Routing

- **R1.** Hash routing is the only routing mechanism. There is no
  history-API integration, no router library, no per-page bundle
  splitting in v1.
- **R2.** Route resolution (in `src/main.tsx`):
  - Production:
    - `#peek` → App (sprint-race, Arena-01)
    - `#peek-maze` → App (maze-race, Arena-02)
    - anything else → Landing
  - Development (`import.meta.env.DEV`):
    - `#landing` → Landing
    - anything else → App (defaults to maze-race for fast iteration)
- **R3.** The dev fallback to `App` (instead of Landing) is a
  deliberate developer affordance. `npm run dev` lands directly on
  the active scene; no need to type a hash on every reload.
- **R4.** A `hashchange` listener on `window` re-renders the root
  component on hash change; navigation between routes does not require
  a full page reload.

### Arena selection (within the App)

- **R5.** `arenaPathFromHash()`:
  - `#peek` → `CONFIG.arena.defaultArenaPath` (Arena-01, sprint).
  - `#peek-maze` → `CONFIG.arena.mazeArenaPath` (Arena-02, maze).
  - anything else (incl. dev with no hash) → `CONFIG.arena.mazeArenaPath`.
- **R6.** Arena selection is read once per mount (per fresh `seed`).
  Changing the hash mid-race does NOT swap arenas — it would require
  a route change which re-mounts the App component.

### Seed lifecycle

- **R7.** A fresh `uint32` seed is picked on first mount via
  `pickRandomSeed()`. Web Crypto is preferred (`Math.random` is
  forbidden in `src/`); fallback is `(Date.now() & 0xffffffff) >>> 0`
  for environments lacking `crypto.getRandomValues`.
- **R8.** The main `useEffect` is keyed on `[seed]`. Changing `seed`
  via `setSeed(pickRandomSeed())` (the **Race Again** handler) tears
  down the entire scene (renderer, switcher, bridge, FPS rAF) and
  builds a fresh one.
- **R9.** The dev HUD displays the seed so a developer can reproduce
  any run by reading the seed off the screen and feeding it into the
  headless harness.

### Mount sequence (per `seed`)

The main `useEffect` runs the following sequence inside an async IIFE,
guarded by a `cancelled` flag for unmount safety:

1. **Reset transient stats** — `loadStatus = 'loading'`, clear
   `winnerId`, `isDone`, `currentTick`, `totalTicks`, error.
2. **Build the camera** — `new THREE.PerspectiveCamera(50, aspect,
   0.1, 500)`. Same camera object is reused across all camera modes.
3. **Load arena + roster in parallel** via `Promise.all`. Cancellation
   short-circuits before any subsequent step touches state.
4. **Stash the roster** in React state so the WinnerCard can read it.
5. **Build ground extents** based on arena type — sprint extends along
   the +X track; maze is centred on the origin.
6. **Construct the renderer** with the chosen ground colour (deep
   green for maze) and ground extents.
7. **Mount the renderer** into the container with the shared camera.
8. **Build the arena setup** via `buildArenaSetup` — picks the event
   module (sprint-race vs maze-race), the scene objects (finish line
   vs maze walls + tree), the leader resolver / camera settings or
   the static camera placement, and the `winnerCamTarget` for the
   Winner Camera.
9. **Add scene objects** to the renderer.
10. **Run `runSim`** synchronously to produce the deterministic
    `SimResult`.
11. **Construct the Sim Driver** wrapping the result.
12. **Construct the Animation State Switcher** against the renderer.
13. **Construct the Sim ↔ Renderer Bridge** wiring driver → switcher
    → renderer with an `onEvent` handler that updates `stats.winnerId`
    on `simEnd`.
14. **Start the bridge** (which starts its own rAF loop).
15. **Stash scene refs** (`renderer`, `camera`, `built`) into a
    `useRef` and bump `sceneVersion` to trigger the camera effect.
16. **Update `stats`** to `loadStatus = 'ready'` with `robotCount`,
    `seed`, `arenaId`, `totalTicks`.
17. **Start the FPS sampler** — a separate rAF that samples
    `driver.isDone()` and `driver.getCurrentTick()` each frame and
    pushes a 1 s-windowed `fps` average into stats.

### Teardown

- **R10.** Cleanup function returned from the main `useEffect`:
  - Set `cancelled = true` so any in-flight async work bails.
  - Cancel the FPS rAF.
  - Null out `sceneRefs.current` so the camera effect knows refs are
    gone.
  - Dispose the bridge (writes to instance.root) → switcher (reads
    renderer-owned mixers) → renderer. Order matters: bridge stops
    writing first, switcher stops play()/crossFadeTo() calls next,
    renderer disposes mixers + GLB last.
- **R11.** The camera effect's cleanup disposes the active camera
  handle. It does **not** dispose the `PerspectiveCamera` itself,
  which is GC'd with the App component.

### Camera mode selection effect

- **R12.** A separate `useEffect` keyed on `[sceneVersion,
  cameraTargetId, winnerCamSuppressed, stats.isDone, stats.winnerId]`.
  See [Camera System GDD §3 R1–R3](camera-system.md) for the priority
  rules; this shell implements that priority literally as an
  `if/else` chain.
- **R13.** Switching modes mid-race never touches the renderer / sim
  / bridge. Only the previous camera handle is disposed and a new one
  is constructed against the same `PerspectiveCamera`.

### CameraControl bar (top-right)

- **R14.** Three controls in a single row: **Arena** button,
  optional **WIN** pill (when active), **Robot #** numeric input.
- **R15.** **Arena** clears any shoulder follow AND suppresses the
  winner cam: `setCameraTargetId(null)` + `setWinnerCamSuppressed(true)`.
- **R16.** **Robot #** parses the input on Enter / blur. Empty input
  clears the target. Out-of-range integers also clear and reset the
  input field.
- **R17.** **WIN** pill renders only when `winnerCamActive === true`
  (see [Winner Presentation GDD §3 R9–R11](winner-presentation.md)).
- **R18.** The bar is `position: absolute` over the canvas with a
  semi-transparent black background and `backdrop-filter: blur(4px)`.

### DevHud (top-left, hidden in peek mode)

- **R19.** Shows: `S6-02 — Sim ↔ Renderer Bridge` label (legacy
  identifier carried forward), robot count, FPS, status,
  arena+seed, tick / totalTicks (clamped to totalTicks once
  `isDone`), and winner.
- **R20.** `pointerEvents: 'none'` so it can never block control
  clicks beneath it.

### PeekOverlay (in peek mode)

- **R21.** Top-left controls: a **← Back** link clearing the hash,
  and a **↻ Race Again** button that calls `handleRaceAgain` (which
  re-rolls the seed, clears the camera target, and clears the winner
  suppression).
- **R22.** Bottom-left training caption: monospace, low opacity,
  letter-spaced. Reads `MAZE RACE · ARENA 02` for `arena-02`,
  `SPRINT RACE · ARENA 01` otherwise.
- **R23.** Loading and error states render centred overlays. The
  error state shows the error message verbatim — no rebrand into a
  user-friendly string yet (v1.x polish item).

---

## 4. Formulas

The shell has no math worth formulating in the GDD sense (no
balance values, no curves). The only numeric computations are:

### Aspect ratio

```
aspect = container.clientWidth / max(container.clientHeight, 1)
```

The `max(_, 1)` guards against a zero-height container during a
transient layout pass; `aspect = width` when height is zero.

### Random seed (Web Crypto preferred)

```
crypto.getRandomValues(Uint32Array[1])[0]    // preferred
or
(Date.now() & 0xffffffff) >>> 0              // fallback
```

### FPS sample window

```
windowMs   = 1000
fps_sample = (frameCount * 1000) / (now - lastSampleAt)
```

Reset `frameCount = 0` and `lastSampleAt = now` after each emit.

### Tick display

```
displayedTick = isDone ? totalTicks : driver.getCurrentTick()
progress_pct  = totalTicks > 0 ? (displayedTick / totalTicks) * 100 : 0
```

The clamp on `isDone` exists so the HUD reads `ticks/ticks (100%)`
instead of `ticks-1/ticks (99%)`.

---

## 5. Edge Cases

| Case | Behaviour |
|------|-----------|
| `#app` mount point missing in `index.html` | `main.tsx` throws on startup. Static asset; never happens at runtime. |
| User changes hash to `#peek` from `#peek-maze` mid-race | `Root` re-renders with the new route. `App` unmounts (full teardown via R10) and re-mounts with a fresh seed against the sprint arena. |
| Container element not yet sized on first effect run | Camera aspect uses `max(height, 1)`. Renderer's `mount()` reads container size; if zero it'll still mount but render nothing useful. Browser reflow then fires a resize and the renderer adapts (resize handling lives in the renderer GDD). |
| Web Crypto unavailable | Seed falls back to `Date.now() & 0xffffffff`. Sim still runs deterministically given the seed; only the seed-picking is degraded. |
| Roster fails to load | `loadStatus = 'error'`, error message rendered. No race plays. Race Again does not retry — the user must navigate away and back, or reload. (V1.x polish item: retry button.) |
| Arena fails to load | Same as roster failure. The arena path comes from `CONFIG.arena.*`; failure here means a missing or malformed JSON file in build output. |
| `runSim` throws | Caught by the outer try/catch in the async IIFE; same error treatment as load failure. |
| User clicks **Race Again** before initial load finishes | The `cancelled` flag short-circuits the in-flight load; the new seed triggers a fresh effect run. The first render's renderer / switcher / bridge are never constructed (cancellation gates each step), so nothing leaks. |
| User clicks **Race Again** repeatedly | Each click re-rolls the seed and re-runs the effect. There is no debounce; rapid-clicking just builds and tears down scenes. Renderer dispose is idempotent; teardown order is preserved on every cycle. |
| User types `Robot #` while loading | Input is local component state. It does not trigger a sim restart. The shoulder cam mounts the moment refs become available (`sceneVersion > 0`). |
| Race Again with shoulder cam active | New scene mounts with `cameraTargetId = null` (cleared by `handleRaceAgain`) — the new race always starts on the arena cam. Intentional. |
| Hash changes to a non-route value (e.g., `#anything`) | Production: falls back to Landing. Development: falls back to App with the maze arena. |
| Renderer's `mount` throws | Caught by the outer try/catch. `loadStatus = 'error'` with the renderer's error message. The half-built renderer is GC'd; no explicit dispose because `mount` failure means nothing was registered. |

---

## 6. Dependencies

### Inbound (this system depends on)

- **[85-Instance Renderer](85-instance-renderer.md)** — constructed
  per mount, mounted into the container with the shared camera.
- **[Animation State Switcher](animation-state-switcher.md)** —
  constructed per mount, attached to the renderer.
- **[Sim Engine Core](sim-engine-core.md)** — `runSim` invoked
  synchronously inside the mount sequence.
- **[Sim Driver](sim-driver.md)** — wraps the `SimResult`; consumed
  by the bridge and the FPS sampler.
- **Sim ↔ Renderer Bridge** — owns the per-tick pose write +
  switcher transition trigger.
- **[Sprint Race Event Module](sprint-race-event-module.md)** —
  injected into `runSim` for sprint arenas.
- **Maze Race Event Module** (deferred GDD; landed unplanned in
  Sprint 6 — see retrospective) — injected for maze arenas.
- **[Robot Roster Loader](robot-roster-loader.md)** + **[Arena
  Loader](arena-loader.md)** — parallel-loaded in the mount sequence.
- **[Camera System](camera-system.md)** — the shell owns mode
  selection but the camera modules own the per-mode behaviour.
- **[Winner Presentation](winner-presentation.md)** — WinnerCard +
  WIN pill live in `app.tsx` but their rules are documented there.
- **[Config Module](config-module.md)** — reads `CONFIG.arena.*`,
  `CONFIG.camera.*`, `CONFIG.renderer.robotCount` (dev HUD).

### Outbound (these systems depend on this)

- None. The App Shell is the top of the dependency graph for v1.

### Forbidden dependencies

- **No `Math.random`** — `pickRandomSeed` uses Web Crypto with a
  `Date.now()` fallback, neither of which is `Math.random`.
- **No direct imports from `enable3d` or `archive/`** — those belong
  to the archived runner project.
- **No router library** — hash listening is a literal `addEventListener`,
  no `react-router` / `wouter` / etc.

---

## 7. Tuning Knobs

| Knob | Location | Range | Effect |
|------|----------|-------|--------|
| `GROUND_PAD_X` | `src/app.tsx` module const | 10–80 | Ground plane padding past the +X arena length. Higher = more visible floor past finish. |
| `GROUND_PAD_Z` | `src/app.tsx` module const | 10–80 | Ground plane lateral padding. Higher = wider visible floor. |
| `MAZE_GROUND_COLOR` | `src/app.tsx` module const | hex colour | Maze ground tone. Set darker than the finish-tree canopy for foliage contrast. |
| Camera FOV (`50`) | inline in `useEffect` | 35–75 | Camera field of view. Tighter feels cinematic; wider feels documentary. |
| Camera near/far (`0.1` / `500`) | inline in `useEffect` | (depth-buffer dependent) | Far clip must exceed the maze's diagonal viewing distance from the static cam. 500 covers all v1 arenas. |

The shell deliberately keeps these as module-level constants rather
than promoting them to `CONFIG`. They are scene-construction details,
not gameplay surfaces, per the "magic numbers in user-facing code"
forbidden-pattern rule.

`CONFIG.arena.defaultArenaPath` and `CONFIG.arena.mazeArenaPath`
**are** in `CONFIG` because they are content paths consumed by the
arena loader; the shell only reads them.

---

## 8. Acceptance Criteria

Verified manually in browser. The shell does not have a unit-test
suite — it is integration code that ties leaf-tested modules
together.

### Routing

- [ ] **AC-1.** Production: `https://<deploy>` shows Landing.
- [ ] **AC-2.** Production: `https://<deploy>/#peek` shows App with
  Arena-01 (sprint).
- [ ] **AC-3.** Production: `https://<deploy>/#peek-maze` shows App
  with Arena-02 (maze).
- [ ] **AC-4.** `npm run dev` lands on App with Arena-02 by default.
- [ ] **AC-5.** `npm run dev` then navigate to `#landing` shows
  Landing.
- [ ] **AC-6.** Hash navigation between routes does not full-page-reload.

### Mount lifecycle

- [ ] **AC-7.** Click "Sprint Race →" from Landing → 85 robots
  animate; HUD shows seed, arena id, FPS ≥ 30.
- [ ] **AC-8.** Click "Maze Race →" from Landing → robots steer
  through the maze; static camera frames the entire grid.
- [ ] **AC-9.** Race plays to completion; `winnerId` is set in the
  HUD; on Arena-02 the Winner Camera and WinnerCard activate.
- [ ] **AC-10.** Race Again re-rolls the seed and runs a new race;
  the previous race's state does not leak (no double winners, no
  doubled FPS, no double rAF loops).
- [ ] **AC-11.** Determinism: visiting `#peek-maze` then forcing the
  seed (via dev HUD reading + headless harness) produces the same
  finish order in both environments.

### Camera control

- [ ] **AC-12.** **Arena** button before race-end is a no-op visually
  (sprint) or returns to static (after a shoulder follow) (maze).
- [ ] **AC-13.** **Arena** button after race-end on Arena-02
  dismisses the Winner Camera + WinnerCard.
- [ ] **AC-14.** Typing a valid robot id (e.g., `12`) and pressing
  Enter switches to shoulder follow.
- [ ] **AC-15.** Typing out-of-range id clears and resets to arena cam.
- [ ] **AC-16.** WIN pill appears only when the Winner Camera is active.

### Teardown / no leaks

- [ ] **AC-17.** Race Again N times in a row maintains FPS within
  ±10% of first-race FPS — no rAF accumulation.
- [ ] **AC-18.** Navigating Landing ↔ App ↔ Landing does not leak
  WebGL contexts (browser warns at ~16 contexts; v1 should never
  approach that).
- [ ] **AC-19.** Disposal order is bridge → switcher → renderer
  (verified by reading `useEffect` cleanup).

### Forbidden patterns

- [ ] **AC-20.** No `Math.random` in `src/app.tsx` or `src/main.tsx`
  or `src/landing.tsx` (verified by grep).
- [ ] **AC-21.** No DOM globals (`document`, `window`) referenced
  outside of `useEffect` bodies and the main `main.tsx` mount call.
- [ ] **AC-22.** No router library imported.

---

## Implementation Notes

- Files:
  - [`src/app.tsx`](../../src/app.tsx) (~963 LOC) — the App
    component, sub-components (`CameraControl`, `DevHud`,
    `PeekOverlay`, `WinnerCard`, `TraitBar`), and helpers.
  - [`src/main.tsx`](../../src/main.tsx) (~33 LOC) — `Root`
    component with hash routing.
  - [`src/landing.tsx`](../../src/landing.tsx) (~228 LOC) — the
    Landing page (covered by this GDD only as a route target; its
    own contents are presentation-only and not separately documented).
- Total LOC owned: ~1,224 across the three entry files.
- Shipped incrementally across Sprint 6: bridge wire-up + initial
  HUD (`45f90aa`), polish + camera follow + arena padding
  (`8a89d5c`), seed-driven starting positions (`287ab2c`), random
  seed + Race Again (`b8c57fa`), camera follow + finish line
  (`5b94120`), maze grove visuals + shoulder cam + navigation
  traits (`a340919`), winner cam + WinnerCard + Cipher rebalance
  (`34829ce`).
- The shell is reverse-documented at Sprint 6 close to capture what
  shipped. The original Sprint 6 plan called for `#/`, `#/race`,
  `#/winner` routes; what shipped is `#peek` / `#peek-maze` /
  `#landing` instead — the **race scene and winner reveal occupy
  the same route** (the winner cam + card mount in-place rather than
  on a separate route). This is a simpler structure than planned and
  was kept; the planned multi-route flow is captured in the deferred
  list as v1.x polish if richer navigation is ever needed.
- The dev HUD's label still reads `S6-02 — Sim ↔ Renderer Bridge`
  from earlier in the sprint. This is left as-is — it's a developer
  artefact, not viewer-facing — and is captured in the Sprint 6
  retrospective as a one-line follow-up for Sprint 7 polish.
