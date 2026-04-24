# Game State Manager

> **Status**: Designed (pending review)
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: Death is a Beginning, Two-Week Discipline

## Overview

The Game State Manager is the central authority on what the game is currently doing.
It maintains a single current state (`Loading`, `MainMenu`, `Running`, `Dead`,
`ScoreScreen`, or `Leaderboard`), enforces valid transitions between states, and
broadcasts state-change events that all other systems listen to. No system changes
its own behavior based on internal logic alone — it reacts to state-change events
from this manager. This design keeps the game predictable and ensures the
death-to-restart path is always fast and deterministic.

## Player Fantasy

The player never consciously experiences the Game State Manager — they experience its
results. When they die, the game responds within frames: the robot staggers, the screen
transitions, and the restart button is immediately reachable. When they restart, the
world snaps back instantly — no loading, no fade delay beyond what's intentional. The
system's job is to make transitions feel designed, not technical. Every state change
should feel like the game is responding to the player, not the player waiting for
the game.

## Detailed Design

### Core Rules

1. Exactly one state is active at all times. There is no "no state" condition.
2. The Game State Manager is a singleton accessible globally within the game module.
3. State transitions are initiated by explicit calls to the manager — no system
   changes state directly on itself.
4. On every valid transition, the manager fires a `stateChanged(fromState, toState)`
   event to all registered listeners.
5. All systems that care about state register listeners at initialization; they do
   not poll the current state on a tick.
6. Invalid transitions (e.g., `Running → Leaderboard` directly) are silently
   rejected and logged to the console in development builds.
7. The manager owns no game logic — it manages state and broadcasts events only.

### States and Transitions

| From State | Valid Next States | Trigger |
|------------|------------------|---------|
| `Loading` | `MainMenu` | All assets loaded (GLTFLoader complete, audio context ready) |
| `MainMenu` | `Running`, `Leaderboard` | Player clicks Play / View Leaderboard |
| `Running` | `Dead` | Robot collides with obstacle (collision event from Runner System) |
| `Dead` | `ScoreScreen` | Death animation complete (event fired by Character Renderer, ~2s after death) |
| `ScoreScreen` | `Running`, `MainMenu` | Player clicks Restart / Back to Menu |
| `Leaderboard` | `MainMenu` | Player clicks Back |

### Interactions with Other Systems

Every system that responds to game state registers a `stateChanged` listener at
initialization. The table below specifies exactly what each system does when state
changes. This is the contract — if a system's behavior doesn't match this table,
it is a bug.

| System | Listens for Transition | Required Behavior |
|--------|----------------------|-------------------|
| Character Renderer | → `Running` | Start run animation loop |
| Character Renderer | → `Dead` | Play death animation; fire `deathAnimationComplete` event when done |
| Character Renderer | → `MainMenu` | Reset to idle pose, hide or show as appropriate |
| Environment Renderer | → `Running` | Begin forward lane scrolling |
| Environment Renderer | → `Dead`, `ScoreScreen`, `MainMenu` | Stop scrolling; hold current position |
| Obstacle System | → `Running` | Begin obstacle spawning |
| Obstacle System | → `Dead` | Stop spawning; freeze all active obstacles in place |
| Obstacle System | → `MainMenu`, `ScoreScreen` | Despawn all obstacles; reset spawn state |
| Runner System | → `Running` | Enable input processing; place robot at start position |
| Runner System | → `Dead`, `MainMenu` | Disable input; robot stops responding to controls |
| Score & Distance Tracker | → `Running` | Start incrementing distance and score |
| Score & Distance Tracker | → `Dead` | Lock score; compare to personal best; save if new record |
| HUD | → `Running` | Display live score and distance overlay |
| HUD | → `Dead`, `ScoreScreen`, `MainMenu` | Hide HUD |
| Death Screen | → `ScoreScreen` | Show score results with final distance, score, and robot identity |
| Death Screen | → `Running`, `MainMenu` | Hide Death Screen |
| Main Menu | → `MainMenu` | Show entry screen (wallet connect, Play button, Leaderboard link) |
| Main Menu | → `Running` | Hide Main Menu |
| Audio System | → `Running` | Start gameplay music track (loop) |
| Audio System | → `Dead` | Play death SFX; begin fade-out on music |
| Audio System | → `ScoreScreen` | Play score reveal SFX |
| Audio System | → `MainMenu` | Play menu ambience or music sting |
| Leaderboard UI | → `Leaderboard` | Fetch and display leaderboard data |
| Leaderboard UI | → `MainMenu` | Hide |

## Formulas

This system contains no mathematical formulas. It is a finite state machine with
boolean transition guards. The death animation duration (which gates the
`Dead → ScoreScreen` transition) is a timing value owned by the Character Renderer
GDD, not here. No arithmetic is performed by the Game State Manager.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| Player collides with obstacle while death animation is already playing | Ignore — `Running → Dead` transition already fired; subsequent collision events are rejected until next run | Only one death per run; first collision wins |
| Player clicks Restart before death animation finishes | Queue the restart: complete `Dead → ScoreScreen` transition first, then immediately fire `ScoreScreen → Running` without rendering the score screen | "Death is a Beginning" — don't make them wait, but don't skip recording the score |
| Assets fail to load in `Loading` state | Remain in `Loading`; display a user-facing error; do not transition to `MainMenu` | Transitioning with missing assets would cause immediate undefined behavior |
| Player clicks Play before wallet query resolves | Transition to `Running` immediately using the demo robot skin; apply the NFT texture when the query resolves (on this run if mid-load, or on next run) | Gameplay must never be blocked by Web3 latency |
| A `stateChanged` listener throws an uncaught error | Log to console in development; do not halt the transition or skip remaining listeners | One broken system must not corrupt game state for all others |
| Transition called with the current state as target (e.g., `Running → Running`) | Reject silently; fire no `stateChanged` event | Prevents double-initialization in dependent systems |

## Dependencies

The Game State Manager has no upstream dependencies — it is the foundation.
All 11 systems below depend on it.

| System | Direction | Nature of Dependency |
|--------|-----------|---------------------|
| Character Renderer | Depends on GSM | Listens for state changes to start/stop animations and pose resets |
| Environment Renderer | Depends on GSM | Listens for state changes to start/stop lane scrolling |
| Runner System | Depends on GSM | Listens for `Running` to enable input; fires `collisionDetected` event which triggers GSM → `Dead` |
| Obstacle System | Depends on GSM | Listens for `Running` to begin spawning; `Dead` to freeze obstacles |
| Score & Distance Tracker | Depends on GSM | Listens for `Running` to begin counting; `Dead` to lock and save score |
| Wallet Connection | Depends on GSM | Initiates wallet connect prompt on `MainMenu` entry |
| Main Menu UI | Depends on GSM | Shows on `MainMenu`; hides on `Running` |
| HUD | Depends on GSM | Shows on `Running`; hides on all other states |
| Death Screen | Depends on GSM | Shows on `ScoreScreen`; hides on `Running` and `MainMenu` |
| Leaderboard UI | Depends on GSM | Shows on `Leaderboard`; hides on `MainMenu` |
| Audio System | Depends on GSM | Triggers music and SFX changes on every state transition |

**Note on the Runner System relationship**: The Runner fires a `collisionDetected`
event; the GSM subscribes to that event and initiates the `Running → Dead`
transition. Runner does not hold a direct reference to the GSM — it emits, the
GSM reacts. This breaks the potential circular dependency.

## Tuning Knobs

The Game State Manager exposes no designer-adjustable parameters. It is a deterministic
state machine; all transitions are event-driven with no internal timers or delays.
Timing values affecting state transitions (e.g., death animation duration that gates
`Dead → ScoreScreen`) are owned by the systems that fire those events — adjust them
in their respective GDDs and tuning files.

## Visual/Audio Requirements

The Game State Manager produces no visual or audio output directly. Visual and audio
responses to state transitions are specified in their respective system GDDs
(Character Renderer, Environment Renderer, Audio System, HUD, Death Screen, Main Menu).

## UI Requirements

No UI elements are owned by the Game State Manager. It exposes the current state
as a readable property (`GameState.current`) for any UI system that needs to query
it, but renders nothing itself.

## Acceptance Criteria

- [ ] Game launches and enters `Loading` state immediately on page load
- [ ] `Loading → MainMenu` fires after all assets complete loading; no user interaction is possible before this transition
- [ ] Clicking Play from `MainMenu` transitions to `Running` within 1 frame (no async delay)
- [ ] Robot collision fires `Running → Dead` transition; subsequent collisions in the same run are ignored
- [ ] `Dead → ScoreScreen` fires automatically when the death animation completes (~2s); does not require user input
- [ ] Clicking Restart from `ScoreScreen` transitions to `Running` and all dependent systems reset within 1 frame
- [ ] Clicking Back from `ScoreScreen` transitions to `MainMenu` and all dependent systems reset within 1 frame
- [ ] All 11 dependent systems respond correctly to every applicable state transition (verified in their individual acceptance criteria)
- [ ] Invalid transition (e.g., `Running → Leaderboard`) is rejected; current state remains unchanged; no events fire
- [ ] Same-state transition (e.g., `Running → Running`) fires no events and produces no behavior change in any dependent system
- [ ] A `stateChanged` listener that throws does not halt the transition or prevent remaining listeners from executing
- [ ] Performance: complete state transition including event dispatch to all listeners completes in under 1ms on target hardware

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| Should `Loading` state show a progress bar or a static logo? | Designer | Character Renderer GDD | Unresolved |
| Is a `Paused` state needed for v2 (ESC key during a run)? | Designer | v2 scope review | Deferred to v2 per Two-Week Discipline pillar |
