/**
 * Obstacle Gauntlet trap visuals (Arena-03).
 *
 * Renders the three trap types:
 *   - **Pit zones** as sunken dark bands on the ground plane.
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

// --- Colours / dimensions -----------------------------------------

/** Pit trap-door panels — two hinged hatches per pit zone, hinged on
 *  the OUTER long edges and meeting at the centerline when closed.
 *  Each door extends from the course wall (z = ±courseWidth/2) inward
 *  to z=0, so the two doors together fill the entire course width.
 *  When a robot falls, both doors swing downward (rotating around X)
 *  and a dark gap opens in the middle. The doors fade-close after
 *  PIT_OPEN_DURATION_TICKS so subsequent falls re-open them. */
const PIT_DOOR_COLOR = 0x232a2e;
const PIT_DOOR_THICKNESS = 0.18;
const PIT_DOOR_Y = 0.05;
const PIT_OPEN_MAX_ANGLE = Math.PI * 0.42; // ~75° drop
const PIT_OPEN_DURATION_TICKS = 36; // ~600ms at 60Hz
/** Dark "void" plane below the doors so when they swing open the gap
 *  reads as a hole rather than green ground. */
const PIT_VOID_COLOR = 0x05060a;
const PIT_VOID_Y = -0.5;

const HAMMER_PILLAR_HEIGHT = 6.4;
const HAMMER_PILLAR_RADIUS = 0.45;
const HAMMER_PILLAR_COLOR = 0x4a4f5b;
/**
 * Pillars sit OUTSIDE the course path so robots running near the lateral
 * boundary don't visually clip through them. Distance is measured from
 * the course edge (z = ±courseWidth/2) outward into the void; the cross-
 * beam still spans the full pillar-to-pillar gap so the gallows reads
 * as straddling the path.
 */
const HAMMER_PILLAR_OUTSET = 0.6;
const HAMMER_BEAM_HEIGHT = 0.5;
const HAMMER_BEAM_DEPTH = 0.6;
const HAMMER_BEAM_COLOR = 0x36373d;
const HAMMER_ARM_LENGTH = 5.5;
const HAMMER_ARM_THICKNESS = 0.55;
const HAMMER_HEAD_SIZE = 1.2;
const HAMMER_HEAD_COLOR = 0xa53a2a; // rusty industrial red
const HAMMER_PIVOT_Y = 5.8; // matches beam center
const HAMMER_ARM_COLOR = 0x36373d;
/** Max swing angle from vertical-down. < π/2 keeps the head BELOW the
 *  cross-beam — at 0.48π the arm reaches ±5.49 m from the pivot at the
 *  extreme of each swing, fully inside the gallows posts at z = ±8. */
const HAMMER_MAX_SWING_ANGLE = Math.PI * 0.48;

const BRIDGE_PLANK_COUNT = 24;
const BRIDGE_PLANK_THICKNESS = 0.35;
const BRIDGE_PLANK_HEIGHT = 0.25;
const BRIDGE_PLANK_COLOR = 0x6c4628;   // weathered timber
const BRIDGE_BEAM_COLOR = 0x3b2a18;    // darker rail/beam
const BRIDGE_RAIL_HEIGHT = 0.9;
const BRIDGE_RAIL_THICKNESS = 0.18;
const BRIDGE_Y = 0.05; // just above ground (ground is at y=0)

// --- Pit trap-door --------------------------------------------------

interface PitTrapHandle {
  readonly zone: PitZone;
  /** Door hinged on +Z outer edge; rotates -X to drop free edge down. */
  readonly door1: THREE.Group;
  /** Door hinged on -Z outer edge; rotates +X to drop free edge down. */
  readonly door2: THREE.Group;
  /** Last sim tick a fall was registered in this zone. -Infinity if none. */
  lastBumpTick: number;
}

/**
 * Build one pit trap. Each pit gets:
 *   - A dark "void" plane sitting BELOW the door y (revealed when
 *     doors swing open).
 *   - Two doors as `THREE.Group`s. Each group's origin sits at the
 *     hinge (outer long edge); the door mesh lives inside the group,
 *     translated so its free edge is at the pit's centerline. Rotating
 *     the group around X swings the free edge downward.
 */
function createPitTrap(
  zone: PitZone,
  courseWidth: number,
): { group: THREE.Group; handle: PitTrapHandle } {
  const group = new THREE.Group();
  group.name = `pit-trap-${zone.xStart.toFixed(0)}`;

  const length = zone.xEnd - zone.xStart;
  const halfW = courseWidth / 2;
  const cx = (zone.xStart + zone.xEnd) / 2;

  // Void plane below the doors. Spans both door halves so the dark
  // surface is visible through the gap when doors are open.
  const voidGeom = new THREE.PlaneGeometry(length, halfW * 2);
  voidGeom.rotateX(-Math.PI / 2);
  const voidMat = new THREE.MeshStandardMaterial({
    color: PIT_VOID_COLOR,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const voidMesh = new THREE.Mesh(voidGeom, voidMat);
  voidMesh.position.set(cx, PIT_VOID_Y, 0);
  group.add(voidMesh);

  // Shared door material.
  const doorMat = new THREE.MeshStandardMaterial({
    color: PIT_DOOR_COLOR,
    roughness: 0.85,
    metalness: 0.25,
  });

  // Each door is a thin Box. Centred on the group's origin (hinge at
  // outer edge); the geometry is translated so the box extends from
  // the hinge inward toward the centerline (free edge at z=0).
  function buildDoor(hingeZ: number, sign: 1 | -1): THREE.Group {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(cx, PIT_DOOR_Y, hingeZ);
    const doorGeom = new THREE.BoxGeometry(length, PIT_DOOR_THICKNESS, halfW);
    // Translate so the box's outer face is at z=0 (the hinge); free
    // edge is at z = -sign * halfW.
    doorGeom.translate(0, 0, -sign * halfW * 0.5);
    const mesh = new THREE.Mesh(doorGeom, doorMat);
    doorGroup.add(mesh);
    return doorGroup;
  }

  const door1 = buildDoor(halfW, 1); // hinged at +Z
  const door2 = buildDoor(-halfW, -1); // hinged at -Z
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

  const pillarGeom = new THREE.CylinderGeometry(
    HAMMER_PILLAR_RADIUS,
    HAMMER_PILLAR_RADIUS * 1.15,
    HAMMER_PILLAR_HEIGHT,
    16,
  );
  const structureMat = new THREE.MeshStandardMaterial({
    color: HAMMER_PILLAR_COLOR,
    roughness: 0.7,
    metalness: 0.4,
  });
  for (const sign of [1, -1]) {
    const pillar = new THREE.Mesh(pillarGeom, structureMat);
    pillar.position.set(0, HAMMER_PILLAR_HEIGHT / 2, sign * halfSpan);
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
  planks: THREE.Mesh[]; // one per slice; visibility toggles on crumble
  plankXEnds: number[]; // each plank's right-edge x in world space
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

  // Side rails (continuous, do NOT crumble — visual frame for the planks)
  const railGeom = new THREE.BoxGeometry(length, BRIDGE_RAIL_HEIGHT, BRIDGE_RAIL_THICKNESS);
  for (const sign of [1, -1]) {
    const rail = new THREE.Mesh(railGeom, beamMat);
    rail.position.set(
      (bridge.xStart + bridge.xEnd) / 2,
      BRIDGE_Y + BRIDGE_RAIL_HEIGHT / 2,
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
    plank.position.set(cx, BRIDGE_Y + BRIDGE_PLANK_HEIGHT / 2, 0);
    group.add(plank);
    planks.push(plank);
    plankXEnds.push(bridge.xStart + plankWidth * (i + 1));
  }

  return { group, handle: { spec: bridge, planks, plankXEnds } };
}

// --- Public API ---------------------------------------------------

export interface GauntletVisuals {
  /** Group to add via `renderer.addToScene`. Disposes via the renderer's
   *  scene traversal. */
  readonly group: THREE.Group;
  /**
   * Per-frame update. Call from the App's rAF loop with the current
   * interpolated sim tick. `bridgeEnteredTick` is the sim state's
   * record of when the first robot crossed the bridge entrance, or
   * `null` if no robot has entered yet (crumble dormant).
   *
   * Side effects: sets hammer arm rotations; toggles plank visibility;
   * sets pit-door rotations based on `lastBumpTick` per zone. No
   * allocations per frame.
   */
  update(tickFloat: number, bridgeEnteredTick: number | null, tickRateHz: number): void;
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

  function update(
    tickFloat: number,
    bridgeEnteredTick: number | null,
    tickRateHz: number,
  ): void {
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
    // door1 (hinged +Z) rotates -X; door2 (hinged -Z) rotates +X.
    for (let i = 0; i < pitHandles.length; i++) {
      const p = pitHandles[i];
      const ticksSinceBump = tickFloat - p.lastBumpTick;
      const intensity = Math.max(
        0,
        Math.min(1, 1 - ticksSinceBump / PIT_OPEN_DURATION_TICKS),
      );
      const angle = intensity * PIT_OPEN_MAX_ANGLE;
      p.door1.rotation.x = -angle;
      p.door2.rotation.x = angle;
    }
    // Bridge crumble — hide planks whose right-edge x has been crossed
    // by the crumble line. Once hidden, planks stay hidden for the rest
    // of the race (no resurrection).
    if (bridgeEnteredTick !== null) {
      const ticksSince = tickFloat - bridgeEnteredTick;
      const crumbleX =
        bridgeHandle.spec.xStart +
        bridgeHandle.spec.crumbleSpeedMps * (ticksSince / tickRateHz);
      for (let i = 0; i < bridgeHandle.planks.length; i++) {
        if (bridgeHandle.plankXEnds[i] < crumbleX && bridgeHandle.planks[i].visible) {
          bridgeHandle.planks[i].visible = false;
        }
      }
    } else {
      // Race not yet on bridge — ensure all planks visible (idempotent).
      for (let i = 0; i < bridgeHandle.planks.length; i++) {
        if (!bridgeHandle.planks[i].visible) {
          bridgeHandle.planks[i].visible = true;
        }
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
