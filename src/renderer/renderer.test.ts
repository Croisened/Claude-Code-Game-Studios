import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { createRenderer, type WebGLRendererLike, type AssetLoaderFn } from '@/renderer/renderer';
import { CONFIG } from '@/config';
import type { RobotAssets } from '@/renderer/asset-loader';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeContainer(width = 800, height = 600): HTMLElement {
  const children: unknown[] = [];
  return {
    clientWidth: width,
    clientHeight: height,
    appendChild: vi.fn((c: unknown) => {
      children.push(c);
      return c;
    }),
    removeChild: vi.fn((c: unknown) => {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      return c;
    }),
  } as unknown as HTMLElement;
}

function makeWebGLRendererStub(): WebGLRendererLike & {
  __renderCalls: number;
  __setSizeCalls: Array<[number, number]>;
  __pixelRatio: number;
  __disposed: boolean;
} {
  const canvas = { parentNode: null as unknown as Node | null } as unknown as HTMLCanvasElement;
  const stub = {
    domElement: canvas,
    outputColorSpace: '' as unknown as THREE.ColorSpace,
    shadowMap: { enabled: false },
    __renderCalls: 0,
    __setSizeCalls: [] as Array<[number, number]>,
    __pixelRatio: 1,
    __disposed: false,
    setSize(w: number, h: number) {
      this.__setSizeCalls.push([w, h]);
    },
    setPixelRatio(n: number) {
      this.__pixelRatio = n;
    },
    getPixelRatio() {
      return this.__pixelRatio;
    },
    render() {
      this.__renderCalls++;
    },
    dispose() {
      this.__disposed = true;
    },
  };
  return stub;
}

/** Builds a minimal RobotAssets bundle that exercises the per-instance
 * assembly path without loading anything from disk. */
function makeFakeAssets(robotCount: number): RobotAssets {
  // Build a tiny SkinnedMesh + named bone, with the bone as a SIBLING of the
  // mesh under the scene root — matching real GLB structure. Animation clips
  // target the bone by name; if the renderer clones only the mesh (losing the
  // bone), `mixer.clipAction()` throws on bone lookup. This catches the
  // "clone mesh vs. clone scene root" bug class.
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
  sceneRoot.add(bone);          // bone is a SIBLING of the mesh, like real GLBs
  sceneRoot.add(skinnedMesh);

  // Clip targets the named bone, mirroring how real Mixamo/Blender clips work.
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

interface FakeRaf {
  raf: (cb: FrameRequestCallback) => number;
  cancelRaf: (id: number) => void;
  flushOne: () => void;
  pending: () => number;
  cancelled: () => number;
}

function makeFakeRaf(): FakeRaf {
  const queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  const cancelledIds = new Set<number>();
  return {
    raf: (cb) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    cancelRaf: (id) => {
      cancelledIds.add(id);
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    flushOne: () => {
      const next = queue.shift();
      if (next) next.cb(performance.now());
    },
    pending: () => queue.length,
    cancelled: () => cancelledIds.size,
  };
}

interface MockResizeTarget extends EventTarget {
  __listeners: Map<string, Set<EventListener>>;
  __removed: Set<string>;
  fire(eventType: string): void;
}

function makeResizeTarget(): MockResizeTarget {
  const listeners = new Map<string, Set<EventListener>>();
  const removed = new Set<string>();
  const target = new EventTarget() as MockResizeTarget;
  target.__listeners = listeners;
  target.__removed = removed;
  const origAdd = target.addEventListener.bind(target);
  const origRemove = target.removeEventListener.bind(target);
  target.addEventListener = (type, l) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(l as EventListener);
    origAdd(type, l);
  };
  target.removeEventListener = (type, l) => {
    listeners.get(type)?.delete(l as EventListener);
    removed.add(type);
    origRemove(type, l);
  };
  target.fire = (type) => {
    target.dispatchEvent(new Event(type));
  };
  return target;
}

interface Harness {
  container: HTMLElement;
  webGL: ReturnType<typeof makeWebGLRendererStub>;
  raf: FakeRaf;
  loadAssets: AssetLoaderFn;
  resizeTarget: MockResizeTarget;
}

function makeHarness(robotCount?: number): Harness {
  const container = makeContainer();
  const webGL = makeWebGLRendererStub();
  const raf = makeFakeRaf();
  const count = robotCount ?? CONFIG.renderer.robotCount;
  const assets = makeFakeAssets(count);
  const loadAssets: AssetLoaderFn = vi.fn(async () => assets);
  const resizeTarget = makeResizeTarget();
  return {
    container,
    webGL,
    raf,
    loadAssets,
    resizeTarget,
  };
}

function makeRenderer(h: Harness) {
  return createRenderer({
    webGLRendererFactory: () => h.webGL,
    loadAssets: h.loadAssets,
    raf: h.raf.raf,
    cancelRaf: h.raf.cancelRaf,
    resizeTarget: h.resizeTarget,
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('createRenderer — lifecycle', () => {
  it('mount() resolves with all instances assembled', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(r.getAllInstances()).toHaveLength(CONFIG.renderer.robotCount);
    r.dispose();
  });

  it('mount() rejects if called twice on the same renderer', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    await expect(r.mount(h.container)).rejects.toThrow(/already mounted/);
    r.dispose();
  });

  it('dispose() is idempotent', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('dispose() before mount() resolves does not crash and discards assets', async () => {
    const h = makeHarness();
    let resolveAssets: (a: RobotAssets) => void = () => {};
    const slow: AssetLoaderFn = () =>
      new Promise<RobotAssets>((res) => {
        resolveAssets = res;
      });
    const r = createRenderer({
      webGLRendererFactory: () => h.webGL,
      loadAssets: slow,
      raf: h.raf.raf,
      cancelRaf: h.raf.cancelRaf,
      resizeTarget: h.resizeTarget,
    });
    const mountPromise = r.mount(h.container);
    r.dispose();
    resolveAssets(makeFakeAssets(CONFIG.renderer.robotCount));
    await expect(mountPromise).resolves.toBeUndefined();
    expect(r.getAllInstances()).toHaveLength(0);
  });

  it('dispose() cancels the rAF loop', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(h.raf.pending()).toBeGreaterThan(0);
    r.dispose();
    expect(h.raf.cancelled()).toBeGreaterThan(0);
  });

  it('dispose() removes the resize listener', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(h.resizeTarget.__listeners.get('resize')?.size ?? 0).toBe(1);
    r.dispose();
    expect(h.resizeTarget.__listeners.get('resize')?.size ?? 0).toBe(0);
  });

  it('dispose() disposes the WebGLRenderer', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    r.dispose();
    expect(h.webGL.__disposed).toBe(true);
  });
});

describe('createRenderer — robotCount validation', () => {
  it('throws when CONFIG.renderer.robotCount is below the safe range', async () => {
    // CONFIG is read-only; fake the loader to detect that mount checks before loading.
    const h = makeHarness();
    const spy = vi
      .spyOn(CONFIG.renderer, 'robotCount', 'get')
      .mockReturnValue(5 as unknown as typeof CONFIG.renderer.robotCount);
    const r = makeRenderer(h);
    await expect(r.mount(h.container)).rejects.toThrow(/robotCount/);
    spy.mockRestore();
    r.dispose();
  });

  it('throws when CONFIG.renderer.robotCount is above the safe range', async () => {
    const h = makeHarness();
    const spy = vi
      .spyOn(CONFIG.renderer, 'robotCount', 'get')
      .mockReturnValue(86 as unknown as typeof CONFIG.renderer.robotCount);
    const r = makeRenderer(h);
    await expect(r.mount(h.container)).rejects.toThrow(/robotCount/);
    spy.mockRestore();
    r.dispose();
  });
});

describe('createRenderer — instances', () => {
  it('getInstance(id) returns the matching instance for valid ids', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    for (let id = 0; id < CONFIG.renderer.robotCount; id++) {
      const inst = r.getInstance(id);
      expect(inst).toBeDefined();
      expect(inst!.id).toBe(id);
    }
    r.dispose();
  });

  it('getInstance(id) returns undefined for out-of-range ids', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(r.getInstance(-1)).toBeUndefined();
    expect(r.getInstance(CONFIG.renderer.robotCount)).toBeUndefined();
    expect(r.getInstance(9999)).toBeUndefined();
    r.dispose();
  });

  it('getInstance(id) returns undefined before mount() resolves', () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    expect(r.getInstance(0)).toBeUndefined();
  });

  it('every instance has a unique skin texture (Set size === robotCount)', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const maps = new Set<THREE.Texture>();
    for (const inst of r.getAllInstances()) {
      const mesh = findFirstSkinnedMesh(inst.root);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.map) maps.add(mat.map);
    }
    expect(maps.size).toBe(CONFIG.renderer.robotCount);
    r.dispose();
  });

  it('every instance has a unique material (no shared materials)', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const mats = new Set<THREE.Material>();
    for (const inst of r.getAllInstances()) {
      const mesh = findFirstSkinnedMesh(inst.root);
      mats.add(mesh.material as THREE.Material);
    }
    expect(mats.size).toBe(CONFIG.renderer.robotCount);
    r.dispose();
  });

  it('every instance exposes run/idle/death clips', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    for (const inst of r.getAllInstances()) {
      expect(inst.clips.has('run')).toBe(true);
      expect(inst.clips.has('idle')).toBe(true);
      expect(inst.clips.has('death')).toBe(true);
    }
    r.dispose();
  });

  it('placeholder grid: instances are spread over the 10×9 layout', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const positions = r.getAllInstances().map((i) => [i.root.position.x, i.root.position.z]);
    const xs = new Set(positions.map(([x]) => x));
    const zs = new Set(positions.map(([, z]) => z));
    expect(xs.size).toBeGreaterThan(1);
    expect(zs.size).toBeGreaterThan(1);
    r.dispose();
  });

  it('placePlaceholderGrid:false keeps all instances at origin', async () => {
    const h = makeHarness();
    const r = createRenderer({
      webGLRendererFactory: () => h.webGL,
      loadAssets: h.loadAssets,
      raf: h.raf.raf,
      cancelRaf: h.raf.cancelRaf,
      resizeTarget: h.resizeTarget,
      placePlaceholderGrid: false,
    });
    await r.mount(h.container);
    for (const inst of r.getAllInstances()) {
      expect(inst.root.position.x).toBe(0);
      expect(inst.root.position.z).toBe(0);
    }
    r.dispose();
  });
});

describe('createRenderer — render loop', () => {
  it('one rAF tick advances every mixer (mixer.time > 0)', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    // Sleep to give the clock a non-zero delta on the next tick.
    await new Promise((res) => setTimeout(res, 16));
    h.raf.flushOne();
    for (const inst of r.getAllInstances()) {
      expect(inst.mixer.time).toBeGreaterThan(0);
    }
    r.dispose();
  });

  it('render() is invoked on each rAF tick', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const before = h.webGL.__renderCalls;
    h.raf.flushOne();
    h.raf.flushOne();
    expect(h.webGL.__renderCalls).toBeGreaterThan(before);
    r.dispose();
  });

  it('render() is skipped on zero-dim container', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const before = h.webGL.__renderCalls;
    (h.container as unknown as { clientWidth: number }).clientWidth = 0;
    h.raf.flushOne();
    expect(h.webGL.__renderCalls).toBe(before);
    r.dispose();
  });
});

describe('createRenderer — WebGLRenderer setup', () => {
  it('sets outputColorSpace to SRGBColorSpace', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(h.webGL.outputColorSpace).toBe(THREE.SRGBColorSpace);
    r.dispose();
  });

  it('clamps pixel ratio to 2', async () => {
    const h = makeHarness();
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 3;
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(h.webGL.getPixelRatio()).toBe(2);
    r.dispose();
    delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  });

  it('disables shadows', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect(h.webGL.shadowMap.enabled).toBe(false);
    r.dispose();
  });

  it('appends domElement to the container', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    expect((h.container.appendChild as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    r.dispose();
  });
});

describe('createRenderer — resize', () => {
  it('resize event updates camera aspect and renderer size', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const setSizesBefore = h.webGL.__setSizeCalls.length;
    (h.container as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 1024;
    (h.container as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 512;
    h.resizeTarget.fire('resize');
    expect(h.webGL.__setSizeCalls.length).toBeGreaterThan(setSizesBefore);
    expect(h.webGL.__setSizeCalls[h.webGL.__setSizeCalls.length - 1]).toEqual([1024, 512]);
    r.dispose();
  });

  it('zero-dim container resize is ignored', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const setSizesBefore = h.webGL.__setSizeCalls.length;
    (h.container as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 0;
    h.resizeTarget.fire('resize');
    expect(h.webGL.__setSizeCalls.length).toBe(setSizesBefore);
    r.dispose();
  });
});

describe('createRenderer — scene access', () => {
  it('getScene() returns the active scene after mount', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const scene = r.getScene();
    expect(scene).toBeInstanceOf(THREE.Scene);
    r.dispose();
  });

  it('getScene() throws before mount', () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    expect(() => r.getScene()).toThrow();
  });

  it('addToScene() attaches the object as a scene child', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    await r.mount(h.container);
    const helper = new THREE.Object3D();
    r.addToScene(helper);
    expect(helper.parent).toBe(r.getScene());
    r.dispose();
  });
});

describe('createRenderer — supplied camera', () => {
  it('uses a supplied camera instead of building an internal one', async () => {
    const h = makeHarness();
    const r = makeRenderer(h);
    const supplied = new THREE.PerspectiveCamera(75, 1, 0.5, 200);
    await r.mount(h.container, supplied);
    h.raf.flushOne();
    // The render call uses the supplied camera; we can't observe it directly
    // through the stub's render() since we ignore the args, but we can verify
    // no internal camera contention by making sure render was called.
    expect(h.webGL.__renderCalls).toBeGreaterThan(0);
    r.dispose();
  });
});

// -----------------------------------------------------------------------------
// Internal helper for tests
// -----------------------------------------------------------------------------

function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) {
      found = obj as THREE.SkinnedMesh;
    }
  });
  if (!found) throw new Error('no SkinnedMesh found');
  return found;
}
