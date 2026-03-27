# Score & Distance Tracker

> **Status**: Designed (pending review)
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: Death is a Beginning

## Overview

The Score & Distance Tracker measures how far the robot has run in the current
attempt and exposes that value as the player's score. Distance and score are the
same number: meters traveled since the run began. The system starts counting when
the game enters the `Running` state, locks the value when the game enters `Dead`,
and saves a new personal best if the score exceeds the previous record. It exposes
a live `distance` value that the HUD reads every frame, a `finalScore` that the
Death Screen displays, a `personalBest` for comparison on the Death Screen, and a
`distance` feed that the Difficulty Curve uses to scale obstacle intensity. Personal
best is persisted to `localStorage`, keyed by NFT token ID when a wallet is
connected, or by a generic guest key when playing without a wallet.

## Player Fantasy

The score is the robot's story. When the Death Screen shows "847m — New Personal
Best," that number is the entire arc of that run — every dodge, every near-miss,
every moment the city almost had you. The system is invisible during play; it only
speaks at the end. The personal best comparison turns a raw number into a personal
achievement: not just "847m" but "847m — 112m further than you've ever gone." That
delta is the engine of "one more run."

## Detailed Design

### Core Rules

1. `distance` increments every frame while in `Running` state:
   `distance += forwardSpeed * deltaTime`
2. `score` is always equal to `distance`. They are the same value displayed
   differently — score is rendered as an integer (floor) in meters, formatted
   with comma separators for readability (e.g., `1,247m`).
3. On `Dead` state entry: distance stops incrementing immediately. The locked
   value becomes `finalScore`.
4. `finalScore` is compared to `personalBest`. If `finalScore > personalBest`,
   update `personalBest` and write it to `localStorage`.
5. Personal best localStorage key:
   - Wallet connected: `neon_fugitive_pb_[tokenId]`
   - No wallet: `neon_fugitive_pb_guest`
6. On `Running` state entry (start of each new run): reset `distance` to `0`,
   clear `finalScore`, and load `personalBest` from `localStorage`.
7. This system does not own `forwardSpeed` — it receives that value from the
   Runner System as part of each frame update. It is a passive recipient, not
   a speed calculator.

### States and Transitions

No internal states. The tracker is active (incrementing) during `Running` and
passive (locked) during all other game states. State transitions are driven
entirely by Game State Manager events.

| GSM State | Tracker Behavior |
|-----------|-----------------|
| `Loading`, `MainMenu` | Idle; distance = 0 |
| `Running` | Incrementing distance each frame |
| `Dead` | Locked; finalScore set; personal best evaluated and saved |
| `ScoreScreen` | Locked; exposes finalScore and personalBest for Death Screen to read |
| `Leaderboard` | Locked; no changes |

### Interactions with Other Systems

| System | Data Flow | Direction |
|--------|-----------|-----------|
| Game State Manager | `Running` event → start counting; `Dead` event → lock and save | GSM → Tracker |
| Runner System | Provides `forwardSpeed` (units/sec) and `deltaTime` (seconds) each frame during `Running` | Runner → Tracker |
| Difficulty Curve | Reads `distance` (meters) each frame to drive obstacle scaling parameters | Tracker → Difficulty Curve |
| HUD | Reads `distance` every render frame for live score display | Tracker → HUD |
| Death Screen | Reads `finalScore` and `personalBest` when `ScoreScreen` state is entered | Tracker → Death Screen |
| Leaderboard Backend | Reads `finalScore` and active token ID at run end to submit to leaderboard | Tracker → Leaderboard |
| NFT Ownership Verification | Provides active token ID; used as localStorage key suffix for personal best | NFT Verify → Tracker |

## Formulas

### Distance Increment

```
distance += forwardSpeed * deltaTime
```

| Variable | Type | Range | Source | Description |
|----------|------|-------|--------|-------------|
| `distance` | float | 0 → ∞ | This system (accumulated) | Total meters traveled since run start |
| `forwardSpeed` | float | 5.0 – 40.0 m/s | Runner System (set by Difficulty Curve) | Current robot forward velocity |
| `deltaTime` | float | 0.008 – 0.05 s | Three.js render loop | Time since last frame; capped at 0.05s to prevent distance spike on tab return |

**Expected output range**: 0m at run start → practical ceiling of ~2,000–5,000m for
skilled players under v1 difficulty curve. No hard cap.

### Personal Best Update

```
if finalScore > personalBest:
    personalBest = finalScore
    localStorage.setItem(pbKey, personalBest)
```

No arithmetic — pure greater-than comparison and write. `pbKey` is
`neon_fugitive_pb_[tokenId]` or `neon_fugitive_pb_guest`.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| `deltaTime` spike on tab return (e.g., 2.0s frame) | Cap `deltaTime` at 0.05s before applying to distance formula | Prevents phantom distance gain from background tab; keeps score honest |
| `localStorage` unavailable (private browsing, quota exceeded) | Silently skip personal best write; continue without error; personal best shows 0 for the session | Don't crash the game over optional persistence |
| Player dies at exactly 0m (first-frame collision) | `finalScore = 0`; personal best is not updated (0 never overwrites any stored value ≥ 0) | 0m is not an achievement worth recording |
| `forwardSpeed` is 0 (edge case or future pause feature) | Distance does not increment (0 × deltaTime = 0); no divide-by-zero possible | Safe by formula |
| Token ID changes mid-session (wallet reconnect with different account) | Load new token's personal best immediately on reconnect; prior run's `finalScore` is not retroactively reassigned to new token | Each token's record is fully independent |
| localStorage key collision with another application | Namespaced prefix `neon_fugitive_pb_` prevents collision with any non-Neon-Fugitive keys | Namespace is sufficient mitigation |

## Dependencies

No upstream dependencies. This is a Foundation-layer system.

| System | Direction | Nature of Dependency |
|--------|-----------|---------------------|
| Runner System | Runner → Tracker | Provides `forwardSpeed` and `deltaTime` each frame |
| NFT Ownership Verification | NFT Verify → Tracker | Provides token ID for localStorage key |
| Difficulty Curve | Tracker → Difficulty Curve | Reads `distance` to drive obstacle scaling |
| HUD | Tracker → HUD | Reads `distance` every frame for live display |
| Death Screen | Tracker → Death Screen | Reads `finalScore` and `personalBest` on `ScoreScreen` entry |
| Leaderboard Backend | Tracker → Leaderboard | Reads `finalScore` and token ID on run end |

## Tuning Knobs

| Parameter | Current Value | Safe Range | Effect of Increase | Effect of Decrease |
|-----------|--------------|------------|-------------------|-------------------|
| `deltaTime` cap | 0.05s (50ms) | 0.016s – 0.1s | More lenient on tab-return spikes; slightly higher phantom distance on extreme lag | Stricter honesty; may cause minor distance loss on moderate frame drops |
| Score display format | Integer meters, comma-separated | — | N/A | N/A |

Note: `forwardSpeed` is not a tuning knob of this system — it is owned and set by
the Difficulty Curve via the Runner System. Changes to speed belong in the Difficulty
Curve GDD.

## Visual/Audio Requirements

None. This system tracks numbers only. Visual display is owned by HUD and Death Screen.
Audio triggered by score milestones (if any) is owned by the Audio System.

## UI Requirements

None directly. This system exposes data; HUD and Death Screen own the rendering.
Required exposed interface:
- `tracker.distance` — readable float, updated every frame during `Running`
- `tracker.finalScore` — readable integer, set on `Dead`, available on `ScoreScreen`
- `tracker.personalBest` — readable integer, loaded from localStorage on run start
- `tracker.isNewPersonalBest` — boolean, true if `finalScore > previous personalBest`

## Acceptance Criteria

- [ ] `distance` increments correctly every frame during `Running` state
- [ ] `distance` does not change during `Dead`, `ScoreScreen`, `MainMenu`, or `Leaderboard`
- [ ] `distance` resets to exactly `0.0` at the start of each new run
- [ ] `finalScore` equals the locked `distance` value at death with no further increment
- [ ] Personal best is written to `localStorage` when `finalScore > personalBest`
- [ ] Personal best is NOT updated when `finalScore <= personalBest`
- [ ] Personal best key is `neon_fugitive_pb_[tokenId]` when wallet is connected
- [ ] Personal best key is `neon_fugitive_pb_guest` when no wallet is connected
- [ ] `deltaTime` is capped at 0.05s; no distance spike occurs after tab-return
- [ ] `localStorage` failure is silently handled; game continues without error
- [ ] Death at 0m does not overwrite a higher personal best with `0`
- [ ] `tracker.isNewPersonalBest` is `true` only when `finalScore` exceeds previous record
- [ ] Performance: distance update completes in under 0.1ms per frame

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| Should guest personal best carry over when wallet connects mid-session? | Designer | Wallet Connection GDD | Unresolved — consider migrating guest PB to token PB on first connect |
| Score multiplier for near-misses — v2 feature or v1? | Designer | v2 scope review | Deferred to v2 per Two-Week Discipline pillar |
