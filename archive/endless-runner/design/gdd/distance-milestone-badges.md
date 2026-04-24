# Distance Milestone Badges

> **Status**: Designed
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Death is a Beginning, Competence

## Overview

The Distance Milestone Badge system automatically awards named badges when the robot
crosses fixed distance thresholds during a run. Badges are one-time unlocks: crossing
500m once earns the first badge permanently across all sessions and devices. The highest
reached milestone tier is persisted to Supabase keyed by the player's NFT skin ID, with
localStorage as a fallback for guest play or offline conditions. On the death screen, the
player's current milestone tier and the next unreached threshold are displayed alongside
the final score. The system requires no player action beyond surviving — the city reveals
its districts to runners who make it far enough. Without milestones, every run ends at an
abstract number; with them, every run ends at a named place in Neotropolis.

## Player Fantasy

Milestones transform raw distance into a story about where your robot went. "You reached
the Industrial Corridor" lands differently than "847m" — it's a place, not a number. For
a player who has never broken 500m, seeing the first badge unlock on the death screen
feels like the city finally acknowledged them. For a veteran chasing 5000m, the highest
unreached tier is a permanent provocation.

The crossing moment itself is celebrated in-run: as the robot passes each 1000m threshold,
lightning strikes down from the sky — the city's enforcement grid reacting to the intrusion.
The run never stops, but the world acknowledges the runner. On death, the system reframes
the entire attempt: not "I failed at distance X" but "I made it to Y, and Z is next."

## Detailed Design

### Core Rules

1. The system maintains a `highestMilestone` value — the index of the furthest milestone
   tier the player has ever reached. Loaded from Supabase (by skin ID) on run start;
   localStorage used as fallback.
2. During `Running` state, each frame the system checks `scoreTracker.distance` against
   the ordered milestone threshold list.
3. When `distance` crosses a threshold **for the first time ever** (i.e. its index >
   `highestMilestone`):
   - Update `highestMilestone` to the new index.
   - Write the new value to localStorage immediately (synchronous, no failure risk).
   - Fire a Supabase write in the background (async, fire-and-forget — failure is silent).
   - Trigger the lightning strike VFX sequence (see Visual/Audio Requirements).
4. Lightning strikes fire at every **1000m** interval crossed during a run (1000m, 2000m,
   3000m…), regardless of whether the milestone is new. This is the in-run celebration —
   it fires even for players who have already unlocked that tier.
5. On `Dead` / `ScoreScreen`: the death screen displays the name of `highestMilestone` and
   the next unreached threshold. If `highestMilestone` is the final tier (5000m), display
   "Maximum Depth Reached" with no next target.
6. On `Running` entry (run restart): reload `highestMilestone` from localStorage (no
   re-fetch from Supabase needed mid-session).

### Milestone Registry

| Index | Threshold | Badge Name |
|-------|-----------|-----------|
| 0 | 500m | Outer Grid |
| 1 | 1000m | Industrial Corridor |
| 2 | 2500m | Neon Quarter |
| 3 | 5000m | The Core |

### States and Transitions

| GSM State | System Behaviour |
|-----------|-----------------|
| `Loading` / `MainMenu` | Idle; load `highestMilestone` from Supabase/localStorage |
| `Running` | Active; check distance each frame; fire VFX on 1000m intervals |
| `Dead` | Lock; no new milestones awarded after death |
| `ScoreScreen` | Expose `highestMilestone` and `nextMilestone` for death screen display |
| `Leaderboard` | Idle |

### Interactions with Other Systems

| System | Data Flow | Direction |
|--------|-----------|-----------|
| Score & Distance Tracker | Reads `distance` each frame during `Running` | Tracker → Milestones |
| Game State Manager | `Running` event → activate; `Dead` event → lock | GSM → Milestones |
| Supabase (Leaderboard Backend) | Writes `highestMilestone` index on new unlock; reads on session load | Milestones ↔ Supabase |
| Death Screen / Game UI | Reads `highestMilestoneName` and `nextMilestoneName` on `ScoreScreen` | Milestones → UI |
| VFX System (new, lightweight) | Fires 3-bolt lightning sequence on 1000m crossing | Milestones → VFX |

## Formulas

### Milestone Unlock Check (per frame)

```
for each milestone M in MILESTONE_REGISTRY (ascending order):
    if scoreTracker.distance >= M.threshold AND M.index > highestMilestone:
        highestMilestone = M.index
        persist(highestMilestone)
        triggerVFX()
        break  ← only one new milestone can unlock per frame
```

| Variable | Type | Range | Source |
|----------|------|-------|--------|
| `scoreTracker.distance` | float | 0 → ∞ | Score & Distance Tracker |
| `M.threshold` | int | 500, 1000, 2500, 5000 | MILESTONE_REGISTRY config |
| `highestMilestone` | int (index) | -1 (none) → 3 (The Core) | localStorage / Supabase |

### Lightning Strike Trigger Check (per frame)

```
lastLightningThreshold = floor(previousDistance / 1000) * 1000
currentLightningThreshold = floor(scoreTracker.distance / 1000) * 1000

if currentLightningThreshold > lastLightningThreshold AND currentLightningThreshold > 0:
    triggerLightningVFX()
    lastLightningThreshold = currentLightningThreshold
```

| Variable | Type | Source |
|----------|------|--------|
| `previousDistance` | float | distance from last frame |
| `scoreTracker.distance` | float | Score & Distance Tracker |
| `lastLightningThreshold` | int | Internal state, reset to 0 on run start |

## Edge Cases

| Scenario | Expected Behaviour | Rationale |
|----------|-------------------|-----------|
| Player crosses two milestones in one frame (e.g. lag spike jumps distance from 400m to 1100m) | Only the highest newly-crossed milestone unlocks; VFX fires once; `highestMilestone` jumps to correct index | `break` after first unlock prevents double-fire; distance check is against all thresholds so the correct one is found |
| Player crosses 1000m, 2000m, 3000m in one lag-spike frame | Lightning VFX fires once (for the highest 1000m interval crossed); intermediate intervals are skipped | Acceptable — extreme lag spikes are rare; firing multiple overlapping VFX sequences would look worse than skipping one |
| Supabase write fails on new unlock | localStorage write already completed synchronously; milestone is not lost; Supabase failure is silent | Player never loses progress; next session will re-read from localStorage as fallback |
| Supabase read fails on session load | Fall back to localStorage value; if localStorage also empty, `highestMilestone = -1` (no milestones) | Game is fully playable without Supabase; milestones degrade gracefully |
| Guest player (no skin ID) | Use a guest key for localStorage (`neon_fugitive_milestone_guest`); skip Supabase write entirely | Consistent with Score Tracker pattern; no backend writes for unauthenticated players |
| Player already has `highestMilestone = 3` (The Core) on load | No further unlock checks needed beyond confirming loaded value; death screen shows "Maximum Depth Reached" | Index 3 is the ceiling; no valid `M.index > 3` exists |
| Run ends at exactly a threshold distance (e.g. precisely 500m) | Milestone unlocks — `>=` check means the threshold value itself qualifies | Inclusive boundary; dying at exactly 500m is a meaningful achievement |
| Player clears localStorage manually between sessions | `highestMilestone` falls back to Supabase value on next load if available; otherwise resets to -1 | Supabase is the durable store; localStorage is cache |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Score & Distance Tracker | Tracker → Milestones | Reads `distance` float each frame during `Running` | Hard — system cannot function without a distance value |
| Game State Manager | GSM → Milestones | `Running` event activates checks; `Dead` event locks; `ScoreScreen` event exposes display data | Hard — all state-gated behaviour depends on GSM events |
| Supabase (Leaderboard Backend) | Milestones ↔ Supabase | Reads `highestMilestone` on session load; writes on new unlock (async, fire-and-forget) | Soft — system fully functional without it; localStorage handles fallback |
| Game UI / Death Screen | Milestones → UI | Exposes `highestMilestoneName`, `nextMilestoneName`, and `nextMilestoneThreshold` for ScoreScreen display | Soft — game runs without the display; data is available if UI wants it |
| VFX System | Milestones → VFX | Fires `triggerLightningVFX()` on 1000m crossing | Soft — milestone logic is unaffected if VFX is unavailable or disabled |

### New Supabase Table Required

```sql
CREATE TABLE milestones (
  skin_id       TEXT PRIMARY KEY,
  highest_index INTEGER NOT NULL DEFAULT -1,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

`skin_id` matches the player ID format used in the `scores` table (the NFT skin number
as a string).

## Tuning Knobs

| Parameter | Current Value | Safe Range | Effect if Too High | Effect if Too Low |
|-----------|--------------|------------|-------------------|-------------------|
| `MILESTONE_THRESHOLDS` | [500, 1000, 2500, 5000] | Any increasing sequence > 0 | Milestones feel unreachable; most players never unlock any | Milestones feel trivial; all unlocked in first session, no long-term goal |
| `LIGHTNING_INTERVAL` | 1000m | 500m – 2000m | VFX fires rarely; celebration moments are sparse | VFX fires too frequently; loses impact, becomes noise |
| `LIGHTNING_BOLT_COUNT` | 3 | 1 – 5 | Cluttered screen; performance risk on low-end hardware | Single bolt feels underwhelming at key milestone moments |
| `LIGHTNING_BOLT_STAGGER_MS` | 100ms | 50ms – 300ms | Bolts feel like separate unrelated events | All bolts fire simultaneously; loses the "scatter" feel |
| `LIGHTNING_DURATION_MS` | 400ms | 200ms – 800ms | Lingers too long; interferes with obstacle reading | Too brief to register visually |
| `MILESTONE_REGISTRY` | 4 tiers | 2 – 8 tiers | Too many named places dilutes meaning of each | Too few tiers; no progression structure for mid-game players |

## Visual/Audio Requirements

### Lightning Strike VFX (Three.js implementation)

- 3 bolts fire per trigger, one per lane (left, center, right), staggered by 100ms each
- Each bolt: a thin vertical `PlaneGeometry` or `LineSegments` with an emissive cyan/white
  material (`0xaaddff`), 0.05–0.1 units wide, spanning full scene height
- Bolt appears instantly at full opacity, fades to 0 over `LIGHTNING_DURATION_MS` (400ms)
  via material opacity animation
- Bolts are spawned from a pre-allocated pool of 3 — no `new` calls during a run
- No audio cue at v1; a thunder SFX can be added in v2

## Acceptance Criteria

### Milestone Logic
- [ ] `highestMilestone` initialises to `-1` on first-ever session (no prior record)
- [ ] Crossing 500m for the first time sets `highestMilestone = 0` and writes to localStorage
- [ ] Crossing a threshold the player has already reached does NOT update `highestMilestone`
- [ ] Only one milestone unlocks per frame, even if a lag spike crosses multiple thresholds
- [ ] `highestMilestone` does not change after `Dead` state is entered
- [ ] On run restart, `highestMilestone` is reloaded from localStorage (not reset to -1)

### Persistence
- [ ] localStorage write is synchronous and completes before the next frame
- [ ] Supabase write is async and fires in the background; failure is silent with no crash
- [ ] On Supabase read failure at session load, localStorage value is used as fallback
- [ ] Guest player (no skin ID) uses `neon_fugitive_milestone_guest` as localStorage key and skips Supabase writes

### Death Screen Display
- [ ] Death screen shows the name of `highestMilestone` (e.g. "Industrial Corridor")
- [ ] Death screen shows the next unreached threshold and name
- [ ] If `highestMilestone = 3` (The Core), death screen shows "Maximum Depth Reached" with no next target
- [ ] If `highestMilestone = -1` (no milestone reached), death screen shows the first tier as the next target

### Lightning VFX
- [ ] Lightning fires on every 1000m crossing (1000m, 2000m, 3000m…) regardless of whether milestone is new
- [ ] Exactly 3 bolts fire per crossing, staggered by 100ms each
- [ ] Bolts are distributed across all three lanes
- [ ] VFX does not fire at 0m on run start
- [ ] Lightning sequence completes within 400ms and does not block player input or obstacle updates
- [ ] Frame rate does not drop below 55fps during VFX sequence on target hardware
