# Runner Prototype

**PROTOTYPE — NOT FOR PRODUCTION**

Validates the core loop hypothesis: does 3-lane dodging feel fun?

## Run It

```bash
cd prototypes/runner
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Firefox.

## Controls

| Key | Action |
|-----|--------|
| ← → / A D | Lane change (instant snap) |
| ↑ / Space | Jump |
| ↓ / S | Slide |
| R / Enter / Space | Restart (after death) |

## What to Test

1. **Lane snap feel** — Does instant X snap feel precise or jarring? Does the camera lag provide enough momentum sensation?
2. **Jump arc** — Does the jump height (≈3.6 units peak) give enough clearance over Barriers (top = 1.0)? Does the timing feel learnable?
3. **Slide clearance** — Does sliding under Drones (bottom = 1.0, crouched top = 0.9) feel like a deliberate commitment, or accidentally tight?
4. **Speed ramp** — Does the acceleration from 8 u/s to 25 u/s over ~34s feel gradual enough to learn, fast enough to create tension?
5. **Obstacle timing** — At max speed (25 u/s), reaction window is ~1.2s from spawn (Z=-30) to contact. Does that feel fair or too tight?
6. **Near-misses** — Do dodges feel satisfying? Do you feel the obstacle "nearly got you"?

## Architecture Notes (NOT for production)

- No Rapier physics — jump arc is manual `velocityY + gravity`
- No enable3d — plain Three.js + `requestAnimationFrame`
- No input system abstraction — raw `keydown` events
- Collision is AABB, not Rapier callback
- All values hardcoded — no config objects
- Single 600-line file

See `REPORT.md` after testing.
