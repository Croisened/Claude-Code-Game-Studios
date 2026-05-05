/**
 * Finish-Line visual.
 *
 * Builds a thick white strip on the floor at the arena's final gate,
 * with "ROBO RHAPSODY" lettered in black centered along its length.
 * The strip lies on the XZ plane, perpendicular to the race direction:
 * - X extent: `LINE_THICKNESS` units (a chunky band the leader runs
 *   *over*, not just a hairline marker). The strip's NEAR edge is
 *   placed at `finishX` and the band extends downstream from there
 *   (centerX = finishX + LINE_THICKNESS/2). This keeps the band
 *   entirely past any obstacle that ends at `finishX` — notably the
 *   gauntlet's crumbling bridge, whose `xEnd` coincides with
 *   `arena.length`. With center-on-finishX placement the bridge
 *   planks (which sit slightly above the strip's y) visually covered
 *   the near half of the band; the shift moves the lettering clear.
 * - Z extent: full `arena.width` (covers the entire course laterally).
 * - Y: a hair above the ground plane (`HEIGHT_OFFSET`) to avoid
 *   z-fighting with the renderer's ground mesh.
 *
 * The texture is rendered to a 2D canvas at construction time, then
 * uploaded as a `CanvasTexture`. `MeshBasicMaterial` is used (not
 * Standard) so the white reads as bright white at all camera angles
 * regardless of lighting — finish lines are signage, not painted
 * surfaces.
 *
 * Returned mesh is ready to add to the scene via
 * `renderer.addToScene(mesh)`. Renderer disposal traverses the scene
 * and disposes geometry + material + map automatically.
 */
import * as THREE from 'three';
import type { Arena } from '@/sim/arena';

/** Strip depth along world X (perpendicular to motion). */
const LINE_THICKNESS = 4;
/** Above ground to avoid z-fighting with the renderer ground mesh. */
const HEIGHT_OFFSET = 0.02;
/** Texture resolution along the long (Z) and short (X) axes. */
const TEXTURE_LONG = 2048;
const TEXTURE_SHORT = 256;
const TEXT = 'ROBO RHAPSODY';
const TEXT_FONT = 'bold 160px "Inter", system-ui, -apple-system, sans-serif';
const TEXT_FILL = '#000000';
const STRIP_FILL = '#ffffff';

export interface CreateFinishLineOptions {
  /**
   * Test seam: builds the texture without touching `document` /
   * `HTMLCanvasElement`. Defaults to `defaultBuildFinishLineTexture`,
   * which renders the white-and-black canvas via the browser 2D API.
   */
  readonly textureFactory?: () => THREE.Texture;
}

/**
 * Default texture builder — renders to an HTMLCanvasElement, so it
 * requires a browser-like environment (`document` available). Tests
 * inject a stub via `opts.textureFactory`.
 */
export function defaultBuildFinishLineTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    throw new Error(
      'createFinishLine: default texture factory requires document; ' +
        'pass opts.textureFactory in non-browser environments',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_LONG;
  canvas.height = TEXTURE_SHORT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('createFinishLine: 2D canvas context unavailable');
  }
  ctx.fillStyle = STRIP_FILL;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = TEXT_FILL;
  ctx.font = TEXT_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(TEXT, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Build the finish-line mesh for `arena`. The strip is placed at the
 * x-position of the arena's final gate (sprint-race) OR at
 * `arena.length` if the arena has no gates (gauntlet, future event
 * types). Throws if `arena.length` is zero AND there are no gates.
 */
export function createFinishLine(
  arena: Arena,
  opts: CreateFinishLineOptions = {},
): THREE.Mesh {
  const finishX = arena.gates.length > 0
    ? arena.gates[arena.gates.length - 1].x
    : arena.length;
  if (finishX <= 0) {
    throw new Error('createFinishLine: arena has no gates and length <= 0');
  }

  const texture = (opts.textureFactory ?? defaultBuildFinishLineTexture)();

  // PlaneGeometry(width, height): width along plane X, height along
  // plane Y. After rotating x = -π/2, plane lies on XZ; plane Y maps
  // to world -Z. We want the long dimension to span world Z, so plane
  // height = arena.width and plane width = LINE_THICKNESS.
  const geometry = new THREE.PlaneGeometry(LINE_THICKNESS, arena.width);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);

  // The texture's natural orientation has text reading along canvas X
  // (UV.U). After our geometry choice, UV.U maps to world X (the
  // *thickness* of the strip — only 4 units), which would squash the
  // text. Rotate the texture 90° so UV.V (the long axis) carries the
  // text.
  texture.center.set(0.5, 0.5);
  texture.rotation = Math.PI / 2;

  mesh.rotation.x = -Math.PI / 2; // lay flat on XZ
  // Near edge at finishX → centerX = finishX + LINE_THICKNESS/2 so the
  // band sits entirely downstream of the bridge in the gauntlet arena.
  mesh.position.set(finishX + LINE_THICKNESS / 2, HEIGHT_OFFSET, 0);

  // Ensure the strip renders on top of the ground at z-fighting-free
  // depth even on hardware that interprets HEIGHT_OFFSET conservatively.
  mesh.renderOrder = 1;

  return mesh;
}
