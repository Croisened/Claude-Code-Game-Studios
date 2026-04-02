# Browser Smoke Test Checklist

Run this checklist before committing any rendering-adjacent change.
Takes ~30 seconds. Catches visual regressions that `tsc --noEmit` and unit tests cannot see.

## How to Run

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome. Run through each check.

---

## Checklist

### Main Menu

- [ ] Robot is visible in the hero showcase position (not hidden, not clipping through floor)
- [ ] Robot idle animation is playing
- [ ] NFT ID input is visible and shows a default value (not empty)
- [ ] Background music starts (or prompts for interaction unlock)
- [ ] "Press any key" prompt is visible

### Running State

- [ ] Floor tiles scroll smoothly — no visible seam or stutter
- [ ] Robot switches to run animation
- [ ] HUD shows distance counter incrementing
- [ ] Obstacles spawn and scroll toward the robot
- [ ] Barrier obstacle renders (neon orange gate shape, not a box)
- [ ] Drone obstacle renders (neon cyan sphere + rotors, not a box)
- [ ] Lane change moves the robot left/right
- [ ] Jump raises the robot above the floor
- [ ] Camera follows the robot's X position

### Death & Score Screen

- [ ] Collision with an obstacle triggers death animation
- [ ] Score screen appears with final score and personal best
- [ ] Leaderboard top-10 renders (or graceful error message if offline)
- [ ] "Press any key" restarts to main menu

### Audio

- [ ] Run SFX plays during Running
- [ ] Jump SFX plays on jump
- [ ] Lane change SFX plays on lane change
- [ ] Death SFX plays on collision
- [ ] Mute button toggles audio off/on
- [ ] Mute state persists after page reload

### Mobile (if touch input changed)

- [ ] Swipe left/right changes lane
- [ ] Swipe up jumps
- [ ] Swipe down slides

---

## When to Run

- Before committing any change to: `src/core/`, `src/main.ts`, or `assets/`
- Always after: character renderer, environment renderer, obstacle art, UI layout changes
- Not required for: config-only changes, test-only changes, docs updates

---

## Known Non-Issues (do not flag)

- Console warnings about `[GSM] Rejected invalid transition` in tests — expected, test-only
- `[ObstacleSystem] setSpeed clamped` in dev console — expected when speed hits floor
