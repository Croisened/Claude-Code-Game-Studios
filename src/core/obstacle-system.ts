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
  mesh:      THREE.Mesh;
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
    private readonly _config:   ObstacleSystemConfig      = OBSTACLE_SYSTEM_CONFIG,
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
    return this._pool.filter(o => o.active).length;
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

      obs.mesh.position.z += this._rs.currentSpeed * physicsDelta;

      if (obs.mesh.position.z > this._config.recycleThreshold) {
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
        const geo = new THREE.BoxGeometry(def.hitbox.w, def.hitbox.h, def.hitbox.d);
        const mat = new THREE.MeshLambertMaterial({ color: def.debugColor });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        // Park far off-screen so inactive obstacles don't affect fog/culling tests
        mesh.position.set(0, def.centerY, -1000);
        this._scene.add(mesh);
        pool.push({ typeIndex, mesh, active: false });
      }
    }
    return pool;
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
      if (Math.abs(obs.mesh.position.z - spawnZ) < this._config.minObstacleGap) {
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
    slot.mesh.position.set(lane, def.centerY, spawnZ);
    slot.mesh.visible = true;
    slot.active       = true;
  }

  private _deactivate(obs: PooledObstacle): void {
    obs.active          = false;
    obs.mesh.visible    = false;
    obs.mesh.position.z = -1000; // safe off-screen park
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

    // Obstacle AABB
    const obsMinX = obs.mesh.position.x - def.hitbox.w / 2;
    const obsMaxX = obs.mesh.position.x + def.hitbox.w / 2;
    const obsMinY = obs.mesh.position.y - def.hitbox.h / 2;
    const obsMaxY = obs.mesh.position.y + def.hitbox.h / 2;
    const obsMinZ = obs.mesh.position.z - def.hitbox.d / 2;
    const obsMaxZ = obs.mesh.position.z + def.hitbox.d / 2;

    const overlap =
      robotMinX < obsMaxX && robotMaxX > obsMinX &&
      robotMinY < obsMaxY && robotMaxY > obsMinY &&
      robotMinZ < obsMaxZ && robotMaxZ > obsMinZ;

    if (overlap) {
      this._rs.notifyCollision();
    }
  }
}
