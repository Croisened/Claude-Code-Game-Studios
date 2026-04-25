import { describe, it, expect } from 'vitest';
import { CONFIG, type Config } from '@/config';

describe('CONFIG', () => {
  it('exposes exactly the v1 top-level subsystem keys', () => {
    expect(Object.keys(CONFIG).sort()).toEqual([
      'animation',
      'arena',
      'build',
      'camera',
      'renderer',
      'sim',
    ]);
  });

  it('matches the v1 starter values for sim', () => {
    expect(CONFIG.sim.tickRateHz).toBe(60);
    expect(CONFIG.sim.defaultSeed).toBe(1);
  });

  it('matches the v1 starter values for renderer', () => {
    expect(CONFIG.renderer.robotCount).toBe(85);
    expect(CONFIG.renderer.targetFps).toBe(60);
    expect(CONFIG.renderer.frustumCullSkeletons).toBe(false);
    expect(CONFIG.renderer.robotGlbPath).toBe(
      'assets/art/characters/robot/robot_run.glb',
    );
    expect(CONFIG.renderer.idleGlbPath).toBe(
      'assets/art/characters/robot/robot_idle.glb',
    );
    expect(CONFIG.renderer.deathGlbPath).toBe(
      'assets/art/characters/robot/robot_death.glb',
    );
    expect(CONFIG.renderer.skinTexturePathPattern).toBe(
      'assets/art/characters/robot/skins/{id}.png',
    );
  });

  it('matches the v1 starter values for animation', () => {
    expect(CONFIG.animation.crossfadeSeconds).toBe(0.2);
    expect(CONFIG.animation.defaultState).toBe('run');
    expect(CONFIG.animation.validStates).toEqual(['run', 'idle', 'death']);
  });

  it('matches the v1 starter values for build', () => {
    expect(CONFIG.build.traitsJsonPath).toBe('/traits.json');
  });

  it('matches the v1 starter values for arena (S5-03)', () => {
    expect(CONFIG.arena.defaultArenaPath).toBe('/assets/data/arenas/arena-01.json');
  });

  it('reserves camera as an empty subsystem placeholder', () => {
    expect(Object.keys(CONFIG.camera)).toHaveLength(0);
  });

  it('exposes a Config type alias', () => {
    const cfg: Config = CONFIG;
    expect(cfg).toBe(CONFIG);
  });
});
