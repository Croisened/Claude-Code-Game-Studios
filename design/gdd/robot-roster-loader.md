# Robot Roster Loader — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S5-02
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The Robot Roster Loader is the boundary that converts the build artifact
`public/traits.json` (produced by the S4-03 CSV→JSON pipeline) into the
in-memory `RobotRoster` shape the sim and renderer consume. It is the single
place in the codebase where snake-case JSON field names become camelCase
TypeScript identifiers, where trait stats are pre-derived via `deriveStats`
(S5-01), and where per-robot skin texture paths are resolved against
`CONFIG.renderer.skinTexturePathPattern`.

The loader is asynchronous (the underlying source is a network or filesystem
read) and IO-injectable: production code in the browser reads through `fetch`;
the headless sim harness (S5-06) reads from disk in Node. Both call paths
converge on the same `RobotRoster` shape.

The exported API is one function:

```ts
loadRoster(opts?: LoadRosterOptions): Promise<RobotRoster>
```

`LoadRosterOptions` exposes the IO seam (`traitsSource: () => Promise<unknown>`)
for tests and for the Node-side harness; defaults to `fetch` against
`CONFIG.build.traitsJsonPath`. `RobotRoster` is a frozen, id-sorted array of
85 entries — one per NFT — each carrying its raw traits, derived stats, and
resolved skin texture path. The function performs *integrity* validation
(count, ID coverage, field presence) but does not re-validate business rules
(sum ≤ 100); those are the build script's contract.

---

## 2. Player Fantasy

The Robot Roster Loader has no direct player-facing surface — viewers never
see a "loading roster…" spinner long enough to register, and the shape it
produces is plumbing for the sim and renderer. Its contribution to the player
fantasy is therefore *negative*: the absence of failure modes that would
otherwise leak into the watch experience.

The fantasy at stake is **"every NFT in the collection is on the field."**
When a viewer brings up Robo Rhapsody and the field draws, they should be
able to count to 85 and find any specific robot by ID. If the loader silently
dropped a robot, mismatched a skin, or paired Rhapsody Z's name with AACK
PAACK 1's traits, the viewer's mental model ("this is *my* robot, racing
right now") collapses.

The loader's job is to make the in-memory roster a perfect, exhaustive mirror
of the trait CSV: same count, same IDs, same names, same textures, same trait
values — every time, in the same order. It is deliberately **boring**. Any
cleverness here (sorting, filtering, mapping IDs) is a vector for the kind of
bug a viewer can actually see on screen, so the loader is written to be the
dullest module in the codebase that still does its job.

---

## 3. Detailed Rules

**R1. Single entry point.** The module exports exactly one function,
`loadRoster`. Two types — `RobotRosterEntry` and `RobotRoster` — and one
options interface, `LoadRosterOptions`. No class, no factory, no module-level
singleton.

**R2. Async by contract.** `loadRoster` returns a `Promise<RobotRoster>`.
Callers must `await` the result; there is no synchronous accessor. The
returned promise resolves once and is then garbage-collectable; the loader
does not cache.

**R3. IO seam.** `LoadRosterOptions.traitsSource: () => Promise<unknown>` is
the sole IO entry point. Default behavior (`opts` omitted, browser):
`fetch(CONFIG.build.traitsJsonPath).then(r => r.json())`. Tests and the
Node-side sim harness pass an explicit `traitsSource` returning a parsed
object — typically a fixture array or `JSON.parse(readFileSync(...))`.

**R4. Fetch-shape contract.** `traitsSource` resolves to **`unknown`** — the
loader does the type-narrowing. A successful resolve does not imply the data
is valid; the loader inspects every record. A rejected promise propagates
with a wrapped error (`new Error('Failed to load roster: …', { cause })`).

**R5. Source field naming is snake_case.** The JSON contract from S4-03 uses
`full_send`, `degen`, `cipher`, `doubter`, `altruist`, `id`, `name`. The
loader maps these to the `RobotTraits` shape (camelCase) at the single
boundary. No other module in `src/` reads the snake_case shape.

**R6. Output is frozen and id-sorted.** The returned `RobotRoster` is the
result of `Object.freeze(entries)` after `entries.sort((a, b) => a.id - b.id)`.
Sort order is part of the contract: `roster[0].id === 0`,
`roster[i].id === i`. Any consumer indexing by ID can use the array index
directly — see Renderer Asset Loader, which already assumes
`texture[i] corresponds to robot id i`.

**R7. Pre-derived stats.** Each entry's `stats` field is the result of
`deriveStats(entry.traits)`, computed at load time. The sim engine never
re-derives. If `CONFIG.sim.traitToStat` is mutated after `loadRoster`
resolves (test scenarios only), in-flight rosters carry the *old* stats —
consumers wanting refreshed coefficients must reload. This is a feature, not
a bug: it locks the trait→stat snapshot for the lifetime of the roster.

**R8. Skin path resolution.** `entry.skinTexturePath` is
`CONFIG.renderer.skinTexturePathPattern.replace('{id}', String(entry.id))`.
The loader does **not** load the texture bytes — that is the renderer
asset-loader's job (S4-04). Path resolution uses string substitution only; no
URL encoding, no path normalization, no existence check.

**R9. Integrity validation, not business validation.** The loader verifies
the data is *structurally* sound and ID-complete:

- `data` is an array.
- `data.length === EXPECTED_ROBOT_COUNT`. `EXPECTED_ROBOT_COUNT` is a
  module-scope constant `85`, bound to the CSV / NFT collection size on
  disk. It is intentionally **not** sourced from `CONFIG.renderer.robotCount`
  (which is a render-side performance fallback ∈ [10, 85]); the loader's job
  is to ingest the full roster regardless of how many robots the renderer
  ultimately draws.
- Every record has all seven required fields with the expected types
  (`id: number`, `name: string`, five trait fields all finite numbers).
- The set of `id` values is exactly `{0, 1, …, 84}` — no gaps, no duplicates,
  no out-of-range values.

Any failure throws synchronously inside the promise chain with a message
identifying the offending record. The loader does **not** check trait sum
≤ 100, trait ranges `[0, 100]`, or trait integrality — those are S4-03's
contract; if the build script's invariants are broken, the whole pipeline
is wrong and the bug belongs upstream.

**R10. Determinism.** Same `traitsSource` resolution, same `CONFIG`, same
output — byte-for-byte. Two `loadRoster` calls with the same input must
produce arrays whose `JSON.stringify` outputs are identical. The loader does
no random and no time-dependent work.

**R11. No `Math.random`, no `Date.now`.** Forbidden by the same sprint-wide
rule that applies to the rest of `src/sim/` per `technical-preferences.md`.

---

## 4. Data Shape / Schema

*(The required §4 heading is "Formulas"; for systems without gameplay math
this is repurposed to the type-shape contract, mirroring the pattern set by
`config-module.md`.)*

**Input shape (JSON, snake_case, S4-03 contract):**

```jsonc
[
  {
    "id": 0,
    "name": "Rhapsody Z",
    "full_send": 90,
    "degen": 5,
    "cipher": 2,
    "doubter": 1,
    "altruist": 2
  }
  // … 84 more
]
```

Defined by `tools/build/traits-csv-to-json.ts`. Order in the file is the CSV
order (id-ascending in v1, but the loader does not rely on this — it sorts).

**Public types (camelCase, exported from `src/sim/robot-roster.ts`):**

```ts
import type { RobotTraits, SimStats } from '@/sim/trait-to-stat';

export interface RobotRosterEntry {
  readonly id: number;            // 0..84
  readonly name: string;
  readonly traits: RobotTraits;   // camelCase, from snake_case JSON
  readonly stats: SimStats;       // pre-derived via deriveStats()
  readonly skinTexturePath: string; // CONFIG pattern with {id} substituted
}

export type RobotRoster = readonly RobotRosterEntry[];

export interface LoadRosterOptions {
  /**
   * Returns the parsed JSON payload. Default: fetches
   * CONFIG.build.traitsJsonPath via `fetch` and `.json()`.
   * Override in Node tests / sim harness.
   */
  readonly traitsSource?: () => Promise<unknown>;
}

export function loadRoster(opts?: LoadRosterOptions): Promise<RobotRoster>;
```

**Field-mapping table:**

| JSON (snake) | Entry (camel)       | Type     | Notes |
|--------------|---------------------|----------|-------|
| `id`         | `id`                | `number` | required ∈ {0..84} |
| `name`       | `name`              | `string` | required, non-empty |
| `full_send`  | `traits.fullSend`   | `number` | finite |
| `degen`      | `traits.degen`      | `number` | finite |
| `cipher`     | `traits.cipher`     | `number` | finite |
| `doubter`    | `traits.doubter`    | `number` | finite |
| `altruist`   | `traits.altruist`   | `number` | finite |
| *(derived)*  | `stats`             | `SimStats` | `deriveStats(traits)` |
| *(derived)*  | `skinTexturePath`   | `string` | pattern.replace('{id}', String(id)) |

**Sample worked entry — Rhapsody Z (id 0):**

```ts
{
  id: 0,
  name: 'Rhapsody Z',
  traits: { fullSend: 90, degen: 5, cipher: 2, doubter: 1, altruist: 2 },
  stats: {
    speed: 1.22,
    acceleration: 1.297,
    handling: 0.33,
    pathfinding: 0.314,
    caution: 0.01,
    chaos: 0.05,
    grace: 0.02,
  },
  skinTexturePath: 'assets/art/characters/robot/skins/0.png',
}
```

**Constants used by the loader (module-scope, not config):**

```ts
const EXPECTED_ROBOT_COUNT = 85; // Bound to the CSV / NFT collection size on
                                  // disk. NOT sourced from
                                  // CONFIG.renderer.robotCount (a render-side
                                  // perf fallback). The loader always ingests
                                  // the full roster.
const REQUIRED_FIELDS = ['id', 'name', 'full_send', 'degen', 'cipher',
                         'doubter', 'altruist'] as const;
```

---

## 5. Edge Cases

**E1. `traitsSource` rejects.** The IO layer fails (404, network error,
file-not-found in Node). The loader's promise rejects with
`new Error('Failed to load roster: <message>', { cause })`. The original
error is preserved on `cause` so the harness / browser console can surface
the underlying problem. No retry inside the loader — the caller decides
whether to retry.

**E2. `traitsSource` resolves to non-array.** The payload is an object, a
string, `null`, etc. Throws `new Error('Roster JSON must be an array, got
<typeof>')`. Same shape as the build script's error vocabulary so failures
across the pipeline read consistently.

**E3. Wrong row count.** `data.length !== 85`. Throws
`new Error('Roster must have 85 entries, got <n>')`. This is the most likely
"you forgot to run the build" failure mode: a stale `traits.json` from a
prior CSV revision will trip this. The error message intentionally states
the expected count so a human reading the console knows where to look.

**E4. Missing required field.** A record is missing one of the seven
fields. Throws `new Error('Roster entry at index <i> (id=<id>) missing
required field <field>')`. `id` is included when available so the human
can find the offending row in the CSV.

**E5. Non-numeric trait or id.** A field that should be `number` is a
string, `null`, `NaN`, `Infinity`, or `undefined`. Treat as missing (E4)
and throw with the same pattern. `Number.isFinite()` is the gate. Note: the
build script already does numeric coercion, so this case primarily catches
*manual* edits to `public/traits.json` outside the build pipeline.

**E6. Non-string name.** `name` is not a string, or is the empty string.
Throws with E4 vocabulary. Names appear in robot-profile UI; empty /
non-string names would surface as visible UI bugs and are worth catching
early.

**E7. Duplicate id.** Two records share an id. Throws
`new Error('Roster has duplicate id <id> (at indices <i>, <j>)')`. Build
script already enforces uniqueness; this case primarily catches manual JSON
corruption.

**E8. ID gap or out-of-range.** The set of ids is not exactly `{0..84}`.
Throws `new Error('Roster ids must be {0..84}, got missing: <list>,
unexpected: <list>')`. Reports both sides of the diff so the developer sees
what to fix.

**E9. Extra fields in record.** A record has fields beyond the seven
required (e.g., the build script later adds `nft_address`). The loader
**ignores** them — does not throw, does not propagate. Forward-compat for
build artifact evolution; today's fields are a subset, not a superset.

**E10. Concurrent calls.** Two `loadRoster()` calls in flight
simultaneously. Both succeed independently with deep-equal results. The
loader has no module-level state, so there is no race.

**E11. Mutation of returned roster.** The roster is `Object.freeze`d at top
level. Each entry is also `Object.freeze`d. Attempting to write a property
throws in strict mode (which is the project default). Nested objects
(`traits`, `stats`) are also frozen.

**E12. CONFIG mutation between load and read.** If a test mutates
`CONFIG.sim.traitToStat` after `loadRoster` resolves, entries' `stats`
remain at the values computed at load time (R7). To reflect the new
coefficients, callers must `loadRoster()` again.

---

## 6. Dependencies

**Upstream (this system reads from):**

- **Build / Deploy Pipeline (`design/gdd/build-deploy-pipeline.md`, S4-03)** —
  produces `public/traits.json` from the canonical CSV. The loader trusts the
  build script's invariants (85 rows, sum ≤ 100, integer traits) and only
  re-checks integrity (count + ID coverage + field presence). If the build
  script's contract changes, the loader's `REQUIRED_FIELDS` list and
  JSON-shape narrowing must move with it.
- **Config Module (`design/gdd/config-module.md`, S4-01)** — reads
  `CONFIG.build.traitsJsonPath` (default `traitsSource` URL) and
  `CONFIG.renderer.skinTexturePathPattern` (skin path resolution).
- **Trait → Stat Derivation (`design/gdd/trait-to-stat-derivation.md`,
  S5-01)** — calls `deriveStats(traits)` once per entry at load time. Stats
  are baked into the roster.

**Downstream (this system is read by):**

- **Sim Engine Core (S5-04)** — reads the roster as the canonical robot set
  for an event. Iterates by index `0..84` for stable ordering. Reads
  `entry.stats` per tick; never re-derives.
- **Sprint Race Event Module (S5-05)** — receives the roster from the Sim
  Engine; reads name + stats for AI decisions and elimination bookkeeping.
- **85-Instance Skinned Mesh Renderer (S4-04)** — currently consumes skin
  texture paths via its own `asset-loader` `RobotAssetPaths` structure
  (Sprint 4 design predates the loader). Sprint 6 will reconcile: the
  renderer's per-id texture array becomes
  `roster.map(e => e.skinTexturePath)`, removing the duplicated path pattern
  in the renderer call site. Until then, both compute the same paths from
  the same CONFIG knob — consistent but redundant.
- **Headless sim harness (S5-06)** — passes a Node-side `traitsSource` that
  reads `public/traits.json` from disk via `node:fs`.

**Sibling (peer-level):**

- **Seedable PRNG** — orthogonal. Roster construction is deterministic
  without randomness; the PRNG is a sim-tick concern.

**Reverse-link audit (per `.claude/rules/design-docs.md` bidirectionality
rule):**

The following GDDs need a one-line "Used by" / dependency mention pointing to
Robot Roster Loader. Updates land alongside the implementation commit:

- `design/gdd/build-deploy-pipeline.md` — add a "Consumed by" row pointing to
  the loader as the canonical reader of `traits.json`.
- `design/gdd/config-module.md` — update the existing "Robot Roster Loader"
  row in §6 with the GDD link and S5-02 task ID.
- `design/gdd/trait-to-stat-derivation.md` — §6 already mentions the loader
  as the downstream consumer; bump status text from "S5-02" to a real link
  now that this GDD exists.
- `design/gdd/systems-index.md` — flip row 7 status to Approved with the GDD
  path; bump progress tracker to 7/13.
- `design/gdd/85-instance-renderer.md` — note that texture path derivation
  will eventually consolidate through the roster loader (forward-looking, no
  code change in S5-02).

S5-04, S5-05, S5-06 GDDs do not exist yet and will reference this one when
authored.

---

## 7. Tuning Knobs

The Robot Roster Loader has **no tuning knobs of its own**. It reads two
existing CONFIG values, neither newly introduced by S5-02:

| CONFIG path | Owner GDD | Effect on loader |
|-------------|-----------|------------------|
| `CONFIG.build.traitsJsonPath` | Build / Deploy Pipeline (S4-03) | URL passed to default `fetch` traitsSource. |
| `CONFIG.renderer.skinTexturePathPattern` | 85-Instance Renderer (S4-04) | Pattern used in `entry.skinTexturePath` resolution. `{id}` substitution only. |

Both knobs are owned by other systems. Their safe ranges, defaults, and
change procedures are documented in the owning GDD; the loader is a
consumer, not the source of truth.

**Module-scope constants (not knobs):**

- `EXPECTED_ROBOT_COUNT = 85` — bound to the on-disk asset / NFT collection
  size. Changing this requires a coordinated change to the trait CSV, the
  build script, and the skin texture set on disk; it is not a runtime tuning
  surface.
- `REQUIRED_FIELDS` — the seven JSON field names accepted by the loader.
  Changes require a coordinated update with
  `tools/build/traits-csv-to-json.ts` and the trait CSV header.

**Why no knobs?** The loader's job is fidelity: same input, same output, as
boring as possible (§2). A configurable loader is a knob that can be turned
the wrong way; the only tuning surfaces in the trait pipeline live in
`CONFIG.sim.traitToStat` (which the loader consumes via `deriveStats`) and
the CSV itself.

---

## 8. Acceptance Criteria

Each criterion is verifiable from a passing Vitest run, a `tsc --noEmit`, or
an inspection of the listed file.

**AC1. Type contract holds.** `RobotRosterEntry`, `RobotRoster`,
`LoadRosterOptions`, `loadRoster` are exported from
`src/sim/robot-roster.ts` with the shapes defined in §4. `tsc --noEmit`
succeeds with `"strict": true`.

**AC2. Single export.** Module exports exactly `loadRoster`,
`RobotRosterEntry`, `RobotRoster`, `LoadRosterOptions`. No default export,
no class, no factory. Verifiable by grepping the source.

**AC3. Happy path against real `public/traits.json`.** A test injects a
Node-side `traitsSource` that reads the actual `public/traits.json` from
disk and asserts: roster length is 85, ids `0..84` are all present in
ascending order, every entry has the seven required fields, every entry's
`traits` is camelCase, every entry's `stats` deep-equals
`deriveStats(entry.traits)`, and every entry's `skinTexturePath` matches
`CONFIG.renderer.skinTexturePathPattern` with the entry's id substituted.

**AC4. Rhapsody Z spot check.** A test asserts that the entry at
`roster[0]` matches the §4 worked example exactly: id 0, name "Rhapsody Z",
traits as listed, stats deep-equal to the §1-of-trait-to-stat-derivation
worked numbers, `skinTexturePath === 'assets/art/characters/robot/skins/0.png'`.

**AC5. Determinism.** Two `loadRoster` calls with the same `traitsSource`
produce arrays whose `JSON.stringify` outputs are identical (R10).

**AC6. Snake → camel mapping.** A test verifies the loader does not leak
snake_case fields into entries. `Object.keys(entry.traits)` is exactly
`['fullSend','degen','cipher','doubter','altruist']`. Catches a future
regression where someone "helpfully" passes the JSON record through
unchanged.

**AC7. Frozen output.** A test asserts `Object.isFrozen(roster)`,
`Object.isFrozen(roster[0])`, `Object.isFrozen(roster[0].traits)`,
`Object.isFrozen(roster[0].stats)`. Attempting to write a property throws
`TypeError` in strict mode.

**AC8. Wrong row count fails (E3).** A test injects a `traitsSource`
returning a 3-row array and asserts the promise rejects with an error
containing `"85"` and `"3"`.

**AC9. Missing field fails (E4).** A test injects a payload where entry
`id=42` lacks `cipher`, asserts the promise rejects with an error
containing `"42"` and `"cipher"`.

**AC10. Non-finite trait fails (E5).** A test injects `degen: NaN` on one
entry and asserts rejection with the same vocabulary as E4.

**AC11. Duplicate id fails (E7).** Two records share `id: 7`; assert
rejection with error containing `"7"`.

**AC12. ID gap fails (E8).** Test omits `id: 50` and uses `id: 100` instead;
assert rejection mentions both missing and unexpected sets.

**AC13. Non-array fails (E2).** `traitsSource` resolves to `{}`; assert
rejection with error containing `"array"`.

**AC14. `traitsSource` rejection propagates (E1).** `traitsSource` rejects
with a sentinel `Error('boom')`; assert the loader's rejection has `boom`
somewhere reachable (message or `.cause`).

**AC15. Extra fields ignored (E9).** Test payload has extra
`nft_address: '0x…'` on every record; loader resolves successfully and
entries do not contain the extra field.

**AC16. No `Math.random` invocation.** A `vi.spyOn(Math, 'random')` wraps a
successful load; spy is never called. Mirrors the S5-01 AC11 pattern.

**AC17. Concurrent loads succeed independently (E10).**
`Promise.all([loadRoster(opts), loadRoster(opts)])` resolves; both rosters
are deep-equal, neither is the same reference.

**AC18. Reverse-link audit complete.** Per §6, the listed GDDs reference
this one. Verifiable by grep.

**AC19. GDD review status.** This document's status header reads `Approved`
before the implementation commit lands.
