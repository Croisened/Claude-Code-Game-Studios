# Audio System

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-04-01
> **Implements Pillar**: The City Hunts You

## Overview

The Audio System manages all sound in Robo Rhapsody: a looping background music
track and four game-event SFX (run loop, jump, lane change, death). It subscribes
to GSM state transitions to start/stop music and SFX at the correct moments. It is
driven by the Web Audio API via HTML5 `<audio>` elements — no external library. A
global mute toggle persists across sessions via `localStorage`. The system has no
update loop; all audio is event-driven except the run loop, which is tied to
Running state entry/exit.

## Player Fantasy

Sound is the nervous system of the run. The music doesn't play *at* the player —
it runs alongside them, a neon pulse that makes the city feel alive and the escape
feel urgent. SFX are crisp and responsive: every jump, every lane shift is
confirmed in the player's ears a split-second before they see it land. The death
sound is the emotional full stop — a descending tone that says "you got caught"
with finality, not cruelty. Muting the game doesn't break it; the player who plays
in silence still has a complete experience. But the player with audio on feels
faster.

## Detailed Rules

### Sound Inventory

| ID | File | Type | Trigger | Loop |
|----|------|------|---------|------|
| `SFX_RUN` | `sfx/run-loop.wav` | SFX | Running state entry | Yes — until Running exits |
| `SFX_JUMP` | `sfx/jump.wav` | SFX | Jump input accepted | No |
| `SFX_LANE` | `sfx/lane-change.wav` | SFX | Successful lane change | No |
| `SFX_DEATH` | `sfx/death.wav` | SFX | `→ Dead` transition | No |
| `MUS_LOOP` | `music/music-loop.wav` | Music | `→ MainMenu` transition | Yes — until `→ Dead` |

### Playback Rules

1. **Music** starts on `→ MainMenu` and loops continuously. It stops (fade out over
   0.5s) on `→ Dead`. It resumes (fade in over 0.5s) on the next `→ MainMenu` or
   `→ Running` transition.
2. **SFX_RUN** starts on `→ Running`, loops until `→ Dead` or `→ MainMenu`, then
   stops immediately (no fade).
3. **SFX_JUMP** fires at the moment the jump input is accepted — only when
   `LocomotionState` transitions to `Jumping`. It does not fire if the jump is
   rejected (e.g. already airborne).
4. **SFX_LANE** fires at the moment a lane change succeeds — only if the robot
   actually moves (boundary rejections produce no sound).
5. **SFX_DEATH** fires on `→ Dead`. It plays once to completion regardless of mute
   state changes mid-play. *(Muting mid-death-sound cuts it immediately — see Edge
   Cases.)*
6. **Mute toggle**: a single boolean `audioMuted` stored in `localStorage`. When
   `true`, all `<audio>` elements have `volume = 0`. Toggling un-mutes by restoring
   each element's configured volume. The mute state applies immediately to any
   currently playing audio.
7. All audio elements are pre-loaded at system construction (`preload="auto"`). No
   audio is loaded on demand during a run.

## Formulas

### Volume Levels

All volumes are on a 0.0–1.0 scale (Web Audio / HTML `<audio>` native range).

| ID | Base Volume | Rationale |
|----|-------------|-----------|
| `SFX_RUN` | 0.3 | Continuous — must sit below music without masking it |
| `SFX_JUMP` | 0.6 | One-shot — needs to cut through the mix clearly |
| `SFX_LANE` | 0.5 | One-shot — audible but not jarring at high frequency |
| `SFX_DEATH` | 0.7 | Punctuation moment — should be the loudest SFX |
| `MUS_LOOP` | 0.4 | Background — present but never dominant |

### Music Fade Formula

Linear volume ramp applied via `setInterval` at 16ms tick resolution:

```
fadeStep = (targetVolume - currentVolume) / (fadeDuration / 16)
```

- **Fade out** (`→ Dead`): `targetVolume = 0`, `fadeDuration = 500ms`
- **Fade in** (`→ MainMenu` / `→ Running`): `targetVolume = MUS_LOOP base volume`,
  `fadeDuration = 500ms`
- Ramp is cancelled and restarted if a new fade is triggered before the previous
  completes.

*Example — fade out:* `currentVolume = 0.4`, `fadeDuration = 500ms` →
`fadeStep = (0 − 0.4) / (500/16) ≈ −0.013` per tick. After ~31 ticks (≈496ms)
volume reaches 0.

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Browser blocks autoplay on first load | Music does not start until the first user interaction (click/keypress). The GSM is already in `MainMenu` by then — the audio system retries `music.play()` on the first `pointerdown` or `keydown` event, then removes the listener. |
| Player restarts mid-death-sound (`→ Dead → MainMenu → Running` quickly) | `SFX_DEATH` is stopped immediately on `→ MainMenu`. `SFX_RUN` starts fresh on `→ Running`. Music fade-in begins on `→ MainMenu`. |
| Player spams lane change | Each successful lane change triggers `SFX_LANE`. The element is rewound (`currentTime = 0`) and replayed — overlapping plays on the same element are not supported; the previous instance is cut. |
| Player spams jump (rejected) | `SFX_JUMP` does not fire for rejected jumps. No double-jump sound. |
| Mute toggled while music is fading | The fade interval is cancelled. Volume is set to `0` immediately (mute) or to `MUS_LOOP base volume` immediately (unmute). No partial fade states persist. |
| Audio file fails to load | The element's `error` event is caught and logged. The system continues without that sound — no throw, no broken state. |
| Tab is backgrounded mid-run | Browser suspends the audio context. On tab restore, `<audio>` playback resumes automatically — no explicit resume needed. |

## Dependencies

### Inbound (systems AudioSystem depends on)

| System | What it uses |
|--------|-------------|
| `GameStateManager` | Subscribes to state transitions to start/stop music and SFX |
| `RunnerSystem` | Subscribes to `collisionDetected` event (via callback registered in `main.ts`) to trigger `SFX_DEATH` |
| `InputSystem` (indirect) | `SFX_JUMP` and `SFX_LANE` are triggered by `RunnerSystem` calling back into `AudioSystem` — `AudioSystem` never reads input directly |

### Outbound (systems that depend on AudioSystem)

| System | What it provides |
|--------|-----------------|
| `GameUI` | Mute toggle button calls `AudioSystem.toggleMute()` |
| `RunnerSystem` | Must expose `onJump(cb)` and `onLaneChange(cb)` callbacks so `AudioSystem` can subscribe without coupling to `InputSystem` |

### Asset Dependencies

| Asset | Path | Required by |
|-------|------|------------|
| Run loop | `assets/audio/sfx/run-loop.wav` | `SFX_RUN` |
| Jump SFX | `assets/audio/sfx/jump.wav` | `SFX_JUMP` |
| Lane change SFX | `assets/audio/sfx/lane-change.wav` | `SFX_LANE` |
| Death SFX | `assets/audio/sfx/death.wav` | `SFX_DEATH` |
| Music loop | `assets/audio/music/music-loop.wav` | `MUS_LOOP` |

## Tuning Knobs

| Knob | Default | Safe Range | Effect |
|------|---------|-----------|--------|
| `sfxRunVolume` | 0.3 | 0.0–0.6 | Run loop loudness; above 0.6 it competes with music |
| `sfxJumpVolume` | 0.6 | 0.3–0.9 | Jump SFX punch; below 0.3 feels absent |
| `sfxLaneVolume` | 0.5 | 0.2–0.8 | Lane change click presence |
| `sfxDeathVolume` | 0.7 | 0.4–1.0 | Death sting weight; this is the loudest moment |
| `musicVolume` | 0.4 | 0.1–0.6 | Background music level; above 0.6 dominates the mix |
| `musicFadeDuration` | 500ms | 200–1000ms | Music fade in/out speed; below 200ms feels abrupt |

All knobs live in `AUDIO_SYSTEM_CONFIG`. No magic numbers in the implementation.

## Acceptance Criteria

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| AC-1 | Music starts on MainMenu | Music audible within 1s of `→ MainMenu` (or first user interaction if autoplay blocked) |
| AC-2 | Music fades on death | Music volume reaches 0 within 600ms of `→ Dead` |
| AC-3 | Music resumes on restart | Music fades in within 600ms of `→ Running` after a death |
| AC-4 | Run loop plays during run | `SFX_RUN` audible from `→ Running` until `→ Dead`; silent before and after |
| AC-5 | Jump SFX fires on jump | `SFX_JUMP` plays on accepted jump; silent on rejected jump (airborne) |
| AC-6 | Lane SFX fires on lane change | `SFX_LANE` plays on successful lane change; silent on boundary rejection |
| AC-7 | Death SFX fires on death | `SFX_DEATH` plays once on `→ Dead` |
| AC-8 | Mute toggle silences all audio | All audio volume = 0 immediately after toggle; mute state survives page reload |
| AC-9 | Unmute restores all audio | All volumes return to configured levels immediately after unmute |
| AC-10 | No audio on load failure | Missing asset logs an error; game runs and no exception thrown |
| AC-11 | No double-trigger on spam | Lane change spam plays at most one `SFX_LANE` instance at a time (previous cut on rewind) |
