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
import type { Arena, BridgeSpec, HammerSpec } from '@/sim/arena';

// --- Colours / dimensions -----------------------------------------

/** Pit band sits flush on the floor — no actual hole geometry, just a
 *  visually unmistakable dark rectangle that reads as "do not enter". */
const PIT_COLOR = 0x0a0a0a;
const PIT_Y = 0.01; // tiny lift above the ground plane to avoid z-fight

const HAMMER_PILLAR_HEIGHT = 6.0;
const HAMMER_PILLAR_RADIUS = 0.4;
const HAMMER_PILLAR_COLOR = 0x4a4f5b;
const HAMMER_ARM_LENGTH = 4.5;
const HAMMER_ARM_THICKNESS = 0.6;
const HAMMER_HEAD_SIZE = 1.2;
const HAMMER_HEAD_COLOR = 0xa53a2a; // rusty industrial red
const HAMMER_PIVOT_Y = 5.4; // top of pillar
const HAMMER_ARM_COLOR = 0x36373d;

const BRIDGE_PLANK_COUNT = 24;
const BRIDGE_PLANK_THICKNESS = 0.35;
const BRIDGE_PLANK_HEIGHT = 0.25;
const BRIDGE_PLANK_COLOR = 0x6c4628;   // weathered timber
const BRIDGE_BEAM_COLOR = 0x3b2a18;    // darker rail/beam
const BRIDGE_RAIL_HEIGHT = 0.9;
const BRIDGE_RAIL_THICKNESS = 0.18;
const BRIDGE_Y = 0.05; // just above ground (ground is at y=0)

// --- Pit band -----------------------------------------------------

function createPitBand(
  pit: { xStart: number; xEnd: number },
  width: number,
): THREE.Mesh {
  const length = pit.xEnd - pit.xStart;
  const geom = new THREE.PlaneGeometry(length, width);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: PIT_COLOR,
    roughness: 1.0,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set((pit.xStart + pit.xEnd) / 2, PIT_Y, 0);
  mesh.name = `pit-${pit.xStart.toFixed(0)}-${pit.xEnd.toFixed(0)}`;
  return mesh;
}

// --- Hammers ------------------------------------------------------

interface HammerHandle {
  spec: HammerSpec;
  arm: THREE.Object3D; // pivot transform; rotates around its z axis
}

function createHammer(spec: HammerSpec): { group: THREE.Group; handle: HammerHandle } {
  const group = new THREE.Group();
  group.name = `hammer-${spec.x.toFixed(0)}`;

  // Pillar — fixed; provides visual anchor for the swinging arm.
  const pillarGeom = new THREE.CylinderGeometry(
    HAMMER_PILLAR_RADIUS,
    HAMMER_PILLAR_RADIUS * 1.2,
    HAMMER_PILLAR_HEIGHT,
    16,
  );
  const pillarMat = new THREE.MeshStandardMaterial({
    color: HAMMER_PILLAR_COLOR,
    roughness: 0.7,
    metalness: 0.4,
  });
  const pillar = new THREE.Mesh(pillarGeom, pillarMat);
  pillar.position.set(0, HAMMER_PILLAR_HEIGHT / 2, 0);
  group.add(pillar);

  // Pivot — empty Object3D positioned at the top of the pillar.
  // Rotating this around its local Z swings the arm + head over the
  // course's +X axis (the kill direction).
  const pivot = new THREE.Object3D();
  pivot.position.set(0, HAMMER_PIVOT_Y, 0);
  group.add(pivot);

  // Arm — long box stretching down from the pivot. Its local origin is
  // at the top of the arm (pivot end) so rotation about z is the swing.
  const armGeom = new THREE.BoxGeometry(
    HAMMER_ARM_THICKNESS,
    HAMMER_ARM_LENGTH,
    HAMMER_ARM_THICKNESS,
  );
  // Translate geometry so the arm hangs DOWN from the pivot; pivot's
  // (0,0,0) becomes the top end of the arm.
  armGeom.translate(0, -HAMMER_ARM_LENGTH / 2, 0);
  const armMat = new THREE.MeshStandardMaterial({
    color: HAMMER_ARM_COLOR,
    roughness: 0.6,
    metalness: 0.5,
  });
  const arm = new THREE.Mesh(armGeom, armMat);
  pivot.add(arm);

  // Head — boxy block at the end of the arm. Same downward translation
  // so its center sits at -armLength.
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
 * Compute the hammer arm's rotation (radians around Z) at a given sim
 * tick. The arm hangs DOWN at angle 0 (pointing -Y in pivot space).
 * During the down window the arm rotates toward the floor; during the
 * up window it rotates back to vertical-up.
 *
 * Uses a smooth sinusoid mapped over the cycle. Down phase corresponds
 * to angle ≈ 0 (arm pointing straight down — kill posture). Up phase
 * corresponds to angle ≈ π (arm flipped above the pivot — fully
 * retracted). The swing is symmetric so rise and fall feel even.
 */
function hammerArmAngle(spec: HammerSpec, tickFloat: number): number {
  const phase =
    ((tickFloat % spec.cycleTicks) + spec.cycleTicks) % spec.cycleTicks;
  // We want angle = 0 (arm fully down) at phase = (downStart+downEnd)/2,
  // and angle = π (fully up) at the diametrically-opposite phase.
  const downCenter = (spec.downStartTick + spec.downEndTick) / 2;
  const offset =
    ((phase - downCenter + spec.cycleTicks) % spec.cycleTicks) / spec.cycleTicks;
  // offset ∈ [0, 1). offset=0 → angle 0 (down). offset=0.5 → angle π (up).
  // cos curve: cos(π * offset * 2) goes 1 → -1 → 1 as offset traverses 0→0.5→1.
  // Map: angle = (1 - cos(offset * 2π)) / 2 * π — gives 0 → π → 0.
  return ((1 - Math.cos(offset * 2 * Math.PI)) / 2) * Math.PI;
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
  const platformWidth = Math.min(courseWidth - 6, 18);

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
   * Side effects: sets hammer arm rotations; toggles plank visibility.
   * No allocations per frame.
   */
  update(tickFloat: number, bridgeEnteredTick: number | null, tickRateHz: number): void;
}

export function createGauntletTraps(arena: Arena): GauntletVisuals {
  if (!arena.gauntletConfig) {
    throw new Error('createGauntletTraps: arena has no gauntletConfig');
  }
  const cfg = arena.gauntletConfig;
  const root = new THREE.Group();
  root.name = 'gauntlet-traps';

  // Pit bands.
  for (const pit of cfg.pitZones) {
    root.add(createPitBand(pit, arena.width));
  }

  // Hammers.
  const hammerHandles: HammerHandle[] = [];
  for (const spec of cfg.hammers) {
    const { group, handle } = createHammer(spec);
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
    // Hammer rotation.
    for (let i = 0; i < hammerHandles.length; i++) {
      const h = hammerHandles[i];
      h.arm.rotation.z = hammerArmAngle(h.spec, tickFloat);
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

  return { group: root, update };
}
