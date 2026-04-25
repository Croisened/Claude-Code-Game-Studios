import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  loadRobotAssets,
  type GltfLoaderLike,
  type TextureLoaderLike,
  type RobotAssetPaths,
} from '@/renderer/asset-loader';

const PATHS: RobotAssetPaths = {
  run: 'assets/art/characters/robot/robot_run.glb',
  idle: 'assets/art/characters/robot/robot_idle.glb',
  death: 'assets/art/characters/robot/robot_death.glb',
  skinPattern: 'assets/art/characters/robot/skins/{id}.png',
};

function makeFakeGltf(name: string): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const group = new THREE.Group();
  group.name = name;
  const clip = new THREE.AnimationClip(name, 1.0, []);
  return { scene: group, animations: [clip] };
}

function makeFakeTexture(): THREE.Texture {
  return new THREE.Texture();
}

function makeGltfLoader(
  resolveMap: Record<string, ReturnType<typeof makeFakeGltf>>,
  rejectMap: Record<string, Error> = {},
): GltfLoaderLike {
  return {
    load: (url, onLoad, _onProgress, onError) => {
      queueMicrotask(() => {
        if (rejectMap[url]) {
          onError?.(rejectMap[url]);
          return;
        }
        const gltf = resolveMap[url];
        if (!gltf) {
          onError?.(new Error(`unexpected url: ${url}`));
          return;
        }
        onLoad(gltf as never);
      });
    },
  };
}

function makeTextureLoader(failingIds: number[] = []): TextureLoaderLike {
  return {
    load: (url, onLoad, _onProgress, onError) => {
      queueMicrotask(() => {
        const match = url.match(/skins\/(\d+)\.png$/);
        const id = match ? Number(match[1]) : -1;
        if (failingIds.includes(id)) {
          onError?.(new Error(`failed: ${url}`));
          return;
        }
        onLoad(makeFakeTexture());
      });
    },
  };
}

function makeStandardLoaders(): { gltf: GltfLoaderLike; tex: TextureLoaderLike } {
  return {
    gltf: makeGltfLoader({
      [PATHS.run]: makeFakeGltf('run'),
      [PATHS.idle]: makeFakeGltf('idle'),
      [PATHS.death]: makeFakeGltf('death'),
    }),
    tex: makeTextureLoader(),
  };
}

describe('loadRobotAssets', () => {
  it('resolves with run/idle/death GLTFs and N textures', async () => {
    const { gltf, tex } = makeStandardLoaders();
    const assets = await loadRobotAssets({
      robotCount: 10,
      paths: PATHS,
      gltfLoader: gltf,
      textureLoader: tex,
    });

    expect(assets.runGltf.scene.name).toBe('run');
    expect(assets.idleGltf.scene.name).toBe('idle');
    expect(assets.deathGltf.scene.name).toBe('death');
    expect(assets.textures).toHaveLength(10);
    expect(assets.textures.every((t) => t instanceof THREE.Texture)).toBe(true);
  });

  it('loads exactly robotCount textures (id 0..robotCount-1)', async () => {
    const { gltf } = makeStandardLoaders();
    const requestedUrls: string[] = [];
    const tex: TextureLoaderLike = {
      load: (url, onLoad) => {
        requestedUrls.push(url);
        queueMicrotask(() => onLoad(makeFakeTexture()));
      },
    };

    await loadRobotAssets({
      robotCount: 10,
      paths: PATHS,
      gltfLoader: gltf,
      textureLoader: tex,
    });

    expect(requestedUrls).toHaveLength(10);
    for (let id = 0; id < 10; id++) {
      expect(requestedUrls).toContain(
        `assets/art/characters/robot/skins/${id}.png`,
      );
    }
  });

  it('rejects when a GLB fails to load', async () => {
    const gltf = makeGltfLoader(
      {
        [PATHS.run]: makeFakeGltf('run'),
        [PATHS.death]: makeFakeGltf('death'),
      },
      { [PATHS.idle]: new Error('idle 404') },
    );
    const tex = makeTextureLoader();

    await expect(
      loadRobotAssets({
        robotCount: 10,
        paths: PATHS,
        gltfLoader: gltf,
        textureLoader: tex,
      }),
    ).rejects.toThrow(/idle/);
  });

  it('rejects when a texture fails to load', async () => {
    const { gltf } = makeStandardLoaders();
    const tex = makeTextureLoader([3]);

    await expect(
      loadRobotAssets({
        robotCount: 10,
        paths: PATHS,
        gltfLoader: gltf,
        textureLoader: tex,
      }),
    ).rejects.toThrow(/3\.png/);
  });

  it('sets sRGB color space and flipY=false on each texture', async () => {
    const captured: THREE.Texture[] = [];
    const { gltf } = makeStandardLoaders();
    const tex: TextureLoaderLike = {
      load: (_url, onLoad) => {
        const t = makeFakeTexture();
        captured.push(t);
        queueMicrotask(() => onLoad(t));
      },
    };

    await loadRobotAssets({
      robotCount: 10,
      paths: PATHS,
      gltfLoader: gltf,
      textureLoader: tex,
    });

    for (const t of captured) {
      expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(t.flipY).toBe(false);
    }
  });

  it('throws for robotCount outside the 10..85 range', async () => {
    const { gltf, tex } = makeStandardLoaders();
    await expect(
      loadRobotAssets({
        robotCount: 9,
        paths: PATHS,
        gltfLoader: gltf,
        textureLoader: tex,
      }),
    ).rejects.toThrow(/robotCount/);
    await expect(
      loadRobotAssets({
        robotCount: 86,
        paths: PATHS,
        gltfLoader: gltf,
        textureLoader: tex,
      }),
    ).rejects.toThrow(/robotCount/);
  });

  it('loads all assets in parallel (does not serialize)', async () => {
    const order: string[] = [];
    const gltf: GltfLoaderLike = {
      load: (url, onLoad) => {
        order.push(`start:${url}`);
        queueMicrotask(() => {
          order.push(`end:${url}`);
          onLoad(makeFakeGltf(url) as never);
        });
      },
    };
    const tex: TextureLoaderLike = {
      load: (url, onLoad) => {
        order.push(`start:${url}`);
        queueMicrotask(() => {
          order.push(`end:${url}`);
          onLoad(makeFakeTexture());
        });
      },
    };

    await loadRobotAssets({
      robotCount: 10,
      paths: PATHS,
      gltfLoader: gltf,
      textureLoader: tex,
    });

    const starts = order.filter((s) => s.startsWith('start:')).length;
    const firstEndIndex = order.findIndex((s) => s.startsWith('end:'));
    // All 13 starts (3 GLBs + 10 textures) must occur before any end.
    expect(starts).toBe(13);
    expect(firstEndIndex).toBeGreaterThanOrEqual(starts);
  });
});
