# Trait → Stat Derivation — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S5-01
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

Trait → Stat Derivation is the pure function that converts a robot's five raw
NFT traits — `full_send`, `degen`, `cipher`, `doubter`, `altruist` — into the
seven derived simulation stats the sim engine consumes each tick: `speed`,
`acceleration`, `handling`, `pathfinding`, `caution`, `chaos`, and `grace`. It
is the only place in the codebase where trait values are interpreted as
gameplay parameters; everything downstream (Sim Engine Core, Sprint Race, Maze
Run, Obstacle Gauntlet) reads stats, not traits.

The function is total, side-effect-free, and synchronous: same trait input
always produces the same stat output, byte-for-byte. All coefficients are read
from `CONFIG.sim.traitToStat` so balance changes are one-file edits and never
require touching the derivation code.

The exported API is one function:

```ts
deriveStats(traits: RobotTraits): SimStats
```

`RobotTraits` is the trait shape produced by the Robot Roster Loader (S5-02),
with each trait an integer in `[0, 100]` (CSV-native). `SimStats` is the
seven-stat shape consumed by the Sim Engine Core (S5-04). The function does no
validation — bad data is the loader's problem, not the math's.

---

## 2. Player Fantasy

The fantasy here is for the **viewer**, not the robot: tuning into a Robo
Rhapsody event and feeling that **each robot's trait sheet predicted what just
happened**. When Rhapsody Z (Full Send 90) blasts off the start line and
overshoots the first turn, that's the trait sheet on screen. When AACK PAACK 1
(Degen 96) does something baffling — bursts ahead, then veers into a wall —
that's the trait sheet on screen. When the Cipher-heavy robot calmly finds the
racing line, when the Doubter robot survives the gauntlet by hesitating at the
right moment — those moments are only legible because the math turned the same
five trait numbers into seven distinct, observable behaviors.

Trait → Stat Derivation is the contract that makes those reads possible. Every
observable difference between two robots in the sim traces back here: the same
traits in produce the same stats out, and the stats are the only thing the sim
engine sees. If the function is unstable or noisy, two identical robots behave
differently and the fantasy collapses ("why did mine lose? was it the sim or
just luck?"). If the function is too gentle, a Full Send 90 robot doesn't
visibly outpace a Full Send 30 robot and the traits stop mattering. The
function's job is to make the trait sheet **load-bearing**: the radar chart on
a robot's profile page is a prediction, and watching the event is the
verification.

---

## 3. Detailed Rules

**R1. Single entry point.** The module exports exactly one function,
`deriveStats(traits)`. No class, no factory, no internal state. Calling it a
second time with the same input returns a value that compares deep-equal to
the first call.

**R2. Pure and synchronous.** No I/O, no `Date.now()`, no `Math.random()`,
no reads from anywhere except the `traits` argument and
`CONFIG.sim.traitToStat`. No mutation of either. The function returns a fresh
object every call.

**R3. Input shape.** `RobotTraits` is `{ fullSend, degen, cipher, doubter,
altruist }` where each field is a finite number. Production data are integers
in `[0, 100]` from the CSV, but the function is defined for any real-valued
input — it does not clamp, validate, or throw on out-of-range values. Garbage
in, garbage out.

**R4. Output shape.** `SimStats` is `{ speed, acceleration, handling,
pathfinding, caution, chaos, grace }` — seven `number` fields. Field order is
part of the contract for snapshot tests; never change it.

**R5. Coefficient ownership.** Every numeric coefficient in §4 lives under
`CONFIG.sim.traitToStat.<stat>` (e.g., `CONFIG.sim.traitToStat.speed.base`,
`CONFIG.sim.traitToStat.speed.fullSendCoeff`). The function reads them at call
time; it does not snapshot them at module load. This means a test can stub
`CONFIG` and re-call without re-importing.

**R6. Trait normalization is internal.** Traits arrive as 0–100 integers; the
function divides by 100 internally before applying coefficients. Callers never
see normalized values. This keeps `traits.fullSend === 90` meaningful at every
call site outside the function.

**R7. No clamping of stats.** Output values are not clamped to `[0, 1]` or any
other range. If a coefficient configuration produces `speed = 1.4` or
`caution = -0.1`, that is what the function returns. Bound-enforcement, if
ever needed, belongs in the consuming sim or in `CONFIG` review — not in the
math.

**R8. Determinism is observable.** Calling `deriveStats` with the same
`traits` and the same `CONFIG.sim.traitToStat` always produces structurally
identical output. This is testable in two directions: (a) two calls in the
same process must deep-equal, and (b) the deriver must not depend on any
module load order, so re-importing the module first does not change output.

**R9. Altruist is a real input.** Altruist contributes to `grace` and only to
`grace` in v1. It is not a hidden no-op. A robot with `altruist = 80` and a
robot with `altruist = 0`, all else equal, must produce different `grace`
values; every other stat must be identical between them.

---

## 4. Formulas

**Variable definitions.** Let trait values be `f, d, c, b, a` ∈ `[0, 100]` for
`fullSend, degen, cipher, doubter, altruist` respectively. Define normalized
values `f' = f/100`, `d' = d/100`, `c' = c/100`, `b' = b/100`, `a' = a/100`,
each in `[0, 1]`. All stats are unitless coefficients consumed by the Sim
Engine; their semantic units (m/s, probability, multiplier) are decided by the
consuming subsystem, not here.

**Stats.** Coefficients are referenced as `K.<stat>.<name>` (where
`K = CONFIG.sim.traitToStat`); the literal numbers in the table below are the
v1 starting values, lifted from `design/gdd/game-concept.md` § Trait-to-Behavior
Mapping.

```
speed        = K.speed.base        + K.speed.fullSendCoeff       * f'
acceleration = K.acceleration.base + K.acceleration.fullSendCoeff * f'
                                   - K.acceleration.doubterCoeff  * b'
handling     = K.handling.base     + K.handling.cipherCoeff       * c'
                                   - K.handling.fullSendCoeff     * f'
pathfinding  = K.pathfinding.base  + K.pathfinding.cipherCoeff    * c'
caution      =                       K.caution.doubterCoeff       * b'
chaos        =                       K.chaos.degenCoeff           * d'
grace        =                       K.grace.altruistCoeff        * a'
```

**v1 starting coefficients** (`CONFIG.sim.traitToStat`):

| Stat | base | fullSend | degen | cipher | doubter | altruist |
|------|------|----------|-------|--------|---------|----------|
| `speed`        | 0.5 | +0.8 | — | — | — | — |
| `acceleration` | 0.4 | +1.0 | — | — | −0.3 | — |
| `handling`     | 0.5 | −0.2 | — | +0.5 | — | — |
| `pathfinding`  | 0.3 | — | — | +0.7 | — | — |
| `caution`      | 0.0 | — | — | — | +1.0 | — |
| `chaos`        | 0.0 | — | +1.0 | — | — | — |
| `grace`        | 0.0 | — | — | — | — | +1.0 |

Source: game-concept.md §125–145 (six existing stats) plus the §1 addition of
`grace` from altruist, mirroring the `chaos` / `caution` one-trait pattern.
Coefficients are *plausible*, not *tuned* — Sprint 5 only requires deterministic
and plausible (sprint-05.md risk row 2).

**Worked example: Rhapsody Z** (id 0, `f=90, d=5, c=2, b=1, a=2`).

Normalized: `f'=0.90, d'=0.05, c'=0.02, b'=0.01, a'=0.02`.

```
speed        = 0.5 + 0.8*0.90                         = 1.220
acceleration = 0.4 + 1.0*0.90 - 0.3*0.01              = 1.297
handling     = 0.5 + 0.5*0.02 - 0.2*0.90              = 0.330
pathfinding  = 0.3 + 0.7*0.02                         = 0.314
caution      =       1.0*0.01                         = 0.010
chaos        =       1.0*0.05                         = 0.050
grace        =       1.0*0.02                         = 0.020
```

Reads as expected: high speed/accel, mediocre handling (Full Send overshoots
turns), low caution/chaos/grace.

**Worked example: AACK PAACK 1** (id 2, `f=1, d=96, c=1, b=1, a=1`).

Normalized: `f'=0.01, d'=0.96, c'=0.01, b'=0.01, a'=0.01`.

```
speed        = 0.5 + 0.8*0.01                         = 0.508
acceleration = 0.4 + 1.0*0.01 - 0.3*0.01              = 0.407
handling     = 0.5 + 0.5*0.01 - 0.2*0.01              = 0.503
pathfinding  = 0.3 + 0.7*0.01                         = 0.307
caution      =       1.0*0.01                         = 0.010
chaos        =       1.0*0.96                         = 0.960
grace        =       1.0*0.01                         = 0.010
```

Reads as expected: mediocre everything except `chaos = 0.96` — a 96%
per-decision-tick re-roll probability. The sim engine is responsible for using
`chaos` as a probability; the deriver only emits the value.

**Expected ranges (informational, not enforced).** With v1 coefficients and
traits in `[0, 100]`:

| Stat | min | max |
|------|-----|-----|
| `speed`        | 0.50 | 1.30 |
| `acceleration` | 0.10 | 1.40 |
| `handling`     | 0.30 | 1.00 |
| `pathfinding`  | 0.30 | 1.00 |
| `caution`      | 0.00 | 1.00 |
| `chaos`        | 0.00 | 1.00 |
| `grace`        | 0.00 | 1.00 |

Per R7 these are not clamps — they are the bounds *implied by* the v1
coefficients and trait domain, useful as sanity-check expectations in tests.

---

## 5. Edge Cases

**E1. All-zero traits** (`f=d=c=b=a=0`). Output: `speed=0.50, acceleration=0.40,
handling=0.50, pathfinding=0.30, caution=0, chaos=0, grace=0`. The function
returns the `base` row of §4 for every stat. This is the canonical "trait floor"
baseline; no special-casing in code, the math falls out of the formulas. Any
code path checking `chaos > 0` as a sentinel for "this robot can re-roll" must
accept that an all-zero trait robot never re-rolls — that is the intended
behavior, not a bug.

**E2. All-max traits** (`f=d=c=b=a=100`). Output: `speed=1.30,
acceleration=1.10, handling=0.80, pathfinding=1.00, caution=1.00, chaos=1.00,
grace=1.00`. Note `acceleration = 0.4 + 1.0 − 0.3 = 1.10` — doubter's penalty
bites even at max full_send. This case can never appear in production (traits
sum to ≤ 100 by NFT spec) but is a useful test for coefficient-sign bugs (a
sign flip in any subtractive coefficient would produce a wildly different
value).

**E3. Sum-greater-than-100 traits.** The function does not validate
`f+d+c+b+a ≤ 100`. If a malformed CSV row delivers `f=100, d=100`, the function
returns `speed=1.30, chaos=1.00`. Per R3 this is GIGO; the loader (S5-02) is
responsible for surfacing malformed rows.

**E4. Negative or > 100 trait values.** Allowed by R3; produces stats outside
the §4 expected ranges. No clamping. A `fullSend = -10` produces
`speed = 0.5 + 0.8*-0.1 = 0.42` (below the 0.50 floor). A `fullSend = 200`
produces `speed = 0.5 + 0.8*2.0 = 2.10` (above the 1.30 ceiling). Tests
include one out-of-range case to prove no clamping occurs.

**E5. Non-integer trait values.** Allowed. The CSV is integer-only but the
function is defined for any finite real. `fullSend = 50.5` produces
`speed = 0.5 + 0.8*0.505 = 0.904`. No rounding happens inside the function.

**E6. NaN / Infinity inputs.** `NaN` in any trait propagates to every stat
derived from it (and only those stats). `Infinity` produces `Infinity` or
`-Infinity` in derived stats. The function does not throw. The loader is the
layer responsible for refusing such input; tests verify propagation behavior
without asserting it is desirable.

**E7. Two robots with identical traits.** Must produce deep-equal stat objects
(not just equal values — same key order, same field count). This is the "85
identical robots" thought experiment: if all 85 trait sheets were identical,
the sim's only source of behavioral divergence would be the seeded RNG, never
the deriver. Test asserts deep equality on `JSON.stringify` of two calls with
copies of the same trait object.

**E8. CONFIG mutation between calls.** `CONFIG` is `as const` and a TypeScript
error to mutate, but TypeScript can't catch a deliberate cast. If a test stubs
a coefficient (`(CONFIG as any).sim.traitToStat.speed.base = 99`), the next
call returns the new value. This is *expected* and necessary for coefficient
tuning tests; the rule is that production code never mutates CONFIG, not that
the function defends against it.

**E9. Missing trait field.** TypeScript prevents this at compile time. At
runtime, `traits.fullSend === undefined` would propagate `NaN` through any
stat using `f'`, the same as E6. The function does not assert presence; the
loader's type guarantees do.

---

## 6. Dependencies

**Upstream (this system reads from):**

- **Config Module** (`design/gdd/config-module.md`) — the `CONFIG.sim.traitToStat`
  subtree owns every coefficient in §4. Adding `traitToStat` to the existing
  `sim` subsystem is the only Config Module change S5-01 requires; no schema
  refactor.

**Downstream (this system is read by):**

- **Robot Roster Loader (S5-02)** — calls `deriveStats(traits)` once per robot
  during roster construction, attaches the resulting `SimStats` to each
  `RobotRoster` entry. The loader, not the deriver, owns trait validation.
- **Sim Engine Core (S5-04)** — reads `SimStats` per-robot per-tick. Never
  re-derives; the cached value from roster construction is canonical for the
  lifetime of the event.
- **Sprint Race Event Module (S5-05)** — consumes `speed`, `acceleration`,
  `handling`, `caution`, `chaos` for AI decisions and gate logic. Will reach
  for `pathfinding` if dynamic obstacle avoidance lands; `grace` is read for
  elimination-animation pacing.
- **Future event modules (Maze Run, Obstacle Gauntlet)** — out of v1 sprint
  scope but consume the same `SimStats` shape; this contract is the
  coordination point.

**Sibling (peer-level, no read/write relationship):**

- **Seedable PRNG (`src/sim/rng.ts`)** — orthogonal. The deriver is pure and
  deterministic-by-construction (no random anywhere); the PRNG handles
  stochasticity *consuming* `chaos`, not generating it.

**Reverse-link audit (per `.claude/rules/design-docs.md` bidirectionality
rule):**

The following GDDs need a one-line "Used by" / dependency mention pointing to
Trait → Stat Derivation. Updates land alongside the §1 commit:

- `design/gdd/config-module.md` — add `sim.traitToStat` to the v1 starter
  shape and reference this GDD as the consumer.
- `design/gdd/systems-index.md` — add row for Trait → Stat Derivation.
- `design/gdd/game-concept.md` — link from the §Trait-to-Behavior Mapping
  section to this GDD as the canonical implementation contract (the formulas
  in game-concept.md become non-normative; this GDD is the source of truth).

S5-02, S5-04, S5-05 GDDs do not exist yet and will reference this one when
authored.

---

## 7. Tuning Knobs

Every knob below lives under `CONFIG.sim.traitToStat.<stat>.<knob>`. All are
`number`, all read at call time (R5). Safe ranges are advisory — the function
applies them literally, no clamping (R7). "Effect" describes the in-sim
consequence per the consuming subsystem's intended use.

| Knob | v1 value | Safe range | Effect |
|------|----------|------------|--------|
| `speed.base` | `0.5` | `[0.0, 1.0]` | Floor speed for `f=0` robots. Lower → bigger gap between low- and high-Full Send robots. |
| `speed.fullSendCoeff` | `0.8` | `[0.0, 2.0]` | How much top speed Full Send buys. Sprint Race winner-skew dial. |
| `acceleration.base` | `0.4` | `[0.0, 1.0]` | Off-the-line floor. |
| `acceleration.fullSendCoeff` | `1.0` | `[0.0, 2.0]` | Off-the-line gain from Full Send. |
| `acceleration.doubterCoeff` | `0.3` | `[0.0, 1.0]` | Off-the-line *penalty* from Doubter. Higher → Doubter robots fall behind faster at start. |
| `handling.base` | `0.5` | `[0.0, 1.0]` | Default cornering ability. |
| `handling.cipherCoeff` | `0.5` | `[0.0, 1.5]` | Cipher's cornering bonus. Maze Run dial when that event lands. |
| `handling.fullSendCoeff` | `0.2` | `[0.0, 1.0]` | Full Send's *handling penalty*. Higher → Full Send robots overshoot turns more. |
| `pathfinding.base` | `0.3` | `[0.0, 1.0]` | Default pathfinding floor. |
| `pathfinding.cipherCoeff` | `0.7` | `[0.0, 2.0]` | Cipher's pathfinding gain. Maze Run primary dial. |
| `caution.doubterCoeff` | `1.0` | `[0.0, 2.0]` | Trap-avoidance probability scaling from Doubter. Obstacle Gauntlet primary dial. |
| `chaos.degenCoeff` | `1.0` | `[0.0, 1.0]` | Per-decision-tick re-roll probability scaling from Degen. **Hard ceiling at 1.0** — values above 1.0 mean re-roll-every-tick which makes Degen robots functionally non-actors. |
| `grace.altruistCoeff` | `1.0` | `[0.0, 2.0]` | Death-animation slowdown / elimination-pacing scale from Altruist. Cosmetic in v1. |

**No knobs control normalization.** The trait domain `[0, 100]` and the
normalization divisor `100` are part of the contract (R6) and not exposed as
config. Changing them would change the meaning of every trait sheet on every
NFT and is out of scope.

**No knobs control field shape.** Adding or removing a stat requires a
coordinated GDD update (this doc + S5-04 + S5-05) and a TypeScript type change,
not a config edit.

**Tuning workflow.** During Sprint 6+ when behavior is observable, coefficient
adjustments are one-line edits to `src/config/index.ts`. The deriver is
rebuilt-free (pure, reads at call time), so re-tuning needs only a roster
reload, not a sim restart, in dev tools.

---

## 8. Acceptance Criteria

Each criterion is verifiable from a passing Vitest run, a `tsc --noEmit`, or
an inspection of the listed file. "Pass" means the test/check exists and
passes; "fail" means it is missing or red.

**AC1. Type contract holds.** `RobotTraits` and `SimStats` are exported from
`src/sim/trait-to-stat.ts` with the field names and order defined in §3 R3 and
R4. `tsc --noEmit` succeeds with `"strict": true`.

**AC2. Single export.** The module exports exactly one function — `deriveStats`
— plus the two types above. No default export, no class, no factory.
Verifiable by grepping the source.

**AC3. Determinism (intra-call).** A test calls `deriveStats(traits)` twice
with the same input and asserts deep-equal output via `JSON.stringify`
comparison. Passes for at least 3 distinct trait profiles (Rhapsody Z, AACK
PAACK 1, all-zero).

**AC4. Worked-example fidelity.** A test asserts the §4 worked-example values
for Rhapsody Z and AACK PAACK 1 to within `1e-9`. Acts as a
coefficient-tampering canary.

**AC5. All-zero baseline.** A test on `f=d=c=b=a=0` asserts every stat equals
its `base` (E1 values).

**AC6. All-max coefficient sign check.** A test on `f=d=c=b=a=100` asserts the
E2 outputs. Catches sign-flip bugs in subtractive coefficients
(`acceleration.doubterCoeff`, `handling.fullSendCoeff`).

**AC7. Altruist isolation.** A test holds `f, d, c, b` constant, varies
`altruist` between `0` and `80`, and asserts only `grace` differs while the
other six stats are deep-equal. Proves R9.

**AC8. Trait isolation matrix.** One test per trait that varies *only* that
trait between `0` and `50`, asserts which stats change and which do not,
matching the §4 coefficient table. Five tests total. Catches rogue coefficient
leakage (e.g., a stray `+ d'` term in `speed`).

**AC9. No clamping.** A test on `fullSend = 200` asserts `speed = 2.10` (above
the §4 expected ceiling). Proves R7.

**AC10. Coefficients sourced from CONFIG.** A test mutates
`(CONFIG as any).sim.traitToStat.speed.base` to a sentinel value, calls
`deriveStats`, asserts the new value is reflected in output. Proves R5 and
validates the tuning workflow described in §7. Test cleans up by restoring the
original value in `afterEach`.

**AC11. No `Math.random` use.** A grep over `src/sim/trait-to-stat.ts` returns
zero matches for `Math.random`. (Sprint-wide rule per
`technical-preferences.md`; spelled out here because §3 R2 makes it a contract
of *this* module.)

**AC12. CONFIG schema in place.** `src/config/index.ts` exports a
fully-populated `CONFIG.sim.traitToStat` matching the §7 table. Verifiable by
reading the file.

**AC13. Reverse-link audit complete.** Per §6, the following files reference
this GDD: `config-module.md`, `systems-index.md`, `game-concept.md`. Verifiable
by grep.

**AC14. GDD review status.** This document's status header reads `Approved`
before the implementation commit lands.
