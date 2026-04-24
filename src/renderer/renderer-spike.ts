/**
 * S4-04 SPIKE — 85-Instance Skinned Mesh Renderer.
 *
 * Throwaway prototype to measure feasibility before the production renderer
 * GDD is written. Answers: can Three.js sustain 60fps with 85 independently
 * animated skinned meshes, each with a unique texture? See sprint-04.md.
 *
 * Magic numbers in this file are deliberate — the spike's whole job is to
 * find out what the numbers should be. Tunable values move to CONFIG.renderer
 * when the production renderer is implemented post-GDD.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '@/config';

const GRID_COLS = 10;
const GRID_SPACING = 3.5;
const CAMERA_DISTANCE = 50;
const CAMERA_HEIGHT = 25;
const GROUND_SIZE = 100;
const SKIN_TEXTURE_SIZE_HINT_KB = 200; // for log only

interface SpikeStats {
  fps: number;
  drawCalls: number;
  robotCount: number;
  loadStatus: 'loading' | 'ready' | 'error';
  errorMessage?: string;
}

export function mountRendererSpike(
  container: HTMLElement,
  onStats: (stats: SpikeStats) => void,
): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false; // skip shadows for spike — perf focus
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0a0f');

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    500,
  );
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: '#1a1a24', roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const robotCount = CONFIG.renderer.robotCount;
  let stats: SpikeStats = {
    fps: 0,
    drawCalls: 0,
    robotCount,
    loadStatus: 'loading',
  };
  onStats(stats);

  const mixers: THREE.AnimationMixer[] = [];
  const clock = new THREE.Clock();
  let disposed = false;
  let rafId = 0;

  // FPS counter — rolling 60-frame window.
  const frameTimes: number[] = [];
  let lastFrameMs = performance.now();

  // ---- Resize ----
  const onResize = () => {
    if (disposed) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // ---- Asset load ----
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  const skinPath = (id: number) =>
    CONFIG.renderer.skinTexturePathPattern.replace('{id}', String(id));

  Promise.all([
    new Promise<{
      mesh: THREE.SkinnedMesh;
      clip: THREE.AnimationClip;
      animations: THREE.AnimationClip[];
      root: THREE.Object3D;
    }>((resolveGlb, rejectGlb) => {
      loader.load(
        CONFIG.renderer.robotGlbPath,
        (gltf) => {
          let skinned: THREE.SkinnedMesh | null = null;
          gltf.scene.traverse((child) => {
            if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
              skinned = child as THREE.SkinnedMesh;
            }
          });
          if (!skinned) {
            rejectGlb(new Error('No SkinnedMesh found in robot_run.glb'));
            return;
          }
          if (gltf.animations.length === 0) {
            rejectGlb(new Error('No AnimationClip found in robot_run.glb'));
            return;
          }
          resolveGlb({
            mesh: skinned,
            clip: gltf.animations[0],
            animations: gltf.animations,
            root: gltf.scene,
          });
        },
        undefined,
        (err) => rejectGlb(err),
      );
    }),
    Promise.all(
      Array.from({ length: robotCount }, (_, i) =>
        new Promise<THREE.Texture>((resolveTex, rejectTex) => {
          texLoader.load(
            skinPath(i),
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.flipY = false; // GLTF convention
              resolveTex(tex);
            },
            undefined,
            (err) => rejectTex(err),
          );
        }),
      ),
    ),
  ])
    .then(([glb, textures]) => {
      console.log(
        `[spike] Loaded GLB (${glb.animations.length} animations) + ${textures.length} skins ` +
          `(~${textures.length * SKIN_TEXTURE_SIZE_HINT_KB} KB)`,
      );

      // Build instances. SkeletonUtils.clone preserves the rig graph and
      // creates fresh bones for each instance — needed for independent animation.
      for (let i = 0; i < robotCount; i++) {
        const clonedRoot = cloneSkinned(glb.root);

        // Find the cloned skinned mesh (clone preserves traversal order).
        let clonedSkinned: THREE.SkinnedMesh | null = null;
        clonedRoot.traverse((child) => {
          if ((child as THREE.SkinnedMesh).isSkinnedMesh && !clonedSkinned) {
            clonedSkinned = child as THREE.SkinnedMesh;
          }
        });
        if (!clonedSkinned) {
          console.error(`[spike] Robot ${i}: cloned mesh has no SkinnedMesh`);
          continue;
        }

        // Per-instance material — clone the source material so map swaps
        // do not affect siblings.
        const sourceMat = (clonedSkinned as THREE.SkinnedMesh)
          .material as THREE.MeshStandardMaterial;
        const mat = sourceMat.clone();
        mat.map = textures[i];
        mat.needsUpdate = true;
        (clonedSkinned as THREE.SkinnedMesh).material = mat;

        // Position in 10×9 grid centered at origin.
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        const x = (col - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const z = (row - 4) * GRID_SPACING;
        clonedRoot.position.set(x, 0, z);

        // Animation mixer per instance — required for independent state.
        const mixer = new THREE.AnimationMixer(clonedRoot);
        const action = mixer.clipAction(glb.clip);
        // Slight offset so the field doesn't run in lockstep — visual sanity.
        action.time = (i * 0.07) % glb.clip.duration;
        action.play();
        mixers.push(mixer);

        scene.add(clonedRoot);
      }

      stats = { ...stats, loadStatus: 'ready' };
      onStats(stats);
    })
    .catch((err) => {
      console.error('[spike] Load failed:', err);
      stats = {
        ...stats,
        loadStatus: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      onStats(stats);
    });

  // ---- Animation loop ----
  const tick = () => {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);

    const dt = clock.getDelta();
    for (const m of mixers) m.update(dt);

    renderer.render(scene, camera);

    // FPS rolling avg.
    const now = performance.now();
    const frameMs = now - lastFrameMs;
    lastFrameMs = now;
    frameTimes.push(frameMs);
    if (frameTimes.length > 60) frameTimes.shift();
    if (frameTimes.length === 60) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const fps = 1000 / avg;
      const drawCalls = renderer.info.render.calls;
      if (Math.abs(fps - stats.fps) > 0.3 || drawCalls !== stats.drawCalls) {
        stats = { ...stats, fps, drawCalls };
        onStats(stats);
      }
    }
  };
  tick();

  // ---- Disposer ----
  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    container.removeChild(renderer.domElement);
  };
}
