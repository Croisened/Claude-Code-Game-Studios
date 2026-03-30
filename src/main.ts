/**
 * Robo Rhapsody — Neon Fugitive
 * Entry point: boots Three.js renderer and Rapier physics, then hands off to the game.
 *
 * S1-01 acceptance check:
 *   - Three.js WebGL scene renders a placeholder box
 *   - Rapier world initializes successfully
 *   - Console logs "✓ Rapier ready" and "✓ Three.js ready"
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function boot(): Promise<void> {
  // ── Rapier ────────────────────────────────────────────────────────────────
  await RAPIER.init();
  const gravity = { x: 0, y: -30, z: 0 }; // y=-30 per prototype report (gravity=30)
  const world = new RAPIER.World(gravity);
  console.log('✓ Rapier ready — world gravity:', gravity.y);

  // Sanity: step the world once to confirm physics runs
  world.step();
  console.log('✓ Rapier step OK');

  // ── Three.js ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070d);
  scene.fog = new THREE.Fog(0x07070d, 20, 60);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 0, -5);

  // Placeholder geometry — replaced by CharacterRenderer (S1-04) and
  // EnvironmentRenderer (S1-05) in subsequent tasks.
  const robotMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xb44fff, emissive: 0x220033 }),
  );
  robotMesh.position.set(0, 0.9, 0);
  scene.add(robotMesh);

  const laneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 80),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e }),
  );
  laneMesh.rotation.x = -Math.PI / 2;
  laneMesh.position.z = -30;
  scene.add(laneMesh);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0x00f0ff, 2);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  console.log('✓ Three.js ready');

  // ── Resize ────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Render loop ───────────────────────────────────────────────────────────
  // Placeholder loop — replaced by GameStateManager-driven loop in S1-02+.
  function animate(): void {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

boot().catch((err) => {
  console.error('Boot failed:', err);
});
