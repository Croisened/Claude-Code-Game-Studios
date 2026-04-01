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
import { ObstacleSystem } from './core/obstacle-system';
import { ScoreTracker } from './core/score-tracker';
import { DifficultyCurve } from './core/difficulty-curve';
import { GameUI } from './core/game-ui';
import { AudioSystem } from './core/audio-system';
import { LeaderboardService } from './core/leaderboard-service';
import { RobotNameService } from './core/robot-name-service';
import { inputSystem } from './core/input-system';
import { CAMERA_SYSTEM_CONFIG } from './config/camera-system.config';
import { ENVIRONMENT_RENDERER_CONFIG } from './config/environment-renderer.config';

// ── Startup assertions ──────────────────────────────────────────────────────
// recycleBuffer must be >= cameraZOffset + chunkLength so that when the nearest
// chunk recycles, the next chunk already covers the camera's draw distance.
{
  const { recycleBuffer, chunkLength } = ENVIRONMENT_RENDERER_CONFIG;
  const { zOffset: cameraZOffset } = CAMERA_SYSTEM_CONFIG;
  if (recycleBuffer < cameraZOffset + chunkLength) {
    throw new Error(
      `[Config] recycleBuffer (${recycleBuffer}) must be >= cameraZOffset + chunkLength ` +
      `(${cameraZOffset} + ${chunkLength} = ${cameraZOffset + chunkLength}). ` +
      `Increase recycleBuffer or reduce cameraZOffset.`,
    );
  }
}

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
  scene.fog = new THREE.Fog(0x07070d, 30, 90);

  // ── Lighting — three-point rig (camera at z=+8, y=+3, robot at origin) ───
  // Ambient: bright fill so the whole model reads clearly.
  scene.add(new THREE.AmbientLight(0xffffff, 3));

  // Key light: warm-neutral, front-left above camera — primary illumination.
  const keyLight = new THREE.DirectionalLight(0xfff4e0, 8);
  keyLight.position.set(-4, 8, 6);
  keyLight.castShadow = true;
  scene.add(keyLight);

  // Fill light: cool cyan, front-right at camera height — softens key shadows.
  const fillLight = new THREE.DirectionalLight(0x00cfff, 5);
  fillLight.position.set(5, 4, 6);
  scene.add(fillLight);

  // Rim light: neon magenta, directly behind robot — separates it from the bg.
  const rimLight = new THREE.DirectionalLight(0xff00cc, 6);
  rimLight.position.set(0, 5, -6);
  scene.add(rimLight);

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

  const scoreTracker    = new ScoreTracker(gsm);
  const obstacleSystem  = new ObstacleSystem(
    scene,
    characterRenderer.robotObject3D,
    gsm,
    runnerSystem,
  );
  const difficultyCurve = new DifficultyCurve(runnerSystem, obstacleSystem, scoreTracker, gsm);
  // ── Skin loader — by NFT ID ───────────────────────────────────────────────
  // Loads /assets/art/characters/robot/skins/{id}.png; falls back to Default.
  const DEFAULT_SKIN = '/assets/art/characters/robot/skins/84.png';
  function loadSkinById(id: string): void {
    const path = `/assets/art/characters/robot/skins/${id}.png`;
    new THREE.TextureLoader().load(
      path,
      (tex) => { characterRenderer.applyTexture(tex); },
      undefined,
      () => {
        // Unknown ID — silently fall back to default skin.
        new THREE.TextureLoader().load(DEFAULT_SKIN, (tex) => {
          characterRenderer.applyTexture(tex);
        });
      },
    );
  }

  const audioSystem        = new AudioSystem(gsm, runnerSystem);
  const leaderboardService = new LeaderboardService();
  const robotNameService   = new RobotNameService();
  robotNameService.load().catch((err) => console.error('[RobotNameService] Failed to load:', err));
  const gameUI = new GameUI(gsm, scoreTracker, loadSkinById, () => audioSystem.toggleMute(), audioSystem.isMuted, leaderboardService, robotNameService);

  // ── Collision → Death ─────────────────────────────────────────────────────
  runnerSystem.onCollisionDetected(() => {
    gsm.transition(GameState.Dead);
  });

  // ── Leaderboard submit on death ───────────────────────────────────────────
  gsm.on((e) => {
    if (e.to === GameState.Dead) {
      const stored   = localStorage.getItem('roborhapsody_skin_id');
      const parsed   = stored !== null ? parseInt(stored, 10) : 84;
      const skinId   = Number.isFinite(parsed) ? Math.min(84, Math.max(0, parsed)) : 84;
      const playerId = String(skinId);
      leaderboardService.submitScore(playerId, scoreTracker.finalScore);
    }
  });

  // ── Death animation complete → ScoreScreen ────────────────────────────────
  characterRenderer.onDeathComplete(() => {
    gsm.transition(GameState.ScoreScreen);
  });

  // ── Showcase camera ───────────────────────────────────────────────────────
  // Hero mode on MainMenu + ScoreScreen; gameplay mode during Running.
  gsm.on((e) => {
    if (e.to === GameState.Running) {
      cameraSystem.setShowcase(false);
      cameraSystem.snapToRobot(); // reset camera X on every run restart
    } else if (e.to === GameState.MainMenu || e.to === GameState.ScoreScreen) {
      cameraSystem.setShowcase(true);
    }
  });

  // ── Resize ────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cameraSystem.onResize(window.innerWidth / window.innerHeight);
  });

  // ── Game loop ─────────────────────────────────────────────────────────────
  let lastTime = 0;
  function animate(time: number): void {
    requestAnimationFrame(animate);
    const delta = time - lastTime;
    lastTime = time;
    runnerSystem.update(delta);
    scoreTracker.update(runnerSystem.currentSpeed, delta);
    difficultyCurve.update();
    gameUI.updateHUD();
    obstacleSystem.update(delta);
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
