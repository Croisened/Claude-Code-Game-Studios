// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the 3-lane dodge-obstacle core loop feel fun?
//           Does instant lane snap + physics jump arc + obstacle timing create satisfying near-misses?
// Date: 2026-03-27

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// CONFIG — all hardcoded per prototype convention
// ---------------------------------------------------------------------------

const LANE_LEFT  = -3;
const LANE_CENTER = 0;
const LANE_RIGHT  = 3;
const LANES = [LANE_LEFT, LANE_CENTER, LANE_RIGHT] as const;

const INITIAL_SPEED   = 8;    // units/second
const MAX_SPEED        = 25;   // units/second
const SPEED_RAMP       = 0.5;  // units/s²

const JUMP_FORCE       = 12;   // upward velocity on jump
const GRAVITY          = 20;   // downward acceleration
const GROUND_Y         = 0;    // world Y of ground surface
const LANDING_EPSILON  = 0.05;

const SLIDE_DURATION   = 0.6;  // seconds

// Standing collider: 0.8 × 1.8 × 0.8 → top = 1.8
// Crouched collider: 0.8 × 0.9 × 0.8 → top = 0.9
const STANDING_HALF_H  = 0.9;  // half-height = 0.9, center = 0.9, top = 1.8
const CROUCHED_HALF_H  = 0.45; // half-height = 0.45, center = 0.45, top = 0.9

const SPAWN_Z          = -30;  // Z at which obstacles are placed
const RECYCLE_Z        = 6;    // Z past which obstacles are returned to pool
const SPAWN_INTERVAL   = 2.0;  // seconds between spawn attempts
const MIN_GAP          = 8;    // minimum Z gap between any two active obstacles at spawn time

const CAMERA_Z_OFFSET  = 8;
const CAMERA_Y_OFFSET  = 3;
const LOOK_AHEAD_Z     = -5;
const X_LERP_FACTOR    = 8;    // camera follow speed

// ---------------------------------------------------------------------------
// SCENE
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050f);
scene.fog = new THREE.FogExp2(0x05050f, 0.018);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, CAMERA_Y_OFFSET, CAMERA_Z_OFFSET);
camera.lookAt(0, 0, LOOK_AHEAD_Z);

// Lighting
const ambient = new THREE.AmbientLight(0x202040, 1.0);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0x6060cc, 1.5);
sun.position.set(0, 20, 10);
sun.castShadow = true;
sun.shadow.camera.left   = -10;
sun.shadow.camera.right  =  10;
sun.shadow.camera.top    =  10;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.far    =  80;
scene.add(sun);

// Neon accent lights that scroll with the world feel
const neonL = new THREE.PointLight(0xff00ff, 3, 20);
neonL.position.set(-7, 3, -15);
scene.add(neonL);
const neonR = new THREE.PointLight(0x00ffff, 3, 20);
neonR.position.set( 7, 3, -15);
scene.add(neonR);

// ---------------------------------------------------------------------------
// ENVIRONMENT (static placeholder geometry)
// ---------------------------------------------------------------------------

// Ground
const groundGeo = new THREE.PlaneGeometry(14, 120);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x0d0d22 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -50;
ground.receiveShadow = true;
scene.add(ground);

// Lane dividers
for (const x of [-1.5, 1.5]) {
  const laneGeo = new THREE.PlaneGeometry(0.04, 120);
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x222255 });
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(x, 0.002, -50);
  scene.add(lane);
}

// Side walls (simple box columns repeating Z)
const wallMat = new THREE.MeshLambertMaterial({ color: 0x0a0a1f });
for (let z = -5; z >= -60; z -= 12) {
  for (const side of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), wallMat);
    col.position.set(side * 8, 3, z);
    col.receiveShadow = true;
    scene.add(col);
  }
}

// ---------------------------------------------------------------------------
// ROBOT MESH (placeholder box)
// ---------------------------------------------------------------------------

const robotGroup = new THREE.Group();
scene.add(robotGroup);

// Body
const bodyGeo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
const bodyMat = new THREE.MeshLambertMaterial({ color: 0x00ccee });
const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
bodyMesh.castShadow = true;
robotGroup.add(bodyMesh);

// Eyes (simple indicator of facing)
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.05), eyeMat);
eyeL.position.set(-0.2, 0.45, -0.43);
robotGroup.add(eyeL);
const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.05), eyeMat);
eyeR.position.set( 0.2, 0.45, -0.43);
robotGroup.add(eyeR);

// Robot group origin is at foot level (Y=0), body center is at Y=0.9
robotGroup.position.set(LANE_CENTER, 0, 0);

// ---------------------------------------------------------------------------
// OBSTACLE POOL
// ---------------------------------------------------------------------------

type ObstacleType = 'barrier' | 'drone';

interface Obstacle {
  mesh: THREE.Mesh;
  type: ObstacleType;
  active: boolean;
}

const barrierMat = new THREE.MeshLambertMaterial({ color: 0xdd2222 });
const droneMat   = new THREE.MeshLambertMaterial({ color: 0xff9900 });

const obstaclePool: Obstacle[] = [];

// 3 Barriers: 0.8 × 1.0 × 0.8, centerY = 0.5
for (let i = 0; i < 3; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.8), barrierMat);
  mesh.castShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  obstaclePool.push({ mesh, type: 'barrier', active: false });
}

// 3 Drones: 0.8 × 0.5 × 0.8, centerY = 1.25
for (let i = 0; i < 3; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), droneMat);
  mesh.castShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  obstaclePool.push({ mesh, type: 'drone', active: false });
}

// ---------------------------------------------------------------------------
// GAME STATE
// ---------------------------------------------------------------------------

let laneIndex   = 1;             // 0=left 1=center 2=right
let robotY      = GROUND_Y;      // foot Y position
let velY        = 0;             // vertical velocity
let isJumping   = false;
let isSliding   = false;
let slideTimer  = 0;
let currentSpeed = INITIAL_SPEED;
let distance     = 0;
let spawnTimer   = 0;
let isDead       = false;
let camX         = LANE_CENTER;  // camera X (lerped behind robot)
let bestDistance = 0;

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------

const keysDown = new Set<string>();

window.addEventListener('keydown', (e) => {
  if (keysDown.has(e.code)) return; // suppress repeat
  keysDown.add(e.code);

  if (isDead) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') restart();
    return;
  }

  // Lane change — instant snap
  if (e.code === 'ArrowLeft'  && laneIndex > 0) laneIndex--;
  if (e.code === 'ArrowRight' && laneIndex < 2) laneIndex++;

  // Jump
  if ((e.code === 'ArrowUp' || e.code === 'Space') && !isJumping) {
    if (isSliding) { isSliding = false; slideTimer = 0; } // cancel slide
    velY = JUMP_FORCE;
    isJumping = true;
  }

  // Slide — only from Standing while grounded
  if ((e.code === 'ArrowDown' || e.code === 'KeyS') && !isJumping && !isSliding) {
    isSliding = true;
    slideTimer = SLIDE_DURATION;
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

// ---------------------------------------------------------------------------
// HUD (DOM overlay)
// ---------------------------------------------------------------------------

const hud = document.createElement('div');
hud.style.cssText = `
  position: fixed; top: 0; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; color: #00ffff; font: bold 18px 'Courier New', monospace;
  text-shadow: 0 0 12px #00ffff88; pointer-events: none; white-space: nowrap;
`;
document.body.appendChild(hud);

const controls = document.createElement('div');
controls.style.cssText = `
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
  color: #334; font: 13px 'Courier New', monospace; text-align: center;
  pointer-events: none;
`;
controls.innerHTML = '← → &nbsp; Lane change &nbsp;|&nbsp; ↑ / SPACE &nbsp; Jump &nbsp;|&nbsp; ↓ / S &nbsp; Slide';
document.body.appendChild(controls);

const deathScreen = document.createElement('div');
deathScreen.style.cssText = `
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  color: #ff3333; font: bold 36px 'Courier New', monospace; text-align: center;
  text-shadow: 0 0 24px #ff333388; display: none; line-height: 1.6;
`;
document.body.appendChild(deathScreen);

// ---------------------------------------------------------------------------
// SPAWN & COLLISION HELPERS
// ---------------------------------------------------------------------------

function trySpawn(): void {
  // Minimum gap check
  for (const obs of obstaclePool) {
    if (!obs.active) continue;
    if (Math.abs(obs.mesh.position.z - SPAWN_Z) < MIN_GAP) return;
  }

  // Pick random type and lane
  const type: ObstacleType = Math.random() < 0.55 ? 'barrier' : 'drone';
  const lane = LANES[Math.floor(Math.random() * 3)];

  const slot = obstaclePool.find(o => !o.active && o.type === type);
  if (!slot) return; // pool exhausted — skip

  const centerY = type === 'barrier' ? 0.5 : 1.25;
  slot.mesh.position.set(lane, centerY, SPAWN_Z);
  slot.mesh.visible = true;
  slot.active = true;
}

function robotTopY(): number {
  if (isSliding) return robotY + CROUCHED_HALF_H * 2; // top = 0.9
  return robotY + STANDING_HALF_H * 2;                 // top = 1.8
}

function checkCollision(): boolean {
  const rx = robotGroup.position.x;
  const rMinX = rx - 0.35, rMaxX = rx + 0.35;
  const rMinY = robotY,     rMaxY = robotTopY();
  const rMinZ = -0.45,      rMaxZ = 0.45;

  for (const obs of obstaclePool) {
    if (!obs.active) continue;
    const { x, y, z } = obs.mesh.position;
    const hw = 0.4;
    const hh = obs.type === 'barrier' ? 0.5 : 0.25;
    const hd = 0.4;

    if (
      rMaxX > x - hw && rMinX < x + hw &&
      rMaxY > y - hh && rMinY < y + hh &&
      rMaxZ > z - hd && rMinZ < z + hd
    ) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// RESTART
// ---------------------------------------------------------------------------

function restart(): void {
  laneIndex     = 1;
  robotY        = GROUND_Y;
  velY          = 0;
  isJumping     = false;
  isSliding     = false;
  slideTimer    = 0;
  currentSpeed  = INITIAL_SPEED;
  distance      = 0;
  spawnTimer    = 0;
  isDead        = false;
  camX          = LANE_CENTER;

  robotGroup.position.set(LANE_CENTER, 0, 0);
  robotGroup.rotation.x = 0;

  for (const obs of obstaclePool) {
    obs.active = false;
    obs.mesh.visible = false;
    obs.mesh.position.set(0, -10, 0); // park off-screen
  }

  deathScreen.style.display = 'none';
}

// ---------------------------------------------------------------------------
// GAME LOOP
// ---------------------------------------------------------------------------

let prevTime = performance.now();

function tick(now: number): void {
  requestAnimationFrame(tick);

  const rawDelta = (now - prevTime) / 1000;
  prevTime = now;
  const dt = Math.min(rawDelta, 0.1); // clamp spike frames

  if (!isDead) {
    // Speed ramp
    currentSpeed = Math.min(currentSpeed + SPEED_RAMP * dt, MAX_SPEED);
    distance += currentSpeed * dt;

    // --- ROBOT MOVEMENT ---

    // Instant lane snap (matches GDD spec)
    robotGroup.position.x = LANES[laneIndex];

    // Jump arc
    if (isJumping) {
      velY   -= GRAVITY * dt;
      robotY += velY * dt;

      if (robotY <= GROUND_Y + LANDING_EPSILON) {
        robotY    = GROUND_Y;
        velY      = 0;
        isJumping = false;
      }
    }

    // Slide timer
    if (isSliding) {
      slideTimer -= dt;
      if (slideTimer <= 0) {
        isSliding  = false;
        slideTimer = 0;
      }
    }

    // Apply robot mesh transform
    if (isSliding) {
      // Scale body to crouched height, shift group so feet stay at robotY
      bodyMesh.scale.y     = 0.5;
      bodyMesh.position.y  = CROUCHED_HALF_H;
      eyeL.position.y = eyeR.position.y = CROUCHED_HALF_H - 0.1;
    } else {
      bodyMesh.scale.y     = 1.0;
      bodyMesh.position.y  = STANDING_HALF_H;
      eyeL.position.y = eyeR.position.y = 0.45;
    }
    robotGroup.position.y = robotY;

    // Lean forward slightly when airborne for juice
    robotGroup.rotation.x = isJumping ? -0.15 : 0;

    // --- OBSTACLES ---

    spawnTimer += dt;
    if (spawnTimer >= SPAWN_INTERVAL) {
      spawnTimer = 0;
      trySpawn();
    }

    for (const obs of obstaclePool) {
      if (!obs.active) continue;
      obs.mesh.position.z += currentSpeed * dt;
      if (obs.mesh.position.z > RECYCLE_Z) {
        obs.active = false;
        obs.mesh.visible = false;
      }
    }

    // Drift neon lights to follow approximate camera depth
    neonL.position.z = camX - 15;
    neonR.position.z = camX - 15;

    // --- COLLISION ---
    if (checkCollision()) {
      isDead = true;
      if (distance > bestDistance) bestDistance = distance;

      deathScreen.innerHTML =
        `SYSTEM FAILURE<br>` +
        `<span style="font-size:22px; color:#ffaa00">${Math.floor(distance)} m</span><br>` +
        (bestDistance > distance
          ? `<span style="font-size:16px; color:#888">Best: ${Math.floor(bestDistance)} m</span><br>`
          : `<span style="font-size:16px; color:#00ff88">New Best!</span><br>`) +
        `<span style="font-size:14px; color:#555">R / SPACE / ENTER to restart</span>`;
      deathScreen.style.display = 'block';
    }

    // --- CAMERA ---
    camX += (robotGroup.position.x - camX) * Math.min(X_LERP_FACTOR * dt, 1.0);
    camera.position.set(camX, CAMERA_Y_OFFSET, CAMERA_Z_OFFSET);
    camera.lookAt(camX, 0, LOOK_AHEAD_Z);

    // --- HUD ---
    const speedPct = Math.round(((currentSpeed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED)) * 100);
    hud.textContent = `${Math.floor(distance)} m  ·  ${currentSpeed.toFixed(1)} u/s  ·  ${speedPct}% max`;
  }

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// RESIZE
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------

requestAnimationFrame(tick);
