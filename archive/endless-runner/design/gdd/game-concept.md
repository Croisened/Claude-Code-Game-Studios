# Game Concept: Robo Rhapsody — Neon Fugitive

*Created: 2026-03-27*
*Status: Draft*

---

## Elevator Pitch

> It's a cyberpunk endless runner where you sprint through the hostile streets of
> Neotropolis as your own Robo Rhapsody NFT robot, dodging the city's enforcement
> systems until the city finally catches you — and then you run again.

---

## Core Identity

| Aspect | Detail |
| ---- | ---- |
| **Genre** | Endless Runner / Arcade |
| **Platform** | Web (desktop-first) |
| **Target Audience** | Robo Rhapsody NFT holders + arcade/runner fans |
| **Player Count** | Single-player with leaderboard competition |
| **Session Length** | 2–10 minutes per run; multiple runs per session |
| **Monetization** | None (brand extension + portfolio piece) |
| **Estimated Scope** | Small (~2 weeks, solo developer) |
| **Comparable Titles** | Subway Surfers, Temple Run 2, Canabalt |

---

## Core Fantasy

You are a rogue robot in Neotropolis — a city of chrome, neon, and corporate
surveillance. The city's entire enforcement infrastructure has locked onto your
frequency. You don't fight back. You run.

The fantasy is **personalized survival**: the robot sprinting through Neotropolis
isn't a generic avatar — it's *your* robot, the specific NFT you own, rendered in
full 3D with your unique texture set. Every near-miss, every impossible dodge, every
brutal death happens to *your* machine. When you share your score, you're sharing a
story about your robot.

For players who don't hold an NFT, the demo robot is a teaser — a taste of a world
where the character could be *theirs*.

---

## Unique Hook

> "It's like Subway Surfers, AND ALSO your playable character is the specific NFT
> you own — loaded directly from your wallet."

No other endless runner puts a player's verified digital asset in the protagonist
role. The NFT isn't a cosmetic unlock or a badge — it's the point of the whole game.
The 90 unique texture variants on the Robo Rhapsody model mean no two holders run
the same robot.

---

## Player Experience Analysis (MDA Framework)

### Target Aesthetics (What the player FEELS)

| Aesthetic | Priority | How We Deliver It |
| ---- | ---- | ---- |
| **Sensation** (sensory pleasure) | 1 | Neon cyberpunk visual style, robot death animation, speed-blur effects, kinetic obstacle design |
| **Challenge** (obstacle course, mastery) | 2 | Escalating obstacle density and speed; personal best score pressure |
| **Fantasy** (make-believe, role-playing) | 3 | Playing as your own NFT robot in a lived-in cyberpunk city |
| **Expression** (self-expression, creativity) | 4 | Your NFT skin IS your expression — 90 unique identities |
| **Fellowship** (social connection) | 5 | Leaderboard by robot skin; sharing run scores in the NFT community |
| **Discovery** (exploration, secrets) | N/A | Not a discovery game — focus is forward momentum |
| **Narrative** (drama, story arc) | N/A | Lore lives in environment design, not dialogue or cutscenes |
| **Submission** (relaxation, comfort zone) | N/A | High-tension, not relaxing |

### Key Dynamics (Emergent player behaviors)

- Players will switch between their robot and a friend's to compare distances
- NFT holders will screenshot/record their robot's runs and share in community channels
- Players will naturally develop personal "styles" — learning which obstacles they can
  consistently dodge vs. which kill them
- Non-holders who play via demo will be motivated to acquire an NFT to unlock their
  own skin

### Core Mechanics (Systems we build)

1. **Auto-runner with 3-lane movement** — robot runs forward automatically; player
   swipes/presses to change lanes, jump, or slide
2. **Obstacle spawner** — procedurally places obstacles (drones, barriers, collapsing
   structures, neon signage) with difficulty scaling over time
3. **NFT skin loader** — reads connected wallet, identifies owned Robo Rhapsody tokens,
   loads the corresponding texture onto the shared .glb robot model
4. **Death + score screen** — death triggers a brief cinematic animation, then shows
   distance, score, and robot identity before offering instant restart
5. **Leaderboard** — global high score table keyed by robot token ID, showing which
   NFT ran the furthest

---

## Player Motivation Profile

### Primary Psychological Needs Served

| Need | How This Game Satisfies It | Strength |
| ---- | ---- | ---- |
| **Autonomy** (freedom, meaningful choice) | Choose your robot skin; lane choice and timing are meaningful | Supporting |
| **Competence** (mastery, skill growth) | Clear personal best metric; escalating difficulty creates real mastery curve | Core |
| **Relatedness** (connection, belonging) | Playing as your NFT robot ties the game to the Robo Rhapsody community identity | Core |

### Player Type Appeal (Bartle Taxonomy)

- [x] **Achievers** (goal completion, collection, progression) — How: Personal best scores, leaderboard ranks, distance milestones
- [ ] **Explorers** (discovery, understanding systems, finding secrets) — Not a primary appeal; environment is forward-scrolling
- [x] **Socializers** (relationships, cooperation, community) — How: NFT community identity; sharing robot runs; leaderboard by token
- [x] **Killers/Competitors** (domination, PvP, leaderboards) — How: Global leaderboard; direct score comparison by robot skin

### Flow State Design

- **Onboarding curve**: First 30 seconds are slow — sparse obstacles, forgiving timing.
  Speed and density ramp gradually. No tutorial screen needed; the game teaches through play.
- **Difficulty scaling**: Obstacle speed and spawn rate increase continuously. New obstacle
  types are introduced at distance thresholds so the player is always encountering something
  new but never overwhelmed immediately.
- **Feedback clarity**: Score displayed live during run. Distance shown prominently on
  death screen. Personal best highlighted on restart.
- **Recovery from failure**: Death animation plays (~2 seconds), then score screen appears.
  Single button press restarts instantly. Time from death to running again: under 5 seconds.

---

## Core Loop

### Moment-to-Moment (30 seconds)

The robot runs forward through Neotropolis automatically. The player watches the environment
ahead and reacts: swipe left/right to change lanes, press up to jump, press down to slide.
Obstacles appear with enough lead time to react but not so much that the decision is trivial.
The satisfaction is in the narrow escape — the half-frame dodge that just barely works.

### Short-Term (5–15 minutes)

One run ends in death, reveals a score and distance, then restarts. The "one more run"
pull comes from three sources: beating a personal best, the run that ended unfairly
(player attribution of skill vs. luck), and curiosity about what obstacles appear at
higher speeds/distances not yet reached.

### Session-Level (30–120 minutes)

A session is a series of runs with diminishing time between attempts. The player improves
their personal best, learns obstacle patterns, and develops intuition for the difficulty
curve. Session ends when they accept their best score for the day or achieve a satisfying
result. Natural stopping point: a run that clearly feels like their peak for the session.

### Long-Term Progression

At v1 scope, long-term progression is social: climbing the leaderboard relative to other
Robo Rhapsody holders. The game is "complete" for a given player when they feel they've
represented their robot well on the board. Future v2 progression could include distance
milestones that unlock Neotropolis lore fragments.

### Retention Hooks

- **Curiosity**: What does Neotropolis look like at 2x speed? What obstacles appear after
  1000m that I haven't seen yet?
- **Investment**: My robot's leaderboard position. If I stop playing, others will pass me.
- **Social**: "Show me your robot's best run" is a natural community prompt for NFT holders.
- **Mastery**: The gap between my current best and my theoretical best is always visible.

---

## Game Pillars

### Pillar 1: Identity First

Your robot is not an avatar — it is you. The NFT skin is the protagonist. Every design
decision must reinforce that the player's specific robot is the hero of their run.

*Design test*: If we're debating whether to add a "random robot" option vs. always
defaulting to the player's owned token, this pillar says default to the owned token.
Random robots are for demo mode only.

### Pillar 2: The City Hunts You

Neotropolis is an active antagonist, not a passive backdrop. Obstacles should feel like
the city's systems are responding to the runner — not like random scenery appearing.

*Design test*: If we're debating between a static barricade obstacle vs. a drone that
swoops in from the side, this pillar says choose the drone — it feels like the city is
acting, not just blocking.

### Pillar 3: Death is a Beginning

Dying must feel like motivation to run again, never like punishment or frustration. The
death screen is a transition, not a failure state. Time from death to back in the run
must feel fast.

*Design test*: If we're debating a 5-second unskippable death animation vs. a 2-second
skippable one, this pillar says choose the 2-second skippable — respect the player's
time and eagerness to retry.

### Pillar 4: Own Your Runner

NFT holders play as the robot they own. Wallet connection is a first-class feature.
Non-holders get a demo robot that makes the game accessible and serves as a funnel toward
the collection.

*Design test*: If we're debating whether to let non-holders pick any skin for free vs.
keeping all 90 skins holder-only, this pillar says holder-only — the skins are the value
proposition of owning the NFT.

### Pillar 5: Two-Week Discipline

Every feature must be achievable by a solo artist-developer within the two-week build
window. If a feature cannot ship in time, it is a v2 item — not a reason to delay v1.

*Design test*: If we're debating adding a powerup system vs. shipping with clean obstacle
dodging only, this pillar says ship clean first. Powerups are v2.

### Anti-Pillars (What This Game Is NOT)

- **NOT a story game**: No cutscenes, no dialogue, no branching narrative. Lore lives
  in environment design. Adding story systems would compromise Two-Week Discipline and
  distract from the runner's core tension.
- **NOT a collection game**: No gacha, no unlocking skins through play, no grinding.
  You play as the NFT you own. A grinding system would undermine Own Your Runner by
  suggesting skins can be earned without holding the NFT.
- **NOT a mobile port**: Designed for web desktop first. Touch controls are a v2 feature.
  Mobile-first design would compromise control responsiveness and visual complexity.
- **NOT feature-complete at launch**: A tight, polished core loop ships over a bloated
  prototype. Scope creep is the primary risk for a two-week solo build.

---

## Inspiration and References

| Reference | What We Take From It | What We Do Differently | Why It Matters |
| ---- | ---- | ---- | ---- |
| Subway Surfers | 3-lane endless runner structure, obstacle variety, instant restart | Character is player's real NFT, not a licensed IP character | Proves the genre is accessible and widely understood |
| Temple Run 2 | Escalating speed tension, "one more run" psychology | Web-native, no app install; NFT identity layer | Validates adrenaline-focused runner design |
| Canabalt | Minimalist runner design, single-action input, atmosphere-first | 3D environment, NFT personalization, leaderboard competition | Shows that tension and simplicity can coexist |

**Non-game inspirations**:
- Cyberpunk 2077 — Neotropolis visual language: dense neon, corporate surveillance, vertical
  architecture, chrome and grime in the same frame
- Ghost in the Shell — robots with identity and soul; the machine as a vessel for selfhood
- The Robo Rhapsody NFT collection itself — the existing visual vocabulary and character designs
  are the primary art reference; the game serves the collection, not the reverse

---

## Target Player Profile

| Attribute | Detail |
| ---- | ---- |
| **Age range** | 20–40 |
| **Gaming experience** | Casual to mid-core; familiar with mobile runners and browser games |
| **Time availability** | Short sessions: 5–15 minutes; plays when checking the NFT community |
| **Platform preference** | Web browser (desktop); already in the NFT ecosystem via wallet |
| **Current games they play** | Casual browser games, mobile runners; NFT-adjacent games |
| **What they're looking for** | A reason to engage with their Robo Rhapsody holding beyond static display; community status |
| **What would turn them away** | Long tutorials, pay-to-win mechanics, required downloads, slow restarts |

---

## Technical Considerations

| Consideration | Assessment |
| ---- | ---- |
| **Engine / Renderer** | Three.js (core rendering) + enable3d (Rapier physics, game loop, input handling) |
| **Language** | JavaScript / TypeScript |
| **Key Technical Challenges** | Web3 wallet connection + NFT ownership verification; Three.js performance with animated .glb + dynamic obstacle spawning; obstacle difficulty curve at high speeds |
| **Art Style** | 3D stylized — existing Robo Rhapsody model (.glb) with 90 unique texture sets; Neotropolis environment built in Three.js |
| **Art Pipeline Complexity** | Medium — model and textures already exist; environment and obstacle assets need creation |
| **Audio Needs** | Moderate — cyberpunk ambient track, footstep/movement SFX, obstacle hit/near-miss audio, death sound |
| **Networking** | None (leaderboard via simple backend or third-party service) |
| **Content Volume** | 1 robot model, 90 textures, 3–5 obstacle types, 1 environment style, 1 music track |
| **Procedural Systems** | Obstacle spawner with distance-based difficulty scaling |
| **NFT Integration** | EVM wallet connection (MetaMask/WalletConnect); on-chain ownership query for Robo Rhapsody contract; dynamic texture swap on verified token |

---

## Risks and Open Questions

### Design Risks

- **"Just another runner" risk**: Without strong visual juice and the NFT hook landing emotionally,
  this is a generic browser game. The NFT personalization must feel meaningful, not cosmetic.
- **Difficulty curve fairness**: At high speeds, obstacle timing must remain learnable. If deaths
  feel random rather than earned, the "Death is a Beginning" pillar fails.

### Technical Risks

- **Web3 integration complexity**: Wallet connection, chain querying, and ownership verification
  could consume 2–3 days of the two-week budget. Consider a fallback where users enter their
  token ID manually if full wallet integration proves too slow.
- **Three.js performance**: Dynamic obstacle spawning + animated .glb model on mid-range hardware
  must hit 60fps. Geometry instancing and object pooling will be required.
- **enable3d/Rapier compatibility**: This combination is less documented than native Three.js.
  Budget time for debugging the physics-renderer boundary.

### Market Risks

- **NFT audience size**: The Robo Rhapsody collection has ~90 holders as a practical upper bound
  for the primary audience. This is intentional (brand tool, not mass-market game) but limits
  organic virality.
- **NFT sentiment**: Browser games with wallet connect may face friction from players unfamiliar
  with Web3. Demo mode (no wallet required) mitigates this.

### Scope Risks

- **Solo developer, two weeks**: Every feature added beyond the v1 scope risks the core not
  shipping. The anti-pillars exist specifically to prevent this.
- **Environment art**: The robot model exists; the Neotropolis environment does not. Building a
  compelling cyberpunk lane environment in Three.js is the largest unknown art task.

### Open Questions

- **Which Web3 library?** ethers.js vs. wagmi vs. viem — needs a spike day to evaluate browser
  compatibility and bundle size. Answer via: 2-hour technical prototype of wallet connect + token
  query.
- **Leaderboard backend**: Simple serverless endpoint (Vercel/Netlify function + database) vs.
  third-party service (e.g., Lootlocker) — answer via: evaluate setup time cost against build window.
- **Does the obstacle spawner feel fair?** Answer via: core loop prototype in Week 1, playtested
  by at least 3 people before Week 2 begins.

---

## MVP Definition

**Core hypothesis**: "The 3-lane runner loop is fun in isolation — players want to retry after dying."

**Required for MVP (Week 1 target)**:
1. Robot model (.glb) loads and runs forward in a Three.js scene
2. 3-lane input (keyboard arrow keys / WASD) with jump and slide
3. At least one obstacle type spawns, moves toward player, and kills on contact
4. Death resets the run; distance counter is shown

**Explicitly NOT in MVP** (defer to v1 or v2):
- Wallet connection and NFT skin loading
- Death animation
- Score screen
- Leaderboard
- Audio
- Multiple obstacle types
- Difficulty scaling

### Scope Tiers

| Tier | Content | Features | Target |
| ---- | ---- | ---- | ---- |
| **MVP** | 1 robot skin, 1 obstacle type, 1 environment stub | Runner loop, 3-lane input, death/restart, distance counter | End of Week 1 |
| **v1 Ship** | 90 NFT skins, 3–5 obstacle types, full Neotropolis environment | Wallet connect, NFT skin loader, death animation, score screen, leaderboard | End of Week 2 |
| **v2 Ideas** | District zone variety, powerups, Neotropolis lore fragments | Mobile touch controls, run replay, social sharing card generator | Post-launch |

---

## Next Steps

- [ ] Run `/map-systems` to decompose Neon Fugitive into individual systems with dependencies and priorities
- [ ] Run `/design-system` to author per-system GDDs (runner, spawner, NFT skin loader, leaderboard)
- [ ] Configure Three.js + enable3d stack in CLAUDE.md (`/setup-engine` or manual config)
- [ ] Spike Web3 wallet connection (ethers.js vs. wagmi — 2-hour prototype)
- [ ] Prototype core runner loop in Three.js (MVP target: robot runs, input works, death resets)
- [ ] Playtest MVP with 3 people (`/playtest-report` to capture feedback)
- [ ] Plan first sprint (`/sprint-plan new`)
