# Leaderboard System

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-04-01
> **Implements Tasks**: S2-10, S2-11

## Overview

The Leaderboard System persists top scores to a Supabase backend and displays a
top-10 table on the ScoreScreen. On death, the player's final score and NFT skin
ID are submitted via the Supabase REST API. When the ScoreScreen renders, the top-10
is fetched and displayed below the player's personal score. No authentication is
required — submissions use the Supabase anon key with row-level security policies
allowing public insert and select. The player's own row is highlighted in the table.

## Player Fantasy

You died — but your name is still on the board. The leaderboard isn't a wall of
shame; it's proof you ran. Seeing your skin ID in the top-10 is a flex for NFT
holders. The table loads fast, the neon glow confirms you're in the record, and
the prompt to reboot sits right below — pulling you back in immediately.

## Detailed Rules

### Submission

1. A score is submitted on every `→ Dead` transition where `finalScore > 0`.
2. The player ID is the NFT skin ID stored in `localStorage` under the key
   `roborhapsody_skin_id`. If the key is absent or empty, player ID is `'Guest'`.
3. Submission is fire-and-forget — the game does not wait for the response before
   advancing to ScoreScreen. Network errors are caught, logged, and silently ignored.
4. Scores of `0` are not submitted (the player had not run).

### Fetch

1. The top-10 is fetched when `_showScoreScreen()` is called (`→ ScoreScreen`).
2. The fetch returns up to 10 rows ordered by `score DESC`.
3. While fetching, a "FETCHING LEADERBOARD…" placeholder is shown.
4. On network error or malformed response, "LEADERBOARD UNAVAILABLE" is shown.
5. The player's own entry is highlighted if their `player_id` and `score` match any
   row in the returned top-10.

### Table Schema (Supabase)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | bigserial | auto | Primary key |
| `player_id` | text | `'Guest'` | NFT skin ID or `'Guest'` |
| `score` | integer | — | Meters (floor of distance) |
| `created_at` | timestamptz | `now()` | Set by server |

### Row-Level Security

- `public insert` policy: `WITH CHECK (true)` — anyone can insert
- `public select` policy: `USING (true)` — anyone can read

## Formulas

### Score Value

Score submitted = `Math.floor(ScoreTracker.distance)` at `→ Dead`.
This is the same value displayed as `finalScore` on the ScoreScreen.

### Top-10 Query

```
GET /rest/v1/scores
  ?select=player_id,score
  &order=score.desc
  &limit=10
```

No pagination — always the absolute top-10 globally.

### Player Row Highlight Condition

A returned row is highlighted if:
```
row.player_id === localPlayerId AND row.score === finalScore
```

If the player appears multiple times (same skin ID, same score), only the first
matching row is highlighted.

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Score = 0 (player died instantly) | No submission. Leaderboard still fetches and displays. |
| Network down at submit time | `fetch` rejects; error logged to console; game continues normally. |
| Network down at fetch time | Catch block renders "LEADERBOARD UNAVAILABLE" in place of the table. |
| Player not in top-10 | No row is highlighted. Table still renders normally. |
| Two players with same skin ID and score | First matching row in the returned array is highlighted. |
| Player changes skin ID mid-session | Submit uses the ID current at the time of death (read from localStorage at submit time). |
| Supabase returns malformed JSON | `json()` parse error is caught; "LEADERBOARD UNAVAILABLE" shown. |
| Very long skin ID string | Truncated to 20 characters in the display only; full value stored in DB. |

## Dependencies

### Inbound (systems LeaderboardSystem depends on)

| System | What it uses |
|--------|-------------|
| `GameStateManager` | `→ Dead` triggers submit; `→ ScoreScreen` triggers fetch |
| `ScoreTracker` | `finalScore` used as the score value at submit time |
| `localStorage` | Reads `roborhapsody_skin_id` for player ID |
| Supabase REST API | Score persistence and retrieval |

### Outbound (systems that depend on LeaderboardSystem)

| System | What it provides |
|--------|-----------------|
| `GameUI` | Consumes `fetchTop10()` result to render the ScoreScreen table |
| `main.ts` | Calls `submitScore()` on `→ Dead` |

## Tuning Knobs

| Knob | Default | Safe Range | Effect |
|------|---------|-----------|--------|
| `topN` | 10 | 5–25 | Number of rows fetched and displayed |
| `playerIdMaxDisplay` | 20 chars | 8–30 | Truncation length for skin IDs in the table |

All knobs live in `LEADERBOARD_CONFIG`.

## Acceptance Criteria

| # | Criterion | Pass Condition |
|---|-----------|---------------|
| AC-1 | Score submits on death | A new row appears in the Supabase `scores` table after each run ending in death with `finalScore > 0` |
| AC-2 | Player ID recorded | Submitted row's `player_id` matches the skin ID in localStorage (or `'Guest'` if unset) |
| AC-3 | Zero score not submitted | No row inserted when player dies with `finalScore = 0` |
| AC-4 | Top-10 fetches on ScoreScreen | Leaderboard table renders within 3s of ScoreScreen appearing on a normal connection |
| AC-5 | Loading state shown | "FETCHING LEADERBOARD…" placeholder visible before data arrives |
| AC-6 | Network error graceful | "LEADERBOARD UNAVAILABLE" shown if fetch fails; no exception thrown; game still restarts normally |
| AC-7 | Player row highlighted | Own score row visually distinct from others when player appears in top-10 |
| AC-8 | Table sorted by score | Rows displayed highest score first |
| AC-9 | Reboot prompt still works | Pressing any key still transitions to MainMenu from ScoreScreen regardless of leaderboard state |
