# Systems Index: Robo Rhapsody — Neon Fugitive

> **Status**: Draft
> **Created**: 2026-03-27
> **Last Updated**: 2026-03-27
> **Source Concept**: design/gdd/game-concept.md

---

## Overview

Neon Fugitive is a 3-lane endless runner with a Web3 identity layer. The mechanical
scope is deliberately narrow — a tight core loop (run, dodge, die, restart) with one
distinguishing feature set on top (NFT wallet integration and leaderboard). The system
architecture reflects this: 8 MVP systems that make the core loop function, and 10 v1
systems that add the NFT hook, UI polish, audio, and social competition layer. There are
no AI systems, no economy, no progression trees, and no narrative systems — each absence
is a deliberate decision in service of the Two-Week Discipline pillar.

---

## Systems Enumeration

| # | System Name | Category | Priority | Status | Design Doc | Depends On |
|---|-------------|----------|----------|--------|------------|------------|
| 1 | Game State Manager | Core | MVP | Designed | design/gdd/game-state-manager.md | — |
| 2 | Input System | Core | MVP | Designed | design/gdd/input-system.md | — |
| 3 | Score & Distance Tracker | Core | MVP | Designed | design/gdd/score-and-distance-tracker.md | — |
| 4 | Character Renderer | Core | MVP | Not Started | — | Game State Manager |
| 5 | Environment Renderer | Core | MVP | Not Started | — | Game State Manager |
| 6 | Camera System | Core | MVP | Not Started | — | Character Renderer |
| 7 | Runner System | Gameplay | MVP | Not Started | — | Input System, Character Renderer, Camera System, Game State Manager |
| 8 | Obstacle System | Gameplay | MVP | Not Started | — | Runner System, Game State Manager |
| 9 | Difficulty Curve | Gameplay | v1 Ship | Not Started | — | Obstacle System, Score & Distance Tracker |
| 10 | Wallet Connection | Web3 | v1 Ship | Not Started | — | Game State Manager |
| 11 | NFT Ownership Verification | Web3 | v1 Ship | Not Started | — | Wallet Connection |
| 12 | NFT Skin Loader | Web3 | v1 Ship | Not Started | — | NFT Ownership Verification, Character Renderer |
| 13 | Main Menu | UI | v1 Ship | Not Started | — | Game State Manager, Wallet Connection |
| 14 | HUD | UI | v1 Ship | Not Started | — | Score & Distance Tracker, Game State Manager |
| 15 | Death Screen | UI | v1 Ship | Not Started | — | Score & Distance Tracker, Game State Manager |
| 16 | Leaderboard Backend | Backend | v1 Ship | Not Started | — | Score & Distance Tracker, NFT Ownership Verification |
| 17 | Leaderboard UI | UI | v1 Ship | Not Started | — | Leaderboard Backend |
| 18 | Audio System | Audio | v1 Ship | Not Started | — | Game State Manager |

> Systems 1–3 are inferred foundations. Systems 4–18 were either explicitly stated in the
> concept doc or inferred from dependency analysis. Object Pool and Obstacle Type Registry
> are folded into the Obstacle System GDD. Personal Best tracking is folded into Score &
> Distance Tracker.

---

## Categories

| Category | Description | Systems in This Game |
|----------|-------------|---------------------|
| **Core** | Foundation systems everything depends on | Game State Manager, Input System, Score & Distance Tracker, Character Renderer, Environment Renderer, Camera System |
| **Gameplay** | The systems that make the game fun | Runner System, Obstacle System, Difficulty Curve |
| **Web3** | NFT identity and ownership verification | Wallet Connection, NFT Ownership Verification, NFT Skin Loader |
| **UI** | Player-facing information displays | Main Menu, HUD, Death Screen, Leaderboard UI |
| **Backend** | External data persistence | Leaderboard Backend |
| **Audio** | Sound and music | Audio System |

---

## Priority Tiers

| Tier | Definition | Target | Systems |
|------|------------|--------|---------|
| **MVP** | Required for core loop to function. Tests "is dodging obstacles fun?" | End of Week 1 | 1–8 |
| **v1 Ship** | NFT identity, UI polish, audio, leaderboard — full brand experience | End of Week 2 | 9–18 |
| **v2 Ideas** | Powerups, mobile touch, run replay, social sharing cards | Post-launch | (not enumerated) |

---

## Dependency Map

### Foundation Layer (no dependencies)

1. **Game State Manager** — the state machine framework; all other systems register listeners or query state
2. **Input System** — pure input abstraction; nothing needs to exist before keyboard events can be captured
3. **Score & Distance Tracker** — tracks numbers; no game system dependencies

### Core Layer (depends on Foundation)

1. **Character Renderer** — depends on: Game State Manager (show/hide by state)
2. **Environment Renderer** — depends on: Game State Manager (scroll during Running state only)
3. **Camera System** — depends on: Character Renderer (camera tracks robot position)
4. **Wallet Connection** — depends on: Game State Manager (connect prompt in Menu state)

### Gameplay Layer (depends on Core)

1. **Runner System** — depends on: Input System, Character Renderer, Camera System, Game State Manager
2. **NFT Ownership Verification** — depends on: Wallet Connection (needs connected wallet address)

### Feature Layer (depends on Gameplay)

1. **Obstacle System** — depends on: Runner System (lane positions, forward speed), Game State Manager
2. **Difficulty Curve** — depends on: Obstacle System (drives its parameters), Score & Distance Tracker (distance is the scalar input)
3. **NFT Skin Loader** — depends on: NFT Ownership Verification (which token ID?), Character Renderer (texture slot)

### Presentation Layer (wraps everything)

1. **HUD** — depends on: Score & Distance Tracker (live data feed), Game State Manager
2. **Death Screen** — depends on: Score & Distance Tracker (final score), Game State Manager
3. **Main Menu** — depends on: Game State Manager, Wallet Connection
4. **Leaderboard Backend** — depends on: Score & Distance Tracker (score to submit), NFT Ownership Verification (whose score)
5. **Leaderboard UI** — depends on: Leaderboard Backend
6. **Audio System** — depends on: Game State Manager (music/SFX triggered by state transitions)

---

## Circular Dependencies

None found. The dependency graph is a clean DAG.

The only near-circular relationship: **Game State Manager** and **Runner System** both need to know about each other (state manager triggers run start; runner triggers death state). Resolved by having the Runner System fire events that the State Manager listens to, not by direct coupling. Runner System does not hold a reference to the State Manager — it emits events.

---

## High-Risk Systems

| System | Risk Type | Risk Description | Mitigation |
|--------|-----------|-----------------|------------|
| NFT Ownership Verification | Technical | On-chain browser query (ethers.js/viem) is untested; RPC latency, contract ABI, and CORS in browser are all unknowns | Spike prototype in Week 1 before building the runner. Fallback: manual token ID entry field. |
| Environment Renderer | Scope | No Neotropolis environment assets exist — this is the largest art task with no existing reference | Begin with placeholder geometry (lane tiles, simple buildings). Art pass is v1, not MVP. |
| Obstacle System | Design | Difficulty curve fairness at high speeds is unknown until physically playtested | Core loop prototype by Day 3–4 of Week 1, playtested before Week 2 begins. |
| Leaderboard Backend | Technical | Serverless DB setup (Vercel + Supabase/PlanetScale) vs. third-party (Lootlocker) — setup time unknown | Evaluate Day 1 of Week 2. If setup > 4 hours, use Lootlocker. |

---

## Recommended Design Order

Design GDDs in this order. MVP systems must be fully designed before implementation begins.
Independent systems at the same layer can be designed in parallel.

| Order | System | Priority | Layer | Est. Effort |
|-------|--------|----------|-------|-------------|
| 1 | Game State Manager | MVP | Foundation | S |
| 2 | Input System | MVP | Foundation | S |
| 3 | Score & Distance Tracker | MVP | Foundation | S |
| 4 | Character Renderer | MVP | Core | M |
| 5 | Environment Renderer | MVP | Core | M |
| 6 | Runner System | MVP | Gameplay | M |
| 7 | Camera System | MVP | Core | S |
| 8 | Obstacle System | MVP | Feature | M |
| 9 | Difficulty Curve | v1 | Feature | S |
| 10 | Wallet Connection | v1 | Core | S |
| 11 | NFT Ownership Verification | v1 | Feature | M |
| 12 | NFT Skin Loader | v1 | Feature | S |
| 13 | Main Menu | v1 | Presentation | S |
| 14 | HUD | v1 | Presentation | S |
| 15 | Death Screen | v1 | Presentation | S |
| 16 | Audio System | v1 | Polish | S |
| 17 | Leaderboard Backend | v1 | Presentation | M |
| 18 | Leaderboard UI | v1 | Presentation | S |

> Effort: S = 1 design session (~1 hour), M = 2–3 sessions (~2–3 hours), L = 4+ sessions.

---

## Progress Tracker

| Metric | Count |
|--------|-------|
| Total systems identified | 18 |
| Design docs started | 1 |
| Design docs reviewed | 0 |
| Design docs approved | 0 |
| MVP systems designed | 3 / 8 |
| v1 Ship systems designed | 0 / 10 |

---

## Next Steps

- [ ] Design MVP systems 1–8 using `/design-system [system-name]`
- [ ] Run `/design-review` on each completed GDD
- [ ] Spike NFT Ownership Verification early (highest technical risk)
- [ ] Prototype Runner System + Obstacle System after GDDs are written (`/prototype runner`)
- [ ] Playtest MVP prototype before starting Week 2 (`/playtest-report`)
- [ ] Run `/gate-check pre-production` when all MVP GDDs are complete
- [ ] Plan implementation sprint with `/sprint-plan new`
