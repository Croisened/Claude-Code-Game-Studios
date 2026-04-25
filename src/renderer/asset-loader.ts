/**
 * Robo Rhapsody Sim — Asset Loader.
 *
 * Loads the three robot GLBs (run/idle/death) and N skin textures in parallel,
 * resolving with a typed bundle the renderer can hand straight to per-instance
 * assembly.
 *
 * Loaders (GLTFLoader, TextureLoader) are injectable so tests can run in a
 * Node environment without a real WebGL context. Production callers omit the
 * injectable arguments and the module constructs Three.js's default loaders.
 *
 * See design/gdd/85-instance-renderer.md §3 (asset loading rules) and §5
 * (edge cases #1–#5).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const ROBOT_COUNT_MIN = 10;
const ROBOT_COUNT_MAX = 85;

export interface RobotAssetPaths {
  /** GLB providing geometry + skeleton + run animation clip. */
  run: string;
  /** GLB providing the idle animation clip (clip-only, geometry ignored). */
  idle: string;
  /** GLB providing the death animation clip (clip-only, geometry ignored). */
  death: string;
  /** Filename pattern for skin textures; `{id}` is substituted with 0..robotCount-1. */
  skinPattern: string;
}

export interface RobotAssets {
  runGltf: GLTF;
  idleGltf: GLTF;
  deathGltf: GLTF;
  /** length === robotCount; texture[i] corresponds to robot id i. */
  textures: THREE.Texture[];
}

export interface GltfLoaderLike {
  load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void;
}

export interface TextureLoaderLike {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void;
}

export interface LoadRobotAssetsOpts {
  robotCount: number;
  paths: RobotAssetPaths;
  /** Inject a GLTFLoader (test seam). Defaults to a fresh `new GLTFLoader()`. */
  gltfLoader?: GltfLoaderLike;
  /** Inject a TextureLoader (test seam). Defaults to a fresh `new THREE.TextureLoader()`. */
  textureLoader?: TextureLoaderLike;
}

/**
 * Resolve when run/idle/death GLBs and `robotCount` skin textures are all
 * loaded. Reject (with a message naming the offending path) on the first
 * failure of any single asset; partial loads are not a valid state.
 */
export function loadRobotAssets(opts: LoadRobotAssetsOpts): Promise<RobotAssets> {
  const { robotCount, paths } = opts;

  if (robotCount < ROBOT_COUNT_MIN || robotCount > ROBOT_COUNT_MAX) {
    return Promise.reject(
      new Error(
        `robotCount ${robotCount} outside safe range [${ROBOT_COUNT_MIN}, ${ROBOT_COUNT_MAX}]`,
      ),
    );
  }

  const gltfLoader = opts.gltfLoader ?? new GLTFLoader();
  const textureLoader = opts.textureLoader ?? new THREE.TextureLoader();

  const gltfPromises: Promise<GLTF>[] = [
    loadGltf(gltfLoader, paths.run),
    loadGltf(gltfLoader, paths.idle),
    loadGltf(gltfLoader, paths.death),
  ];

  const texturePromises: Promise<THREE.Texture>[] = [];
  for (let id = 0; id < robotCount; id++) {
    const url = paths.skinPattern.replace('{id}', String(id));
    texturePromises.push(loadTexture(textureLoader, url));
  }

  return Promise.all([
    Promise.all(gltfPromises),
    Promise.all(texturePromises),
  ]).then(([gltfs, textures]) => ({
    runGltf: gltfs[0],
    idleGltf: gltfs[1],
    deathGltf: gltfs[2],
    textures,
  }));
}

function loadGltf(loader: GltfLoaderLike, url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (err) => reject(new Error(`Failed to load GLB ${url}: ${describeError(err)}`)),
    );
  });
}

function loadTexture(loader: TextureLoaderLike, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        resolve(tex);
      },
      undefined,
      (err) => reject(new Error(`Failed to load texture ${url}: ${describeError(err)}`)),
    );
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
