/**
 * Obstacle Gauntlet trap visuals (Arena-03).
 *
 * Renders the three trap types:
 *   - **Pit zones** as twin hinged trap doors that swing open beneath
 *     a falling robot. The ground itself is cut out at each pit zone
 *     (see GroundHole in renderer.ts) so when the doors swing the
 *     camera looks through into the black scene background.
 *   - **Hammers** as pillar + swinging-arm meshes whose rotation reads
 *     directly from the sim tick (sim-authoritative).
 *   - **Crumbling bridge** as a row of plank meshes that hide
 *     progressively as the crumble line advances after the first
 *     robot enters the bridge.
 *
 * Materials are shared across trap instances of the same type to keep
 * draw calls bounded. The whole structure is parented to a single
 * Group so call sites add/dispose with a single
 * `renderer.addToScene` / disposal traversal.
 *
 * Sim authority: hammer rotation phase is derived from the sim tick
 * via `(tickFloat % cycleTicks) / cycleTicks` — the same predicate the
 * sim uses for `isHammerDown`. The renderer NEVER sets hammer
 * positions out of sim-driven phase. Bridge crumble line position
 * also derives from `(tickFloat - bridgeEnteredTick) * crumbleSpeedMps`
 * — pure functions of sim state.
 */
import * as THREE from 'three';
import type { Arena, BridgeSpec, HammerSpec, PitZone } from '@/sim/arena';
import { createOrangeTree } from '@/arena-visuals/maze-walls';
import { createRng } from '@/sim/rng';

// --- Colours / dimensions -----------------------------------------

/** Pit trap-door panels — two hinged hatches per pit zone, hinged on
 *  the OUTER long edges and meeting at the centerline when closed.
 *  Each door extends from the course wall (z = ±courseWidth/2) inward
 *  to z=0, so the two doors together fill the entire course width.
 *  When a robot falls, both doors swing DOWNWARD (rotating around X) so
 *  the robot drops straight through the opened hatch into the abyss; the
 *  doors then fade-close back to flat over PIT_OPEN_DURATION_TICKS so the
 *  next fall re-opens them. The door's TOP face sits flush with the ground
 *  plane (y=0) — see PIT_DOOR_CENTER_Y — so closed doors don't read as a
 *  raised platform on top of the floor. */
const PIT_DOOR_COLOR = 0x232a2e;
const PIT_DOOR_THICKNESS = 0.18;
/** Door centre Y so the top face (centre + thickness/2) lands at the
 *  ground plane y=0; the door body sinks into the punched-out floor hole. */
const PIT_DOOR_CENTER_Y = -PIT_DOOR_THICKNESS / 2;
const PIT_OPEN_MAX_ANGLE = Math.PI * 0.42; // ~75° drop — doors swing down out of the hole
const PIT_OPEN_DURATION_TICKS = 36; // ~600ms at 60Hz
// The "void" beneath the doors is now a real hole punched out of the ground
// (see GroundHole in renderer.ts and the groundHoles wiring in app.tsx for
// the obstacle-gauntlet path). The previous shallow dark plane at y=-0.5
// is gone — the pure-black scene background shows through the hole, and
// falling robots drop into actual empty space.

const HAMMER_PILLAR_HEIGHT = 12.8;
/**
 * How far below ground the gauntlet "abyss" extends. The hammer pillars
 * are rooted at this depth (selling the "we're suspended on a platform"
 * illusion); pit-fall robots drop to this same depth so they come to
 * rest at the abyss floor instead of stopping mid-air. Exported so the
 * app shell can wire the pit-fall animation to the same value.
 */
export const GAUNTLET_ABYSS_DEPTH_M = 60;
const HAMMER_PILLAR_DEPTH_BELOW = GAUNTLET_ABYSS_DEPTH_M;
const HAMMER_PILLAR_RADIUS = 0.45;
const HAMMER_PILLAR_COLOR = 0x4a4f5b;
/**
 * Pillars sit OUTSIDE the course path so robots running near the lateral
 * boundary don't visually clip through them. Distance is measured from
 * the course edge (z = ±courseWidth/2) outward into the void; the cross-
 * beam still spans the full pillar-to-pillar gap so the gallows reads
 * as straddling the path. With the doubled arm length, the head reaches
 * z ≈ ±10.98 m at extreme swings — the OUTSET must keep pillars further
 * outboard than that so the arm doesn't clip through them.
 */
const HAMMER_PILLAR_OUTSET = 2.0;
const HAMMER_BEAM_HEIGHT = 0.5;
const HAMMER_BEAM_DEPTH = 0.6;
const HAMMER_BEAM_COLOR = 0x36373d;
const HAMMER_ARM_LENGTH = 11.0;
const HAMMER_ARM_THICKNESS = 0.55;
const HAMMER_HEAD_SIZE = 1.2;
const HAMMER_HEAD_COLOR = 0xa53a2a; // rusty industrial red
const HAMMER_PIVOT_Y = 11.6; // matches beam center, near the doubled pillar top
const HAMMER_ARM_COLOR = 0x36373d;
/** Max swing angle from vertical-down. < π/2 keeps the head BELOW the
 *  cross-beam — at 0.48π the arm reaches ±10.98 m from the pivot at the
 *  extreme of each swing, fully inside the gallows posts at z = ±11. */
const HAMMER_MAX_SWING_ANGLE = Math.PI * 0.48;

const BRIDGE_PLANK_COUNT = 24;
const BRIDGE_PLANK_THICKNESS = 0.35;
const BRIDGE_PLANK_HEIGHT = 0.25;
const BRIDGE_PLANK_COLOR = 0x6c4628;   // weathered timber
const BRIDGE_BEAM_COLOR = 0x3b2a18;    // darker rail/beam
const BRIDGE_RAIL_HEIGHT = 0.9;
const BRIDGE_RAIL_THICKNESS = 0.18;
/**
 * Plank surface (top face) sits flush with the ground plane at y=0 so
 * robots running across the bridge stay at ground height — no visible
 * "step up" onto raised planks. The plank body sits below ground in the
 * bridge's punched-out hole (see groundHoles wiring in app.tsx); when a
 * plank crumbles it drops straight into the void.
 */
const BRIDGE_PLANK_TOP_Y = 0;
/** Resting Y for the centre of each plank — half the plank height below
 *  the surface. */
const BRIDGE_PLANK_CENTER_Y = BRIDGE_PLANK_TOP_Y - BRIDGE_PLANK_HEIGHT / 2;
/** Rails sit ON the plank surface, extending upward into open air. */
const BRIDGE_RAIL_BOTTOM_Y = BRIDGE_PLANK_TOP_Y;
/** How many ticks a plank takes to fall from resting position to invisible. */
const BRIDGE_PLANK_FALL_TICKS = 14;
/** How far (metres) each plank drops during its fall animation. */
const BRIDGE_PLANK_FALL_DEPTH_M = 5.0;
/** Backward tilt (radians) added to the plank as it falls — its trailing
 *  edge (the side the robot came from) drops first, so the plank tips
 *  into the void behind the runner instead of sinking flat. ~32°. */
const BRIDGE_PLANK_FALL_TILT_RAD = 0.55;

// --- Grove (abyss-floor base + scattered orange trees) ------------
//
// A wide flat plane sits at the very bottom of the abyss (top face flush
// with the deepest pillar roots at y = -GAUNTLET_ABYSS_DEPTH_M) with 24
// orange trees scattered across it. Reuses the maze finish-tree palette
// (createOrangeTree + MAZE_GROUND_COLOR) so the gauntlet's floor reads as
// the same orange-grove world glimpsed from far above. Trees stay in the
// outboard bands (z outside the course strip) so they don't punch up
// through the suspended path.
//
// Plane lateral extent is 3× course width per the spec; longitudinal
// extent matches the gauntlet ground's X extent (course length + pad on
// each side) so the grove visibly extends beneath the entire course.

/** Sized to match MAZE_GROUND_COLOR in app.tsx — same orange-grove green. */
const GROVE_BASE_COLOR = 0x3a5527;
const GROVE_BASE_ROUGHNESS = 0.95;
/** Top of the grove plane sits at the abyss floor (= where the hammer
 *  pillars bottom out). Visually grounds the suspended-platform fiction. */
const GROVE_BASE_Y = -GAUNTLET_ABYSS_DEPTH_M;
/** Lateral plane size = 3× the course/bridge width. */
const GROVE_BASE_WIDTH_MULT = 3;
/** X-axis padding past the course on each end so the grove stretches
 *  visibly past the start grid and finish band. Mirrors the gauntlet
 *  ground's GAUNTLET_GROUND_PAD_X (kept in sync visually, not imported
 *  to avoid a UI→arena-visuals dep). */
const GROVE_BASE_X_PAD = 36;
const GROVE_TREE_COUNT = 24;
/** Keep tree trunks at least this far outboard of the course edge so
 *  canopies don't intersect the suspended platform from below. */
const GROVE_TREE_INNER_BUFFER_Z = 1.5;
const GROVE_TREE_OUTER_BUFFER_Z = 1.0;
const GROVE_TREE_X_BUFFER = 1.0;
/** Per-tree uniform scale range. Slight shrinking + variation makes the
 *  24 trees read as a scattered grove from above instead of a regular
 *  array of identical landmarks. */
const GROVE_TREE_SCALE_MIN = 0.55;
const GROVE_TREE_SCALE_MAX = 0.95;
/** Fixed seed → deterministic grove layout regardless of the sim seed.
 *  Visual placement doesn't need to vary per race. */
const GROVE_RNG_SEED = 0xC0FFEE;

function createGauntletGrove(arena: Arena): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gauntlet-grove';

  const sizeZ = arena.width * GROVE_BASE_WIDTH_MULT;
  const sizeX = arena.length + GROVE_BASE_X_PAD * 2;
  const centerX = arena.length / 2;

  // Flat base plane (no thickness — never seen edge-on; camera looks
  // down or across, never up under it). PlaneGeometry rotated to lie
  // flat, top face at GROVE_BASE_Y.
  const baseGeom = new THREE.PlaneGeometry(sizeX, sizeZ);
  const baseMat = new THREE.MeshStandardMaterial({
    color: GROVE_BASE_COLOR,
    roughness: GROVE_BASE_ROUGHNESS,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.set(centerX, GROVE_BASE_Y, 0);
  base.receiveShadow = true;
  group.add(base);

  // 24 orange trees scattered across the outboard bands. Alternate sides
  // for an even left/right distribution; jitter x and z within each band.
  const rng = createRng(GROVE_RNG_SEED);
  const courseHalfZ = arena.width / 2;
  const halfZ = sizeZ / 2;
  const innerZ = courseHalfZ + GROVE_TREE_INNER_BUFFER_Z;
  const outerZ = halfZ - GROVE_TREE_OUTER_BUFFER_Z;
  const xMin = centerX - sizeX / 2 + GROVE_TREE_X_BUFFER;
  const xMax = centerX + sizeX / 2 - GROVE_TREE_X_BUFFER;

  for (let i = 0; i < GROVE_TREE_COUNT; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = side * (innerZ + rng() * Math.max(0, outerZ - innerZ));
    const x = xMin + rng() * (xMax - xMin);
    const scale =
      GROVE_TREE_SCALE_MIN + rng() * (GROVE_TREE_SCALE_MAX - GROVE_TREE_SCALE_MIN);
    const yawY = rng() * Math.PI * 2;
    const tree = createOrangeTree({ scale, yawY });
    tree.position.set(x, GROVE_BASE_Y, z);
    group.add(tree);
  }

  return group;
}

// --- Pit trap-door --------------------------------------------------

interface PitTrapHandle {
  readonly zone: PitZone;
  /** Door hinged at the front (xStart) edge of the pit; rotates around
   *  Z so its free edge at x=cx drops below the floor. */
  readonly door1: THREE.Group;
  /** Door hinged at the back (xEnd) edge of the pit; rotates around Z
   *  symmetrically. */
  readonly door2: THREE.Group;
  /** Last sim tick a fall was registered in this zone. -Infinity if none. */
  lastBumpTick: number;
}

/**
 * Build one pit trap. Two doors split the pit zone ACROSS the course
 * (perpendicular to the running direction): door1 hinged at the front
 * edge (xStart), door2 hinged at the back edge (xEnd). Each spans half
 * the pit length × the full course width and meets the other at the
 * pit's centre x = (xStart + xEnd) / 2. When opened both swing down
 * around the Z axis, dropping their free edges below the floor.
 */
function createPitTrap(
  zone: PitZone,
  courseWidth: number,
): { group: THREE.Group; handle: PitTrapHandle } {
  const group = new THREE.Group();
  group.name = `pit-trap-${zone.xStart.toFixed(0)}`;

  const length = zone.xEnd - zone.xStart;
  const halfLen = length / 2;
  const platformWidth = courseWidth;

  // Shared door material.
  const doorMat = new THREE.MeshStandardMaterial({
    color: PIT_DOOR_COLOR,
    roughness: 0.85,
    metalness: 0.25,
  });

  // Each door is a thin Box. The doorGroup origin sits AT the hinge
  // edge (xStart for door1, xEnd for door2), and the geometry is
  // translated inward so the door body extends from the hinge to the
  // pit centreline. Rotating the group around Z swings the free edge
  // downward (negative for door1, positive for door2 — see update()).
  function buildDoor(hingeX: number, sign: 1 | -1): THREE.Group {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(hingeX, PIT_DOOR_CENTER_Y, 0);
    const doorGeom = new THREE.BoxGeometry(halfLen, PIT_DOOR_THICKNESS, platformWidth);
    // Translate so the hinged face is at x=0 (the group origin); free
    // edge is at x = sign * halfLen.
    doorGeom.translate(sign * halfLen * 0.5, 0, 0);
    const mesh = new THREE.Mesh(doorGeom, doorMat);
    doorGroup.add(mesh);
    return doorGroup;
  }

  const door1 = buildDoor(zone.xStart, +1); // hinged at xStart, body extends +X to centre
  const door2 = buildDoor(zone.xEnd, -1); // hinged at xEnd, body extends -X to centre
  group.add(door1);
  group.add(door2);

  return {
    group,
    handle: {
      zone,
      door1,
      door2,
      lastBumpTick: Number.NEGATIVE_INFINITY,
    },
  };
}

// --- Hammers ------------------------------------------------------

interface HammerHandle {
  spec: HammerSpec;
  arm: THREE.Object3D; // pivot transform; rotates around its z axis
}

function createHammer(
  spec: HammerSpec,
  courseWidth: number,
): { group: THREE.Group; handle: HammerHandle } {
  const group = new THREE.Group();
  group.name = `hammer-${spec.x.toFixed(0)}`;

  // Two-column gallows: pillars at ±halfSpan with a cross-beam at top.
  // The arm pivots at the centre of the cross-beam (z=0) so the head
  // swings evenly to both sides as it rotates around the world X axis.
  // Pillars sit OUTSIDE the course (in the void) so robots can't clip
  // them — see HAMMER_PILLAR_OUTSET docs above.
  const halfSpan = courseWidth / 2 + HAMMER_PILLAR_OUTSET;

  // Pillars span from y = HAMMER_PILLAR_HEIGHT (top, where the cross-beam
  // sits) down to y = -HAMMER_PILLAR_DEPTH_BELOW (deep into the void).
  // The visible above-ground segment is unchanged; the below-ground
  // segment is what gives the "we're up on a high platform" feeling.
  const pillarTotalHeight = HAMMER_PILLAR_HEIGHT + HAMMER_PILLAR_DEPTH_BELOW;
  const pillarCenterY = (HAMMER_PILLAR_HEIGHT - HAMMER_PILLAR_DEPTH_BELOW) / 2;
  const pillarGeom = new THREE.CylinderGeometry(
    HAMMER_PILLAR_RADIUS,
    HAMMER_PILLAR_RADIUS * 1.15,
    pillarTotalHeight,
    16,
  );
  const structureMat = new THREE.MeshStandardMaterial({
    color: HAMMER_PILLAR_COLOR,
    roughness: 0.7,
    metalness: 0.4,
  });
  for (const sign of [1, -1]) {
    const pillar = new THREE.Mesh(pillarGeom, structureMat);
    pillar.position.set(0, pillarCenterY, sign * halfSpan);
    group.add(pillar);
  }

  // Cross-beam connecting the two pillar tops at HAMMER_PIVOT_Y.
  // Spans 2 × halfSpan along Z, oriented horizontal across the course.
  const beamGeom = new THREE.BoxGeometry(
    HAMMER_BEAM_DEPTH,
    HAMMER_BEAM_HEIGHT,
    halfSpan * 2,
  );
  const beamMat = new THREE.MeshStandardMaterial({
    color: HAMMER_BEAM_COLOR,
    roughness: 0.6,
    metalness: 0.5,
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  beam.position.set(0, HAMMER_PIVOT_Y, 0);
  group.add(beam);

  // Pivot at centre of cross-beam. Rotating around X swings the arm
  // in the YZ plane (perpendicular to robot motion along +X). Down
  // posture (angle 0) places the head at z=0, sweeping evenly to ±Z.
  const pivot = new THREE.Object3D();
  pivot.position.set(0, HAMMER_PIVOT_Y, 0);
  group.add(pivot);

  // Arm — hangs DOWN from pivot in the +X direction so its X-extent
  // aligns with the kill-radius (which is X-based per the sim). Width
  // of the arm sits along Z so it visually reads as a perpendicular
  // pendulum when at rest.
  const armGeom = new THREE.BoxGeometry(
    HAMMER_ARM_THICKNESS,
    HAMMER_ARM_LENGTH,
    HAMMER_ARM_THICKNESS,
  );
  armGeom.translate(0, -HAMMER_ARM_LENGTH / 2, 0);
  const armMat = new THREE.MeshStandardMaterial({
    color: HAMMER_ARM_COLOR,
    roughness: 0.6,
    metalness: 0.5,
  });
  const arm = new THREE.Mesh(armGeom, armMat);
  pivot.add(arm);

  // Head at end of arm. Wider along X (the kill direction) so it
  // looks like a brick crashing through the lane.
  const headGeom = new THREE.BoxGeometry(
    HAMMER_HEAD_SIZE * 1.6,
    HAMMER_HEAD_SIZE,
    HAMMER_HEAD_SIZE,
  );
  headGeom.translate(0, -HAMMER_ARM_LENGTH, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: HAMMER_HEAD_COLOR,
    roughness: 0.55,
    metalness: 0.35,
    emissive: 0x2a0a05,
    emissiveIntensity: 0.4,
  });
  const head = new THREE.Mesh(headGeom, headMat);
  pivot.add(head);

  group.position.set(spec.x, 0, 0);
  return { group, handle: { spec, arm: pivot } };
}

/**
 * Compute the hammer arm's rotation (radians around X) at a given sim
 * tick. The arm pivots at the centre of the cross-beam and swings as a
 * **true pendulum** in the YZ plane (perpendicular to robot motion),
 * passing through angle = 0 (straight down, kill posture) at the centre
 * of the sim's down window and reaching ±HAMMER_MAX_SWING_ANGLE at the
 * extremes of each swing. The swing is symmetric: arm goes down →
 * +max → down → -max → down each cycle, so the head sweeps evenly to
 * both sides of the gallows posts.
 *
 * Sim/visual coupling: the sim's single down-window aligns with the
 * FIRST zero-crossing per cycle (offset=0). The arm passes through 0
 * a second time at offset=0.5 — that crossing is visually "down" but
 * the sim does not register it as a kill. This is a v1 cosmetic
 * tradeoff; viewers see a proper pendulum motion while the sim retains
 * its simple one-window-per-cycle kill model.
 */
function hammerArmAngle(spec: HammerSpec, tickFloat: number): number {
  const phase =
    ((tickFloat % spec.cycleTicks) + spec.cycleTicks) % spec.cycleTicks;
  const downCenter = (spec.downStartTick + spec.downEndTick) / 2;
  const offset =
    ((phase - downCenter + spec.cycleTicks) % spec.cycleTicks) / spec.cycleTicks;
  // Pendulum: 0 → +max → 0 → -max → 0 over the cycle, with the first
  // zero crossing at offset = 0 (i.e., at the sim's downCenter).
  return HAMMER_MAX_SWING_ANGLE * Math.sin(2 * Math.PI * offset);
}

// --- Crumbling bridge --------------------------------------------

interface BridgeHandle {
  spec: BridgeSpec;
  planks: THREE.Mesh[]; // one per slice
  plankXEnds: number[]; // each plank's right-edge x in world space
  /** Tick at which each plank began its fall, or null if not yet falling. */
  plankCrumbleTick: (number | null)[];
}

function createBridge(bridge: BridgeSpec, courseWidth: number): {
  group: THREE.Group;
  handle: BridgeHandle;
} {
  const group = new THREE.Group();
  group.name = `bridge-${bridge.xStart.toFixed(0)}-${bridge.xEnd.toFixed(0)}`;

  const length = bridge.xEnd - bridge.xStart;
  const plankWidth = length / BRIDGE_PLANK_COUNT;
  // Bridge fills the full course width (the sim clamps robots to
  // ±courseWidth/2 so there's no walking around it).
  const platformWidth = courseWidth;

  const plankMat = new THREE.MeshStandardMaterial({
    color: BRIDGE_PLANK_COLOR,
    roughness: 0.8,
    metalness: 0,
  });
  const beamMat = new THREE.MeshStandardMaterial({
    color: BRIDGE_BEAM_COLOR,
    roughness: 0.85,
    metalness: 0,
  });

  // Side rails (continuous, do NOT crumble — visual frame for the planks).
  // Sit on the plank surface and extend upward, so they remain visible
  // above the ground even after the planks have fallen away.
  const railGeom = new THREE.BoxGeometry(length, BRIDGE_RAIL_HEIGHT, BRIDGE_RAIL_THICKNESS);
  for (const sign of [1, -1]) {
    const rail = new THREE.Mesh(railGeom, beamMat);
    rail.position.set(
      (bridge.xStart + bridge.xEnd) / 2,
      BRIDGE_RAIL_BOTTOM_Y + BRIDGE_RAIL_HEIGHT / 2,
      sign * (platformWidth / 2),
    );
    group.add(rail);
  }

  // Planks — array of small boxes, each crumbles independently.
  const plankGeom = new THREE.BoxGeometry(
    plankWidth * 0.92, // small gap between planks
    BRIDGE_PLANK_HEIGHT,
    platformWidth - 0.6,
  );
  const planks: THREE.Mesh[] = [];
  const plankXEnds: number[] = [];
  for (let i = 0; i < BRIDGE_PLANK_COUNT; i++) {
    const cx = bridge.xStart + plankWidth * (i + 0.5);
    const plank = new THREE.Mesh(plankGeom, plankMat);
    plank.position.set(cx, BRIDGE_PLANK_CENTER_Y, 0);
    group.add(plank);
    planks.push(plank);
    plankXEnds.push(bridge.xStart + plankWidth * (i + 1));
  }

  const plankCrumbleTick: (number | null)[] = new Array(BRIDGE_PLANK_COUNT).fill(null);
  return { group, handle: { spec: bridge, planks, plankXEnds, plankCrumbleTick } };
}

// --- Public API ---------------------------------------------------

export interface GauntletVisuals {
  /** Group to add via `renderer.addToScene`. Disposes via the renderer's
   *  scene traversal. */
  readonly group: THREE.Group;
  /**
   * Per-frame update. Call from the App's rAF loop with the current
   * interpolated sim tick and the world-X of the bridge crumble line
   * (computed by the app from the leader's on-bridge position, mirroring
   * the sim's leader-tracking crumble logic). `crumbleX = null` means
   * no robot has entered the bridge yet — crumble is dormant.
   *
   * Side effects: sets hammer arm rotations; animates plank fall + tilt
   * based on crumbleX; sets pit-door rotations based on `lastBumpTick`
   * per zone. No allocations per frame.
   */
  update(tickFloat: number, crumbleX: number | null): void;
  /**
   * Trigger a pit-trap-door opening at the given world x. The doors of
   * whichever pit zone contains `x` swing open and fade closed over
   * `PIT_OPEN_DURATION_TICKS` ticks. Idempotent within the fade window —
   * later falls in the same zone refresh the bump tick.
   */
  triggerPitFall(x: number, fallTick: number): void;
}

export function createGauntletTraps(arena: Arena): GauntletVisuals {
  if (!arena.gauntletConfig) {
    throw new Error('createGauntletTraps: arena has no gauntletConfig');
  }
  const cfg = arena.gauntletConfig;
  const root = new THREE.Group();
  root.name = 'gauntlet-traps';

  // Grove (abyss-floor base + scattered trees). Added before the traps so
  // it's behind them in the scene-graph traversal — purely cosmetic but
  // keeps related visuals grouped.
  root.add(createGauntletGrove(arena));

  // Pit traps.
  const pitHandles: PitTrapHandle[] = [];
  for (const pit of cfg.pitZones) {
    const { group: pitGroup, handle } = createPitTrap(pit, arena.width);
    root.add(pitGroup);
    pitHandles.push(handle);
  }

  // Hammers.
  const hammerHandles: HammerHandle[] = [];
  for (const spec of cfg.hammers) {
    const { group, handle } = createHammer(spec, arena.width);
    root.add(group);
    hammerHandles.push(handle);
  }

  // Bridge.
  const { group: bridgeGroup, handle: bridgeHandle } = createBridge(
    cfg.bridge,
    arena.width,
  );
  root.add(bridgeGroup);

  function update(tickFloat: number, crumbleX: number | null): void {
    // Hammer rotation. Pivot rotates around the WORLD X axis so the
    // arm swings in the YZ plane (perpendicular to the robot's motion
    // along +X) — the head crosses the lane rather than sweeping
    // along the course.
    for (let i = 0; i < hammerHandles.length; i++) {
      const h = hammerHandles[i];
      h.arm.rotation.x = hammerArmAngle(h.spec, tickFloat);
    }
    // Pit door rotation. Linear fade over PIT_OPEN_DURATION_TICKS:
    //   intensity = max(0, 1 - ticksSinceBump / PIT_OPEN_DURATION_TICKS)
    // Doors swing DOWN around the Z axis (the split runs ACROSS the
    // course, perpendicular to robot motion). door1 (hinged at xStart,
    // body extends +X) rotates -Z so its free edge drops below the
    // floor; door2 (hinged at xEnd, body extends -X) rotates +Z
    // symmetrically. The hatch opens centred on x = (xStart + xEnd) / 2.
    for (let i = 0; i < pitHandles.length; i++) {
      const p = pitHandles[i];
      const ticksSinceBump = tickFloat - p.lastBumpTick;
      const intensity = Math.max(
        0,
        Math.min(1, 1 - ticksSinceBump / PIT_OPEN_DURATION_TICKS),
      );
      const angle = intensity * PIT_OPEN_MAX_ANGLE;
      p.door1.rotation.z = -angle;
      p.door2.rotation.z = angle;
    }
    // Bridge crumble — planks past the crumble line fall and disappear.
    // Each plank records the tick it started falling; subsequent frames
    // animate it with gravity-like acceleration on Y plus a backward
    // tilt around Z (its -X / trailing edge drops first), so the plank
    // tips into the void behind the runner rather than slumping flat.
    if (crumbleX !== null) {
      for (let i = 0; i < bridgeHandle.planks.length; i++) {
        const plank = bridgeHandle.planks[i];
        if (!plank.visible) continue; // already gone
        if (bridgeHandle.plankXEnds[i] < crumbleX) {
          // Start the fall timer the first frame the crumble line passes.
          if (bridgeHandle.plankCrumbleTick[i] === null) {
            bridgeHandle.plankCrumbleTick[i] = tickFloat;
          }
          const fallProgress = Math.min(
            1,
            (tickFloat - bridgeHandle.plankCrumbleTick[i]!) / BRIDGE_PLANK_FALL_TICKS,
          );
          // Quadratic Y drop = gravity acceleration (slow start, fast end).
          plank.position.y =
            BRIDGE_PLANK_CENTER_Y - fallProgress * fallProgress * BRIDGE_PLANK_FALL_DEPTH_M;
          // Linear tilt — positive rotation.z drops the plank's -X edge
          // (the side the robot came from) so the plank tips backward.
          plank.rotation.z = fallProgress * BRIDGE_PLANK_FALL_TILT_RAD;
          if (fallProgress >= 1) plank.visible = false;
        }
      }
    } else {
      // Race not yet on bridge — restore all planks (idempotent reset).
      for (let i = 0; i < bridgeHandle.planks.length; i++) {
        const plank = bridgeHandle.planks[i];
        plank.visible = true;
        plank.position.y = BRIDGE_PLANK_CENTER_Y;
        plank.rotation.z = 0;
        bridgeHandle.plankCrumbleTick[i] = null;
      }
    }
  }

  function triggerPitFall(x: number, fallTick: number): void {
    for (let i = 0; i < pitHandles.length; i++) {
      const p = pitHandles[i];
      if (x >= p.zone.xStart && x <= p.zone.xEnd) {
        // Forward in time only — events arrive in tick order from the
        // bridge so this is naturally satisfied; the guard exists in
        // case of out-of-order replay.
        if (fallTick > p.lastBumpTick) {
          p.lastBumpTick = fallTick;
        }
        return;
      }
    }
  }

  return { group: root, update, triggerPitFall };
}
