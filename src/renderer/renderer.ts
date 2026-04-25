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
import {
  loadRobotAssets,
  type RobotAssets,
  type LoadRobotAssetsOpts,
} from '@/renderer/asset-loader';

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
const GROUND_SIZE = 80;
const GROUND_ROUGHNESS = 0.95;
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

export type RobotAnimationState = 'run' | 'idle' | 'death';

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
  getInstance(id: number): RobotInstance | undefined;
  getAllInstances(): readonly RobotInstance[];
  getScene(): THREE.Scene;
  addToScene(obj: THREE.Object3D): void;
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
    s.background = new THREE.Color(SCENE_BACKGROUND);

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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({
        color: GROUND_COLOR,
        roughness: GROUND_ROUGHNESS,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    s.add(ground);

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
    if (!mounted) return undefined;
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
    dispose,
  };
}

function disposeMaterial(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  m.map?.dispose?.();
  m.dispose?.();
}
