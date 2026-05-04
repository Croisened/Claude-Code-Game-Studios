# Bundle-Size Baseline

> **Status**: Baseline
> **First captured**: 2026-04-24 (end of Sprint 4)
> **Source**: Sprint 4 retro AI #2; tracked in [sprint-05.md](../../production/sprints/sprint-05.md) S5-07

## Why this exists

Sprint 4 shipped the Sneak Peek route, which switched from a build-time
DEV/Landing toggle to runtime hash routing. The production bundle now includes
the App shell, Three.js, addons (`GLTFLoader`, `RoomEnvironment`), the renderer,
and the animation state switcher for **all** Landing visitors — even those who
never click Sneak Peek. This file records the post-Sneak-Peek baseline so future
sprints have a number to defend against.

## Measurement procedure

```bash
npm run build
du -h dist/index.html dist/assets/index-*.js
du -sh dist/assets/art dist/assets/audio
```

Record raw + gzip sizes from Vite's stdout; the gzip number is what users actually
download. Re-run at the close of any sprint that adds runtime dependencies, new
routes, or non-trivial code volume.

## Baseline (2026-04-24, end of Sprint 4)

| Artifact | Raw | Gzip | Loaded when |
|----------|-----|------|-------------|
| `dist/index.html` | 0.59 kB | 0.40 kB | Always (initial paint) |
| `dist/assets/index-*.js` (single chunk) | 605.93 kB | **158.92 kB** | Always (initial paint) |
| `dist/assets/art/` (96 files: 85 skin textures + robot GLB + supporting maps) | 259 MB | n/a | Lazy: only on `/#peek` route |
| `dist/assets/audio/` (5 files) | 748 KB | n/a | Lazy: not currently loaded by code |

**Initial Landing-page payload**: **~160 kB gzip** (0.4 kB HTML + 158.92 kB JS).

**Total `dist/` on disk**: 260 MB. Driven almost entirely by 85 skin PNGs +
robot GLB/maps under `dist/assets/art/characters/robot/` (249 MB). These do not
ship to Landing visitors; they are fetched only when the user enters the
`/#peek` route and the renderer starts loading robot assets.

## Vite warnings at this baseline

> `(!) Some chunks are larger than 500 kB after minification.`

The JS chunk crosses Vite's default 500 kB warning threshold (605.93 kB raw
before gzip). This is informational. The gzip-on-the-wire size (158.92 kB) is
the load-time concern, and that is well within reasonable Landing budgets.

Code-splitting options exist if the bundle grows further:

- Dynamic-import the renderer + Three.js so `/#peek` is a separately-fetched chunk.
- `build.rollupOptions.output.manualChunks` to split vendor (Three.js + addons)
  from app code.
- Raise `build.chunkSizeWarningLimit` if the warning becomes noise.

None of these are needed today. The current single-chunk approach is simplest
and the gzip size is acceptable.

## Composition of the JS bundle (qualitative)

The 605 kB raw chunk is dominated by:

1. Three.js core (`three`) — by far the largest contributor; rendering, scene
   graph, animation, geometry, materials.
2. Three.js addons — `GLTFLoader`, `RoomEnvironment`, `PMREMGenerator` (loaded
   via `three/addons/`).
3. App code — `src/main.tsx`, `src/app/`, `src/landing/`, `src/peek/`,
   `src/renderer/`, `src/animation/`, `src/config/`, `src/sim/rng/`.
4. Preact + `@preact/preset-vite` runtime — small relative to Three.js.

Three.js is the load-bearing cost; nothing else moves the needle by more than a
few kB. Treat Three.js as a fixed cost; budget around it.

## Trend

| Sprint | Date | Initial JS gzip | Δ vs prior | Notes |
|--------|------|-----------------|------------|-------|
| Sprint 4 | 2026-04-24 | 158.92 kB | — | First post-pivot baseline. Sneak Peek route added; renderer + animation system included in Landing bundle. |
| Sprint 5 | 2026-04-24 | 158.93 kB | +0.01 kB | Sim engine, sprint race module, harness, two GDDs added under `src/sim/` and `tools/sim/`. None of it is reachable from Landing — the bundle is unchanged within rounding. |
| Sprint 6 | 2026-05-04 | 173.60 kB | +14.67 kB | Sim Driver + Sim ↔ Renderer Bridge + four-mode Camera System + maze arena (Arena-02) + maze-walls / finish-tree visuals + WinnerCard UI + cyberpunk landing/peek styling. First sprint to materially move the bundle since the pivot. Within the 200 kB defensibility threshold (~26 kB headroom remaining). The 500 kB raw-chunk warning still applies; not yet acted on. |

Future sprints append a row when the bundle is re-measured.

## Defensibility threshold

Soft target: keep initial-Landing JS gzip **under 200 kB** for v1. That leaves
~40 kB of headroom for Sprint 6 work (Camera System, Winner VFX, Preact App
Shell additions). If a sprint's added code pushes the bundle past 200 kB,
revisit code-splitting before merging.

This threshold is a guideline, not a gate — the v1 product is a desktop-web
event-watcher, not a mobile-first, latency-sensitive surface. The number is
here mainly to detect surprise regressions.
