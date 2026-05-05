import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createAnimationStateSwitcher } from '@/animation/state-switcher';
import { createRenderer, type AssetLoaderFn } from '@/renderer/renderer';
import { CONFIG } from '@/config';
import type { RobotAssets } from '@/renderer/asset-loader';

// -----------------------------------------------------------------------------
// Test harness — reuses the renderer's stub strategy so we drive a real
// renderer with synthetic GLBs and verify switcher behavior end-to-end.
// -----------------------------------------------------------------------------

function makeContainer(width = 800, height = 600): HTMLElement {
  return {
    clientWidth: width,
    clientHeight: height,
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  } as unknown as HTMLElement;
}

function makeWebGLRendererStub() {
  return {
    domElement: { parentNode: null } as unknown as HTMLCanvasElement,
    outputColorSpace: '' as unknown as THREE.ColorSpace,
    shadowMap: { enabled: false },
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
    setSize: () => {},
    setPixelRatio: () => {},
    getPixelRatio: () => 1,
    render: () => {},
    dispose: () => {},
  };
}

function makeFakeAssets(robotCount: number): RobotAssets {
  // SkinnedMesh + named bone as siblings under scene root, mirroring real GLBs.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));

  const bone = new THREE.Bone();
  bone.name = 'rootBone';
  const skeleton = new THREE.Skeleton([bone]);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.bind(skeleton);

  const sceneRoot = new THREE.Group();
  sceneRoot.add(bone);
  sceneRoot.add(skinnedMesh);

  // Distinct clips per state with non-trivial duration so death's
  // clampWhenFinished can be observed by advancing the mixer past it.
  const track = new THREE.VectorKeyframeTrack(
    'rootBone.position',
    [0, 1],
    [0, 0, 0, 1, 0, 0],
  );
  const runClip = new THREE.AnimationClip('run', 1, [track]);
  const idleClip = new THREE.AnimationClip('idle', 1, [track]);
  const deathClip = new THREE.AnimationClip('death', 1, [track]);

  const textures: THREE.Texture[] = [];
  for (let i = 0; i < robotCount; i++) {
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    textures.push(t);
  }

  return {
    runGltf: { scene: sceneRoot, animations: [runClip] } as unknown as RobotAssets['runGltf'],
    idleGltf: { scene: new THREE.Group(), animations: [idleClip] } as unknown as RobotAssets['idleGltf'],
    deathGltf: { scene: new THREE.Group(), animations: [deathClip] } as unknown as RobotAssets['deathGltf'],
    textures,
  };
}

function makeFakeRaf() {
  const queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  return {
    raf: (cb: FrameRequestCallback) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    cancelRaf: (id: number) => {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    flushOne: () => {
      const next = queue.shift();
      if (next) next.cb(performance.now());
    },
  };
}

async function makeMountedRenderer(robotCount?: number) {
  const container = makeContainer();
  const webGL = makeWebGLRendererStub();
  const raf = makeFakeRaf();
  const count = robotCount ?? CONFIG.renderer.robotCount;
  const assets = makeFakeAssets(count);
  const loadAssets: AssetLoaderFn = vi.fn(async () => assets);
  const target = new EventTarget();

  const renderer = createRenderer({
    webGLRendererFactory: () => webGL,
    loadAssets,
    raf: raf.raf,
    cancelRaf: raf.cancelRaf,
    resizeTarget: target,
  });

  await renderer.mount(container);
  return { renderer, container };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('createAnimationStateSwitcher — construction', () => {
  it('throws if the renderer is not mounted', () => {
    const empty = {
      mount: () => Promise.resolve(),
      getInstance: () => undefined,
      getAllInstances: () => [] as never[],
      getScene: () => new THREE.Scene(),
      addToScene: () => {},
      applyInitialPoses: () => {},
      dispose: () => {},
    };
    expect(() => createAnimationStateSwitcher(empty)).toThrow(/not mounted/);
  });

  it('starts every robot in the idle state', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    for (let id = 0; id < CONFIG.renderer.robotCount; id++) {
      expect(switcher.current(id)).toBe('idle');
    }
    switcher.dispose();
    renderer.dispose();
  });

  it('applies a per-id phase offset on the idle action', async () => {
    const { renderer } = await makeMountedRenderer();
    createAnimationStateSwitcher(renderer);
    const sample = renderer.getAllInstances();
    const idle0 = findActiveAction(sample[0]);
    const idle1 = findActiveAction(sample[1]);
    const idle47 = findActiveAction(sample[47]);
    expect(idle0.time).toBeCloseTo(0, 5);
    expect(idle1.time).toBeCloseTo(0.07, 5);
    expect(idle47.time).toBeCloseTo((47 * 0.07) % 1, 5);
    renderer.dispose();
  });
});

describe('createAnimationStateSwitcher — setState', () => {
  it('runs cleanly through all six transitions', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    const transitions: Array<['run' | 'idle' | 'death', 'run' | 'idle' | 'death']> = [
      ['idle', 'run'],
      ['run', 'idle'],
      ['idle', 'death'],
      ['death', 'idle'],
      ['idle', 'run'],
      ['run', 'death'],
      ['death', 'run'],
    ];
    for (const [from, to] of transitions) {
      switcher.setState(0, from);
      switcher.setState(0, to);
      expect(switcher.current(0)).toBe(to);
    }
    switcher.dispose();
    renderer.dispose();
  });

  it('same-state setState is a no-op (does not invoke clipAction)', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    const inst = renderer.getInstance(0)!;
    const spy = vi.spyOn(inst.mixer, 'clipAction');
    switcher.setState(0, 'idle'); // already idle from construction
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    switcher.dispose();
    renderer.dispose();
  });

  it('death sets LoopOnce and clampWhenFinished on the death action', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.setState(0, 'death');
    const action = actionFor(renderer.getInstance(0)!, 'death');
    expect(action.loop).toBe(THREE.LoopOnce);
    expect(action.clampWhenFinished).toBe(true);
    switcher.dispose();
    renderer.dispose();
  });

  it('death → idle resets loop config on the idle action', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.setState(0, 'death');
    switcher.setState(0, 'idle');
    const action = actionFor(renderer.getInstance(0)!, 'idle');
    expect(action.loop).toBe(THREE.LoopRepeat);
    expect(action.clampWhenFinished).toBe(false);
    switcher.dispose();
    renderer.dispose();
  });

  it('throws on unknown id', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    expect(() => switcher.setState(-1, 'idle')).toThrow(/Unknown robot id/);
    expect(() => switcher.setState(CONFIG.renderer.robotCount, 'idle')).toThrow(/Unknown robot id/);
    switcher.dispose();
    renderer.dispose();
  });

  it('throws on invalid state', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    expect(() => switcher.setState(0, 'sleep' as never)).toThrow(/Invalid animation state/);
    switcher.dispose();
    renderer.dispose();
  });

  it('crossfade uses CONFIG.animation.crossfadeSeconds', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    const inst = renderer.getInstance(0)!;
    const fromAction = findActiveAction(inst);
    const spy = vi.spyOn(fromAction, 'crossFadeTo');
    switcher.setState(0, 'run');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(CONFIG.animation.crossfadeSeconds);
    expect(spy.mock.calls[0][2]).toBe(false); // warpDuration
    spy.mockRestore();
    switcher.dispose();
    renderer.dispose();
  });
});

describe('createAnimationStateSwitcher — current', () => {
  it('returns the most recent setState value', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.setState(5, 'run');
    expect(switcher.current(5)).toBe('run');
    switcher.setState(5, 'death');
    expect(switcher.current(5)).toBe('death');
    switcher.dispose();
    renderer.dispose();
  });

  it('throws on unknown id (matches setState)', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    expect(() => switcher.current(-1)).toThrow(/Unknown robot id/);
    expect(() => switcher.current(CONFIG.renderer.robotCount)).toThrow(/Unknown robot id/);
    switcher.dispose();
    renderer.dispose();
  });
});

describe('createAnimationStateSwitcher — disposal', () => {
  it('dispose is idempotent', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.dispose();
    expect(() => switcher.dispose()).not.toThrow();
    renderer.dispose();
  });

  it('setState after dispose throws', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.dispose();
    expect(() => switcher.setState(0, 'run')).toThrow(/disposed/);
    renderer.dispose();
  });

  it('current after dispose throws', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.dispose();
    expect(() => switcher.current(0)).toThrow(/disposed/);
    renderer.dispose();
  });
});

describe('createAnimationStateSwitcher — death holds final pose', () => {
  it('death action clamps after one full duration', async () => {
    const { renderer } = await makeMountedRenderer();
    const switcher = createAnimationStateSwitcher(renderer);
    switcher.setState(0, 'death');
    const inst = renderer.getInstance(0)!;
    const action = actionFor(inst, 'death');
    // Advance the mixer well past the clip's 1-second duration so
    // clampWhenFinished kicks in.
    inst.mixer.update(2);
    expect(action.time).toBeLessThanOrEqual(1.0001);
    expect(action.paused).toBe(true);
    switcher.dispose();
    renderer.dispose();
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function findActiveAction(inst: { mixer: THREE.AnimationMixer; clips: ReadonlyMap<string, THREE.AnimationClip> }): THREE.AnimationAction {
  // First isRunning() action — used for the per-id idle phase-offset test
  // where only idle is playing. NOT safe mid-crossfade (multiple actions
  // run simultaneously); use `actionFor(inst, state)` for those cases.
  for (const clip of inst.clips.values()) {
    const action = inst.mixer.clipAction(clip);
    if (action.isRunning()) return action;
  }
  throw new Error('No running action found on instance');
}

function actionFor(
  inst: { mixer: THREE.AnimationMixer; clips: ReadonlyMap<string, THREE.AnimationClip> },
  state: 'run' | 'idle' | 'death',
): THREE.AnimationAction {
  const clip = inst.clips.get(state);
  if (!clip) throw new Error(`Missing clip: ${state}`);
  return inst.mixer.clipAction(clip);
}
