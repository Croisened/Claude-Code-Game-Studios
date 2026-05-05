/**
 * Robo Rhapsody Sim — 85-Instance Skinned Mesh Renderer.
 *
 * Loads three robot GLBs (run/idle/death) plus N skin textures, instantiates
 * `CONFIG.renderer.robotCount` independently-animated skinned meshes, and
 * drives them at 60 FPS via per-instance `AnimationMixer`s. Camera ownership
 * is transitional in Sprint 4: a temporary internal camera is constructed if
 * `mount()` is called without one. Sprint 6 (Camera System, S4-11) will pass
 * its owned camera in.
 *
 * See design/gdd/85-instance-renderer.md for the full contract.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from '@/config';
import type { RobotAnimationState } from '@/animation/types';
import type { RobotPose } from '@/sim/engine';
import {
  loadRobotAssets,
  type RobotAssets,
  type LoadRobotAssetsOpts,
} from '@/renderer/asset-loader';

/**
 * Asset-vs-sim yaw offset. Mirrors `ASSET_FORWARD_YAW_OFFSET` in
 * `sim-renderer-bridge.ts:63` — the bridge owns per-tick rotation writes,
 * but `applyInitialPoses` is a one-time pre-sim placement that needs the
 * same offset so robots face along +X (the sim's "forward") at start.
 *
 * If a third consumer of this constant ever appears, promote it to a
 * shared module rather than triplicating it.
 */
const ASSET_FORWARD_YAW_OFFSET = Math.PI / 2;

// --- Tunable invariants (not in CONFIG; see GDD §7 "Implementation-detail constants")
const MAX_DT = 0.1;            // seconds; clamps tab-throttle skip-ahead
const PIXEL_RATIO_CAP = 2;     // clamp DPR to keep retina/3x phones bounded

// --- Internal camera defaults (transitional; Sprint 6 supplies its own camera)
const INTERNAL_CAMERA_FOV = 50;
const INTERNAL_CAMERA_NEAR = 0.1;
const INTERNAL_CAMERA_FAR = 500;
const INTERNAL_CAMERA_POSITION: readonly [number, number, number] = [0, 14, 28];
const INTERNAL_CAMERA_LOOK_AT: readonly [number, number, number] = [0, 1, 0];

// --- Placeholder grid layout (matches the spike at commit 2fe3668)
const GRID_COLS = 10;
const GRID_SPACING = 3.5;
const GRID_ROW_OFFSET = 4; // centres the grid on z=0 at robotCount=85 (10×9 layout)

// --- Scene presentation defaults (transitional dev lighting; per GDD §7,
// lighting becomes a tunable surface in v1.1+ when arena variation lands).
const SCENE_BACKGROUND = '#2a3548';
const GROUND_COLOR = 0x2a3548;        // matches bg so the horizon blends
const DEFAULT_GROUND_SIZE = 80;
const GROUND_ROUGHNESS = 0.95;
/** Vertical thickness applied to the holed ground path. Matches
 *  BRIDGE_PLANK_HEIGHT in arena-visuals/gauntlet-traps.ts so the visible
 *  cross-section at pit/bridge cutouts reads at the same scale as the
 *  bridge planks. Top face sits at y=0; the slab extrudes down to -thickness. */
const GROUND_HOLE_THICKNESS = 0.25;
const AMBIENT_INTENSITY = 0.9;
const SUN_INTENSITY = 1.4;
const SUN_POSITION: readonly [number, number, number] = [20, 40, 20];
const HEMI_SKY_COLOR = 0xb1c8ff;       // cool blue sky tint
const HEMI_GROUND_COLOR = 0x4a3a2a;    // warm earth tint
const HEMI_INTENSITY = 0.5;
const RIM_COLOR = 0x9bb6ff;            // cool blue back-light
const RIM_INTENSITY = 0.6;
const RIM_POSITION: readonly [number, number, number] = [-30, 25, -40];

// --- Tone mapping (ACES Filmic gives PBR materials proper film-grade response)
const TONE_MAPPING_EXPOSURE = 1.2;

// --- Per-instance material overrides (test scene metallic finish)
const ROBOT_METALNESS = 0.7;
const ROBOT_ROUGHNESS = 0.45;

const ROBOT_COUNT_MIN = 10;
const ROBOT_COUNT_MAX = 85;

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface RobotInstance {
  /** Robot id, 0..robotCount-1; matches NFT token id when robotCount === 85. */
  readonly id: number;
  /** Owns position, rotation, and scale. Mutated by sim/camera systems. */
  readonly root: THREE.Object3D;
  /** Per-instance mixer. Animation State Switcher (S4-05) drives transitions. */
  readonly mixer: THREE.AnimationMixer;
  /** Three named clips: run / idle / death. */
  readonly clips: ReadonlyMap<RobotAnimationState, THREE.AnimationClip>;
}

export interface Renderer {
  mount(container: HTMLElement, camera?: THREE.PerspectiveCamera): Promise<void>;
  /** Throws if called before `mount()` resolves. Returns `undefined` only when
   *  the renderer is mounted but the id is unknown. */
  getInstance(id: number): RobotInstance | undefined;
  getAllInstances(): readonly RobotInstance[];
  getScene(): THREE.Scene;
  addToScene(obj: THREE.Object3D): void;
  /**
   * Place each known instance at its arena start pose. Called ONCE during
   * scene setup, BEFORE the sim/bridge starts. Mirrors `placeOnGrid` for the
   * debug grid path — initial-placement is a renderer concern; per-tick
   * pose writes remain the bridge's exclusive territory. Poses for unknown
   * ids are silently skipped (defensive). Yaw is offset by
   * `ASSET_FORWARD_YAW_OFFSET` so robots face along +X.
   */
  applyInitialPoses(poses: readonly RobotPose[]): void;
  dispose(): void;
}

export interface WebGLRendererLike {
  domElement: HTMLCanvasElement;
  outputColorSpace: THREE.ColorSpace;
  shadowMap: { enabled: boolean };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  setSize(w: number, h: number): void;
  setPixelRatio(n: number): void;
  getPixelRatio(): number;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export type WebGLRendererFactory = (
  params: THREE.WebGLRendererParameters,
) => WebGLRendererLike;

export type AssetLoaderFn = (opts: LoadRobotAssetsOpts) => Promise<RobotAssets>;

/**
 * Ground-plane geometry override. Defaults to an 80×80 square centered at
 * origin (the Sprint 4 placeholder). Pass arena-derived values from the
 * app shell to size the floor to the race course (S6-03 follow-up).
 */
export interface GroundExtents {
  /** Length of the ground along world X. */
  readonly sizeX: number;
  /** Width of the ground along world Z. */
  readonly sizeZ: number;
  /** Ground center along world X (default: 0). */
  readonly centerX?: number;
  /** Ground center along world Z (default: 0). */
  readonly centerZ?: number;
}

/**
 * A rectangular hole punched out of the ground plane, in WORLD XZ
 * coordinates. The ground keeps its outer rectangle (sized via
 * `groundExtents`) and the listed rectangles become triangulated holes.
 * Used by the obstacle-gauntlet to expose the void below pit-trap doors
 * so falling robots are seen against the black background, not the floor.
 */
export interface GroundHole {
  readonly xStart: number;
  readonly xEnd: number;
  readonly zStart: number;
  readonly zEnd: number;
}

export interface CreateRendererOptions {
  /** Test seam: factory for the WebGLRenderer. Defaults to `new THREE.WebGLRenderer(...)`. */
  webGLRendererFactory?: WebGLRendererFactory;
  /** Test seam: asset loader. Defaults to `loadRobotAssets` from `./asset-loader`. */
  loadAssets?: AssetLoaderFn;
  /** Test seam: requestAnimationFrame impl. Defaults to `globalThis.requestAnimationFrame`. */
  raf?: (cb: FrameRequestCallback) => number;
  /** Test seam: cancelAnimationFrame impl. Defaults to `globalThis.cancelAnimationFrame`. */
  cancelRaf?: (id: number) => void;
  /** Test seam: target for the resize listener. Defaults to `globalThis.window` when present. */
  resizeTarget?: EventTarget | null;
  /** Whether to lay instances out on a placeholder 10×9 grid. Default true (Sprint 4). */
  placePlaceholderGrid?: boolean;
  /**
   * Ground-plane geometry. Default: an 80×80 square centered at origin.
   * App shell sizes this to the loaded arena so the floor reaches the
   * finish line.
   */
  groundExtents?: GroundExtents;
  /**
   * Override the ground material's base color (sRGB hex, e.g. `0x8aa372`
   * for the maze's orange-grove green). Defaults to `GROUND_COLOR` —
   * the dark blue-gray that matches the sprint-race sky.
   */
  groundColor?: number;
  /**
   * Override the scene background color (any THREE.Color-compatible
   * input — hex string `'#000000'` or numeric `0x000000`). Defaults to
   * `SCENE_BACKGROUND` (the dark blue-gray sprint sky). Used by the
   * gauntlet to drop the horizon to near-black so the narrow course
   * reads as a path over a void.
   */
  backgroundColor?: THREE.ColorRepresentation;
  /**
   * Optional rectangular holes cut out of the ground plane. When non-empty
   * the ground is built as a Group: a flat top cap (`ShapeGeometry` with
   * holes) plus an outer-perimeter rim that gives the slab cross-section
   * thickness (GROUND_HOLE_THICKNESS) at the world boundary. The holes
   * themselves get NO side walls — when the gauntlet's trap doors swing
   * open the camera sees through to the void, not at an exposed hole-wall
   * remnant. Otherwise the existing PlaneGeometry path is kept (so the
   * default sprint-race / maze ground is unchanged).
   */
  groundHoles?: readonly GroundHole[];
  /**
   * Optional equirectangular panorama (JPG/PNG) to use as the scene
   * background — assigned to `scene.background` once loaded with
   * `EquirectangularReflectionMapping`. The `backgroundColor` (or default)
   * shows during the brief load, then swaps in once the texture decodes.
   *
   * Background only — does NOT touch `scene.environment`, so PBR
   * reflections on the robots are unchanged. Lighting stays consistent
   * across arenas.
   *
   * Disposed automatically on `dispose()`.
   */
  skyboxPath?: string;
  /**
   * Optional rotation (radians) applied to the skybox via
   * `scene.backgroundRotation`. The equirect can't be "translated" (it's
   * rendered as a fullscreen pass keyed by ray direction), but it can be:
   *   - `y` — yaw the panorama horizontally. Useful for hiding the
   *     image's wrap seam behind the camera.
   *   - `x` — pitch the panorama. POSITIVE values raise the horizon
   *     line in the camera's view (more sky visible above the course).
   *   - `z` — roll. Rarely needed.
   * All three default to 0. Ignored when `skyboxPath` is unset.
   */
  skyboxRotation?: { x?: number; y?: number; z?: number };
}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

export function createRenderer(opts: CreateRendererOptions = {}): Renderer {
  const webGLRendererFactory: WebGLRendererFactory =
    opts.webGLRendererFactory ??
    ((params) => new THREE.WebGLRenderer(params) as unknown as WebGLRendererLike);
  const loadAssets: AssetLoaderFn = opts.loadAssets ?? loadRobotAssets;
  const raf: (cb: FrameRequestCallback) => number =
    opts.raf ??
    ((cb) => {
      if (typeof globalThis.requestAnimationFrame !== 'function') {
        throw new Error('requestAnimationFrame is not available in this environment');
      }
      return globalThis.requestAnimationFrame(cb);
    });
  const cancelRaf: (id: number) => void =
    opts.cancelRaf ??
    ((id) => {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(id);
      }
    });
  const resizeTarget: EventTarget | null =
    opts.resizeTarget !== undefined
      ? opts.resizeTarget
      : (typeof globalThis !== 'undefined' && 'window' in globalThis
          ? (globalThis.window as unknown as EventTarget)
          : null);
  const placePlaceholderGrid = opts.placePlaceholderGrid ?? true;
  const groundExtents: Required<GroundExtents> = {
    sizeX: opts.groundExtents?.sizeX ?? DEFAULT_GROUND_SIZE,
    sizeZ: opts.groundExtents?.sizeZ ?? DEFAULT_GROUND_SIZE,
    centerX: opts.groundExtents?.centerX ?? 0,
    centerZ: opts.groundExtents?.centerZ ?? 0,
  };

  // Closure-private state.
  let mounted = false;
  let mountStarted = false;
  let disposed = false;
  let containerEl: HTMLElement | null = null;
  let webGLRenderer: WebGLRendererLike | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let internalCamera: THREE.PerspectiveCamera | null = null;
  let envTexture: THREE.Texture | null = null;
  let skyboxTexture: THREE.Texture | null = null;
  let instances: RobotInstance[] = [];
  let instanceById: Map<number, RobotInstance> = new Map();
  const clock = new THREE.Clock(false);
  let rafId: number | null = null;
  let resizeListener: (() => void) | null = null;
  // Production path uses a real WebGLRenderer; tests inject a stub. Skip
  // PBR-environment setup when stubbed (PMREMGenerator needs real WebGL).
  const isProductionRenderer = opts.webGLRendererFactory === undefined;

  function buildScene(): THREE.Scene {
    const s = new THREE.Scene();
    s.background = new THREE.Color(opts.backgroundColor ?? SCENE_BACKGROUND);

    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    s.add(ambient);

    const hemi = new THREE.HemisphereLight(
      HEMI_SKY_COLOR,
      HEMI_GROUND_COLOR,
      HEMI_INTENSITY,
    );
    s.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
    sun.position.set(...SUN_POSITION);
    s.add(sun);

    const rim = new THREE.DirectionalLight(RIM_COLOR, RIM_INTENSITY);
    rim.position.set(...RIM_POSITION);
    s.add(rim);

    const groundMat = new THREE.MeshStandardMaterial({
      color: opts.groundColor ?? GROUND_COLOR,
      roughness: GROUND_ROUGHNESS,
    });
    const hasHoles = !!opts.groundHoles && opts.groundHoles.length > 0;
    if (hasHoles) {
      // Hole-aware path: flat top cap (so trap doors flush with the floor
      // see no exposed hole walls when they swing open) + an explicit
      // outer-perimeter rim that gives the slab cross-section thickness
      // visible at the world boundary.
      const groundGroup = buildGroundWithHoles(
        groundExtents,
        opts.groundHoles!,
        groundMat,
      );
      groundGroup.rotation.x = -Math.PI / 2;
      groundGroup.position.set(groundExtents.centerX, 0, groundExtents.centerZ);
      s.add(groundGroup);
    } else {
      const groundGeom = new THREE.PlaneGeometry(
        groundExtents.sizeX,
        groundExtents.sizeZ,
      );
      const ground = new THREE.Mesh(groundGeom, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(groundExtents.centerX, 0, groundExtents.centerZ);
      s.add(ground);
    }

    return s;
  }

  function buildInternalCamera(width: number, height: number): THREE.PerspectiveCamera {
    const aspect = height > 0 ? width / height : 1;
    const cam = new THREE.PerspectiveCamera(
      INTERNAL_CAMERA_FOV,
      aspect,
      INTERNAL_CAMERA_NEAR,
      INTERNAL_CAMERA_FAR,
    );
    cam.position.set(...INTERNAL_CAMERA_POSITION);
    cam.lookAt(...INTERNAL_CAMERA_LOOK_AT);
    return cam;
  }

  function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
    let found: THREE.SkinnedMesh | null = null;
    root.traverse((obj) => {
      if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) {
        found = obj as THREE.SkinnedMesh;
      }
    });
    if (!found) throw new Error('No SkinnedMesh found in robot GLB');
    return found;
  }

  function placeOnGrid(root: THREE.Object3D, id: number): void {
    const col = id % GRID_COLS;
    const row = Math.floor(id / GRID_COLS);
    const x = (col - (GRID_COLS - 1) / 2) * GRID_SPACING;
    const z = (row - GRID_ROW_OFFSET) * GRID_SPACING;
    root.position.set(x, 0, z);
  }

  function assembleInstances(assets: RobotAssets, robotCount: number): void {
    if (!scene) throw new Error('Scene not initialised');

    const sourceSceneRoot = assets.runGltf.scene;
    const sourceMesh = findSkinnedMesh(sourceSceneRoot);
    const sourceMaterial = sourceMesh.material as THREE.MeshStandardMaterial;
    const runClip = assets.runGltf.animations[0];
    const idleClip = assets.idleGltf.animations[0];
    const deathClip = assets.deathGltf.animations[0];

    if (!runClip) throw new Error(`No AnimationClip found in run GLB`);
    if (!idleClip) throw new Error(`No AnimationClip found in idle GLB`);
    if (!deathClip) throw new Error(`No AnimationClip found in death GLB`);

    const fresh: RobotInstance[] = [];
    const byId = new Map<number, RobotInstance>();

    for (let id = 0; id < robotCount; id++) {
      // Clone the scene root, not the mesh — the bones live as siblings of
      // the SkinnedMesh in the GLB graph and are required by AnimationClip
      // bindings (clips reference bones by name).
      const root = cloneSkinned(sourceSceneRoot);

      const cloneMesh = findSkinnedMesh(root);
      const mat = sourceMaterial.clone();
      mat.map = assets.textures[id];
      mat.metalness = ROBOT_METALNESS;
      mat.roughness = ROBOT_ROUGHNESS;
      mat.needsUpdate = true;
      cloneMesh.material = mat;

      const mixer = new THREE.AnimationMixer(root);
      const clips = new Map<RobotAnimationState, THREE.AnimationClip>([
        ['run', runClip],
        ['idle', idleClip],
        ['death', deathClip],
      ]);

      // No auto-play. The Animation State Switcher (S4-05) owns play()
      // and crossFadeTo() calls codebase-wide; the renderer hands out
      // mixer + clips and stays out of the timing business.

      // Visual scale is applied once at assembly time. Sim positions and
      // arena geometry are unaffected — scale is purely a presentation
      // concern.
      root.scale.setScalar(CONFIG.renderer.robotScale);

      if (placePlaceholderGrid) placeOnGrid(root, id);

      scene.add(root);

      const inst: RobotInstance = { id, root, mixer, clips };
      fresh.push(inst);
      byId.set(id, inst);
    }

    instances = fresh;
    instanceById = byId;
  }

  function tick(): void {
    if (disposed) return;
    rafId = raf(tick);
    if (!webGLRenderer || !scene || !camera) return;

    const w = containerEl?.clientWidth ?? 0;
    const h = containerEl?.clientHeight ?? 0;
    if (w === 0 || h === 0) return;

    const dt = Math.min(clock.getDelta(), MAX_DT);
    for (const inst of instances) inst.mixer.update(dt);

    webGLRenderer.render(scene, camera);
  }

  function handleResize(): void {
    if (disposed || !webGLRenderer || !containerEl || !camera) return;
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    if (w === 0 || h === 0) return;
    webGLRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  async function mount(
    container: HTMLElement,
    suppliedCamera?: THREE.PerspectiveCamera,
  ): Promise<void> {
    if (mountStarted) {
      throw new Error('Renderer already mounted');
    }
    mountStarted = true;

    const robotCount = CONFIG.renderer.robotCount;
    if (robotCount < ROBOT_COUNT_MIN || robotCount > ROBOT_COUNT_MAX) {
      throw new Error(
        `CONFIG.renderer.robotCount ${robotCount} outside safe range [${ROBOT_COUNT_MIN}, ${ROBOT_COUNT_MAX}]`,
      );
    }

    containerEl = container;

    const assets = await loadAssets({
      robotCount,
      paths: {
        run: CONFIG.renderer.robotGlbPath,
        idle: CONFIG.renderer.idleGlbPath,
        death: CONFIG.renderer.deathGlbPath,
        skinPattern: CONFIG.renderer.skinTexturePathPattern,
      },
    });

    if (disposed) return; // dispose() called before assets resolved; bail.

    webGLRenderer = webGLRendererFactory({ antialias: true });
    webGLRenderer.outputColorSpace = THREE.SRGBColorSpace;
    webGLRenderer.shadowMap.enabled = false;
    webGLRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    webGLRenderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

    const dpr =
      typeof globalThis !== 'undefined' && 'devicePixelRatio' in globalThis
        ? Math.min((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1, PIXEL_RATIO_CAP)
        : 1;
    webGLRenderer.setPixelRatio(dpr);
    webGLRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(webGLRenderer.domElement);

    scene = buildScene();

    // Environment map for metallic robots — without this, metalness > 0
    // looks matte black because there is nothing to reflect. Production
    // path only; the test stub does not implement enough of WebGLRenderer
    // for PMREMGenerator to function.
    if (isProductionRenderer) {
      const realRenderer = webGLRenderer as unknown as THREE.WebGLRenderer;
      const pmrem = new THREE.PMREMGenerator(realRenderer);
      envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      pmrem.dispose();
    }

    // Optional equirectangular skybox. Fire-and-forget — scene.background
    // already shows the fallback colour; the panorama swaps in once the
    // texture decodes (~50–200 ms typical). Production-only because the
    // test stub doesn't implement enough of WebGLRenderer for textures.
    if (isProductionRenderer && opts.skyboxPath) {
      const skyboxPath = opts.skyboxPath;
      const skyboxRotation = opts.skyboxRotation;
      new THREE.TextureLoader().load(
        skyboxPath,
        (texture) => {
          if (disposed || !scene) {
            texture.dispose();
            return;
          }
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          skyboxTexture = texture;
          scene.background = texture;
          if (skyboxRotation) {
            scene.backgroundRotation.set(
              skyboxRotation.x ?? 0,
              skyboxRotation.y ?? 0,
              skyboxRotation.z ?? 0,
            );
          }
        },
        undefined,
        (err) => {
          // Non-fatal: keep the fallback colour and log so dev sees the
          // path mistake without the whole scene going dark.
          console.warn(`[renderer] failed to load skybox '${skyboxPath}':`, err);
        },
      );
    }

    if (suppliedCamera) {
      camera = suppliedCamera;
    } else {
      internalCamera = buildInternalCamera(container.clientWidth, container.clientHeight);
      camera = internalCamera;
    }

    assembleInstances(assets, robotCount);

    if (resizeTarget) {
      resizeListener = () => handleResize();
      resizeTarget.addEventListener('resize', resizeListener);
    }

    clock.start();
    rafId = raf(tick);
    mounted = true;
  }

  function getInstance(id: number): RobotInstance | undefined {
    if (!mounted) throw new Error('Renderer not mounted; getInstance() unavailable');
    return instanceById.get(id);
  }

  function getAllInstances(): readonly RobotInstance[] {
    return instances;
  }

  function getScene(): THREE.Scene {
    if (!scene) throw new Error('Renderer not mounted; getScene() unavailable');
    return scene;
  }

  function addToScene(obj: THREE.Object3D): void {
    if (!scene) throw new Error('Renderer not mounted; addToScene() unavailable');
    scene.add(obj);
  }

  function applyInitialPoses(poses: readonly RobotPose[]): void {
    for (const pose of poses) {
      const inst = instanceById.get(pose.id);
      if (!inst) continue;
      inst.root.position.set(pose.x, pose.y, pose.z);
      inst.root.rotation.y = pose.yaw + ASSET_FORWARD_YAW_OFFSET;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }

    if (resizeTarget && resizeListener) {
      resizeTarget.removeEventListener('resize', resizeListener);
      resizeListener = null;
    }

    if (scene) {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose?.();
        const mat = (mesh.material as THREE.Material | THREE.Material[] | undefined);
        if (Array.isArray(mat)) {
          for (const m of mat) disposeMaterial(m);
        } else if (mat) {
          disposeMaterial(mat);
        }
      });
    }

    if (envTexture) {
      envTexture.dispose();
      envTexture = null;
    }

    if (skyboxTexture) {
      skyboxTexture.dispose();
      skyboxTexture = null;
    }

    if (webGLRenderer) {
      webGLRenderer.dispose();
      const canvas = webGLRenderer.domElement;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    instances = [];
    instanceById = new Map();
    scene = null;
    camera = null;
    internalCamera = null;
    webGLRenderer = null;
    containerEl = null;
  }

  return {
    mount,
    getInstance,
    getAllInstances,
    getScene,
    addToScene,
    applyInitialPoses,
    dispose,
  };
}

function disposeMaterial(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  m.map?.dispose?.();
  m.dispose?.();
}

/**
 * Build a holed-ground rig as a Group containing two meshes:
 *
 *   1. A flat **top cap** (`ShapeGeometry` of the outer rect with the hole
 *      paths punched out) at local z=0. With NO extrusion, the holes have
 *      no side walls — when a gauntlet trap door swings open the camera
 *      sees straight through to the void below instead of looking at an
 *      exposed vertical hole-wall remnant.
 *
 *   2. An explicit **outer-perimeter rim** (4 quads) extruding from local
 *      z=0 down to z=-GROUND_HOLE_THICKNESS along ONLY the outer rectangle.
 *      Gives the slab the visible cross-section thickness at the world
 *      boundary that motivated the original thickness pass, without
 *      generating hole walls.
 *
 * Caller applies `rotation.x = -π/2` and the centre offset to the returned
 * Group, so local +Z → world +Y (rim extrudes downward) and the cap lands
 * at world Y=0.
 *
 * Trade-off: the bottom of the slab is intentionally NOT capped — looking
 * up through a hole from below would reveal the underside of the top cap.
 * The gauntlet camera never goes below the floor, and the abyss-floor
 * grove in `gauntlet-traps.ts` covers the downward sightlines.
 */
function buildGroundWithHoles(
  groundExtents: Required<GroundExtents>,
  holes: readonly GroundHole[],
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground-with-holes';

  const halfX = groundExtents.sizeX / 2;
  const halfZ = groundExtents.sizeZ / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfX, -halfZ);
  shape.lineTo(halfX, -halfZ);
  shape.lineTo(halfX, halfZ);
  shape.lineTo(-halfX, halfZ);
  shape.closePath();
  for (const h of holes) {
    const x0 = h.xStart - groundExtents.centerX;
    const x1 = h.xEnd - groundExtents.centerX;
    const z0 = h.zStart - groundExtents.centerZ;
    const z1 = h.zEnd - groundExtents.centerZ;
    const path = new THREE.Path();
    // CW relative to the CCW outer.
    path.moveTo(x0, z0);
    path.lineTo(x0, z1);
    path.lineTo(x1, z1);
    path.lineTo(x1, z0);
    path.closePath();
    shape.holes.push(path);
  }
  const topGeom = new THREE.ShapeGeometry(shape);
  const top = new THREE.Mesh(topGeom, material);
  top.receiveShadow = true;
  group.add(top);

  const rimGeom = buildOuterRimGeometry(halfX, halfZ, GROUND_HOLE_THICKNESS);
  const rim = new THREE.Mesh(rimGeom, material);
  group.add(rim);

  return group;
}

/**
 * Build the 4-quad rim that gives the holed ground its outer-edge
 * thickness. Quads sit in shape-local space (XY plane is the floor,
 * +Z is "up" before the caller rotates the geometry); each quad spans
 * one outer edge of the rectangle from z=0 down to z=-thickness.
 *
 * Vertex windings are CCW when viewed from OUTSIDE the slab so the
 * default front-face culling shows the visible outer face. If a future
 * camera angle exposes the inner faces (e.g., a top-down debug cam),
 * flip the material to DoubleSide rather than re-deriving windings.
 */
function buildOuterRimGeometry(
  halfX: number,
  halfZ: number,
  thickness: number,
): THREE.BufferGeometry {
  // Outer-rect corners at the top (z=0) and bottom (z=-thickness) of the rim.
  // Subscript T = top edge, B = bottom edge.
  const A_T: [number, number, number] = [-halfX, -halfZ, 0];
  const B_T: [number, number, number] = [halfX, -halfZ, 0];
  const C_T: [number, number, number] = [halfX, halfZ, 0];
  const D_T: [number, number, number] = [-halfX, halfZ, 0];
  const A_B: [number, number, number] = [-halfX, -halfZ, -thickness];
  const B_B: [number, number, number] = [halfX, -halfZ, -thickness];
  const C_B: [number, number, number] = [halfX, halfZ, -thickness];
  const D_B: [number, number, number] = [-halfX, halfZ, -thickness];

  const positions: number[] = [];
  const indices: number[] = [];

  // South wall along edge AB (local y=-halfZ) — outward normal is local -Y.
  // CCW from outside (looking in +Y direction): A_B, B_B, B_T, A_T.
  pushQuad(positions, indices, A_B, B_B, B_T, A_T);
  // East wall along edge BC (local x=+halfX) — outward normal is local +X.
  // CCW from outside (looking in -X direction): B_B, C_B, C_T, B_T.
  pushQuad(positions, indices, B_B, C_B, C_T, B_T);
  // North wall along edge CD (local y=+halfZ) — outward normal is local +Y.
  // CCW from outside (looking in -Y direction): C_B, D_B, D_T, C_T.
  pushQuad(positions, indices, C_B, D_B, D_T, C_T);
  // West wall along edge DA (local x=-halfX) — outward normal is local -X.
  // CCW from outside (looking in +X direction): D_B, A_B, A_T, D_T.
  pushQuad(positions, indices, D_B, A_B, A_T, D_T);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function pushQuad(
  positions: number[],
  indices: number[],
  v0: readonly [number, number, number],
  v1: readonly [number, number, number],
  v2: readonly [number, number, number],
  v3: readonly [number, number, number],
): void {
  const i0 = positions.length / 3;
  positions.push(v0[0], v0[1], v0[2]);
  positions.push(v1[0], v1[1], v1[2]);
  positions.push(v2[0], v2[1], v2[2]);
  positions.push(v3[0], v3[1], v3[2]);
  indices.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
}
