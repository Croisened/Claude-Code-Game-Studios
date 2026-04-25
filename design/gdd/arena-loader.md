# Arena Loader + Sprint Arena JSON — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S5-03
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The Arena Loader converts a hand-authored JSON file at
`assets/data/arenas/arena-NN.json` into the in-memory `Arena` shape that the
Sim Engine (S5-04) and the Sprint Race Event Module (S5-05) consume. It
defines the v1 arena schema, ships the first arena (`arena-01.json` — a
sprint-race course), and provides a deterministic loader that validates the
file is structurally sound and physically plausible before handing it to
the sim.

Like the Robot Roster Loader, this is an IO-injectable async function.
Production code in the browser fetches the JSON over HTTP; the headless sim
harness (S5-06) reads from disk in Node. Both call paths converge on the
same `Arena` shape.

The exported API is one function:

```ts
loadArena(opts?: LoadArenaOptions): Promise<Arena>
```

`LoadArenaOptions` exposes the IO seam (`arenaSource: () => Promise<unknown>`);
defaults to `fetch` against `CONFIG.arena.defaultArenaPath`. `Arena` is a
frozen, validated record describing the course geometry (length, width),
the start grid layout (lanes × rows + spacing), and the gate sequence
(three gates: A, B, finish; each with an X coordinate and a cull threshold).

Filenames use sequential numbering (`arena-01`, `arena-02`, …); the event
type lives inside the file as a `type` field (`'sprint-race'`, future:
`'maze-run'`, `'gauntlet'`). This keeps filenames stable as content is
reordered or re-themed and avoids a taxonomy decision on the filesystem
layer.

The first arena (`arena-01.json`) is part of the deliverable, not a
separate concern. Per sprint-05.md risk row 5, **the first arena IS the
schema validator** — authoring it concurrently with the schema is how we
discover what fields are missing or over-engineered.

---

## 2. Player Fantasy

Arenas are the **places** where the fantasy happens. A roster is *who*
raced; an arena is *where they raced*. When a viewer says "I love watching
the wide turn at gate B," that gate is an arena fact: a position on a
course that someone with `cipher = 80` predictably handles better than
someone with `full_send = 80`. Without arenas, traits are abstract; with
arenas, traits *land* somewhere observable.

The fantasy at stake is **legibility of place**. Three gates is more
memorable than five. A gate at exactly 80 m is more memorable than a gate
"somewhere in the first third." Stage culls of 28 → 10 → 1 read as a story
(the field, the contenders, the winner) more cleanly than 30 → 12 → 3 → 1.
The arena schema favours hand-authored, opinionated, *named* geometry over
procedural variety; in v1 there is exactly one arena and the goal is to
make that arena feel **specific**.

The Arena Loader's job is to refuse to ship anything that wouldn't read
clearly: gates out of order, finish positioned before gate B, cull
thresholds that don't strictly decrease, a course shorter than the start
grid. These would all produce viewer-visible bugs (robots crossing the
finish before reaching gate A; fewer survivors after a gate cull than
before). The schema is dull on purpose. The arena file is the artistic
surface — and `arena-01.json` is the first place anyone gets to be
opinionated about layout.

---

## 3. Detailed Rules

**R1. Single entry point.** The module exports exactly one function,
`loadArena`. Two types — `Arena`, `Gate` — and supporting interfaces for
the start grid + load options. No class, no factory, no module singleton.

**R2. Async + IO seam.** `loadArena(opts?: LoadArenaOptions): Promise<Arena>`.
`LoadArenaOptions.arenaSource: () => Promise<unknown>` is the sole IO entry
point. Default: `fetch(CONFIG.arena.defaultArenaPath).then(r => r.json())`.
Tests and the Node-side harness pass an explicit `arenaSource`.

**R3. Coordinate system.** Right-handed Y-up. `+X` is the race direction
(forward); `+Z` is the lane axis (right of forward). All arena positions
are in **meters**. The start line is `x = 0`; the finish gate is at
`x = arena.length`. Lanes are positioned symmetrically around `z = 0`
(negative Z to one side, positive Z to the other) for any odd lane count,
or symmetrically straddling `z = 0` for even counts.

**R4. Output is frozen, by-value.** `Arena` is `Object.freeze`d at top
level; nested `gates`, `startGrid`, and individual `Gate` objects are also
frozen. Consumers cannot mutate.

**R5. JSON shape contract.** The arena file is a single object (not an
array). Required top-level fields: `id`, `type`, `length`, `width`,
`startGrid`, `gates`. No other top-level fields are recognized in v1;
extras are ignored (forward-compat, mirroring the roster loader's E9).

**R6. Sprint-race-only in v1.** `type` must be `'sprint-race'`. Other
event types (`'maze-run'`, `'gauntlet'`) are deferred to v1.1+. If a future
arena specifies a type the loader doesn't recognize, the loader rejects.

**R7. Gate ordering invariants.** `gates` is an array of length ≥ 2 (at
minimum: one mid-race gate + finish). Sprint-race v1 ships with exactly 3
gates (A, B, finish). The loader enforces:

- Gates are in **strictly ascending X order**.
- The first gate has `x > 0`.
- The last gate has `x === arena.length` (the finish line).
- Each `gate.cullToCount` is an integer ≥ 1.
- `cullToCount` values are **strictly decreasing** along the gate sequence
  (e.g., 28 → 10 → 1; never 28 → 28 → 1, never 28 → 35).
- The first gate's `cullToCount` is `< startGridCapacity` (the arena culls
  *somebody* at gate A) and `≥ 1`.

**R8. Start-grid invariants.** `startGrid = { lanes, rows, laneSpacing,
rowSpacing }`. Loader enforces:

- `lanes` and `rows` are integers ≥ 1.
- `lanes * rows >= 85` (the v1 roster size). Exact equality is the common
  case (17 × 5 = 85), but a larger grid is permitted to accommodate future
  roster growth without re-authoring arenas.
- `laneSpacing > 0` and `rowSpacing > 0`, both finite.
- `(lanes - 1) * laneSpacing < arena.width` (every lane fits inside the
  course width). Strict inequality so the outer lanes have at least a
  sliver of margin.
- Row 0 starts at `x = 0` and runs back along `-X` in `rowSpacing`
  increments; row `r` is at `x = -r * rowSpacing`. Rows are behind the
  start line, not in front. The first robot through `x = 0` has crossed
  the start line, not started in front of it.

**R9. Geometry sanity.** `arena.length > 0`, `arena.width > 0`, both
finite. `arena.length` is large enough to contain all gates (R7 already
implies this transitively).

**R10. Determinism.** Same `arenaSource` resolution → identical `Arena`
output, byte-for-byte. The loader does no random and no time-dependent
work.

**R11. No `Math.random`, no `Date.now`.** Forbidden by the sprint-wide
rule.

**R12. The loader is a *shape* validator.** It does not opine on
*quality* — a length-of-1m course with three near-overlapping gates would
pass validation. The schema's job is to refuse data that would crash the
sim or produce nonsensical viewer-visible output; taste is the arena
author's responsibility.

---

## 4. Data Shape / Schema

*(§4 is repurposed from "Formulas" to type-shape contract, mirroring
`config-module.md` and `robot-roster-loader.md`.)*

**Input shape (JSON, hand-authored):**

```jsonc
{
  "id": "arena-01",
  "type": "sprint-race",
  "length": 240,                 // meters along +X
  "width": 40,                   // meters along +Z
  "startGrid": {
    "lanes": 17,                 // count along Z
    "rows":  5,                  // count along -X (behind start line)
    "laneSpacing": 2.0,          // meters between lane centers
    "rowSpacing":  2.0           // meters between row centers
  },
  "gates": [
    { "name": "gate_a", "x":  80, "cullToCount": 28 },
    { "name": "gate_b", "x": 160, "cullToCount": 10 },
    { "name": "finish", "x": 240, "cullToCount":  1 }
  ]
}
```

**Public types (exported from `src/sim/arena.ts`):**

```ts
export type ArenaType = 'sprint-race';

export interface Gate {
  readonly name: string;
  readonly x: number;
  readonly cullToCount: number;
}

export interface StartGrid {
  readonly lanes: number;
  readonly rows: number;
  readonly laneSpacing: number;
  readonly rowSpacing: number;
}

export interface Arena {
  readonly id: string;
  readonly type: ArenaType;
  readonly length: number;
  readonly width: number;
  readonly startGrid: StartGrid;
  readonly gates: readonly Gate[];
}

export interface LoadArenaOptions {
  readonly arenaSource?: () => Promise<unknown>;
}

export function loadArena(opts?: LoadArenaOptions): Promise<Arena>;
```

**Derived helper (also exported):**

```ts
/**
 * World-space (x, z) for the start position of robot `id` on `arena`.
 * Order: row-major across lanes, packed back through rows.
 *   id 0  → lane 0, row 0
 *   id 1  → lane 1, row 0
 *   ...
 *   id 16 → lane 16, row 0
 *   id 17 → lane 0, row 1
 *   ...
 * Lanes are centered around z = 0; the leftmost lane is the most
 * negative Z, the rightmost the most positive.
 */
export function getStartPosition(
  arena: Arena,
  robotId: number,
): { x: number; z: number };
```

**Worked example: `arena-01.json` (the v1 sprint-race arena):**

```
length      = 240 m
width       =  40 m
lanes       =  17        (z covers −16.0 .. +16.0 with 2.0 spacing)
rows        =   5        (x covers   0.0 .. −8.0 with 2.0 spacing)
grid capacity = 85       (= roster count, exact match)
gate_a      = 80 m,  cullToCount = 28
gate_b      = 160 m, cullToCount = 10
finish      = 240 m, cullToCount =  1
```

Start position math: lane index `L = id % lanes`, row index
`R = floor(id / lanes)`. World coords:

```
z = (L − (lanes − 1) / 2) * laneSpacing
x = −R * rowSpacing
```

Robot id 0: `L=0, R=0` → `z = (0 − 8) * 2 = −16`, `x = 0`.
Robot id 8: `L=8, R=0` → `z = 0`, `x = 0` (the middle lane, front row).
Robot id 17: `L=0, R=1` → `z = −16`, `x = −2`.
Robot id 84: `L=16, R=4` → `z = +16`, `x = −8`.

**Module-scope constants:**

```ts
const SUPPORTED_ARENA_TYPES = ['sprint-race'] as const;
const REQUIRED_TOP_LEVEL_FIELDS = ['id', 'type', 'length', 'width',
                                   'startGrid', 'gates'] as const;
const REQUIRED_GATE_FIELDS = ['name', 'x', 'cullToCount'] as const;
const REQUIRED_START_GRID_FIELDS = ['lanes', 'rows', 'laneSpacing',
                                    'rowSpacing'] as const;
const MIN_GATE_COUNT = 2;          // at least one cull gate + finish
const MIN_ROSTER_COVERAGE = 85;    // grid must seat the full roster
```

---

## 5. Edge Cases

**E1. `arenaSource` rejects.** Mirrors roster loader E1: rejection wrapped
in `new Error('Failed to load arena: <msg>')` with the original error
attached on `.cause`. No retry inside the loader.

**E2. Payload not an object.** Array, string, `null`, primitive → throws
`Arena JSON must be an object, got <typeof>`.

**E3. Missing top-level field.** Throws `Arena missing required field
<field>` for the first missing field discovered. Loader short-circuits —
does not enumerate every missing field on a single throw.

**E4. Unsupported `type`.** `type: 'maze-run'` (or any value not in
`SUPPORTED_ARENA_TYPES`) → throws `Arena type '<value>' is not supported
in v1 (supported: [sprint-race])`. Documents what *is* available so the
developer doesn't have to grep.

**E5. Non-finite numeric field.** `length: NaN`, `width: Infinity`, any
gate `x: 'eighty'`, etc. → throws `Arena field <path> must be a finite
number, got <value>`.

**E6. Non-positive geometry.** `length <= 0` or `width <= 0` → throws
`Arena field <path> must be > 0, got <value>`. Zero is rejected
explicitly: a zero-length course has no race to run; a zero-width course
has no lanes.

**E7. Empty / too-short gate list.** `gates.length < 2` → throws
`Arena must have at least 2 gates (one cull + finish), got <n>`.

**E8. Gates not strictly ascending in X.** Two gates with equal X, or a
gate with smaller X than its predecessor → throws `Arena gates must be in
strictly ascending x order; gate '<name>' (x=<x>) at index <i> violates
this`. Names the offending gate so the author can find it.

**E9. Finish not at `length`.** Last gate `x !== length` → throws
`Arena last gate (finish) must be at x = length (<length>), got <x>`. The
arena explicitly identifies the finish line as "last gate of the
sequence"; misalignment between this and `length` creates ambiguity about
where the race ends.

**E10. First gate at or before start.** First gate `x <= 0` → throws
`Arena first gate must have x > 0, got <x>`. A gate at `x = 0` would be
triggered before the race starts.

**E11. Cull thresholds not strictly decreasing.** Any
`gates[i].cullToCount <= gates[i+1].cullToCount` → throws `Arena gate
cullToCount must strictly decrease; gate '<name>' (<count>) does not
exceed next gate '<next>' (<nextCount>)`.

**E12. Cull threshold non-positive or non-integer.** `cullToCount = 0`,
`cullToCount = -3`, `cullToCount = 1.5` → throws `Arena gate '<name>'
cullToCount must be a positive integer, got <value>`. A cull-to-zero
would empty the field; a fractional cull is meaningless.

**E13. First gate cull >= grid capacity.** First-gate
`cullToCount >= startGrid.lanes * startGrid.rows` → throws `Arena first
gate cullToCount (<count>) must be less than start grid capacity
(<capacity>); arena would cull no robots`. Catches "I forgot to actually
cull anyone at gate A."

**E14. Start grid too small.** `lanes * rows < 85` → throws `Arena start
grid capacity (<capacity>) must be at least 85 (the v1 roster size)`.

**E15. Start grid wider than course.** `(lanes - 1) * laneSpacing >=
width` → throws `Arena start grid (<gridWidth>m wide) does not fit in
arena width (<width>m)`. Catches the "too many lanes for a narrow track"
misauthor.

**E16. Non-integer lanes/rows.** `lanes: 17.5`, `rows: 0` → throws
`Arena startGrid.<field> must be a positive integer, got <value>`.

**E17. Non-positive spacing.** `laneSpacing <= 0` or `rowSpacing <= 0` →
throws `Arena startGrid.<field> must be > 0, got <value>`.

**E18. Extra top-level fields.** `theme: 'neon'`, `weather: 'rain'`, etc.
→ ignored (forward-compat, mirrors roster E9). The arena file is allowed
to evolve; today's required fields are a subset.

**E19. Empty `id` or `name`.** Empty-string `id`, or any gate's
`name === ''` → throws. IDs and names appear in logs/UI; empty strings
would surface as bugs.

**E20. Duplicate gate names.** Two gates share a `name` → throws `Arena
gate names must be unique; '<name>' appears at indices <i>, <j>`. Sim
consumers may key on name; duplicates would be ambiguous.

**E21. `getStartPosition` out-of-range.** Called with `robotId < 0`,
`robotId >= lanes * rows`, or non-integer → throws `getStartPosition:
robotId must be an integer in [0, <capacity>), got <id>`. Defensive
against caller bugs since this helper produces world-space positions
consumed by the renderer.

**E22. Concurrent loads.** Two `loadArena()` calls in flight → both
succeed independently; loader has no module-level state.

**E23. Mutation of returned arena.** All nested objects frozen; mutation
throws `TypeError` in strict mode.

---

## 6. Dependencies

**Upstream (this system reads from):**

- **Config Module (`config-module.md`, S4-01)** — reads
  `CONFIG.arena.defaultArenaPath` (the URL the default `arenaSource`
  fetches). S5-03 introduces this knob; the existing reserved
  `CONFIG.arena: {}` placeholder gets populated.

**Downstream (this system is read by):**

- **Sim Engine Core (S5-04)** — consumes `Arena` to know course bounds,
  gate positions for cull triggers, and the start grid layout. Calls
  `getStartPosition(arena, id)` once per robot at sim start to seed initial
  world positions.
- **Sprint Race Event Module (S5-05)** — reads `gates` to drive stage-cull
  bookkeeping; reads `length` to determine the finish condition. Names
  gates by `gate.name` for event-timeline output.
- **Headless sim harness (S5-06)** — passes a Node-side `arenaSource` that
  reads `assets/data/arenas/arena-01.json` from disk via `node:fs`.
- **Renderer (Sprint 6)** — consumes `length`, `width` to size the ground
  plane; consumes gate positions to draw gate markers if/when arena
  visualization is added. Renderer is decoupled in v1 (it does not import
  the loader) but the schema is the coordination point.

**Sibling (peer-level):**

- **Robot Roster Loader** — orthogonal. Both load JSON via the same IO
  pattern but neither calls the other. The Sim Engine composes them.
- **Seedable PRNG** — orthogonal. Arena loading is deterministic without
  randomness.

**Reverse-link audit (per `.claude/rules/design-docs.md` bidirectionality
rule):**

The following GDDs need a one-line "Used by" / dependency mention pointing
to Arena Loader. Updates land alongside the implementation commit:

- `design/gdd/config-module.md` — add `arena.defaultArenaPath` to the v1
  starter shape (replacing the empty `arena: {}` reserved subsystem);
  update §6 dependents row for Arena Loader with the GDD link and S5-03
  task ID.
- `design/gdd/systems-index.md` — flip row 8 status to Approved with the
  GDD path; bump progress tracker to 8/13.
- `design/gdd/game-concept.md` — link from §Event Types §Sprint Race to
  this GDD as the canonical implementation contract for the v1 sprint
  course shape.

S5-04, S5-05, S5-06 GDDs do not exist yet and will reference this one
when authored.

---

## 7. Tuning Knobs

The Arena Loader has **no runtime tuning knobs of its own** in the CONFIG
sense. The arena's data shape is the tuning surface; tuning happens by
editing `arena-NN.json`, not `CONFIG`.

One new CONFIG knob is introduced for IO routing only:

| CONFIG path | v1 value | Effect | Owner GDD |
|-------------|----------|--------|-----------|
| `CONFIG.arena.defaultArenaPath` | `'/assets/data/arenas/arena-01.json'` | URL passed to default `arenaSource`. Switching this lets a future "arena rotation" pick a different file without editing call sites. Range: any path resolvable by Vite's static asset serving. | This GDD |

**Per-arena tuning surface (`arena-NN.json`):**

| Field | Effect | Safe range / shape |
|-------|--------|---------------------|
| `length` | Total race distance (m). Longer course → more time for low-acceleration robots to catch up. | 50–500 m. Below 50 m feels rushed; above 500 m bloats playback. |
| `width` | Lane axis (m). Wider course → handling matters less because there's more room to overshoot a turn. | ≥ `(lanes − 1) * laneSpacing + 4 m` margin. |
| `startGrid.lanes` × `rows` | Capacity = `lanes * rows`; must seat ≥ 85. | 17 × 5 = 85 (exact match) for v1. Other factorizations of 85 (5 × 17, 1 × 85) are legal but visually awkward. |
| `startGrid.laneSpacing` | Lane separation at start (m). Tighter → start-line jostling; wider → less position correlation with id. | 1.5–3.0 m. Below 1.5 m visually overlaps neighbouring robots. |
| `startGrid.rowSpacing` | Front-back separation between starting rows (m). Larger → bigger handicap for back-row robots. | 1.5–3.0 m. Same reasoning. |
| `gates[i].x` | Gate X position. Determines pacing (close gates → fast eliminations, distant gates → drawn-out chase). | `(0, length]`. Last gate `=== length`. |
| `gates[i].cullToCount` | Robots remaining after this gate. The dramatic shape of the race. | Strictly decreasing along sequence. v1 default 28 → 10 → 1. |
| `gates[i].name` | Display name in event timeline. | Non-empty, unique within an arena. |

**Module-scope constants (not tuning knobs):**

- `SUPPORTED_ARENA_TYPES = ['sprint-race']` — adding a type requires a
  code change (new event module + loader expansion).
- `MIN_GATE_COUNT = 2` — schema-level invariant; changing it would
  invalidate the "first gate cull, last gate finish" model.
- `MIN_ROSTER_COVERAGE = 85` — bound to the v1 NFT collection size,
  mirroring `EXPECTED_ROBOT_COUNT` in the roster loader.

**Tuning workflow.** During Sprint 6+ when behavior is observable, arena
adjustments are JSON edits. The loader is rebuilt-free (pure validation,
reads at call time), so re-loading needs only a sim restart, not a code
rebuild.

---

## 8. Acceptance Criteria

Each criterion is verifiable from a passing Vitest run, a `tsc --noEmit`,
or an inspection of the listed file.

**AC1. Type contract holds.** `Arena`, `Gate`, `StartGrid`,
`LoadArenaOptions`, `loadArena`, `getStartPosition` are exported from
`src/sim/arena.ts` with the shapes defined in §4. `tsc --noEmit` succeeds
with `"strict": true`.

**AC2. Single primary export.** Module exports exactly `loadArena`,
`getStartPosition`, plus the four types/interfaces. No default export, no
class. Verifiable by grep.

**AC3. `arena-01.json` exists and validates.**
`assets/data/arenas/arena-01.json` exists and matches the §4 worked
example: `id='arena-01'`, `type='sprint-race'`, `length=240`, `width=40`,
`startGrid={17,5,2,2}`, `gates=[gate_a@80→28, gate_b@160→10,
finish@240→1]`. A test loads the file from disk and asserts the parsed
`Arena` matches.

**AC4. Happy-path Node load.** Test injects an `arenaSource` that reads
`assets/data/arenas/arena-01.json` from disk; loader resolves with a
frozen `Arena`.

**AC5. Determinism.** Two `loadArena` calls with the same `arenaSource`
produce arenas whose `JSON.stringify` outputs are identical (R10).

**AC6. Frozen output.** `Object.isFrozen(arena)`,
`Object.isFrozen(arena.startGrid)`, `Object.isFrozen(arena.gates)`,
`Object.isFrozen(arena.gates[0])` are all `true`. Mutation attempt throws
`TypeError`.

**AC7. `getStartPosition` row/lane math.** Tests assert
`getStartPosition(arena01, 0) === { x: 0, z: -16 }`,
`getStartPosition(arena01, 8) === { x: 0, z: 0 }`,
`getStartPosition(arena01, 17) === { x: -2, z: -16 }`,
`getStartPosition(arena01, 84) === { x: -8, z: 16 }`. Numeric equality
with `1e-9` tolerance.

**AC8. `getStartPosition` covers the full roster.** A test maps ids
`0..84` through `getStartPosition` and asserts: every result is finite,
no two ids share an `(x, z)` pair, all `x ≤ 0`, all `z ∈ [-16, 16]`.
Catches algorithmic bugs that don't show up in spot checks.

**AC9. `getStartPosition` rejects out-of-range (E21).** Calls with `-1`,
`85`, `1.5`, and `NaN` all throw a `RangeError`-like Error with a message
containing `getStartPosition` and the bad id.

**AC10. Source rejection propagates with `.cause` (E1).** `arenaSource`
rejects with `Error('boom')`; loader rejection has `boom` reachable on
`.message` or `.cause`.

**AC11. Non-object payload fails (E2).** Array, string, and `null`
payloads each reject with an error containing `'object'`.

**AC12. Missing required field fails (E3).** Each of the six required
top-level fields, omitted in turn, produces a rejection mentioning that
field's name. (Six tests in a parametric loop.)

**AC13. Unsupported type fails (E4).** `type: 'maze-run'` rejects with an
error containing `'maze-run'` and `'sprint-race'`.

**AC14. Non-finite numerics fail (E5).** `length: NaN`, `width: Infinity`,
gate `x: 'eighty'` each reject with an error mentioning the field path.

**AC15. Non-positive geometry fails (E6).** `length: 0`, `width: -10`
each reject with `'> 0'` in the message.

**AC16. Gate-list validation (E7–E11).** A parametric set of tests for:
`gates: []`, gates length 1, gates with non-ascending X, finish at wrong
X, first gate at x=0, cull thresholds not strictly decreasing. Each
rejects with the relevant gate name (or index) called out in the error
message.

**AC17. Cull threshold validation (E12).** `cullToCount: 0`,
`cullToCount: -1`, `cullToCount: 1.5` each reject with `'positive
integer'` in the message.

**AC18. First-gate cull >= grid capacity fails (E13).** First gate
`cullToCount: 85` (or any value ≥ capacity) rejects with message
mentioning `'cull no robots'`.

**AC19. Start-grid shape validation (E14–E17).** Tests for capacity < 85,
lanes×rows fitting > width, non-integer lanes, non-positive spacing —
each with specific error messages.

**AC20. Extra top-level fields ignored (E18).** A test arena with
`theme: 'neon'` and `weather: 'rain'` loads successfully; the resulting
`Arena` does not have those fields.

**AC21. Empty id / gate name fails (E19, E20).** `id: ''`, gate
`name: ''`, two gates sharing a name — each rejects.

**AC22. No `Math.random` invocation (R11).** `vi.spyOn(Math, 'random')`
over a successful load; spy is never called.

**AC23. Concurrent loads succeed (E22).** `Promise.all`-style double-load
resolves with two distinct but `JSON.stringify`-equal arenas.

**AC24. Reverse-link audit complete.** Per §6, the listed GDDs reference
this one. Verifiable by grep.

**AC25. GDD review status.** This document's status header reads
`Approved` before the implementation commit lands.
