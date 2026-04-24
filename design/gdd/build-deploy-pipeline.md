# Build / Deploy Pipeline — Game Design Document

> **Status**: Draft Complete (Sections 1–8 written, ready for review)
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S4-03
> **System Index**: design/gdd/systems-index.md (#3)

---

## 1. Overview

The Build / Deploy Pipeline is the project's cradle-to-deploy automation:
it transforms source artifacts (TypeScript code, the trait CSV, GLB models,
PNG textures) into the static bundle served at `robo-rhapsody.onrender.com`.
In v1, it has three responsibilities:

1. **CSV → JSON transform.** A pre-build script reads
   `design/data/robots-traits.csv` and produces `public/traits.json` (or
   equivalent runtime-loadable path). The runtime never parses CSV — that's
   a build-time concern. Decoupling parsing from runtime keeps load fast and
   lets us swap the source format later (Sheets API, Parquet, on-chain
   query) without touching consumers.

2. **Static bundle build.** `vite build` produces a tree-shaken `dist/`
   containing the hashed JS bundle, the index.html mount, and copies of
   `assets/` (robot GLB + 85 skin PNGs) via `vite-plugin-static-copy`.

3. **Render deployment.** The Render service is already wired to this
   GitHub repo from the runner era. A push to `main` triggers Render's
   webhook, which runs `npm install && npm run build` and serves `dist/`.
   Manual operations are the user's; the pipeline itself is hands-off after
   `git push`.

The pipeline is intentionally simple. v1 has no environment-specific
builds, no Docker, no CI gates beyond Render's build success or failure.
Sophistication (preview deploys, separate staging, build matrix, lint/test
gates) enters v1.1+ if and when the project's deploy needs grow.

Why it goes in Sprint 4: every downstream system needs the trait JSON
available at runtime. S4-04 (Renderer) needs it to know which 85 skin
textures to load; Sprint 5 systems need it for the actual sim. Settling
the build-time data flow now unblocks every consumer that follows.

---

## 2. Build / Deploy Operator Experience Goals

*(adapted from "Player Fantasy" — the "operator" is the developer pushing
commits and observing deploys.)*

When the developer pushes a commit to `main`, the goal is: ~3 minutes
later, the change is live at `robo-rhapsody.onrender.com`. No manual deploy
steps, no rebuilds-by-hand, no syncing JSON artifacts back into the repo by
hand.

When the trait CSV changes, the runtime gets the new values
automatically — the developer doesn't have to remember to re-run a
transform script. When the build fails, the failure is visible (Render
dashboard, console output) and reproducible locally with the same
`npm run build`.

Concretely, the system should produce these felt experiences:

- **Push-to-deploy.** `git push origin main` is the entire deploy ritual.
  Render runs `npm install && npm run build` in a clean environment,
  serves the resulting `dist/`. Failures show up in Render's deploy log
  and on the dashboard; success is silent.

- **Source-of-truth single file.** The trait data lives in exactly one
  file: `design/data/robots-traits.csv`. The runtime JSON is a build
  artifact at `public/traits.json` (locked v1 path), not a checked-in
  source — preventing drift between two files that should always agree.

- **Reproducible builds.** Same source tree at the same commit produces a
  byte-equivalent `dist/` (modulo Vite's hash filenames, which are
  deterministic from content). Tests pass on Render iff they pass locally.

- **Visible bundle size.** Vite prints the JS/CSS bundle sizes after
  every build. A bundle that grows unexpectedly is noticed at build time,
  not after deploy.

- **No mystery state.** No build script writes outside `dist/` or
  `public/`. No environment variables required for the build to succeed
  in v1 (env vars come back when persistence does in v1.1+).

- **Cheap to change locally.** `npm run dev` includes the same CSV→JSON
  step as `npm run build`, so a CSV edit during dev produces a fresh
  `traits.json` on the next dev-server reload.

---

## 3. Detailed Rules

**Transform script location.** `tools/build/traits-csv-to-json.ts`. Imports
nothing from `src/`. Tests live alongside if/when added — for v1 the
script is small enough to verify by inspection + the runtime JSON
validation in S4-04 / Sprint 5.

**Transform script contract.**

- **Input:** `design/data/robots-traits.csv` (relative to repo root).
- **Output:** `public/traits.json` (relative to repo root).
- **Output format:** A single JSON array of robot records, each with the
  shape:

  ```ts
  {
    id: number,        // 0–84
    name: string,
    full_send: number,
    degen: number,
    cipher: number,
    doubter: number,
    altruist: number
  }
  ```

- **Order:** Records appear in source CSV order (currently sorted by `id`
  ascending; the script preserves whatever order the CSV uses).
- **Validation:** The script asserts that exactly 85 records are present
  and that every row's traits sum to ≤ 100. Failures abort the script
  with a non-zero exit and a clear stderr message — Render shows the
  error in the deploy log.

**When the transform runs.**

- `npm run build` → runs the transform first, then `tsc && vite build`.
- `npm run dev` → runs the transform first, then `vite`.
- Implementation: explicit `&&` chaining in `package.json` scripts. No
  magic pre/post hooks. The order is visible at the command line.

Example (final form lands in S4-03 implementation):

```json
"scripts": {
  "build:traits": "tsx tools/build/traits-csv-to-json.ts",
  "dev": "npm run build:traits && vite",
  "build": "npm run build:traits && tsc && vite build"
}
```

**Runtime support.** `tsx` (devDep) executes the TypeScript transform
script directly without a separate compile step. Adds ~2 MB to
`node_modules`; runs in <100 ms.

**Vite responsibilities (existing, locked in S4-00):**

- `@preact/preset-vite` plugin enables Preact + JSX
- `@/*` path alias maps to `./src/*` (mirror of `tsconfig.json` paths)
- `vite-plugin-static-copy` copies `assets/` into `dist/` (robot GLB +
  85 skin PNGs)
- Vite's native `public/` handling copies `public/traits.json` into
  `dist/traits.json`, served at the site root

**Render service settings (configured externally, captured here for
reference):**

| Setting | Value |
|---------|-------|
| Service type | Static Site |
| Build command | `npm install && npm run build` |
| Publish directory | `./dist` |
| Auto-deploy on `main` | yes |

**What goes where.**

- **`assets/`** — large binary inputs (GLB, PNG textures). Tracked in
  git. Copied verbatim by `vite-plugin-static-copy`.
- **`public/`** — small generated JSON consumed by the runtime. **Not**
  tracked in git (build artifact, must be regenerated). Served from site
  root by Vite.
- **`src/`** — TypeScript source code (Preact app, sim, config).
- **`design/data/`** — source data files (CSV). Tracked in git. The CSV
  is the canonical source; `public/traits.json` is derived.
- **`tools/build/`** — build-time scripts. Tracked in git. Not bundled
  into the runtime.

**Gitignore additions** (mandated by this design):

```
public/traits.json
```

Without this, devs who run `npm run dev` will have an unstaged
`public/traits.json` cluttering `git status` after every fresh checkout.

**Forbidden patterns:**

- Reading `traits.json` at module-load time in Vite-bundled code (the
  file is fetched at runtime via `fetch('/traits.json')`, not imported).
  Importing the JSON directly would inline it into the JS bundle —
  defeating the v1 architectural choice from Section 2.
- Writing build artifacts outside `dist/` and `public/`. The transform
  only touches `public/traits.json`.
- Hand-editing `public/traits.json`. The CSV is the source of truth;
  manual edits are overwritten on the next build.

---

## 4. Pipeline Stages

*(adapted from "Formulas" — this section documents the build-step data flow.)*

The data flow from a `git push` to a live deploy. The pipeline is fully
linear — no parallelism, no fan-out, no rollback machinery in v1.

**Production deploy path (`git push origin main` → live):**

```
  ┌─────────────────────────┐
  │  git push origin main    │
  └──────────┬───────────────┘
             │
             ▼ (Render webhook)
  ┌─────────────────────────┐
  │  Render: build container │
  └──────────┬───────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │  npm install             │
  └──────────┬───────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │  npm run build           │
  │   ├─ build:traits         │
  │   │   (CSV → public/traits.json)
  │   ├─ tsc --noEmit         │
  │   └─ vite build           │
  └──────────┬───────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │  Render: serve dist/     │
  │  → robo-rhapsody.onrender.com
  └─────────────────────────┘
```

**Build stage details:**

| Stage | Command | Reads | Writes | Fails when |
|-------|---------|-------|--------|------------|
| 1. Install | `npm install` | `package.json`, `package-lock.json` | `node_modules/` | Network failure, lockfile drift, missing dep |
| 2a. Transform | `tsx tools/build/traits-csv-to-json.ts` | `design/data/robots-traits.csv` | `public/traits.json` | CSV missing, malformed row, count ≠ 85, traits sum > 100 |
| 2b. Typecheck | `tsc --noEmit` | `src/**/*.ts(x)`, `tsconfig.json` | (none — type checking only) | Any TS error in `src/` |
| 2c. Bundle | `vite build` | `src/`, `index.html`, `public/`, `assets/`, `vite.config.ts` | `dist/` | Vite build error, asset path missing |
| 3. Serve | (Render-managed) | `dist/` | (HTTP responses) | Build failure (no `dist/`) |

**Local dev path (`npm run dev`):**

```
  npm run dev
    │
    ├─ build:traits  (CSV → public/traits.json)
    │
    └─ vite           (dev server on :5173 with HMR)
```

Vite's HMR reloads on changes to `src/`, `index.html`, and
`vite.config.ts`. CSV changes do **not** trigger HMR — the developer
re-runs `npm run dev` (or `npm run build:traits` separately) after
editing the CSV. Auto-watch on the CSV is a v1.1 candidate (`chokidar`
or a Vite plugin); deferred to keep S4-03 minimal.

**Output bundle composition (post `vite build`):**

```
  dist/
  ├── index.html                           (Preact mount + script tag)
  ├── assets/
  │   ├── index-{contenthash}.js           (bundled Preact + Three.js + sim)
  │   └── (other Vite-emitted assets)
  ├── traits.json                          (from public/, ~10 KB)
  └── assets/                              (from vite-plugin-static-copy)
      └── art/characters/robot/
          ├── robot_run.glb                (~2-5 MB)
          ├── robot_idle.glb               (~2-5 MB)
          └── skins/
              ├── 0.png
              ├── 1.png
              └── … (85 total)
```

Note: there are two `assets/` folders in `dist/` — one is Vite's emitted
bundle output (`dist/assets/index-{hash}.js`), the other is the
static-copied source assets (`dist/assets/art/...`). They coexist without
collision because the namespaces don't overlap. If a future change names
something `dist/assets/art-{hash}.js`, that's a problem — flagged but not
addressed in v1.

**Determinism guarantees:**

- Same git commit + same `package-lock.json` → byte-equivalent `dist/`
  modulo Vite's content-hash filenames (which are themselves deterministic
  from input bytes).
- The transform script is pure: same CSV → same JSON, every time. Output
  is sorted by source CSV order; no `Date.now()` or `Math.random()` in
  the pipeline.

**Failure modes by stage:**

| Failure | Effect | Recovery |
|---------|--------|----------|
| `npm install` fails on Render | Build aborts; live site unchanged from prior deploy | Investigate lockfile, retry deploy via Render dashboard |
| `build:traits` validation fails | Build aborts with stderr message; live site unchanged | Fix CSV at `design/data/robots-traits.csv`; push again |
| `tsc` errors | Build aborts before bundling; live site unchanged | Fix TS errors locally, push again |
| `vite build` fails | Build aborts; live site unchanged | Reproduce locally with `npm run build`, fix, push again |
| Successful build, runtime `fetch('/traits.json')` 404 | Site loads but the sim has no robot data | Indicates `public/traits.json` was somehow excluded from `dist/`. Check Vite's public-dir config and `vite-plugin-static-copy` settings. |

---

## 5. Edge Cases

1. **CSV file missing.** Script aborts with `Cannot read file: design/data/robots-traits.csv`. Build fails before bundling. Fix: check the file is committed and the path is correct.

2. **CSV missing required columns.** Expected header: `id, name, full_send, degen, cipher, doubter, altruist`. If any column is missing, the script aborts with the missing column name. Header order is flexible — the script keys by name, not position.

3. **Row count ≠ 85.** Script aborts with `Expected 85 rows, found N`. Prevents accidentally deploying a partial roster. To change the canonical count, update both the CSV and the validation constant in the same commit.

4. **Trait sum > 100 on any row.** Script aborts with the offending row's `id` and the actual sum. Prevents the AACK PAACK / power-leveling problem where a row could exceed the spec's `≤ 100` constraint.

5. **Trait sum < 100.** **Allowed.** Spec says `sum ≤ 100`; under-allocation is valid (the unused points are flavor / room for future trait expansion). All current 85 robots happen to sum to exactly 100, but the validation must permit lower.

6. **Non-numeric trait value.** Script aborts with the row `id` and the bad cell. Catches CSV-formatting accidents early (e.g., a stray quote, a comma in a name, an Excel-injected formula).

7. **Duplicate `id`.** Script aborts with the duplicated id. Robot IDs must be unique.

8. **CSV encoded as UTF-16 or with a BOM.** The script reads with explicit UTF-8 + BOM stripping. If the CSV is UTF-16 (Excel does this on Windows), the script aborts with a clear "expected UTF-8" message. Re-export from the spreadsheet as UTF-8 CSV.

9. **Empty CSV file.** Falls under case #3 (count ≠ 85, found 0).

10. **CSV unchanged across two builds.** Output JSON is byte-identical. The transform is pure — same input, same output, in source order.

11. **`public/` directory does not exist.** First-time clone, fresh worktree. Script creates `public/` if missing, then writes `traits.json`. Idempotent.

12. **Atomic write race.** The transform writes to a temp file (`public/.traits.json.tmp`) and renames atomically via `fs.renameSync`. Vite never sees a half-written JSON. If the process is killed mid-write, the temp file is the only artifact left — next run cleans it up before writing.

13. **Disk full / permission error.** Propagates to stderr with the OS-level error message. Build fails. Local: free disk or fix permissions. Render: rare, but check service quotas.

14. **Render build-minutes exceeded.** Render's free tier has monthly build-minute caps. Hitting the cap fails subsequent builds until the cap resets. Mitigation: keep the build under 2 minutes (currently ~30 sec); upgrade plan only if v1.1+ needs preview deploys.

15. **Same commit pushed twice (`git push --force-with-lease` etc.).** Render rebuilds from scratch each time. Output is deterministic; the second deploy is a no-op for the served bytes.

16. **Two pushes in rapid succession.** Render queues; only the latest may matter for the final served version. Intermediate commits' build artifacts are discarded. No race condition in the served `dist/`.

17. **Local `node_modules` out of sync with `package-lock.json`.** `npm install` reconciles. If consistency is critical (CI), use `npm ci`. v1 doesn't require this — Render runs `npm install` per the dashboard config.

18. **Asset rename between commits.** A file removed from `assets/` and re-added with a different name results in two distinct files in successive `dist/` outputs. Old hashed file URLs become 404 after redeploy — fine, since no client should be holding stale URLs across versions.

---

## 6. Dependencies

**Upstream dependencies (Build / Deploy depends on):**

- **Toolchain:** `tsx` (TypeScript runner), `vite`, `vite-plugin-static-copy`,
  `@preact/preset-vite`. All declared in `package.json`.
- **Config Module:** Indirectly. The output path `public/traits.json` must
  align with `CONFIG.build.traitsJsonPath` (`/traits.json`). The transform
  script does NOT import `CONFIG` — coordination is by convention, enforced
  in code review. Importing config from a build-time script that runs
  before `vite build` would create awkward TypeScript-config + path-alias
  gymnastics; the few lines of duplication are cheaper.
- **Source data:** `design/data/robots-traits.csv` (committed to git).
- **Source code:** `src/**/*` (the Preact/TS/Three.js codebase).
- **External services:** Render static-site service (configured externally,
  GitHub-connected).

**Downstream dependents:**

| System | What it consumes | First read appears in |
|--------|------------------|------------------------|
| Robot Roster Loader | `public/traits.json` via `fetch('/traits.json')` | Sprint 5 |
| 85-Instance Skinned Mesh Renderer | Robot count + skin texture paths via Roster Loader (transitive) | S4-04 |
| Sprint Race Event Module | Trait values via Roster Loader (transitive) | Sprint 6 |
| Every system that runs in the browser | The bundled `dist/index.js` and copied `assets/` (transitive) | All |

Per `design-docs.md` rule, each downstream system's GDD must list Build /
Deploy Pipeline in its own Dependencies section when authored.

**Forbidden dependencies:**

- The transform script does NOT import from `src/` (no `@/config` imports,
  no Three.js, no Preact). Build-time tools and runtime code stay separated.
- The runtime does NOT import `traits.json` directly via `import`/`require`
  — that would inline the data into the JS bundle (defeating the
  architectural choice from Section 2). Always `fetch('/traits.json')` at
  runtime.
- The build does NOT depend on environment variables in v1. Once
  persistence enters in v1.1+, Supabase keys will be read via
  `import.meta.env.VITE_*` at runtime, never at build time.

---

## 7. Tuning Knobs

**None at runtime.** The Build / Deploy Pipeline runs at build time and
produces a static artifact. There are no runtime tuning knobs.

**Build-time constants** (hardcoded in the transform script, not "knobs"):

| Constant | Value | Where | Reason it's not a knob |
|----------|-------|-------|------------------------|
| Expected row count | 85 | `tools/build/traits-csv-to-json.ts` | Invariant of the v1 roster. Changing it requires CSV + GDD update, not a tweak. |
| Maximum trait sum | 100 | same | Spec invariant from `design/gdd/game-concept.md`. Cannot be raised without spec change. |
| Output path | `public/traits.json` | same | Locked v1 path (Section 2). Must match `CONFIG.build.traitsJsonPath`. |
| Required column names | `id, name, full_send, degen, cipher, doubter, altruist` | same | Defined by the CSV schema. Adding a column is a coordinated CSV + script + downstream-reader change. |

**Tunable elsewhere** (these affect the pipeline indirectly but live in
other systems):

| Knob | Lives in | Affects |
|------|----------|---------|
| `CONFIG.build.traitsJsonPath` | Config Module | The runtime fetch URL. Must match the transform's hardcoded output path. |
| Vite plugin order | `vite.config.ts` | Bundle behavior. `preact()` first, then `viteStaticCopy()`. |
| Render build/publish settings | Render dashboard | Build command, publish dir. Captured in Section 3 reference table; not in repo. |

---

## 8. Acceptance Criteria

**Direct criteria** (testable on S4-03 commit):

1. **Transform script exists.** `tools/build/traits-csv-to-json.ts` is
   present and committed.

2. **Run via npm.** `npm run build:traits` is defined in `package.json`
   and executes the script via `tsx`.

3. **Output file produced.** Running `npm run build:traits` creates
   `public/traits.json` with 85 records.

4. **Output schema correct.** Each record has keys `id`, `name`,
   `full_send`, `degen`, `cipher`, `doubter`, `altruist` of correct types
   (number, string, number, ...).

5. **Validation: row count.** Modifying the CSV to have 84 or 86 rows
   and running the script causes a non-zero exit with a clear stderr
   message.

6. **Validation: trait sum.** A row with traits summing to 101 causes a
   non-zero exit naming the row's id.

7. **Validation: duplicate id.** Two rows sharing an id cause a non-zero
   exit naming the duplicate.

8. **Validation: missing CSV.** Running the script with the CSV deleted
   causes a non-zero exit with a path-not-found message.

9. **Atomic write.** Inspect the script — writes use temp file +
   `fs.renameSync`, not direct `writeFileSync` to the final path.

10. **Gitignore.** `.gitignore` contains `public/traits.json`.

11. **Script chain — dev.** `npm run dev` runs `build:traits` before
    `vite`. Inspecting `package.json` confirms the chain.

12. **Script chain — build.** `npm run build` runs `build:traits` before
    `tsc && vite build`.

13. **`tsx` installed.** `tsx` appears in `package.json`
    `devDependencies`.

14. **Local build succeeds end-to-end.** `npm run build` produces
    `dist/index.html`, `dist/assets/*.js`, `dist/traits.json`, and
    `dist/assets/art/...`.

15. **Production deploy serves traits.** After pushing the S4-03 commits,
    `curl https://robo-rhapsody.onrender.com/traits.json` returns 200
    with valid JSON of 85 records.

**Discipline criteria** (enforced per PR going forward):

16. **Output path coordination.** Reviewers confirm the transform's
    output path matches `CONFIG.build.traitsJsonPath` whenever either
    changes. PR splitting these two changes across separate commits is
    rejected.

17. **No runtime CSV parsing.** Reviewers grep for CSV-related imports
    (`csv-parse`, `papaparse`, `d3-dsv`, etc.) in `src/`. Hits are
    rejected — CSV parsing is build-time only.
