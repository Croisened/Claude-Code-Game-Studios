# Sprint 2 — 2026-04-01 to 2026-04-07

> **Status**: Active
> **Stage**: Production
> **Developer**: Nathanial Ryan
> **Created**: 2026-03-31

---

## Sprint Goal

Ship v1 — Rapier physics integrated, Difficulty Curve live, Web3 wallet + NFT
skin connected, audio in, and leaderboard submitted.

---

## Capacity

| | |
|---|---|
| **Total days** | 5 working days (solo developer) |
| **Buffer (20%)** | 1 day reserved for Web3/Rapier integration friction |
| **Available** | 4 days |

> Estimates are upper bounds. Agent pair-programming compresses implementation
> by 5–10×. Plan 2–3× the task count vs. a human-hours estimate (per Sprint 1
> retro recommendation).

---

## Tasks

### Must Have (Critical Path)

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S2-01 | Tech hardening — `tsc --noEmit` pre-commit gate + `recycleBuffer > cameraZOffset` startup assertion | 0.1d | — | `npm run typecheck` passes; startup assertion throws on misconfigured values |
| S2-02 | Rapier physics integration — lane snap via `setTranslation()`, jump via `applyImpulse()`, OBSTACLE_GROUP collision callbacks replacing AABB stubs | 0.5d | S1-07, S1-08 | All 6 physics TODOs resolved; existing 175 tests still pass; collision fires correctly at runtime |
| S2-03 | Difficulty Curve — GDD + implementation (speed ramp formula, spawn rate scalar, distance-driven) | 0.5d | S1-08, S1-09 | Speed increases on distance curve per GDD formula; difficulty playtestable at 500m+ |
| S2-04 | Web3 library spike (2h timebox) — ethers.js vs. viem vs. wagmi decision, browser CORS check, RPC latency test | 0.25d | — | Decision recorded in ADR; chosen library installed; proof-of-concept wallet connect works in browser |
| S2-05 | Wallet Connection — connect/disconnect, address display, persist across reload | 0.25d | S2-04 | `connect()` opens wallet modal; address shown in UI; survives page reload |
| S2-06 | NFT Ownership Verification — query contract for token ownership by wallet address | 0.5d | S2-05 | Given known wallet + token ID, returns correct true/false; handles no-wallet and wrong-chain gracefully |

### Should Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S2-07 | NFT Skin Loader — load robot texture from token metadata URI, fallback to default skin | 0.25d | S2-06, S1-04 | NFT holder sees their robot skin; non-holder sees default; load error falls back silently |
| S2-08 | Main Menu — proper start screen with wallet connect CTA, game title, start prompt | 0.25d | S2-05, S1-02 | Menu displays on load; wallet connect visible; any key / click starts game |
| S2-09 | Audio System — GDD + implementation (SFX: run loop, jump, death, lane change + background music loop) | 0.5d | S1-02 | All 4 SFX trigger on correct events; music loops without gap; mute toggle works |

### Nice to Have

| ID | Task | Est. | Dependencies | Acceptance Criteria |
|----|------|------|-------------|---------------------|
| S2-10 | Leaderboard Backend — evaluate Supabase vs. Lootlocker (≤4h budget); submit score on death with wallet address as player ID | 0.5d | S2-06, S1-09 | Score submits on death; top-10 scores fetchable via API; backend decision in ADR |
| S2-11 | Leaderboard UI — top-10 overlay on death screen | 0.25d | S2-10 | Leaderboard renders on death; shows rank, truncated wallet address, score |
| S2-12 | Art pass — first-pass geometry: robot silhouette mesh, neon barrier shape, flying drone shape | 0.5d | S1-04, S1-08 | Distinct readable silhouettes for all 3; no placeholder box meshes remaining in production path |

---

## Carryover from Sprint 1

| Deferred Item | Reason | Addressed By |
|---------------|--------|--------------|
| Rapier physics body integration (lane/jump/collision) | enable3d physics body API not wired; AABB stub sufficient for MVP | S2-02 |
| AnimationMixer / animation clips | No .glb asset yet; placeholder timer sufficient | Post-sprint (needs art asset first) |

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Rapier API mismatch via enable3d wrapping | High | Medium | Verify actual installed API before writing; check enable3d GitHub source |
| Web3 browser CORS / RPC latency issues | Medium | High | S2-04 spike catches this early; fallback is manual token ID entry field |
| NFT metadata URI format unknown | Medium | Low | Fallback to default skin on any load error; non-blocking |
| Leaderboard backend setup > 4h | Medium | Medium | Hard cap at 4h; use Lootlocker if Supabase exceeds budget |
| AnimationMixer still deferred (no .glb) | High | Low | Known and bounded; art pass (S2-12) is geometry only, not rigged animation |

---

## Dependencies on External Factors

- **Web3 RPC endpoint**: Public RPC (Infura/Alchemy free tier) required for NFT query — needs API key
- **NFT contract ABI**: Robo Rhapsody contract ABI required for S2-06 — Nathanial to provide
- **Audio assets**: SFX + music files required for S2-09 — source or generate before task begins
- **Leaderboard service**: Supabase project or Lootlocker account required for S2-10

---

## Definition of Done

- [ ] `npm run typecheck` (`tsc --noEmit`) passes with zero errors
- [ ] `npm run test` passes — all existing 175 tests green; new tests added for S2-02 and S2-03
- [ ] Rapier physics: lane snap, jump, and collision callbacks wired — no AABB stubs remaining
- [ ] Difficulty Curve active: speed increases measurably over a 500m run
- [ ] Web3: wallet connect works in browser; NFT holder sees correct skin
- [ ] Audio: SFX and music play correctly in browser
- [ ] All Must Have tasks completed
- [ ] GDDs written for all new systems (Difficulty Curve, Audio System) before implementation
- [ ] ADRs written for Web3 library decision and Leaderboard backend decision
- [ ] No S1 or S2 bugs in delivered features
- [ ] Game is playable end-to-end: menu → run → die → leaderboard → restart

---

## Build Order

```
S2-01 (typecheck gate)          ← immediate, standalone
S2-04 (Web3 spike)              ← early, unblocks Web3 chain
  └── S2-05 (Wallet Connection)
        ├── S2-06 (NFT Verification)
        │     └── S2-07 (NFT Skin Loader)
        └── S2-08 (Main Menu)

S2-02 (Rapier physics)          ← parallel with Web3 chain
S2-03 (Difficulty Curve)        ← after S2-02 (uses same physics body)
S2-09 (Audio System)            ← parallel, no physics/Web3 dependency

S2-10 (Leaderboard Backend)     ← after S2-06
  └── S2-11 (Leaderboard UI)

S2-12 (Art pass)                ← last; cosmetic, no blockers
```
