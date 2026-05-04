# Winner Presentation — Game Design Document

> **Status**: Approved
> **Created**: 2026-05-04
> **Last Updated**: 2026-05-04
> **Sprint Task**: S6-05 (originally "Winner VFX"; renamed at Sprint 6 close to reflect what shipped)
> **Tier**: S
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Winner Presentation** system makes the winning robot
unambiguously legible to the viewer at race-end. It composes three
pieces:

1. The **Winner Camera** (covered structurally in the
   [Camera System GDD](camera-system.md), §3 R20–R25) — a hard cut to
   a 45° vantage framing the winner against the arena's focal
   landmark, with the winner rotated to face the camera.
2. The **WinnerCard** — a cyberpunk DOM panel anchored to the right
   side of the viewport, showing the winner's robot id, name, traits,
   and a small footer marker. Implemented as a Preact component in
   `src/app.tsx` (`WinnerCard`).
3. The **WIN indicator** in the camera control bar — a magenta pill
   that lights up in the top-right while the Winner Camera is active,
   so the user knows the panel and the camera move are linked.

The original Sprint 6 plan called this task "Winner VFX" and described
it as "minimum a tinted rim light or emissive boost; ideally a
particle accent." **No actual VFX shipped.** The chosen visual
distinguisher is camera composition + UI panel + face-the-camera
rotation override, not material or particle work. This is a deliberate
scope choice captured in the Sprint 6 retrospective; literal VFX
(rim / emissive / particles) is now in the v1.x deferred polish list.

The system is renamed from "Winner VFX" to "Winner Presentation" in
the systems index to reflect what actually ships.

---

## 2. Player Fantasy

> **"That's the one."**

A passive viewer should be able to walk away from the screen during
the last few seconds of a race, glance back at the moment of winner
reveal, and have zero ambiguity about which robot won. The visual
language we ship picks **camera + identity card** as the carrier of
that information, instead of the more conventional **highlight effect
on the winning robot**. Two reasons:

1. The camera framing — a hard cut from arena overview to a 45°
   shoulder-of-the-tree composition — is **already** unambiguous.
   Anything else is layered on top of an answer.
2. The WinnerCard surfaces what makes the winner **interesting** (their
   name, their trait fingerprint), not just **that** they won. This is
   on-brand for Robo Rhapsody — every robot is a named NFT, so
   identity-first presentation matches the IP rather than fighting it.

Particle bursts and rim lights remain attractive future polish; they
just don't carry the "who won" information by themselves.

---

## 3. Detailed Rules

### Render gates

- **R1.** The WinnerCard renders when ALL of:
  - `roster !== null` (roster has loaded)
  - `cameraTargetId === null` (no shoulder cam active)
  - `winnerCamSuppressed === false` (user hasn't clicked **Arena**)
  - `stats.isDone === true`
  - `stats.winnerId !== null`
- **R2.** The Winner Camera and the WinnerCard share **the same gate
  except** the Winner Camera additionally requires
  `built.winnerCamTarget !== undefined` (the arena must publish a
  focal landmark world-position). Sprint-race arenas do not publish
  a target; Arena-02 (maze) does. So:
  - Sprint-race winner: WinnerCard does **not** render (gate fails on
    `winnerCamTarget`'s knock-on suppression — see R3).
  - Maze-race winner: both render together.
- **R3.** The WinnerCard render gate in code is currently identical
  to R1 (no `winnerCamTarget` check). For sprint-race winners the
  card would in principle render against a non-existent winner cam.
  This is fine in practice because sprint-race v1 has no winner-cam
  target, so the `roster && cameraTargetId === null && !winnerCamSuppressed
  && stats.isDone && stats.winnerId !== null` predicate evaluates true
  and the card renders against the static follow-leader cam parked on
  the winner. **In v1 this is treated as a feature** — the card
  works for either camera mode as long as the winner is stationary
  and visible. The v1.x deferred work calls out giving sprint-race
  arenas their own `winnerCamTarget` (e.g., the finish line tape)
  so both arenas behave symmetrically.

### Winner Camera — see [Camera System GDD §3 R20–R25](camera-system.md)

Cross-reference only. The Winner Camera's framing rules, the
face-the-camera rotation override (the **only documented exception**
to "no non-sim writes to instance rotation"), and the tick / lifecycle
discipline live in the Camera System GDD. This file owns only the
**presentation composition** that surrounds it.

### WinnerCard panel

- **R4.** Anchored at `right: 24px; top: 50%` with
  `transform: translateY(-50%)` — vertically centred on the right
  side of the viewport. The Winner Camera frames its subjects toward
  screen-left, leaving the right side clean.
- **R5.** Width is fixed at `300px`. The panel is `position: absolute`
  inside the App's `position: fixed; inset: 0` root, so it floats over
  the canvas without consuming layout.
- **R6.** `pointerEvents: 'none'` — the panel is purely informational
  and never intercepts mouse events. This is critical because the
  cyberpunk drop-shadow extends visually beyond the box; without
  `pointer-events: none`, the user cannot click the **Race Again** /
  **Arena** controls beneath it.
- **R7.** The panel renders four elements in order:
  1. Header row: a magenta "▍ WINNER" tag + a cyan `ID #NN` (zero-padded).
  2. Robot name in 20 px Inter, weight 700, magenta-glow text-shadow.
  3. Cyan-fading-to-transparent horizontal rule.
  4. Five `TraitBar` rows — one per trait (`FULL SEND`, `DEGEN`,
     `CIPHER`, `DOUBTER`, `ALTRUIST`).
  5. Right-aligned footer marker `ROBO_RHAPSODY · v0.1`.
- **R8.** Each `TraitBar` shows a label-coloured numeric value
  zero-padded to 2 chars and a 4 px-tall progress bar at `value%`
  fill. The fill colour is per-trait — see §4 for the palette.

### WIN pill (in CameraControl)

- **R9.** The WIN pill is rendered in the top-right
  **Arena / Robot # / WIN / input** bar when
  `winnerCamActive === true`, where `winnerCamActive ===
  cameraTargetId === null && !winnerCamSuppressed && stats.isDone &&
  stats.winnerId !== null`.
- **R10.** Visual style: magenta `#ff2ec4` background, magenta-glow
  shadow, dark text `#0a0a0f`, letter-spaced `0.08em`.
- **R11.** The pill is non-interactive. It is purely a state
  indicator — not a button. (Compare to the **Arena** button which is
  the one that toggles `winnerCamSuppressed`.)

### Lifecycle

- **R12.** The WinnerCard mounts and unmounts as a normal Preact
  conditional. There is **no** transition animation in v1 — the card
  appears the same frame the Winner Camera cuts. This is intentional
  for the same reason the Winner Camera doesn't lerp in: the cut
  punctuates the ending; the panel arriving simultaneously feels like
  the same beat.
- **R13.** Race Again clears all winner state (`stats.winnerId = null`,
  `stats.isDone = false`, `winnerCamSuppressed = false`,
  `cameraTargetId = null`) before the new sim starts. The WinnerCard
  unmounts on the same frame.

---

## 4. Formulas

### Trait colour palette

```
TRAIT_COLORS = {
  FULL SEND: '#ff2ec4',   // brand magenta
  DEGEN:     '#ffb84a',   // amber
  CIPHER:    '#22e6ff',   // brand cyan
  DOUBTER:   '#a288ff',   // violet
  ALTRUIST:  '#7dff9e',   // mint
}
```

The palette is hard-coded in `WinnerCard` per-trait. The brand
magenta + cyan match `src/landing.tsx`'s palette
(`COLORS.brand = '#ff2ec4'`, `COLORS.accent = '#22e6ff'`); the
amber / violet / mint values are net-new for trait differentiation.

### TraitBar fill width

```
pct = clamp(value, 0, 100)
fill_width_px = (pct / 100) * panel_inner_width
```

`panel_inner_width` = `300px - 2*18px` padding = `264px`.

### Card placement

```
right  = 24
top    = 50%
y      = top - card_height / 2     // via translateY(-50%)
```

No code reads card height; the CSS centring handles it.

### Cut timing

```
WinnerCamera fires:    same frame as `simEnd` event reaches the App
                        shell (via the bridge's onEvent → setStats)
WinnerCard mounts:     same frame, same Preact render pass
```

There is no scheduled delay; both are gated on `stats.isDone &&
stats.winnerId !== null` becoming true.

---

## 5. Edge Cases

| Case | Behaviour |
|------|-----------|
| Roster fails to load | `roster === null` → WinnerCard never renders. Winner Camera still fires (if its independent gate passes). The viewer sees the camera move but no info card — visually incomplete but not broken. |
| `winner.name` is empty string | Renders as a 14 px-margin gap below the header. No fallback (e.g., "Robot 57") in v1. The roster contract (§Roster Loader) says `name` is a non-empty string from CSV, so this is theoretical. |
| `winner.traits.<trait>` is `> 100` or `< 0` | TraitBar clamps to `[0, 100]` for the fill width but renders the raw integer in the label. v1 trait values are always in `[0, 100]` per CSV, so this is also theoretical. |
| Trait value is non-integer (e.g., post-rebalance fractional) | Renders the raw `String(value)` after `padStart(2, ' ')`. Will look ugly for `String(7.5).padStart(2, ' ')` = `'7.5'`. Trait values are integers in v1; revisit if rebalance lands floats. |
| User clicks **Arena** mid-card | `winnerCamSuppressed = true` → BOTH the Winner Camera and WinnerCard unmount on the next render. The user sees the wide static (maze) or follow-leader (sprint, parked) view. |
| User types a robot id mid-card | `cameraTargetId = N` → BOTH the Winner Camera and WinnerCard unmount; shoulder cam mounts. |
| User clicks **Race Again** mid-card | Card unmounts first as the new render gate fails (`stats.winnerId` is reset to `null` on the same React state batch). New race plays out; new card mounts on its own race-end. |
| Sprint-race winner | WinnerCard renders against the static follow-leader cam parked on the winner (R3). Visual quality is acceptable in playtests; no winner-cam composition is missed. |
| Multiple racers tie at the same finish tick | The Sim Engine's tie-break (id-ascending) yields a single `winnerId`. Presentation system never sees ties. |

---

## 6. Dependencies

### Inbound (this system depends on)

- **[Camera System](camera-system.md)** — owns the Winner Camera mode
  that this system relies on for visual emphasis. This GDD only
  references the Camera GDD's R20–R25; it does not duplicate them.
- **[Sim Driver](sim-driver.md) + Sim ↔ Renderer Bridge** — the
  bridge surfaces the `simEnd` event with `winnerId` to the App
  shell, which sets `stats.winnerId` and triggers the gate. The Sim
  Driver itself is only used indirectly via `driver.isDone()`.
- **[Robot Roster Loader](robot-roster-loader.md)** — the WinnerCard
  reads `winner.name` and `winner.traits.*` from a `RobotRosterEntry`.
  The shell's `roster` state is populated on initial load.
- **[Preact App Shell](preact-app-shell.md)** — owns the render gate,
  the React state that drives `stats.isDone` / `stats.winnerId`, and
  the `WinnerCard` / `CameraControl` component lifecycles.
- **[Config Module](config-module.md)** — none currently. (See §7.)

### Outbound (these systems depend on this)

- None in v1. The Winner Presentation is a leaf in the dependency
  graph: it consumes everything else that has finished and produces
  no further state.

### Forbidden dependencies

- The WinnerCard does not import from `@/sim` directly. Its sole sim
  data path is `winner: RobotRosterEntry`, threaded in by the App
  shell from `roster[stats.winnerId]`.
- No camera-mutating logic lives in this system. The face-the-camera
  rotation override is owned by the Winner Camera in the Camera
  System GDD, not here.

---

## 7. Tuning Knobs

| Knob | Current location | Effect | Promotion candidate? |
|------|------------------|--------|----------------------|
| Card width (`300px`) | `WinnerCard` inline style | Affects right-side viewport intrusion | No — sized to fit content |
| Card vertical anchor (`top: 50%`) | `WinnerCard` inline style | Vertical placement | No — the Winner Cam frames toward screen-left consistently |
| Trait colour palette | `TRAIT_COLORS` const | Per-trait identity colour | Yes, if a v1.x palette refresh lands |
| Cyberpunk glow shadow values | `WinnerCard` inline style | Visual intensity | Yes, if a "Polish" tuning pass surfaces it |
| WIN pill colour (`#ff2ec4`) | `CameraControl` inline style | Active-state highlight colour | Yes — should align with the trait palette in any future migration |

**No values currently in `CONFIG`.** The system is presentation-only
and the inline styles are the contract. If a future "branding" or
"theming" pass arrives, the palette migrates to `CONFIG.theme.*` (or
similar) and the inline styles read from there.

The card's text contents come from the `RobotRosterEntry` and are
**not** tuning knobs — they are content, owned by the CSV / JSON
roster.

---

## 8. Acceptance Criteria

Verified manually in browser (these are presentation criteria; no
useful headless test exists short of jsdom screenshot diffing, which
is out of scope for v1).

### Render gates

- [ ] **AC-1.** WinnerCard does NOT render at race-start (gate:
  `stats.winnerId === null`).
- [ ] **AC-2.** WinnerCard renders the moment `simEnd` arrives, on the
  same frame as the Winner Camera cut (maze) or the follow-leader
  parked-on-winner state (sprint).
- [ ] **AC-3.** Clicking **Arena** unmounts the WinnerCard and the
  WIN pill on the next frame.
- [ ] **AC-4.** Typing a valid robot id unmounts the WinnerCard and
  WIN pill; clearing the input remounts them (provided race is done).
- [ ] **AC-5.** Race Again clears the card before the new sim starts.

### Visual contract

- [ ] **AC-6.** Card is anchored top-right at `top: 50%` with no
  intersection with the **CAM Arena / Robot #** control bar.
- [ ] **AC-7.** All five trait rows are rendered with the correct
  per-trait colour from `TRAIT_COLORS`.
- [ ] **AC-8.** Numeric trait values render zero-padded to 2 chars.
- [ ] **AC-9.** Card has `pointer-events: none`; the user can click
  through it to controls beneath.
- [ ] **AC-10.** Footer marker `ROBO_RHAPSODY · v0.1` is right-aligned.
- [ ] **AC-11.** WIN pill renders in the camera control bar exactly
  when `winnerCamActive` is true; otherwise omitted.

### Composition with Winner Camera

- [ ] **AC-12.** On Arena-02 race-end, the camera composition (winner
  + tree at 45°) and the right-anchored WinnerCard do not overlap; the
  winner sits screen-left of the card.
- [ ] **AC-13.** The face-the-camera rotation override (Camera GDD
  R23) keeps the winner visually presented to the viewer regardless
  of finish heading; the WinnerCard's content reads as "about" the
  same robot facing forward in frame.

### Forbidden patterns

- [ ] **AC-14.** WinnerCard does not call `Math.random` (Vitest spy
  if a future test is added).
- [ ] **AC-15.** WinnerCard does not import from `@/sim`.
- [ ] **AC-16.** WinnerCard contents come from `RobotRosterEntry`
  fields only — no derived sim values.

### What this system does NOT do (intentional cuts)

- ❌ No rim light / emissive boost on the winner robot.
- ❌ No particle burst / accent.
- ❌ No spotlight or victory animation.
- ❌ No transition lerp on either the camera cut or the card mount.
- ❌ No audio sting (audio is not in v1 at all).

These are the items the original Sprint 6 plan listed as Winner VFX
candidates that did not ship. They are not failures — they are scope
decisions, captured in the Sprint 6 retrospective and re-entered into
the deferred-roadmap as v1.x polish.

---

## Implementation Notes

- Files:
  - `WinnerCard` + `TraitBar` + `WIN` pill: [`src/app.tsx`](../../src/app.tsx) (lines ~792–963 for the card; lines ~526–640 for the pill within `CameraControl`).
  - Winner Camera: [`src/camera/winner-camera.ts`](../../src/camera/winner-camera.ts) — covered in [Camera System GDD §3 R20–R25](camera-system.md).
- Total LOC owned by this system: ~170 (the WinnerCard + TraitBar Preact components).
- Shipped in commit `34829ce` ("Winner cam + cyberpunk WinnerCard +
  Cipher rebalance"), end of Sprint 6.
- Original Sprint 6 plan (`production/sprints/sprint-06.md`, S6-05)
  used the name "Winner VFX" and listed acceptance criteria that
  presupposed shader/material/particle work. This GDD captures the
  shipped reality and the systems index is updated to match.
- The v1.x deferred polish list now carries: rim/emissive winner
  highlight, particle accent, transition animations on card + camera,
  and per-arena `winnerCamTarget` for sprint-race symmetry.
