# Three.js + enable3d — Version Reference

| Field | Value |
|-------|-------|
| **Three.js Version** | r168 (pinned minimum) |
| **enable3d Version** | 2.x |
| **Rapier Version** | bundled via enable3d (`@dimforge/rapier3d-compat`) |
| **Vite Version** | latest (build tool, unpinned) |
| **Project Pinned** | 2026-03-27 |
| **Last Docs Verified** | 2026-03-27 |
| **LLM Knowledge Cutoff** | ~August 2025 (Three.js r160–r165 range likely in training data) |

---

## Knowledge Gap Warning

The LLM's training data likely covers Three.js up to approximately r160–r165.
Three.js releases frequently (roughly monthly). Always verify API calls against
the actual installed version rather than relying on LLM memory.

**Verify before using**: Any Three.js API that may have changed post-r160,
especially in these frequently-updated areas:

| Area | Risk | Notes |
|------|------|-------|
| `WebGLRenderer` constructor options | LOW | Stable API; antialias, alpha params unchanged |
| `GLTFLoader` import path | MEDIUM | Import path changed in r150+; use `three/addons/` not `three/examples/` |
| `PerspectiveCamera` | LOW | Fully stable |
| Post-processing (EffectComposer) | MEDIUM | Moved to `three/addons/` |
| `PMREMGenerator` | LOW | Stable |
| Color management (`ColorManagement`) | MEDIUM | `sRGBEncoding` deprecated; use `outputColorSpace = SRGBColorSpace` |
| Shadow map types | LOW | Stable |
| Shader material | LOW | Stable |

---

## enable3d Knowledge Gap

enable3d is a niche wrapper library with limited LLM training coverage. Assume
any enable3d-specific API may have changed or may not be known to the LLM.

**Always verify**:
- `PhysicsLoader.init()` signature
- `ExtendedObject3D` rigid body attachment API
- `setNextKinematicTranslation()` / `setTranslation()` method names (Rapier API
  accessed through enable3d)
- Collision event subscription API

**Primary reference**: https://github.com/yandeu/enable3d

---

## Three.js r168 Key Facts

| Fact | Value |
|------|-------|
| WebGL2 | Default (WebGL1 fallback available) |
| GLB/GLTF loader | `GLTFLoader` from `three/addons/loaders/GLTFLoader.js` |
| Output color space | `renderer.outputColorSpace = THREE.SRGBColorSpace` |
| Shadow map | `renderer.shadowMap.enabled = true`, type `PCFSoftShadowMap` |
| Texture color space | `texture.colorSpace = THREE.SRGBColorSpace` for color maps |
| Animation | `AnimationMixer` + `AnimationClip` + `AnimationAction` |

---

## Rapier 3D Key Facts

Rapier is accessed through enable3d, not imported directly. The underlying package
is `@dimforge/rapier3d-compat` (WASM with JS fallback).

| Concept | Rapier Term | Notes |
|---------|-------------|-------|
| Physics body types | `RigidBodyType.Dynamic`, `KinematicPositionBased`, `Fixed` | Obstacles use KinematicPositionBased |
| Move kinematic body | `body.setNextKinematicTranslation(vector)` | Used for obstacles and robot lane snap |
| Set body position instantly | `body.setTranslation(vector, wakeUp)` | Used for robot restart snap |
| Collision groups | `ActiveCollisionTypes`, `CollisionGroups` | OBSTACLE_GROUP filter defined in Obstacle System GDD |
| Collision events | Subscribe via Rapier event queue or enable3d callback | See Obstacle System GDD for OBSTACLE_GROUP filter pattern |

---

## Import Patterns (Three.js r150+)

```typescript
// Core Three.js
import * as THREE from 'three';

// Addons (loaders, controls, etc.) — use 'three/addons/' not 'three/examples/'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// enable3d
import { enable3d, PhysicsLoader, Project, Scene3D, ExtendedObject3D } from 'enable3d';
```

---

## Verified Sources

- Three.js official docs: https://threejs.org/docs/
- Three.js GitHub (r168 tag): https://github.com/mrdoob/three.js/tree/r168
- Three.js migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
- enable3d GitHub: https://github.com/yandeu/enable3d
- enable3d docs: https://enable3d.io/
- Rapier 3D docs: https://rapier.rs/docs/
- `@dimforge/rapier3d-compat` npm: https://www.npmjs.com/package/@dimforge/rapier3d-compat
