# Browser Smoke Test Checklist

Run this checklist before committing any rendering-adjacent change.
Takes ~60 seconds. Catches visual regressions that `tsc --noEmit` and unit
tests cannot see.

> Looking for the Sprint 1–3 endless-runner checklist? It lives at
> `archive/endless-runner/` along with the runner code.

---

## How to Run

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome. Default lands on the App test
scene; navigate via hash (`#landing` for landing preview, `#peek` for peek
mode) without restarting the dev server.

---

## Generic "New Visual System" Checklist

Apply this section to **every new visual system** before committing it.
The renderer (S4-04), state switcher (S4-05), and any future arena loader
or VFX system all run through these checks. Failing any one is a blocker.

### Direction

- [ ] **Lighting direction is correct.** Highlights fall on surfaces facing the
      key light, shadows on opposite sides. No "flat fully-lit from behind" look.
- [ ] **Up is up.** No upside-down meshes, no -y character orientation.
- [ ] **Forward is consistent.** Characters face one consistent direction
      (camera, +z, or as designed). No 180° flips between instances.

### Opacity / Alpha Gradient

- [ ] **No half-transparent meshes you didn't ask for.** Inspect any material
      that draws translucent — confirm it's intentional, not from a bad export
      or a forgotten `opacity = 0.5` in code.
- [ ] **No banded alpha.** Smooth gradients across translucent surfaces;
      banding indicates wrong texture format (e.g., 8-bit alpha when 16
      was needed).
- [ ] **No invisible wedges.** Every triangle that should render does render.
      Look for missing arms, gaps in geometry, holes from inverted normals.

### State Transitions

- [ ] **Idle → active state crossfades smoothly.** No instant snaps unless the
      design calls for them. Crossfade duration matches `CONFIG.animation.crossfadeSeconds`.
- [ ] **Active → terminal state plays once and holds.** Death (or any one-shot
      finisher) does not loop or reset.
- [ ] **Reverse transition restores normal looping.** If the system supports
      "revival" or returning from a terminal state, the next loopable state
      actually loops (does not freeze on first cycle).
- [ ] **Mid-transition interruption is graceful.** Calling `setState` mid-fade
      does not crash, tear, or produce visual artifacts.

### Per-Instance Correctness

- [ ] **Every instance has its own appearance.** When the system claims to
      produce N distinct instances, all N look distinct. Spot-check a sample
      of ids — no two should share a texture, material, or skeleton ref.
- [ ] **No lockstep.** When all instances are in the same state, their
      animations are phase-offset (e.g., breathing slightly out of sync).
      Lockstep is uncanny.
- [ ] **Per-instance state survives transitions.** Setting one instance to
      a new state does not affect siblings.

### Camera-Angle Sanity

- [ ] **Front rows readable.** From the default camera, foreground instances
      occupy a meaningful fraction of viewport height — not pixel-sized,
      not clipping out the top.
- [ ] **Back rows visible.** No far-plane clipping at the back of the scene
      (use a generous `far` value).
- [ ] **No floor pop-through.** Instances stand on the ground plane at
      consistent y. No feet sinking, no hovering.
- [ ] **Horizon does not break.** When background and ground match, no
      visible seam where the floor "ends" under the camera angle.

### Disposal Hygiene

- [ ] **Hot-reload is leak-free.** With the dev server running, save the
      file 5+ times. JS heap growth is bounded — open Chrome DevTools
      Performance Monitor, watch "JS heap size." Should plateau, not climb.
- [ ] **Tab-switch + return is graceful.** Switch to another tab for 30s,
      come back. Animations resume without skip-ahead, stutter, or stall.
- [ ] **No console errors during mount.** Open DevTools Console; mount must
      complete with zero red errors. Warnings about deprecated Three.js APIs
      are acceptable; uncaught exceptions are not.

---

## Sprint 4 Specific — Renderer + State Switcher + Sneak Peek

These checks are tied to the current Sprint 4 deliverables. Run after any
change to `src/renderer/`, `src/animation/`, `src/app.tsx`, `src/main.tsx`,
or `src/landing.tsx`.

### Dev default (no hash)

- [ ] App test scene renders within ~3 seconds of `npm run dev`
- [ ] All 85 robots visible on the placeholder grid
- [ ] Each robot has a distinct skin texture (no duplicates, no missing)
- [ ] Robots animate (idle by default, then cycle through run + death)
- [ ] HUD shows: `S4-05 — Renderer + State Switcher`, robot count 85/85,
      FPS ~60, status `ready`, current cycle state
- [ ] Animation cycle advances every ~3 seconds: idle → run → death → idle ...
- [ ] FPS stays ≥ 55 across all three states

### Landing preview (`#landing`)

- [ ] Black gradient background with brand text
- [ ] "Sneak Peek →" pill button visible above the social links
- [ ] Italic dim caption below the button: *"They're training. Take a look."*
- [ ] Hover on the pill button: border opacity lifts, faint accent-tinted background
- [ ] Social links (X, Pulse) render below the button

### Sneak Peek route (`#peek` or click the button)

- [ ] Hash updates to `#peek` on click
- [ ] Same renderer scene as default but with **no dev HUD**
- [ ] "← Back" pill top-left, low-opacity dark background, backdrop-blur
- [ ] "ROBOT TRAINING · DAY 1" mono caption bottom-left, low-opacity
- [ ] Animation cycle still runs
- [ ] FPS ≥ 55 sustained
- [ ] Click "← Back" → hash clears, returns to default route

### Direct URL `/#peek` (paste-and-reload)

- [ ] Page loads directly into peek mode (renderer mounts, no Landing flash)
- [ ] No dev HUD visible
- [ ] Caption + Back link present

### Console + memory

- [ ] No red errors in DevTools Console at any point
- [ ] JS heap < 100 MB after mount completes (DevTools Performance Monitor)

---

## When to Run

- **Before committing** any change to: `src/renderer/`, `src/animation/`,
  `src/app.tsx`, `src/main.tsx`, `src/landing.tsx`, or `assets/art/`
- **Always after**: lighting changes, material adjustments, camera moves,
  new visual systems, animation system changes
- **Not required for**: config-only changes, test-only changes, docs-only
  changes, sim/logic-only changes that don't touch render code

---

## Known Non-Issues (do not flag)

- Vite HMR `[vite] connecting...` / `[vite] connected.` debug lines in console
- Single-frame "Loading robots…" overlay in peek mode if assets are still
  fetching from a cold cache
- Brief black flash between Landing and peek-mode mount on slow connections
