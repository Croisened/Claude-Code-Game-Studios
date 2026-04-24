# Input System

> **Status**: Designed (pending review)
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: The City Hunts You

## Overview

The Input System captures keyboard events from the browser and translates them into
named game actions (`LANE_LEFT`, `LANE_RIGHT`, `JUMP`, `SLIDE`). It is the only
system in the game that directly reads from the browser's `keydown` event — all
other systems receive abstract actions, never raw key codes. The system can be
enabled or disabled as a unit; when disabled, no actions are emitted regardless of
what the player presses. This allows the Runner System to toggle input on/off at
state boundaries without managing keyboard listeners itself.

## Player Fantasy

The Input System is invisible when it works — and unforgivable when it doesn't. In
a game where death is one missed input away, the player must feel that their reaction
reached the robot without delay. A perfect lane change should feel mechanical: press
left, robot moves left, instantly. There is no "almost registered." Input either fires
or it doesn't. The system's job is to make the player feel in complete control of
their robot right up to the moment the city catches them.

## Detailed Design

### Core Rules

1. The Input System registers exactly two browser event listeners: `keydown` and
   `keyup` on `window`.
2. When **enabled**, a `keydown` event matching a mapped key fires the corresponding
   named action event immediately, within the same JavaScript event tick.
3. When **disabled**, all `keydown` and `keyup` events are consumed silently; no
   action events are emitted.
4. Each key fires its action **once per physical press** — holding a key does not
   repeat the action. Key repeat is suppressed.
5. Multiple keys may be active simultaneously; each fires its own independent action.
   There is no mutual exclusion between actions (e.g., `JUMP + LANE_LEFT` both fire).
6. No buffering: if an input fires when the Runner System cannot act on it, the
   input is discarded. The Runner System handles any action queuing it requires.
7. The Input System has no knowledge of lanes, physics, or game logic. It maps
   key codes to named actions and emits them — nothing more.
8. All key bindings are defined in a single configuration object. No raw key codes
   (`KeyA`, `ArrowLeft`, etc.) appear outside that config.

### States and Transitions

The Input System has no internal states. It exposes two methods:

- `InputSystem.enable()` — begins processing and emitting actions
- `InputSystem.disable()` — silently consumes all input without emitting

The Runner System is responsible for calling these at the right time based on
GSM state transitions.

### Key Binding Map (v1)

| Action | Primary Keys | Secondary Keys |
|--------|-------------|----------------|
| `LANE_LEFT` | `ArrowLeft` | `KeyA` |
| `LANE_RIGHT` | `ArrowRight` | `KeyD` |
| `JUMP` | `ArrowUp` | `KeyW`, `Space` |
| `SLIDE` | `ArrowDown` | `KeyS` |

### Interactions with Other Systems

| System | Interface | Direction |
|--------|-----------|-----------|
| Runner System | Subscribes to `InputSystem.on('action', handler)` — sole consumer of all action events | Input System → Runner System |
| Runner System | Calls `InputSystem.enable()` on `Running` state; `InputSystem.disable()` on all other states | Runner System → Input System |
| Game State Manager | Not directly connected — GSM signals Runner System, which signals Input System | Indirect |

## Formulas

No mathematical formulas. The Input System performs no calculations — it maps
key codes to named action strings and emits them as events. All game logic
derived from input (lane positions, jump arc physics, slide duration) is
owned by the Runner System.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| Player presses a non-mapped key | Ignore silently; no action emitted | Only mapped keys produce actions |
| Player holds a key across a state change (e.g., holding `Space` while dying) | On `disable()`, suppress all further events; no queued action carries into next run | Clean slate on every run start |
| Two keys mapped to the same action pressed simultaneously (e.g., `ArrowLeft` + `KeyA`) | Each physical keydown emits one action event independently; Runner System receives two `LANE_LEFT` events | Runner System handles duplicate suppression if needed |
| `enable()` called while already enabled | No-op; no duplicate listener registration | Idempotent by design |
| `disable()` called while already disabled | No-op | Idempotent by design |
| Browser loses focus mid-run (tab switch, OS dialog) | Browser `blur` event fires; Input System clears all active key state; no lingering or phantom actions on focus return | Prevents robot from "sticking" in a direction after focus returns |

## Dependencies

| System | Direction | Nature of Dependency |
|--------|-----------|---------------------|
| Runner System | Runner depends on Input System | Sole consumer of action events; calls enable/disable |

No upstream dependencies. The Input System reads from the browser `window` object
only — it has no game system dependencies and can be initialized before any other
system.

## Tuning Knobs

| Parameter | Current Value | Safe Range | Effect of Increase | Effect of Decrease |
|-----------|--------------|------------|-------------------|-------------------|
| Key binding config | See binding map | Any valid `KeyboardEvent.code` value | N/A — swap bindings for remapping | N/A |

The only tunable value is the key binding configuration object. At v1 it is
hardcoded in the config; at v2 it can be exposed to a settings screen for
player remapping without code changes. No timing or threshold values exist in
this system.

## Visual/Audio Requirements

None. The Input System produces no visual or audio output.

## UI Requirements

None at v1. At v2, key bindings may be exposed in a settings screen — that UI
is owned by the Settings/Menu system, not this system.

## Acceptance Criteria

- [ ] `LANE_LEFT` action fires on `ArrowLeft` keydown and `KeyA` keydown
- [ ] `LANE_RIGHT` action fires on `ArrowRight` keydown and `KeyD` keydown
- [ ] `JUMP` action fires on `ArrowUp`, `KeyW`, and `Space` keydown
- [ ] `SLIDE` action fires on `ArrowDown` and `KeyS` keydown
- [ ] Holding a key does not fire the action more than once per physical press
- [ ] `JUMP` and `LANE_LEFT` pressed simultaneously each emit their own independent events in the same tick
- [ ] When disabled, no action events fire regardless of which keys are pressed
- [ ] `enable()` is idempotent — calling it twice does not register duplicate listeners
- [ ] `disable()` is idempotent — calling it twice has no side effects
- [ ] Browser `blur` event clears all active key state; no phantom actions fire on focus return
- [ ] No raw `KeyboardEvent.code` values appear in any file outside the key binding config object
- [ ] Performance: `keydown` handler execution completes in under 0.1ms measured in browser devtools

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| Should `Space` also serve as a UI confirm/restart key on the Score Screen? | Designer | Death Screen GDD | Unresolved — may need Input System to support a separate `UI_CONFIRM` action for non-running states |
