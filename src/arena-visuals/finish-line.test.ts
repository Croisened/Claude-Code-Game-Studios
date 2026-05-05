import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFinishLine } from '@/arena-visuals/finish-line';
import type { Arena } from '@/sim/arena';

function makeArena(overrides?: Partial<Arena>): Arena {
  return Object.freeze({
    id: 'test-arena',
    type: 'sprint-race' as const,
    length: 240,
    width: 40,
    startGrid: Object.freeze({
      lanes: 17,
      rows: 5,
      laneSpacing: 2.0,
      rowSpacing: 6.0,
    }),
    gates: Object.freeze([
      Object.freeze({ name: 'gate_a', x: 80, cullToCount: 28 }),
      Object.freeze({ name: 'gate_b', x: 160, cullToCount: 10 }),
      Object.freeze({ name: 'finish', x: 240, cullToCount: 1 }),
    ]),
    ...overrides,
  }) as Arena;
}

function stubTexture(): THREE.Texture {
  // Empty data texture — avoids any DOM/canvas dependency in Node tests.
  return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
}

describe('createFinishLine', () => {
  it('positions the mesh just past the final gate.x (near edge at gate)', () => {
    const arena = makeArena();
    const mesh = createFinishLine(arena, { textureFactory: stubTexture });
    const params = (mesh.geometry as THREE.PlaneGeometry).parameters;
    // Strip is centered at gate.x + thickness/2 so its near edge sits
    // exactly at the gate (and at the bridge xEnd in gauntlet arenas).
    expect(mesh.position.x).toBeCloseTo(240 + params.width / 2, 6);
    expect(mesh.position.z).toBe(0);   // centered on track centerline
    expect(mesh.position.y).toBeGreaterThan(0); // raised slightly off floor
    expect(mesh.position.y).toBeLessThan(0.1);  // but only by a hair
  });

  it('lays flat on the XZ plane (rotation.x = -π/2)', () => {
    const arena = makeArena();
    const mesh = createFinishLine(arena, { textureFactory: stubTexture });
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('plane height (post-rotation: world Z extent) equals arena.width', () => {
    // PlaneGeometry(width, height) — height becomes the world Z extent
    // after lay-flat rotation. Must span the full track width.
    const arena = makeArena({ width: 40 } as Partial<Arena>);
    const mesh = createFinishLine(arena, { textureFactory: stubTexture });
    const params = (mesh.geometry as THREE.PlaneGeometry).parameters;
    expect(params.height).toBe(40);
    // Width is the strip thickness — chunky band, not a hairline.
    expect(params.width).toBeGreaterThan(1);
    expect(params.width).toBeLessThan(10);
  });

  it('uses the supplied texture (verifies the textureFactory seam)', () => {
    const arena = makeArena();
    const tex = stubTexture();
    const mesh = createFinishLine(arena, { textureFactory: () => tex });
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBe(tex);
  });

  it('uses arena.length as the finish when there are no gates (gauntlet)', () => {
    const arena = Object.freeze({
      ...makeArena(),
      length: 200,
      gates: Object.freeze([]),
    }) as Arena;
    const mesh = createFinishLine(arena, { textureFactory: stubTexture });
    const params = (mesh.geometry as THREE.PlaneGeometry).parameters;
    expect(mesh.position.x).toBeCloseTo(200 + params.width / 2, 6);
  });

  it('throws when there are no gates AND arena.length <= 0', () => {
    const arena = Object.freeze({
      ...makeArena(),
      length: 0,
      gates: Object.freeze([]),
    }) as Arena;
    expect(() => createFinishLine(arena, { textureFactory: stubTexture })).toThrow(
      /no gates and length/,
    );
  });

  it('uses the LAST gate as the finish, not gate_a', () => {
    // Sanity: putting a non-finish gate first must not place the marker
    // on it.
    const arena = makeArena();
    const mesh = createFinishLine(arena, { textureFactory: stubTexture });
    const params = (mesh.geometry as THREE.PlaneGeometry).parameters;
    const lastGate = arena.gates[arena.gates.length - 1];
    expect(mesh.position.x).toBeCloseTo(lastGate.x + params.width / 2, 6);
  });
});
