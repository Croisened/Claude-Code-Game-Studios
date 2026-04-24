# Robo Rhapsody Sim — v1 Specification

## Purpose

Build a browser-based simulation that runs once per day, pits all 90 Robo Rhapsody robots against each other in a procedurally generated event, and produces a replay anyone can tune into. No wallet connection, no user accounts, no holder verification. Passive, ambient engagement driven by trait-based outcomes and per-event-type leaderboards.

This spec extends an existing Three.js project that already has the rigged robot model, textures, and animations loading correctly.

---

## Core Concept

- One daily event, scheduled at a fixed time (e.g., 18:00 UTC).
- All 90 robots participate. Each has a unique texture keyed to its NFT ID and a trait profile.
- Event runs to completion in approximately 2 minutes of playback, with three culling stages thinning the field from 90 → 30 → 10 → 1 winner.
- Simulation is deterministic, pre-computed server-side, and stored as a replay JSON. Clients load the replay and play it back in Three.js.
- Viewers can "BOOST" one robot per event via the site (honor-system tweet intent). A robot can only be boosted once per event; first click wins.
- Winner and final standings write to a per-event-type ELO leaderboard.
- Project X account auto-posts an event announcement and a winner recap.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Rendering | Three.js | Existing project. Skinned mesh with material swaps per robot. |
| Backend / DB | Supabase | Postgres for metadata, Storage for replay JSON blobs, Edge Functions or pg_cron for scheduled jobs. |
| Sim runner | Node.js (Supabase Edge Function or separate worker) | Pure JS, shares geometry/trait logic with frontend where possible. |
| X posting | Twitter API v2 (project account only) or manual for MVP | Intent URLs for user boost posts — no API needed on user side. |

---

## Assets In Hand

- 1 rigged 3D robot model (GLTF/GLB assumed).
- 90 unique textures, one per NFT ID.
- Animations: walk, run, jump, die. *(Confirm whether idle, victory, and any additional states exist — see Open Questions.)*
- Traits per robot, stored/accessible from the NFT metadata source: `full_send`, `degen`, `cipher`, `doubter`, `altruist`, each 1–100, sum ≤ 100.

---

## Database Schema (Supabase)

### `robots`
Static roster. Seeded once from NFT metadata.
```
id               int primary key      -- NFT token ID (1–90)
texture_url      text                 -- path to texture in Supabase Storage or CDN
full_send        int                  -- 0–100
degen            int
cipher           int
doubter          int
altruist         int
created_at       timestamptz default now()
```

### `events`
One row per scheduled daily event.
```
id               uuid primary key
scheduled_at     timestamptz          -- when the replay goes live to viewers
event_type       text                 -- 'sprint' | 'maze' | 'gauntlet' (v1 set)
status           text                 -- 'scheduled' | 'boost_open' | 'simulating' | 'ready' | 'live' | 'complete'
seed             bigint               -- RNG seed used for the sim
replay_url       text                 -- Supabase Storage path to replay JSON
winner_robot_id  int references robots(id)
schema_version   int default 1
created_at       timestamptz default now()
```

### `event_participants`
One row per (event, robot). Lets us query per-event outcomes without parsing replay JSON.
```
event_id             uuid references events(id)
robot_id             int references robots(id)
final_placement      int                  -- 1 = winner, 2 = runner-up, ..., 90 = first eliminated
eliminated_at_stage  int                  -- 1, 2, 3, or null if reached final
boosted              bool default false   -- did someone claim the boost on this robot?
primary key (event_id, robot_id)
```

### `boosts`
One row per boost claim. The unique constraint on (event_id, robot_id) enforces "one boost per robot per event" at the database level.
```
id           uuid primary key
event_id     uuid references events(id)
robot_id     int references robots(id)
claimed_at   timestamptz default now()
client_hash  text                         -- optional: hashed IP/session for rate limiting
unique (event_id, robot_id)
```

### `leaderboard`
Per-robot, per-event-type ELO and stats.
```
robot_id              int references robots(id)
event_type            text
elo                   int default 1000
events_participated   int default 0
wins                  int default 0
podiums               int default 0                -- top 3 finishes
updated_at            timestamptz default now()
primary key (robot_id, event_type)
```

---

## Event Lifecycle (Daily)

Times relative to scheduled showtime `T`.

| Time | Status | Action |
|---|---|---|
| T − 8h | `scheduled` → `boost_open` | Event row created, event type selected, boost window opens, announcement tweet posts. |
| T − 1h | `boost_open` → `simulating` | Boost window closes. Sim runs, writes replay JSON to Storage, updates `event_participants` and `leaderboard`. |
| T − 1h → T | `ready` | Site shows countdown to showtime. Replay preloaded. |
| T | `live` | Replay plays on site. Winner tweet pre-scheduled or triggered. |
| T + ~3min | `complete` | Playback ends. Results visible on leaderboard. |

All transitions driven by scheduled jobs (Supabase `pg_cron` or Edge Functions on a schedule). No event should require manual intervention in normal operation.

---

## Trait-to-Behavior Mapping

Traits feed into sim-time parameters per robot. Because traits sum to ≤ 100, every robot is specialized in *something* — spec the mapping so no stat is wasted.

| Trait | Primary effect | Secondary effect | Best event type |
|---|---|---|---|
| **Full Send** | Top speed & acceleration | Reduced turning precision; more likely to overshoot | Sprint |
| **Degen** | Variance multiplier — re-rolls decisions, random burst actions | Can produce wins *or* disasters | Any (wildcard) |
| **Cipher** | Pathfinding quality, reaction time, shortcut discovery | Faster trap response | Maze |
| **Doubter** | Trap avoidance, ledge hesitation, fall resistance | Lower top speed | Gauntlet |
| **Altruist** | *(v1: no solo effect — reserved for future team events)* | Minor "end of life grace" — dies slower when eliminated for a better ragdoll moment | N/A in v1 |

Suggested derived sim stats (the sim engine should compute these from raw traits):
```
speed         = 0.5 + (full_send / 100) * 0.8
acceleration  = 0.4 + (full_send / 100) * 1.0 - (doubter / 100) * 0.3
handling      = 0.5 + (cipher / 100) * 0.5 - (full_send / 100) * 0.2
pathfinding   = 0.3 + (cipher / 100) * 0.7
caution       = (doubter / 100) * 1.0
chaos         = (degen / 100) * 1.0      // probability of random re-roll per decision tick
```

Tune the coefficients during testing. The goal: a max Full Send robot clearly wins sprints, a max Cipher robot clearly wins mazes, a max Doubter robot clearly survives gauntlets, and a max Degen robot produces unpredictable but occasionally spectacular runs.

---

## Event Types (v1)

Ship with three. Rotate pseudo-randomly per day (e.g., deterministic from seed so future rotation can be inspected).

### 1. Sprint Race
- Straight-ish course with three checkpoint gates.
- Stage 1 cull: first 30 through Gate A; gate closes. (Robots behind are eliminated.)
- Stage 2 cull: first 10 through Gate B; gate closes.
- Stage 3: final 10 race to the finish line. First to cross wins.
- **Favored trait:** Full Send.

### 2. Maze Run
- Procedurally generated maze with a known exit.
- Stage 1 cull: rising acid/water floor after 40 seconds — anything not on elevated path is eliminated.
- Stage 2 cull: maze walls close in, compressing the field. Top 10 by distance-to-exit survive.
- Stage 3: remaining robots race to the exit. First out wins.
- **Favored trait:** Cipher.

### 3. Obstacle Gauntlet
- Linear course with traps: swinging hammers, crushing pistons, pit traps, crumbling bridges.
- Stage 1 cull: first pit section eliminates anyone who falls. Expect ~30 survivors.
- Stage 2 cull: hammer corridor. Survivors who time it wrong are flattened.
- Stage 3: final bridge — crumbles under the last 10 robots as they cross. Last robot standing (or first across) wins.
- **Favored trait:** Doubter.

Each event type is implemented as its own simulation module with a shared interface:
```
runSim(robots, seed, eventConfig) → Replay
```

---

## Replay JSON Format

The replay is the single source of truth for playback. It must be fully self-contained — the frontend loads only this file plus robot textures and produces the visual experience.

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "event_type": "sprint",
  "seed": 1729384756,
  "duration_seconds": 120,
  "sample_rate_hz": 10,
  "arena": {
    "type": "sprint_v1",
    "geometry_params": { /* deterministic params to regenerate the arena */ }
  },
  "robots": [
    {
      "id": 47,
      "start_position": [x, y, z],
      "start_rotation": [qx, qy, qz, qw],
      "boosted": true
    }
  ],
  "stages": [
    { "name": "gate_a", "end_t": 35.0, "eliminated_robot_ids": [12, 33, ...] },
    { "name": "gate_b", "end_t": 75.0, "eliminated_robot_ids": [4, 19, ...] },
    { "name": "finish", "end_t": 118.2, "eliminated_robot_ids": [...] }
  ],
  "timeline": [
    {
      "t": 0.0,
      "frames": [
        { "id": 1, "p": [x,y,z], "r": [qx,qy,qz,qw], "a": "run", "s": 1.0 }
      ]
    }
  ],
  "final_standings": [47, 3, 22, ...],
  "winner_robot_id": 47
}
```

Notes:
- Sample at **10 Hz**; lerp/slerp on playback. This keeps file size manageable (~500KB–1MB gzipped per event).
- `a` = animation state key (`"run"`, `"walk"`, `"jump"`, `"die"`, `"idle"`). `s` = animation speed multiplier.
- Once a robot is eliminated, stop emitting frames for it (they stay where they fell / ragdoll via a one-shot `die` animation at elimination time).
- The arena is regenerated client-side from `geometry_params` + `seed` to keep the replay file small. Arena generation must be deterministic.

---

## Simulation Engine Design

### Principles
1. **Deterministic.** Same inputs (robots, seed, event type) → identical replay. Use a seedable PRNG (`mulberry32`, `xorshift32`, etc. — not `Math.random`).
2. **Decoupled from rendering.** The sim does not use Three.js. It runs headlessly, outputs numerical state over time.
3. **Fixed timestep.** Run sim at ~60 Hz internally, downsample to 10 Hz for the replay.
4. **Shared code across sim and client.** Trait-to-stat derivation, arena generation, and any constants should live in a shared module so client and sim agree.

### High-level loop (per event module)
```
init arena from (seed, eventConfig)
init 90 robots with derived stats and starting positions
for tick in 0..maxTicks:
  for each active robot:
    update AI decision (pathfinding target, obstacle avoidance)
    apply movement (respecting speed/accel/handling caps)
    check collisions & cull conditions
    if eliminated: mark eliminated_at_stage, stop updating
  if on sample tick: record frame snapshot
  if only one robot left or time expired: break
finalize standings by (placement = eliminated_at_stage then position at end)
write replay JSON
```

### Physics / collision
Keep it minimal. Robots are capsules on a heightfield or simple plane with obstacles. No full rigid-body physics engine needed for v1 — simple kinematic movement with collision checks against arena geometry is sufficient. If a physics engine is added later, `cannon-es` or `rapier` both have Node-compatible builds.

---

## Boost System

### User flow
1. On the event page during `boost_open` window, each robot tile shows a `BOOST` button.
2. Clicking opens a `<modal>` with:
   - Twitter Intent URL pre-filled: `"Boosting Robot #047 in today's Robo Rhapsody Maze Run! 🤖 #RoboRhapsody"`
   - A "Confirm Boost" button.
3. Clicking Confirm Boost fires `INSERT INTO boosts (event_id, robot_id, client_hash)`.
   - On success (201): show "Boosted!" state, disable button globally for that robot.
   - On unique constraint violation (409): show "Already boosted" — someone got there first.
4. No verification that the user actually tweeted. Honor system.

### Sim effect
- If `event_participants.boosted = true` for a robot, apply a small stat nudge during that event's simulation.
- Suggested magnitude: +3% to the robot's dominant trait-derived stat (speed for Full Send-heavy robots, pathfinding for Cipher-heavy, etc.).
- Cap the effect small enough that it influences but doesn't determine outcomes. Underdog stories are great; boost-spam wins are not.

### Rate limiting
- Optional: hash client IP + session cookie into `client_hash`. Limit to N boost-clicks per hour per hash to discourage spam. Not strictly necessary for v1 since one-per-robot-per-event is already a hard cap.

---

## Leaderboard & ELO

### Rating formula
Use a placement-based ELO extension (Glicko-style or a simplified multi-player ELO). A practical approach:

For each event, compute expected score per robot based on current ELO vs field average, then compare to actual placement-derived score:
```
actual_score(placement) = (N - placement) / (N - 1)     // 1.0 for winner, 0.0 for last
expected_score(robot, field) = 1 / (1 + 10^((field_avg_elo - robot_elo) / 400))
new_elo = old_elo + K * (actual_score - expected_score)
```
Use `K = 32` initially. Tune after observing spread.

### Separation by event type
Maintain **independent ELO per event type**. Robot #47 can be sprint-rank 3 and maze-rank 82. This is a feature — holders get multiple angles to feel proud from.

### Leaderboard views
- Overall (average ELO across event types)
- Per event type
- Recent form (last 10 events)
- Most boosts received (lifetime)

---

## Frontend Pages

### `/` — Today's Event
- Header with countdown to showtime.
- Grid of 90 robots with texture thumbnails and trait breakdowns. Boost button per tile (disabled if already boosted — reflect this from a realtime Supabase subscription on `boosts` table).
- Event type badge (Sprint / Maze / Gauntlet).
- At showtime `T`: grid collapses / tab switches to the Three.js scene; replay begins playback.
- After `T + duration`: winner highlight, link to leaderboard.

### `/leaderboard`
- Tabs for Overall / Sprint / Maze / Gauntlet.
- Sortable table: rank, robot thumbnail, ID, ELO, wins, podiums, events.

### `/robot/:id`
- Single robot profile. Texture render, trait radar chart, ELO per event type, recent event history.

### `/archive` *(optional for v1, nice to have)*
- List of past events with their replay files. Clicking plays the replay.

---

## Scheduled Jobs

Implement these as Supabase Edge Functions invoked by `pg_cron`, or as a lightweight Node worker on a schedule (whichever fits the existing infrastructure).

| Job | When | What it does |
|---|---|---|
| `schedule_event` | Daily at T−8h | Create new `events` row, choose event type from seeded rotation, set `status = 'boost_open'`, fire announcement tweet. |
| `run_simulation` | Daily at T−1h | Load robots + boost flags, run sim, upload replay JSON to Storage, populate `event_participants`, update `leaderboard`, set `status = 'ready'`. |
| `go_live` | Daily at T | Set `status = 'live'`. (Client-side countdown handles most of this, but the status flag lets the archive know.) |
| `finalize_event` | Daily at T+5min | Set `status = 'complete'`. Fire winner tweet with replay link. |

---

## X (Twitter) Integration

### Project account (automated)
- **Announcement tweet** at T−8h: "Today at 18:00 UTC — 90 robots. One Maze. Tune in: roborhapsody.xyz 🤖"
- **Winner tweet** at T+5min: "🏆 Robot #047 takes the Maze Run. Watch the replay: [link]"
- Rotate 5–10 caption variants per event type so the feed doesn't look botlike.
- MVP can keep this manual if Twitter API setup is a blocker — the sim still runs unattended either way.

### User boost posts
- Twitter Intent URLs only. No API on user side.
- Template: `https://twitter.com/intent/tweet?text=...`

---

## Explicit v1 Scope

### In scope
- Daily automated event (1 of 3 event types: sprint / maze / gauntlet).
- All 90 robots participate, trait-based behavior.
- 3-stage culling per event.
- Deterministic sim with seed, stored as replay JSON.
- Browser-based Three.js playback.
- Boost system: honor-based, one-per-robot-per-event, small sim effect.
- ELO leaderboard per event type.
- Automated announcement + winner tweet (or manual if Twitter API delayed).

### Explicitly NOT in v1
- Wallet connect, holder auth, NFT ownership verification.
- Team events, Altruist-dependent mechanics (trait is tracked but unused in sim).
- Live simulation with real-time viewer input (everything is replay playback).
- Real-time boost effects during playback (boosts lock in before sim runs).
- Custom celebration animations (use existing animations + particle effects for victory).
- Twitter API verification of user boost tweets.
- Mobile-native app.
- Betting, prediction markets, or any value transfer.

---

## Suggested Build Phases

1. **Schema + seed data.** Create Supabase tables, import the 90 robots and their traits. Verify reads from the existing Three.js project.
2. **Sim engine skeleton.** Pure-JS sim module with a single event type (sprint, simplest). Outputs replay JSON to a local file. No Supabase integration yet.
3. **Replay playback.** Add a playback mode to the existing Three.js project that loads a replay JSON and renders it frame-by-frame with interpolation and animation state switching.
4. **Second and third event types.** Maze and gauntlet. Shake out shared interfaces.
5. **Supabase wiring.** Storage upload, event lifecycle, `event_participants`, leaderboard updates.
6. **Frontend event page.** Countdown, robot grid, boost UI, live transition to playback.
7. **Leaderboard page.**
8. **Scheduled jobs.** Automate the lifecycle.
9. **X integration.** Announcement + winner tweets.
10. **Soft-launch test run.** Run one full end-to-end event unannounced. Watch for performance, ragdolls, tweet formatting. Fix.
11. **Launch.** Single announcement tweet. Let it find its audience.

---

## Performance Notes

- 90 skinned meshes in Three.js is fine on modern hardware if you share the geometry and only swap the material (texture). Do *not* load 90 separate GLTF files.
- Consider `InstancedSkinnedMesh` (or manual equivalent) if you see frame drops with 90 individually-clocked animations. A simpler win: only run full animation updates for robots visible in the current camera frustum; for off-screen robots advance the replay state but skip skeleton updates.
- Keep replay JSON gzipped on the wire. Supabase Storage can serve with `Content-Encoding: gzip` if uploaded pre-compressed.
- 10 Hz replay sample rate is a deliberate compromise. If motion looks jerky, bump to 15 Hz and accept the file-size hit before going to 30.

---

## Reliability & Safety

- **Deterministic re-run.** Every event stores its seed. If a sim produces a bug or exploit, re-run with a patched engine to produce a corrected replay. Keep the original as `replay_url_original`.
- **Schema versioning.** The `schema_version` field in replay JSON means future renderer changes don't break old archives.
- **Boost race conditions.** The `(event_id, robot_id)` unique constraint on `boosts` handles the one-per-robot guarantee at the DB level. The frontend must handle 409 gracefully.
- **Sim time budget.** Put a hard cap on sim runtime (e.g., 30 seconds wall-clock). If the sim hasn't produced a winner, force-finalize based on current progress. This prevents a stuck sim from missing showtime.
- **Fallback content.** If the scheduled sim fails, the site should show a clean "event postponed" state rather than a broken countdown. Log the failure and alert.

---

## Open Questions (Please Confirm Before Handoff)

1. **Existing animations.** Confirmed walk/run/jump/die — is there also an idle animation? Any form of victory pose, wave, or celebration? If not, the winner treatment will be built from existing animations + particle effects (confetti, spotlight, slow camera orbit).
2. **Frontend framework.** Is the existing Three.js project vanilla, React, Vue, or something else? This affects how the event page and leaderboard are structured.
3. **Hosting.** Where is the frontend deployed today (Vercel, Netlify, self-hosted)? Does it have a backend component, or is it pure static?
4. **Event showtime.** What time of day works best for the daily event? 18:00 UTC is a reasonable default (morning in the Americas, evening in Europe, late night in Asia), but confirm.
5. **Trait data source.** Are traits stored on-chain and read live, or cached in a metadata JSON? For v1 we'll seed `robots` once from whatever source is easiest; we can refresh later.
6. **Twitter API access.** Does the project have (or want) a Twitter Developer account and API keys? If not, winner tweets go manual until it does — not a blocker.
7. **Replay archive browsing.** Ship `/archive` in v1 or defer? Cheap to build if the data is already there.

---

## Glossary

- **Event** — a single daily simulation run (one of sprint, maze, gauntlet).
- **Stage** — a culling checkpoint within an event (3 per event).
- **Replay** — the JSON timeline that drives client-side playback. Source of truth.
- **Showtime** — the scheduled moment (`T`) when the replay plays on the site.
- **Boost** — a one-per-robot-per-event flag that nudges a robot's stats slightly. Claimed by viewers during the pre-event window.
