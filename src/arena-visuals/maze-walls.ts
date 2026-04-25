/**
 * Maze wall + finish-post visuals for Arena-02.
 *
 * Walls are emitted by `generateMazeLayout` as a flat list of segments,
 * each tagged with world center, length, and orientation. We materialize
 * them as box meshes parented to a single Group so call sites can add and
 * dispose the entire visual with one `renderer.addToScene` / scene
 * traversal.
 *
 * Materials are shared across every wall to keep draw calls and material
 * allocations bounded — a 21×21 maze produces ~440 wall segments. The
 * geometry is per-segment (length differs per wall on rectangular cells —
 * here lengths are uniform, but we keep the per-segment pattern so future
 * non-square cell sizes still work).
 *
 * Renderer disposal traverses the scene and disposes geometry + material
 * + map; the Group's children get cleaned up automatically.
 */
import * as THREE from 'three';
import type { MazeLayout } from '@/sim/maze';

const WALL_HEIGHT = 1.6;
const WALL_THICKNESS = 0.35;
const WALL_COLOR = 0x6b78a4;
const WALL_EMISSIVE = 0x12182a;
const WALL_ROUGHNESS = 0.6;
const WALL_METALNESS = 0.15;
const WALL_Y = WALL_HEIGHT / 2;

// --- Orange tree (maze finish marker)
//
// Low-poly stylized: tapered cylinder trunk, faceted icosahedron canopy,
// and a hand-placed ring of fruit. All meshes share materials/geometry
// where possible; the tree adds ~10 draw calls to the scene.
// All sizes doubled from the original v1 values so the tree reads as a
// proper landmark across the 168m maze instead of a sapling. Canopy
// extends slightly past the immediate finish-cell footprint, but the
// finish-cell clearing (carved in `generateMazeLayout`) gives it room.
const TRUNK_HEIGHT = 5.2;
const TRUNK_RADIUS_TOP = 0.6;
const TRUNK_RADIUS_BOTTOM = 0.84;
const TRUNK_COLOR = 0x5c3a1e;       // saddle/oak brown
const CANOPY_RADIUS = 3.8;
const CANOPY_COLOR = 0x4f7d3e;      // dense pine-leaf green
const ORANGE_RADIUS = 0.64;

/**
 * Offset along world +Z from the finish cell's center to the tree's
 * trunk. Without this, the winner robot snaps to the cell center which
 * is the trunk center — they'd visually clip through the trunk. The
 * offset puts the tree a comfortable ~1.6m from where the winner ends
 * up standing, with both visible side-by-side from the winner cam.
 */
const TREE_OFFSET_Z = 1.6;
const ORANGE_COLOR = 0xf57b1f;      // ripe fruit
const ORANGE_EMISSIVE = 0x803400;   // subtle warm glow so they pop in shadow
const ORANGE_EMISSIVE_INTENSITY = 0.18;

/**
 * 8 hand-picked spherical positions (theta, phi) on the canopy surface.
 * `phi ∈ [0.4, 1.2]` keeps oranges in the upper-half + equator band so
 * none look like they fell off the bottom; `theta` spans 2π for ring
 * symmetry. Fixed list keeps the maze deterministic — no rng needed for
 * a purely visual asset.
 */
const ORANGE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0.2, 0.55],
  [0.95, 0.85],
  [1.7, 0.45],
  [2.4, 1.05],
  [3.2, 0.65],
  [4.0, 0.95],
  [4.85, 0.5],
  [5.6, 1.15],
];

export function createMazeWalls(layout: MazeLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'maze-walls';

  const material = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    emissive: WALL_EMISSIVE,
    roughness: WALL_ROUGHNESS,
    metalness: WALL_METALNESS,
  });

  for (const wall of layout.walls) {
    // For 'horizontal' walls (running along world X), the long axis is X.
    // For 'vertical' walls (running along world Z), the long axis is Z.
    const sizeX = wall.orientation === 'horizontal' ? wall.length : WALL_THICKNESS;
    const sizeZ = wall.orientation === 'horizontal' ? WALL_THICKNESS : wall.length;
    const geom = new THREE.BoxGeometry(sizeX, WALL_HEIGHT, sizeZ);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(wall.x, WALL_Y, wall.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

/**
 * Low-poly orange tree marking the finish cell — the tallest object in
 * the maze, visible from the static overhead arena cam as a brown stem
 * with a green canopy and orange fruit dots, and from the shoulder cam
 * as a clear navigation goal.
 *
 * Anatomy:
 *   - Tapered cylindrical trunk (8 radial segments → low-poly facets).
 *   - Icosahedron canopy (no subdivision → 20 faces).
 *   - Eight icosahedron oranges placed on the canopy surface at fixed
 *     spherical coordinates.
 *
 * All canopy/orange meshes share materials and geometries; the tree adds
 * ~10 draw calls. `flatShading: true` everywhere preserves the faceted
 * low-poly look — smooth shading would average normals and lose the
 * silhouette.
 */
/**
 * World-space (x, z) where the finish-tree's trunk stands. Offset from
 * the cell center along +Z (see `TREE_OFFSET_Z`) so the winner — who
 * snaps to the cell center on arrival — doesn't clip the trunk.
 *
 * Used by both `createMazeFinishTree` (to place the visual) and the
 * winner camera (to compose its frame around tree + winner).
 */
export function getMazeFinishTreeWorldPos(
  layout: MazeLayout,
): { x: number; z: number } {
  const { gridCols, gridRows, cellSize } = layout.config;
  const finishCol = layout.finishCellId % gridCols;
  const finishRow = Math.floor(layout.finishCellId / gridCols);
  return {
    x: (finishCol - (gridCols - 1) / 2) * cellSize,
    z: (finishRow - (gridRows - 1) / 2) * cellSize + TREE_OFFSET_Z,
  };
}

export function createMazeFinishTree(layout: MazeLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'maze-finish-tree';

  const { x, z } = getMazeFinishTreeWorldPos(layout);

  // Trunk — 8-segment radial cylinder for low-poly facets.
  const trunkGeom = new THREE.CylinderGeometry(
    TRUNK_RADIUS_TOP,
    TRUNK_RADIUS_BOTTOM,
    TRUNK_HEIGHT,
    8,
  );
  const trunkMat = new THREE.MeshStandardMaterial({
    color: TRUNK_COLOR,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const trunk = new THREE.Mesh(trunkGeom, trunkMat);
  trunk.position.set(x, TRUNK_HEIGHT / 2, z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // Canopy — icosahedron at subdivision 0 (20 faces) sitting just above
  // the trunk top. Center is offset upward so the canopy doesn't bury
  // its lower hemisphere inside the trunk.
  const canopyCenterY = TRUNK_HEIGHT + CANOPY_RADIUS * 0.55;
  const canopyGeom = new THREE.IcosahedronGeometry(CANOPY_RADIUS, 0);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: CANOPY_COLOR,
    roughness: 0.85,
    metalness: 0,
    flatShading: true,
  });
  const canopy = new THREE.Mesh(canopyGeom, canopyMat);
  canopy.position.set(x, canopyCenterY, z);
  canopy.castShadow = true;
  group.add(canopy);

  // Oranges — share geometry + material across all 8.
  const orangeGeom = new THREE.IcosahedronGeometry(ORANGE_RADIUS, 0);
  const orangeMat = new THREE.MeshStandardMaterial({
    color: ORANGE_COLOR,
    emissive: ORANGE_EMISSIVE,
    emissiveIntensity: ORANGE_EMISSIVE_INTENSITY,
    roughness: 0.55,
    metalness: 0.05,
    flatShading: true,
  });
  // Place oranges slightly inside the canopy radius so they read as
  // embedded in the foliage, not floating off it.
  const fruitR = CANOPY_RADIUS * 0.92;
  for (const [theta, phi] of ORANGE_POSITIONS) {
    const ox = x + fruitR * Math.sin(phi) * Math.cos(theta);
    const oy = canopyCenterY + fruitR * Math.cos(phi);
    const oz = z + fruitR * Math.sin(phi) * Math.sin(theta);
    const orange = new THREE.Mesh(orangeGeom, orangeMat);
    orange.position.set(ox, oy, oz);
    orange.castShadow = true;
    group.add(orange);
  }

  return group;
}
