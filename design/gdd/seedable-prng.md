# Seedable PRNG — Game Design Document

> **Status**: Draft Complete (Sections 1–8 written, ready for review)
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S4-02
> **System Index**: design/gdd/systems-index.md (#2)

---

## 1. Overview

The Seedable PRNG is a tiny, deterministic random-number generator that is the
sole source of stochastic decisions in the Robo Rhapsody Sim. Every random
call in the sim — robot AI choices, Degen-trait re-rolls, arena variation,
elimination tie-breaks — routes through a PRNG instance produced by this
module. `Math.random` is forbidden in `src/` outside this file.

The implementation is `mulberry32`: a 32-bit-state PRNG with good statistical
properties for game use, full-period over 2^32 values, and a single integer
seed. It's not cryptographic-quality, and it doesn't need to be — the goal is
reproducibility, not unpredictability.

The exported API is one function:

```ts
createRng(seed: number): () => number
```

Calling `createRng(seed)` returns a closure. Each call to that closure returns
the next pseudo-random float in `[0, 1)`. Two RNGs created with the same seed
produce identical sequences indefinitely.

This system is foundational. Although v1 has no replay/persistence, building
the sim with strict PRNG discipline from the start means v1.1 can introduce
replay JSON without re-architecting the sim. The cost of discipline now is
negligible; the cost of discovering a `Math.random` leak in Sprint 6 is a
rewrite of every system that touched it.

---

## 2. Developer Experience Goals

*(adapted from "Player Fantasy" — players don't interact with the PRNG
directly, but its determinism shapes future viewer experience.)*

When a developer needs a random number — picking which AI choice a robot
makes, deciding whether a Degen re-roll fires, sampling an arena cosmetic
variation — there is exactly one path: ask the current PRNG for the next
value. No `Math.random()` anywhere. No multiple competing RNGs in different
systems. No stateful global "random module" with hidden coupling.

Concretely, the system should produce these felt experiences:

- **Predictability under test.** A test passing `createRng(42)` and
  asserting "the third call returns 0.7234..." stays green forever. Bugs
  reproduce exactly: "set seed to 42, restart sim, watch the same robot
  disappear at the same gate." Debugging a probabilistic bug becomes
  deterministic.

- **Triviality of use.** The whole API surface is two lines:

  ```ts
  const rng = createRng(seed);
  const x = rng();   // float in [0, 1)
  ```

  No instances to hold, no ceremony, no configuration object.

- **Closure-isolated state.** Each `createRng` call is a fresh closure with
  its own state. A test that creates an RNG and runs it 1000 times has zero
  effect on a separate RNG used elsewhere. No global mutation, no cross-test
  pollution.

- **Forward compatibility with replay.** v1 has no replay JSON, but the
  moment v1.1 introduces "save the seed used for today's event," nothing in
  the sim has to change. The seed is already the single switch that makes
  the entire run reproducible.

- **Forbidden alternatives.** The repo lints (or, until then, code-reviews)
  for `Math.random` outside this file. New code that uses `Math.random` is
  rejected with a one-line note: "Use `createRng` from `@/sim/rng`."

---

## 3. Detailed Rules

**File location.** `src/sim/rng.ts`. Tests at `src/sim/rng.test.ts`.

**Single canonical export:**

```ts
export function createRng(seed: number): () => number;
```

No other named exports. No default export. No class. No singleton.

**Behavior contract.**

- Each call to the returned closure produces a `number` in the half-open
  range `[0, 1)`.
- For any seed `s`, the sequence `[r(), r(), r(), ...]` is identical across
  processes, machines, and Node/browser environments. Determinism is
  absolute — no use of `Date.now()`, `performance.now()`, `crypto`, or any
  other external entropy source.
- The closure is stateful: each call advances the internal 32-bit state.
  Two RNGs created with the same seed are independent — advancing one does
  not affect the other.

**Seed coercion.**

- Expected input: integer in the range `0` to `2^32 − 1`.
- Non-integers and out-of-range values are coerced via the `>>> 0` operator
  (unsigned 32-bit truncation). Negative seeds wrap; floats are floored.
  Example: `createRng(-1)` and `createRng(2**32 - 1)` produce the same
  sequence.
- `NaN`, `Infinity`, and non-numeric inputs become `0` after `>>> 0`.
  Documented as expected behavior, not an error condition.

**No convenience helpers in v1.** The module exports only `createRng`. If
a consumer needs `randInt(rng, min, max)` or `pickOne(rng, array)`, those
are 1–3 lines of trivial inline code or live in a separate
`src/sim/rng-helpers.ts` if they accumulate. v1 keeps the surface
minimal — one function, one job.

**Forbidden patterns.**

- `Math.random()` anywhere in `src/` outside `src/sim/rng.ts`. Code review
  rejects.
- Module-level RNG instances (e.g., `export const rng = createRng(0)`).
  Each consumer creates its own RNG with its own seed; sharing state
  across modules creates hidden ordering coupling that breaks determinism
  the moment two modules race for the next value.
- Storing the closure on a class field that gets serialized — the closure
  is not serializable. State exposure for replay is a v1.1 concern; v1
  does not expose RNG state.

**Recommended usage idiom:**

```ts
import { createRng } from '@/sim/rng';
import { CONFIG } from '@/config';

// Top of an event-module function — receive seed explicitly:
function runSprintRace(seed: number = CONFIG.sim.defaultSeed) {
  const rng = createRng(seed);
  // ... pass rng to functions that need it, or close over it locally
}
```

Each event run gets a fresh RNG. Each subsystem within the run shares
that single RNG. This produces a single deterministic call ordering for
the whole event.

---

## 4. Algorithm

*(adapted from "Formulas" — this section documents the `mulberry32` math.)*

**mulberry32** is a 32-bit-state PRNG by Tommy Ettinger. Public domain, no
license to track. ~5 lines of arithmetic per call.

**Properties:**

| Property | Value |
|----------|-------|
| State size | 32 bits |
| Period | 2^32 (full) |
| Output | float ∈ [0, 1) |
| Statistical quality | passes SmallCrush (TestU01); not tested against BigCrush. Sufficient for game decisions, not cryptographic. |
| Speed | ~10ns per call in V8; effectively free at sim tick rates |
| Determinism | absolute across V8/SpiderMonkey/JSC given identical seed |

**Reference implementation:**

```ts
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Per-line breakdown:**

| Line | Operation | Purpose |
|------|-----------|---------|
| `let state = seed >>> 0` | Coerce seed to uint32 | Handles negatives, floats, NaN — all become a valid 32-bit integer |
| `state = (state + 0x6D2B79F5) >>> 0` | Advance state by Weyl-sequence increment | Constant chosen for good distribution properties; `>>> 0` keeps state in uint32 |
| `t = Math.imul(t ^ (t >>> 15), t \| 1)` | Bit-mix step 1 | `Math.imul` performs proper 32-bit signed multiplication (avoids JS's 53-bit float trap); the `\| 1` ensures odd multiplier (odd × any = invertible) |
| `t ^= t + Math.imul(t ^ (t >>> 7), t \| 61)` | Bit-mix step 2 | Second mixing round with different shift; `61` is prime, decorrelates step 1 |
| `((t ^ (t >>> 14)) >>> 0) / 4294967296` | Final shift, then map to [0, 1) | `>>> 0` converts to non-negative uint32; division by `2^32` (`4294967296`) yields a float in [0, 1) — never 1.0 since max uint32 is `2^32 − 1` |

**Why these constants:** the magic numbers (`0x6D2B79F5`, `15`, `7`, `61`,
`14`) come from Ettinger's published mulberry32. Changing any of them
degrades statistical quality. They are not tunable.

**Output range derivation:**

- Maximum input to division: `2^32 − 1 = 4294967295`
- Divisor: `2^32 = 4294967296`
- Maximum output: `4294967295 / 4294967296 ≈ 0.99999999976`
- Minimum output: `0 / 4294967296 = 0`
- Therefore output ∈ [0, 1) — the half-open range required by the contract.

**Why mulberry32 specifically (vs. xorshift32, splitmix32, etc.):**

- **Smaller code than xorshift family** while passing the same statistical tests
- **No initialization warmup required** — first call produces a usable value
- **Closure-based, not class-based** — fits the "no instances" rule cleanly
- **Well-known in JS gamedev** — easy to find reference implementations and
  verify against community test vectors

---

## 5. Edge Cases

1. **Seed of 0.** Works fine. mulberry32 has no zero-state collapse — it
   advances on the first call to a non-zero state via the Weyl increment.
   First output: `0.2664292...` (deterministic; verified in V8 before this
   GDD was written, see Section 8 reference table).

2. **Negative seed.** Coerced via `>>> 0`. Example: `createRng(-1)` becomes
   `createRng(4294967295)` internally. Two seeds whose uint32 representations
   are equal produce identical sequences — this is documented behavior, not
   a bug.

3. **Float seed.** `>>> 0` truncates to integer. `createRng(3.7)` is
   equivalent to `createRng(3)`. `createRng(0.5)` is equivalent to
   `createRng(0)`.

4. **`NaN`, `Infinity`, `-Infinity`.** All coerce to `0` via `>>> 0`. RNG
   behaves as `createRng(0)`. Caller intent is lost silently — but in
   practice the seed comes from `CONFIG.sim.defaultSeed` (a literal) or an
   explicit numeric value, not from a calculation that could produce these.

5. **Non-numeric input.** TypeScript prevents at compile time. Runtime call
   via `as any` would coerce to `NaN >>> 0 === 0`, falling into case 4.

6. **Same seed, multiple RNG instances.** Each instance has its own closure
   state. Advancing one does not affect the others. Two `createRng(42)`
   calls produce two independent generators that emit identical sequences
   when called the same number of times — deterministic by design.

7. **Output of exactly 1.0.** Impossible. Maximum uint32 (`2^32 − 1`)
   divided by `2^32` is `≈ 0.99999999976`. Code that depends on `r() < 1`
   being always-true is safe.

8. **Output of exactly 0.** Possible. Approximately 1 in 2^32 calls produce
   exactly `0`. Code that does `1 / r()` must guard against this.

9. **Closure garbage-collected mid-event.** The closure holds the state. If
   no reference exists, the GC may reclaim it and the state is lost.
   Mitigation: keep the closure on a long-lived local variable inside the
   event run. This is the natural usage pattern; no extra discipline
   required.

10. **Server-side use (Node.js).** Fully supported. `Math.imul` and bitwise
    operators behave identically in V8 (Node) and V8 (Chrome). When the
    replay pipeline lands in v1.1+, the same seed produces the same sequence
    in headless Node sim and in-browser playback.

11. **Forking / branching state.** Not supported in v1. If two parallel
    decision streams need independent randomness, create two RNGs with
    different seeds (e.g., `createRng(masterSeed)` and
    `createRng(masterSeed + 1)`). A `clone(rng)` helper is a v1.1 candidate,
    deferred until needed.

12. **Counting calls / introspection.** The closure exposes no API beyond
    `()`. Callers cannot ask "how many values have been drawn?" or "what's
    the current state?" If diagnostics need this, wrap the rng in a counter
    at the call site — the rng module itself stays minimal.

---

## 6. Dependencies

**Upstream dependencies (Seedable PRNG depends on):** None at module level.
`src/sim/rng.ts` imports nothing — it's a pure-arithmetic leaf. The
*consumers* of `createRng` depend on the Config Module to source a seed,
but that's a consumer-level concern, not a PRNG-level one.

**Downstream dependents (systems that depend on Seedable PRNG):**

| System | How it uses `createRng` | First read appears in |
|--------|--------------------------|------------------------|
| Sim Engine Core | Creates one rng per event run; passes to event module | Sprint 5 |
| Sprint Race Event Module | Consumes rng for AI decisions, tie-breaks | Sprint 6 |
| Maze Run Event Module (deferred v1.1) | Same pattern | v1.1 |
| Obstacle Gauntlet Event Module (deferred v1.2) | Same pattern | v1.2 |
| Arena Loader (if/when cosmetic variation lands) | Optional; per-arena cosmetic RNG | Sprint 5+ |
| Trait → Stat Derivation | **None.** Deterministic from traits alone — no RNG needed in v1 | — |

Per `design-docs.md` rule, each downstream system's GDD must list Seedable
PRNG in its own Dependencies section when authored. The Trait → Stat row
above is intentionally a "no" — documenting the absence is also useful.

**Integration contract:**

- Single canonical import: `import { createRng } from '@/sim/rng';`
- Type signature is `createRng(seed: number): () => number`. No type alias
  exported (the closure type is trivial enough to inline at consumers).
- The closure has no methods, no properties — it's literally a function.
  Consumers cannot introspect or fork it.

**Forbidden dependencies:**

- No `Math.random()` anywhere in the file.
- No `Date.now()`, `performance.now()`, `crypto.*`, or any other entropy
  source. The state is fully derived from the input seed.
- No imports from `src/` (excluding type-only imports — none expected).
- No async work. Module load and `createRng` invocation are both sync.

---

## 7. Tuning Knobs

**None.** The Seedable PRNG has zero tuning knobs.

The mulberry32 constants (`0x6D2B79F5`, `15`, `7`, `61`, `14`) are not
tunable — changing them degrades statistical quality and breaks determinism
against published test vectors. Section 4 documents this.

The *seed* is sometimes mistaken for a tuning knob. It's not. Seed selection
is the *consumer's* concern; this module exposes no knob to influence the
sequence beyond receiving the seed argument. Default seed values live in
`CONFIG.sim.defaultSeed` (Config Module, Section 7), not here.

Future work that *would* introduce a knob to this module — and is therefore
out of scope until v1.1+:

- Switch to a different PRNG family (e.g., `xoshiro128**`) for a longer
  period
- Expose internal state for replay-state-snapshot use cases
- Add a `clone(rng)` helper to fork sequences

All deferred. v1 has one function and zero parameters beyond the seed.

---

## 8. Acceptance Criteria

**Direct criteria** (testable on S4-02 commit):

1. **File exists.** `src/sim/rng.ts` is present and committed.

2. **Single export.** `import { createRng } from '@/sim/rng'` resolves.
   No other named exports; no default export.

3. **Returns a function.** `typeof createRng(0) === 'function'`.

4. **Output range.** Across 10,000 calls with various seeds, every value is
   `>= 0` and `< 1`. Verified by unit test.

5. **Same seed → identical sequence.** Two RNGs created with the same seed,
   each called 100 times, produce element-wise identical arrays. Verified
   by unit test.

6. **Different seeds → different sequences.** Two RNGs created with seeds
   `1` and `2`, each called 100 times, produce arrays where at least one
   element differs. Verified by unit test.

7. **Independent state.** Advancing one RNG instance does not affect a
   second instance with the same seed. After advancing rng A 50 times, a
   fresh rng B with the same seed and called 50 times produces the same
   array A produced. Verified by unit test.

8. **Reference values.** For `seed = 0`, the first three outputs match
   these published reference values within 1e-12 tolerance:

   | Call # | Expected output |
   |--------|-----------------|
   | 1 | `0.26642920868471265` |
   | 2 | `0.0003297457005828619` |
   | 3 | `0.2232720274478197` |

   These were verified by running the canonical mulberry32 implementation
   in V8 (Node 22) before this GDD was committed. Verified by unit test.

9. **Seed coercion.** `createRng(-1)` and `createRng(0xFFFFFFFF)` produce
   identical sequences. `createRng(NaN)` produces the same sequence as
   `createRng(0)`. Verified by unit test.

10. **Output never equals 1.0.** Across 100,000 calls with seed `1`, no
    output equals exactly `1.0`. Verified by unit test (probabilistic, but
    mathematically the upper bound is `< 1` always — the test is a sanity
    check).

11. **Typecheck green.** `npm run typecheck` exits 0.

12. **Test green.** `npm test` exits 0 with all rng tests passing.

**Discipline criteria** (enforced per PR going forward):

13. **No `Math.random` in `src/`.** Reviewers grep PRs for `Math\.random`
    in `src/` excluding `src/sim/rng.ts`. Hits are rejected unless
    commented and justified (no expected case for v1).

14. **No external entropy sources in `src/sim/rng.ts`.** Reviewers verify
    the file imports nothing and uses no `Date.now()`, `performance.now()`,
    `crypto.*`, or `globalThis.*` access.
