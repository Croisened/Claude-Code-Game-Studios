# Environment Renderer

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: The City Hunts You, Two-Week Discipline

## Overview

The Environment Renderer owns the Neotropolis world that surrounds and passes the
runner: the three-lane track surface, the flanking cityscape, and any decorative
background geometry. It creates the illusion of forward movement by continuously
recycling a pool of environment chunks — as each chunk scrolls behind the camera,
it is repositioned ahead and reused. The player never consciously interacts with
this system; they experience it as speed, atmosphere, and the sensation that the
city is rushing past them. Without it, the runner has no world to inhabit, no sense
of velocity, and no visual confirmation that "The City Hunts You."

At MVP scope, the environment is functional placeholder geometry — lane tiles and
minimal flanking shapes. The v1 Neotropolis art pass replaces the placeholders
without changing the system's architecture.

## Player Fantasy

The environment is the city's hostility made visible. At low speeds, Neotropolis
feels vast and indifferent — chrome corridors stretching into the distance, neon
signs flickering past. As speed escalates, it compresses: the city is closing in,
the reaction window shrinks, the visual noise intensifies. The player doesn't think
"tiles are recycling" — they think "I'm going too fast for this city." Speed is the
primary aesthetic. The environment's job is to make every distance milestone feel
earned and every death feel like the city finally caught up with the robot.

## Detailed Design

### Core Rules

1. The environment is a fixed pool of **4 chunks** positioned sequentially along the
   Z axis at startup. This count is a tuning knob.
2. Each chunk consists of: a lane floor plane (spanning all 3 lanes) and optional
   flanking geometry (walls, buildings). At MVP, chunks are identical flat planes
   with placeholder flanking boxes.
3. During `Running` state, each chunk moves along +Z at `scrollSpeed` units/second
   per render tick (`chunk.position.z += scrollSpeed * delta`).
4. When a chunk's Z position exceeds the recycle threshold (`robotZ + recycleBuffer`),
   it is teleported ahead: `chunk.position.z -= chunkCount * chunkLength`. This
   creates the seamless scroll loop.
5. The robot stays at a fixed Z position. The camera stays at a fixed offset behind
   the robot. Forward velocity is visual only — created by scrolling world geometry,
   not by moving the robot through it.
6. The system owns and exposes three lane center X positions as named constants:
   `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` (default: −3, 0, +3 units). These are
   the canonical lane positions used by all systems — Runner System, Obstacle System,
   and Camera System read them from the Environment Renderer, never hardcode them.
7. The system does not calculate scroll speed. It exposes `setScrollSpeed(speed: number)`.
   **The Runner System is the sole caller of this method** — it calls it every tick
   with the current forward speed. The Difficulty Curve updates the Runner System's
   internal speed value; the Runner System propagates that value to the Environment
   Renderer. No other system calls `setScrollSpeed`.
8. Chunk recycling runs every tick during `Running` state only. All other states
   freeze chunk positions in place.

### States and Transitions

The Environment Renderer has no internal state machine. Its behavior is a direct
function of Game State Manager events. All transitions are driven externally.

| GSM Transition | Environment Renderer Action |
|----------------|-----------------------------|
| `→ Loading` | Instantiate chunk pool; position chunks sequentially; apply materials; do not scroll |
| `→ MainMenu` | Hold chunk positions frozen; environment visible as static backdrop |
| `→ Running` (from MainMenu) | Begin chunk scrolling at initial `scrollSpeed`; recycle loop active |
| `→ Dead` | Stop scrolling immediately; hold all chunks at current positions |
| `→ ScoreScreen` | Hold frozen; environment visible behind score overlay |
| `→ Running` (restart from ScoreScreen) | Reset all chunks to their starting Z positions; reset `scrollSpeed` to initial value; resume scrolling |
| `→ Leaderboard` | Hold frozen; environment not visible (menu layer covers scene) |

**Restart behavior**: On every restart, chunks snap back to their initial layout. Each
run begins from an identical visual starting state.

### Interactions with Other Systems

| System | Direction | Interface |
|--------|-----------|-----------|
| Game State Manager | ER listens | Subscribes to `stateChanged(from, to)`; drives scroll behavior per the States table above |
| Runner System | ER receives | Runner System calls `ER.setScrollSpeed(speed)` every tick — it is the sole caller. Difficulty Curve updates Runner System's speed; Runner System propagates it here. |
| Difficulty Curve | Indirect | Difficulty Curve writes to Runner System's speed value; Runner System relays it to ER via `setScrollSpeed`. Difficulty Curve does NOT call ER directly. |
| Runner System | ER exposes | `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` constants; Runner System reads these for valid robot X positions |
| Obstacle System | ER exposes | `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` constants; Obstacle System reads these to place obstacles in valid lane positions |
| Camera System | ER exposes | `LANE_CENTER` and `laneSpacing` inform the Camera System of playfield width for framing decisions |

## Formulas

**Chunk recycling threshold:**

In Three.js, `Object3D.position` is the **center** of the mesh. Recycling must check
the chunk's back face (the last part to pass the camera), not the center:
```
chunkBackFace = chunk.position.z + chunkLength / 2
recycleThreshold = robotZ + recycleBuffer
if chunkBackFace > recycleThreshold:
    chunk.position.z -= chunkCount × chunkLength
```

**Variable table:**

| Variable | Description | Default |
|----------|-------------|---------|
| `robotZ` | Fixed Z position of the robot (world origin) | 0 |
| `recycleBuffer` | Clearance past robot before back face triggers recycle | 5 units |
| `chunkCount` | Number of chunks in the pool | 4 |
| `chunkLength` | Z-depth of one environment chunk | 20 units |
| `laneSpacing` | Distance from center lane to outer lanes | 3 units |

**Initial chunk layout:**

Chunks are positioned so all geometry starts **ahead** of the robot (negative Z).
Using center-based positioning:
```
chunk[i].position.z = -(i + 0.5) × chunkLength
```
At 4 chunks of 20 units each: centers at Z = −10, −30, −50, −70.
Each chunk's back face (at center + 10) sits at Z = 0, −20, −40, −60 — the back face
of chunk[0] starts exactly at the robot position, with all geometry ahead of it.

**Lane X positions:**
```
LANE_LEFT   = −laneSpacing  (default: −3)
LANE_CENTER = 0
LANE_RIGHT  = +laneSpacing  (default: +3)
```
Total playfield width = 2 × laneSpacing = 6 units.

**Pool coverage sanity check** (must hold true; assertion at startup):
```
chunkCount × chunkLength > cameraFarDistance
```
At defaults (4 × 20 = 80 units), this exceeds any reasonable camera draw distance.
If this assertion fails, increase `chunkCount` or `chunkLength`.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| `scrollSpeed` is 0 before first `setScrollSpeed` call | Chunks do not move; environment is static until Runner System provides a speed value | Safe default; environment waits to be driven |
| `setScrollSpeed` called with a negative value | Clamp to 0; log a warning | Negative scroll moves environment the wrong direction; indicates a caller bug |
| Frame spike (delta > 500ms, e.g. tab losing and regaining focus) | Clamp delta to max 100ms: `delta = Math.min(delta, 0.1)` | An uncapped delta spike could teleport chunks past the recycle threshold into visible range, causing a seam pop |
| `chunkCount × chunkLength` coverage falls below camera draw distance (misconfiguration) | Assert at startup; log error; do not crash — but the loop seam will be visible | Configuration error, not runtime error; caught at init, not during play |
| Obstacle Z position coincides with a chunk seam at recycle moment | No special handling — obstacles are managed by the Obstacle System independently; Environment Renderer moves floor/flanking geometry only, never obstacles | Environment Renderer has no knowledge of obstacle positions |
| v1 art chunks recycled in a visually obvious repeating pattern | Shuffle recycle order or cycle through a larger chunk variety pool — deferred to v1 art pass decision | MVP chunks are identical placeholders; pattern repetition is only noticeable with varied art |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Game State Manager | Upstream | ER subscribes to `stateChanged`; drives scroll on/off and reset behavior | **Hard** — without GSM, ER has no trigger to start/stop scrolling |
| Runner System | Downstream | Runner System calls `ER.setScrollSpeed(speed)` and reads `LANE_*` constants | **Hard** — Runner System cannot position the robot without lane constants; ER scroll without speed input is static |
| Difficulty Curve | Indirect downstream | Difficulty Curve updates Runner System speed; Runner System relays to ER. Difficulty Curve has no direct interface with ER. | **Soft** — ER scrolls at fixed initial speed without Difficulty Curve; v1 feature |
| Obstacle System | Downstream | Obstacle System reads `LANE_*` constants for obstacle placement | **Soft** — Obstacle System cannot place obstacles in valid lanes without these; ER functions without it |
| Camera System | Downstream | Camera System reads `LANE_CENTER` and `chunkWidth` for framing | **Soft** — Camera can estimate framing without ER; soft until Camera System GDD is written |

**Bidirectional note**: The Game State Manager GDD interaction table lists Environment
Renderer behavior for `→ Running`, `→ Dead`, `→ ScoreScreen`, and `→ MainMenu`. The
contracts defined here are consistent with those entries.

**Provisional contracts** (downstream systems not yet designed):
- Runner System is the sole caller of `setScrollSpeed()` and must call it every tick
  (not only on speed change). This ensures ER always has a current value.
- Difficulty Curve must NOT call `setScrollSpeed()` directly. It updates Runner
  System's speed; Runner System propagates to ER.
- `LANE_LEFT`, `LANE_CENTER`, and `LANE_RIGHT` are read-only constants. No system
  other than Environment Renderer may modify them.

## Tuning Knobs

| Knob | Default | Safe Range | Effect | Breaks If… |
|------|---------|------------|--------|------------|
| `chunkCount` | 4 | 3 – 8 | Number of chunks in the recycle pool | < 3: pool coverage may fall below camera draw distance; > 8: unnecessary geometry in scene |
| `chunkLength` | 20 units | 10 – 40 units | Z-depth of each chunk | Too short: recycle seams visible; too long: coarser visual variation in v1 |
| `recycleBuffer` | 5 units | 2 – 10 units | Distance behind robot before a chunk is recycled | Too small: chunk edge visible during recycle; too large: chunk stays in scene beyond draw distance |
| `laneSpacing` | 3 units | 2 – 5 units | Distance from center lane to outer lanes | Changing requires simultaneous updates to Camera System framing and Obstacle System placement |
| `initialScrollSpeed` | 8 units/s | 4 – 12 units/s | Scroll speed at run start, before Difficulty Curve changes | Too slow: no urgency; too fast: no learning window for new players |
| `deltaClamp` | 0.1s | 0.05 – 0.2s | Max frame delta (prevents spike teleports on tab switch/freeze) | Too low: stutters on slow devices; too high: frame spike causes visible chunk pop |

All knobs live in `ENVIRONMENT_RENDERER_CONFIG`. No magic numbers in code.

## Visual/Audio Requirements

### MVP (placeholder — function over form)

- **Lane floor**: flat `PlaneGeometry` spanning all 3 lanes. Solid dark grey (#222222), no texture. **Important**: Three.js `PlaneGeometry` defaults to the XY plane (vertical). Apply `mesh.rotation.x = -Math.PI / 2` to lay it flat as a floor.
- **Lane dividers**: thin `BoxGeometry` strips at ±`laneSpacing` X. Slightly lighter grey (#444444).
- **Flanking geometry**: simple `BoxGeometry` blocks on each side at varying heights — stand-ins for buildings. Flat dark colors only.
- **Lighting**: single directional light + ambient. Shadows optional at MVP.

### v1 (Neotropolis art pass — replaces materials and flanking meshes; chunk architecture unchanged)

- **Lane floor**: neon-lit track surface with emissive cyan/magenta edge strips along lane dividers.
- **Flanking buildings**: stylized cyberpunk architecture — vertical chrome towers, neon signage panels, surveillance camera silhouettes. Mid-polygon count.
- **Background**: Neotropolis night skyline — deep blue-black sky, distant building cluster with colored ambient glow.
- **Atmosphere**: `THREE.Fog` applied to scene to fade far geometry and naturally hide the chunk recycle seam.
- **Color palette**: dark greys/blacks (ground), cyan/electric blue (primary neon), magenta/pink (secondary neon), chrome/silver (structures).
- **References**: Cyberpunk 2077 street-level aesthetic; Ghost in the Shell city density; existing Robo Rhapsody collection visual language.

### Audio

The Environment Renderer produces no audio. Speed-responsive audio (wind intensity,
ambient city sound) is owned by the Audio System, which reads game state and current
speed independently.

## UI Requirements

[To be designed]

## Acceptance Criteria

- [ ] 4 environment chunks are instantiated and visible in the Three.js scene before `MainMenu` state is entered
- [ ] Chunks are stationary during `MainMenu` state; no scroll movement visible
- [ ] Chunk scrolling begins immediately on `→ Running` transition at `initialScrollSpeed`
- [ ] No visible seam or pop occurs during chunk recycling at default settings
- [ ] `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` constants are exported and accessible by other systems before the first run begins
- [ ] `setScrollSpeed(0)` stops scrolling; `setScrollSpeed(n)` resumes at the new rate within the same tick
- [ ] `setScrollSpeed(negativeValue)` clamps to 0 and logs a console warning; does not produce backward scroll
- [ ] On restart (`ScoreScreen → Running`), all chunks reset to their starting Z positions and `scrollSpeed` resets to `initialScrollSpeed`
- [ ] Scrolling stops on `→ Dead`; chunk positions are frozen within 1 frame of the state change
- [ ] Frame delta spike (simulated delta = 1.0s) does not produce a visible chunk pop (delta clamp verifiable by inspection)
- [ ] Startup assertion logs an error if `chunkCount × chunkLength` < camera draw distance
- [ ] Environment renders at 60fps on mid-range desktop hardware during `Running` state alongside the Character Renderer
- [ ] All tuning knobs are defined in `ENVIRONMENT_RENDERER_CONFIG`; no magic numbers in source code

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| How many visually distinct chunk variants in v1? | Developer / Artist | v1 art planning | Unresolved — minimum recommendation: 3 variants to avoid obvious repetition |
| Should chunks recycle in fixed sequence or randomized order in v1? | Developer | v1 implementation | Unresolved — flagged in Edge Cases; MVP chunks are identical so not yet relevant |
| Does the lane floor need a scrolling texture (UV animation) to reinforce forward motion, or does geometry movement alone suffice? | Developer | After MVP prototype playtest | Unresolved — evaluate feel empirically before committing |
| How many polygons can flanking geometry carry before 60fps is at risk? | Developer | Performance profile during MVP build | Unresolved — use geometry instancing for repeated building elements |
| Should `THREE.Fog` be present at MVP, or deferred to v1 art pass? | Developer | MVP build decision | Deferred to v1 — fog is polish, not function |
| Is the chunk recycle seam invisible at default scroll speed, or does it need explicit masking (fog, speed blur)? | Developer | MVP prototype test | Unresolved — test empirically; if seam is visible, add fog before art pass |
