/**
 * Obstacle System
 *
 * Pre-allocates a fixed pool of obstacle meshes at startup. During Running
 * state, fires a spawn timer and places obstacles ahead of the robot in random
 * lanes. Moves all active obstacles toward the robot each tick. Recycles
 * obstacles that scroll past the recycle threshold. Performs AABB collision
 * detection against the robot and calls RunnerSystem.notifyCollision() on hit.
 *
 * Physics note (TODO S1-08+): GDD specifies Rapier kinematic bodies for
 * obstacle movement and collision groups for automatic collision callbacks.
 * Current implementation uses direct Three.js position writes and manual AABB
 * collision checks. Replace with Rapier body integration when physics are wired
 * to scene objects.
 *
 * GDD: design/gdd/obstacle-system.md
 */

import * as THREE from 'three';
import { type GameStateManager, GameState, type StateChangedEvent } from './game-state-manager';
import { type RunnerSystem } from './runner-system';
import { LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './environment-renderer';
import {
  OBSTACLE_SYSTEM_CONFIG,
  OBSTACLE_TYPE_REGISTRY,
  type ObstacleSystemConfig,
  type ObstacleTypeDefinition,
} from '../config/obstacle-system.config';
import { RUNNER_SYSTEM_CONFIG, type RunnerSystemConfig } from '../config/runner-system.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PooledObstacle {
  typeIndex: number;
  object:    THREE.Object3D;
  active:    boolean;
}

const LANES = [LANE_LEFT, LANE_CENTER, LANE_RIGHT] as const;

// ── ObstacleSystem ────────────────────────────────────────────────────────────

export class ObstacleSystem {
  private readonly _pool:    PooledObstacle[];
  private          _active:  boolean = false;
  private          _spawnTimer: number = 0;

  private readonly _gsmListener: (e: StateChangedEvent) => void;

  constructor(
    private readonly _scene:    THREE.Scene,
    private readonly _robot:    THREE.Object3D,
    private readonly _gsm:      GameStateManager,
    private readonly _rs:       RunnerSystem,
    private          _config:   ObstacleSystemConfig      = OBSTACLE_SYSTEM_CONFIG,
    private readonly _registry: ReadonlyArray<ObstacleTypeDefinition> = OBSTACLE_TYPE_REGISTRY,
    private readonly _rsConfig: RunnerSystemConfig         = RUNNER_SYSTEM_CONFIG,
  ) {
    this._pool = this._buildPool();
    this._gsmListener = this._onStateChanged.bind(this);
    this._gsm.on(this._gsmListener);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Number of currently active (visible) obstacles. Useful for tests and debug overlays. */
  get activeCount(): number {
    let count = 0;
    for (const obs of this._pool) { if (obs.active) count++; }
    return count;
  }

  /**
   * Advance spawn timer, move active obstacles, check collisions.
   * No-op when not in Running state.
   * @param deltaMs - milliseconds since last frame
   */
  update(deltaMs: number): void {
    if (!this._active) return;

    // Spawn timer uses real elapsed time — no clamp (timer drift is harmless).
    // Physics delta is clamped to prevent movement overshoot on frame spikes.
    const elapsed      = deltaMs * 0.001;
    const physicsDelta = Math.min(elapsed, 0.1);

    // Spawn timer
    this._spawnTimer += elapsed;
    if (this._spawnTimer >= this._config.spawnInterval) {
      this._spawnTimer = 0;
      this._trySpawn();
    }

    // Move + recycle + collision
    for (const obs of this._pool) {
      if (!obs.active) continue;

      obs.object.position.z += this._rs.currentSpeed * physicsDelta;

      if (obs.object.position.z > this._config.recycleThreshold) {
        this._deactivate(obs);
        continue;
      }

      this._checkCollision(obs);
    }
  }

  /**
   * Override the spawn interval. Called by Difficulty Curve in v1.
   * Values below minSpawnInterval are clamped.
   */
  setSpawnInterval(interval: number): void {
    if (interval < this._config.minSpawnInterval) {
      if (import.meta.env.DEV) {
        console.warn(
          `[ObstacleSystem] setSpawnInterval(${interval}) clamped to ${this._config.minSpawnInterval}`,
        );
      }
      this._config = { ...this._config, spawnInterval: this._config.minSpawnInterval };
      return;
    }
    this._config = { ...this._config, spawnInterval: interval };
  }

  /** Remove all listeners; deactivate all obstacles. */
  destroy(): void {
    this._gsm.off(this._gsmListener);
    this._resetPool();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _buildPool(): PooledObstacle[] {
    const pool: PooledObstacle[] = [];
    for (let typeIndex = 0; typeIndex < this._registry.length; typeIndex++) {
      const def = this._registry[typeIndex];
      for (let i = 0; i < def.poolSize; i++) {
        const object = def.name === 'Drone'
          ? this._buildDrone()
          : this._buildBarrier();
        object.visible = false;
        // Park far off-screen so inactive obstacles don't affect fog/culling tests
        object.position.set(0, def.centerY, -1000);
        this._scene.add(object);
        pool.push({ typeIndex, object, active: false });
      }
    }
    return pool;
  }

  /**
   * Barrier: a neon security gate.
   * Wide horizontal bar with two vertical end posts. Emissive orange-red.
   * Visual only — hitbox is still read from the registry.
   */
  private _buildBarrier(): THREE.Object3D {
    const group = new THREE.Group();
    const mat   = new THREE.MeshStandardMaterial({
      color:           0xff3300,
      emissive:        new THREE.Color(0xff3300),
      emissiveIntensity: 0.8,
      metalness:       0.6,
      roughness:       0.3,
    });

    // Horizontal crossbar spanning the lane
    const bar  = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), mat);
    bar.position.y = 0;
    group.add(bar);

    // Left post
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), mat);
    postL.position.set(-0.76, -0.45, 0);
    group.add(postL);

    // Right post
    const postR = postL.clone();
    postR.position.set(0.76, -0.45, 0);
    group.add(postR);

    return group;
  }

  /**
   * Drone: a floating scanner.
   * Sphere body with four flat rotor discs on diagonal arms. Emissive cyan.
   * Visual only — hitbox is still read from the registry.
   */
  private _buildDrone(): THREE.Object3D {
    const group   = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color:             0x00ddff,
      emissive:          new THREE.Color(0x00ddff),
      emissiveIntensity: 0.7,
      metalness:         0.8,
      roughness:         0.2,
    });
    const rotorMat = new THREE.MeshStandardMaterial({
      color:             0x004466,
      emissive:          new THREE.Color(0x00aacc),
      emissiveIntensity: 0.4,
      metalness:         0.9,
      roughness:         0.1,
    });

    // Sphere body
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bodyMat));

    // 4 rotors at ±X / ±Z offsets
    const rotorGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 8);
    const offsets: [number, number][] = [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
    for (const [ox, oz] of offsets) {
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(ox, 0.05, oz);
      group.add(rotor);
    }

    return group;
  }

  private _onStateChanged(event: StateChangedEvent): void {
    const { to } = event;

    if (to === GameState.Running) {
      this._resetPool();
      this._spawnTimer = 0;
      this._active = true;
      return;
    }

    if (to === GameState.Dead) {
      this._active = false; // obstacles freeze in place
      return;
    }

    if (to === GameState.ScoreScreen || to === GameState.MainMenu) {
      this._resetPool();
      this._spawnTimer = 0;
      this._active = false;
    }
  }

  private _trySpawn(): void {
    const typeIndex = Math.floor(Math.random() * this._registry.length);
    const lane      = LANES[Math.floor(Math.random() * LANES.length)];
    const spawnZ    = -this._config.spawnDistance;

    // Minimum gap check: reject if any active obstacle is too close to spawn Z
    for (const obs of this._pool) {
      if (!obs.active) continue;
      if (Math.abs(obs.object.position.z - spawnZ) < this._config.minObstacleGap) {
        return; // skip — too close
      }
    }

    // Acquire pool slot
    const slot = this._pool.find(o => o.typeIndex === typeIndex && !o.active);
    if (!slot) {
      console.warn(`[ObstacleSystem] Pool exhausted: ${this._registry[typeIndex].name}`);
      return;
    }

    const def = this._registry[typeIndex];
    slot.object.position.set(lane, def.centerY, spawnZ);
    slot.object.visible = true;
    slot.active         = true;
  }

  private _deactivate(obs: PooledObstacle): void {
    obs.active            = false;
    obs.object.visible    = false;
    obs.object.position.z = -1000; // safe off-screen park
  }

  private _resetPool(): void {
    for (const obs of this._pool) {
      this._deactivate(obs);
    }
  }

  private _checkCollision(obs: PooledObstacle): void {
    const def = this._registry[obs.typeIndex];

    const robotH = this._rs.isSliding ? this._rsConfig.crouchedH : this._rsConfig.standingH;

    // Robot AABB (robot origin at feet; robot.position.y = 0 normally)
    const robotMinX = this._robot.position.x - this._rsConfig.colliderW / 2;
    const robotMaxX = this._robot.position.x + this._rsConfig.colliderW / 2;
    const robotMinY = this._robot.position.y;
    const robotMaxY = this._robot.position.y + robotH;
    const robotMinZ = this._robot.position.z - this._rsConfig.colliderD / 2;
    const robotMaxZ = this._robot.position.z + this._rsConfig.colliderD / 2;

    // Obstacle AABB (derived from group root position + registry hitbox)
    const obsMinX = obs.object.position.x - def.hitbox.w / 2;
    const obsMaxX = obs.object.position.x + def.hitbox.w / 2;
    const obsMinY = obs.object.position.y - def.hitbox.h / 2;
    const obsMaxY = obs.object.position.y + def.hitbox.h / 2;
    const obsMinZ = obs.object.position.z - def.hitbox.d / 2;
    const obsMaxZ = obs.object.position.z + def.hitbox.d / 2;

    const overlap =
      robotMinX < obsMaxX && robotMaxX > obsMinX &&
      robotMinY < obsMaxY && robotMaxY > obsMinY &&
      robotMinZ < obsMaxZ && robotMaxZ > obsMinZ;

    if (overlap) {
      this._rs.notifyCollision();
    }
  }
}
