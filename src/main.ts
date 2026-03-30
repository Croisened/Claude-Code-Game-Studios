/**
 * Robo Rhapsody — Neon Fugitive
 * Entry point: boots Three.js + Rapier, initialises core systems, starts game loop.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { gsm, GameState } from './core/game-state-manager';
import { CharacterRenderer } from './core/character-renderer';
import { EnvironmentRenderer } from './core/environment-renderer';
import { CameraSystem } from './core/camera-system';
import { RunnerSystem } from './core/runner-system';
import { inputSystem } from './core/input-system';

async function boot(): Promise<void> {
  // ── Rapier ────────────────────────────────────────────────────────────────
  await RAPIER.init();
  const gravity = { x: 0, y: -30, z: 0 }; // y=-30 per prototype report
  const world = new RAPIER.World(gravity);
  console.log('✓ Rapier ready — world gravity:', gravity.y);
  world.step(); // sanity step
  console.log('✓ Rapier step OK');

  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070d);
  scene.fog = new THREE.Fog(0x07070d, 20, 60);

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0x00f0ff, 2);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  console.log('✓ Three.js ready');

  // ── Systems ───────────────────────────────────────────────────────────────
  const characterRenderer   = new CharacterRenderer(scene, gsm);
  const environmentRenderer = new EnvironmentRenderer(scene, gsm);
  const cameraSystem        = new CameraSystem(
    characterRenderer.robotObject3D,
    window.innerWidth / window.innerHeight,
  );
  const runnerSystem        = new RunnerSystem(
    characterRenderer.robotObject3D,
    environmentRenderer,
    gsm,
    inputSystem,
  );

  // ── Collision → Death ─────────────────────────────────────────────────────
  runnerSystem.onCollisionDetected(() => {
    gsm.transition(GameState.Dead);
  });

  // ── Resize ────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cameraSystem.onResize(window.innerWidth / window.innerHeight);
  });

  // ── Game loop ─────────────────────────────────────────────────────────────
  // Placeholder loop until RunnerSystem owns the update cycle (S1-07).
  let lastTime = 0;
  function animate(time: number): void {
    requestAnimationFrame(animate);
    const delta = time - lastTime;
    lastTime = time;
    runnerSystem.update(delta);
    characterRenderer.update(delta);
    environmentRenderer.update(delta);
    cameraSystem.update(delta);
    renderer.render(scene, cameraSystem.camera);
  }
  requestAnimationFrame(animate);

  // ── Boot transition ───────────────────────────────────────────────────────
  // Loading → MainMenu: makes robot visible and environment static backdrop.
  gsm.transition(GameState.MainMenu);
}

boot().catch((err) => {
  console.error('Boot failed:', err);
});
