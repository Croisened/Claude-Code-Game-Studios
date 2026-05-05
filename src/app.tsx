import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { createRenderer } from '@/renderer/renderer';
import { createAnimationStateSwitcher } from '@/animation/state-switcher';
import { createSimDriver } from '@/sim/sim-driver';
import { createSimRendererBridge } from '@/sim/sim-renderer-bridge';
import {
  createFollowLeaderCamera,
  type LeaderResolver,
} from '@/camera/follow-leader-camera';
import { createRobotShoulderCamera } from '@/camera/robot-shoulder-camera';
import { createWinnerCamera } from '@/camera/winner-camera';
import { createFinishLine } from '@/arena-visuals/finish-line';
import {
  createMazeWalls,
  createMazeFinishTree,
  getMazeFinishTreeWorldPos,
} from '@/arena-visuals/maze-walls';
import { createGauntletTraps } from '@/arena-visuals/gauntlet-traps';
import { runSim, type EventModule, type TimelineEvent } from '@/sim/engine';
import { createSprintRaceModule } from '@/sim/sprint-race';
import { createMazeRaceModule } from '@/sim/maze-race';
import { createObstacleGauntletModule } from '@/sim/obstacle-gauntlet';
import { generateMazeLayout } from '@/sim/maze';
import { loadRoster, type RobotRoster } from '@/sim/robot-roster';
import { loadArena, type Arena } from '@/sim/arena';
import { CONFIG } from '@/config';

type LoadStatus = 'loading' | 'ready' | 'error';

interface RaceStats {
  fps: number;
  robotCount: number;
  loadStatus: LoadStatus;
  seed: number;
  arenaId: string;
  totalTicks: number;
  currentTick: number;
  isDone: boolean;
  winnerId: number | null;
  errorMessage?: string;
}

/** Padding around the arena's race-direction (X) extent for the ground plane.
 *  The leader runs to arena.length; we want some floor past the finish line. */
const GROUND_PAD_X = 40;
/** Padding around the arena's lateral (Z) extent. Robots fan slightly off-axis
 *  due to chaos jitter; this gives margin without making the floor huge. */
const GROUND_PAD_Z = 40;

/**
 * Deep grove-floor green for the maze ground plane. Set a touch darker
 * than the finish-tree's canopy (`0x4f7d3e`) so the foliage reads as the
 * lighter green of the pair — fruit-bearing trees against shaded earth,
 * the way an orange grove looks from above.
 */
const MAZE_GROUND_COLOR = 0x3a5527;

/**
 * Gauntlet ground + sky palette. Both pulled near-black so the course
 * (a single course-width strip — see `arena.width` clamp below) reads
 * as a narrow path floating in a void. The faint warmth on the floor
 * (`0x050505`) keeps the ground from disappearing entirely under the
 * dark robots; pure black would lose the floor under the bridge.
 */
const GAUNTLET_BACKGROUND_COLOR = '#000000';
const GAUNTLET_GROUND_COLOR = 0x050505;
/**
 * Padding past the start grid so robots have a step or two of run-up
 * floor before the gauntlet "begins". Race-direction (X) only — the
 * lateral (Z) ground extent matches `arena.width` exactly so falling
 * sideways drops the robot into the void.
 */
const GAUNTLET_GROUND_PAD_X = 12;

/** Peek mode hides the dev HUD and shows a minimal training caption +
 *  back link. Triggered by any of the `#peek*` hashes from Landing. */
const PEEK_HASHES = ['#peek', '#peek-maze', '#peek-gauntlet'] as const;
function isPeekMode(): boolean {
  if (typeof window === 'undefined') return false;
  return PEEK_HASHES.includes(window.location.hash as (typeof PEEK_HASHES)[number]);
}

/**
 * Pick which arena JSON to load based on the URL hash.
 *
 * - `#peek`           → sprint race (Arena-01). Explicit opt-in for the
 *                       linear race; landing's "Sprint Race →" button
 *                       sends users here.
 * - `#peek-maze`      → maze race (Arena-02).
 * - `#peek-gauntlet`  → obstacle gauntlet (Arena-03).
 * - Anything else     → maze race. Dev (`npm run dev`, no hash) lands
 *                       here so iteration on the maze doesn't need a
 *                       hash on every reload.
 */
function arenaPathFromHash(): string {
  if (typeof window === 'undefined') return CONFIG.arena.mazeArenaPath;
  switch (window.location.hash) {
    case '#peek':
      return CONFIG.arena.defaultArenaPath;
    case '#peek-maze':
      return CONFIG.arena.mazeArenaPath;
    case '#peek-gauntlet':
      return CONFIG.arena.gauntletArenaPath;
    default:
      return CONFIG.arena.mazeArenaPath;
  }
}

/**
 * Generate a fresh uint32 seed for a new race. Uses Web Crypto rather
 * than `Math.random` (forbidden in `src/`); the sim itself is fully
 * deterministic given the seed. Falls back to a `Date.now()`-derived
 * value in environments lacking `crypto.getRandomValues` (vanishingly
 * rare in modern browsers; the fallback exists only so SSR / unit tests
 * don't crash).
 */
function pickRandomSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0];
  }
  return (Date.now() & 0xffffffff) >>> 0;
}

interface StaticCameraPlacement {
  readonly position: { x: number; y: number; z: number };
  readonly lookAt: { x: number; y: number; z: number };
}

interface ArenaSetup {
  readonly eventModule: EventModule;
  readonly sceneObjects: readonly THREE.Object3D[];
  readonly leaderResolver?: LeaderResolver;
  readonly cameraSettings?: typeof CONFIG.camera.follow | typeof CONFIG.camera.mazeFollow;
  /**
   * Per-frame visuals updater. Called by the App's rAF with the
   * current sim tick. Used by gauntlet visuals (hammer rotation,
   * bridge crumble, pit-fall door open + robot Y-drop) to stay
   * sim-authoritative — visuals derive their state from the same
   * tick the sim does, so browser and harness agree on what the
   * world looks like.
   */
  readonly visualsUpdate?: (tickFloat: number) => void;
  /**
   * Sim-event subscriber. Forwarded by the App from the bridge's
   * onEvent handler. Used by gauntlet to capture `pit_fall`
   * eliminations and trigger trap-door opens + per-robot Y drops.
   */
  readonly onSimEvent?: (event: TimelineEvent) => void;
  /**
   * If set, the camera is positioned to this fixed pose at mount and
   * never updated. Mutually exclusive with `leaderResolver` /
   * `cameraSettings` — a static camera doesn't need a follower.
   */
  readonly staticCameraPlacement?: StaticCameraPlacement;
  /**
   * If set, the App's camera effect can switch to a winner-portrait
   * camera when the race finishes. World-space (x, z) of the focal
   * landmark (e.g. the orange tree) so the camera can frame the winner
   * + landmark together. Sprint races leave this undefined.
   */
  readonly winnerCamTarget?: { readonly x: number; readonly z: number };
}

interface BuildArenaSetupOptions {
  readonly arena: Arena;
  readonly roster: Awaited<ReturnType<typeof loadRoster>>;
  readonly seed: number;
  readonly renderer: ReturnType<typeof createRenderer>;
}

/**
 * Assemble the arena-type-specific pieces: which event module to feed
 * into `runSim`, which scene objects (finish-line / maze walls / posts)
 * to drop into the renderer, and how the follow camera should pick its
 * leader and frame the action.
 *
 * The maze layout is generated *outside* the sim from the same seed —
 * the sim's rng is consumed inside `runSim` and isn't exposed here, so
 * we mint a sibling rng with the same seed for maze topology. Both are
 * deterministic per seed, so the layout the renderer/camera see matches
 * the layout the maze-race module steers along.
 */
function buildArenaSetup(opts: BuildArenaSetupOptions): ArenaSetup {
  const { arena, seed } = opts;
  switch (arena.type) {
    case 'sprint-race':
      return {
        eventModule: createSprintRaceModule(),
        sceneObjects: [createFinishLine(arena)],
      };

    case 'obstacle-gauntlet': {
      if (!arena.gauntletConfig) {
        throw new Error('obstacle-gauntlet arena loaded without gauntletConfig — loader bug');
      }
      const eventModule = createObstacleGauntletModule();
      const visuals = createGauntletTraps(arena);
      const bridge = arena.gauntletConfig.bridge;
      // The sim's GauntletState owns `bridgeEnteredTick` internally and
      // doesn't expose it. The renderer detects bridge entry by reading
      // robot positions each frame: when ANY active robot is past
      // bridge.xStart, set bridgeEnteredTick to the current sim tick.
      // This stays deterministic because the bridge poses come from
      // the same SimResult driving the sim's own state — the tick at
      // which the renderer observes "first robot past bridge.xStart"
      // matches the tick the sim observes.
      let bridgeEnteredTick: number | null = null;
      const renderer = opts.renderer;
      // Per-fallen-robot drop animation. Each pit_fall event records
      // the tick + robot id; visualsUpdate animates them dropping
      // from y=0 to y=-PIT_DROP_DEPTH_M over PIT_DROP_DURATION_TICKS.
      const PIT_DROP_DURATION_TICKS = 30; // ~500ms
      const PIT_DROP_DEPTH_M = 8;
      const fallenRobots = new Map<number, number>(); // robotId → fallTick
      const visualsUpdate = (tickFloat: number) => {
        if (bridgeEnteredTick === null) {
          const insts = renderer.getAllInstances();
          for (const inst of insts) {
            if (inst.root.position.x >= bridge.xStart) {
              bridgeEnteredTick = tickFloat;
              break;
            }
          }
        }
        visuals.update(tickFloat, bridgeEnteredTick, CONFIG.sim.tickRateHz);
        // Y-drop fallen robots. Bridge stops writing pose for inactive
        // robots, so once we set instance.y here it stays put without
        // being overwritten next frame.
        for (const [robotId, fallTick] of fallenRobots) {
          const inst = renderer.getInstance(robotId);
          if (!inst) continue;
          const ticksSince = tickFloat - fallTick;
          const dropProgress = Math.min(1, Math.max(0, ticksSince / PIT_DROP_DURATION_TICKS));
          inst.root.position.y = -dropProgress * PIT_DROP_DEPTH_M;
        }
      };
      const onSimEvent = (event: TimelineEvent) => {
        if (event.type !== 'elimination') return;
        if (event.reason !== 'pit_fall') return;
        const inst = renderer.getInstance(event.robotId);
        if (!inst) return;
        // Use the renderer's interpolated x (close to where the robot
        // was at the fall tick). The sim's authoritative x for that
        // tick is in result.poseFrames but the renderer's interpolated
        // value is good enough for "which trap door opened".
        visuals.triggerPitFall(inst.root.position.x, event.tick);
        fallenRobots.set(event.robotId, event.tick);
      };
      return {
        eventModule,
        sceneObjects: [createFinishLine(arena), visuals.group],
        visualsUpdate,
        onSimEvent,
        // Hero-cam landmark — mirrors the maze branch (which uses the
        // finish-tree). The winner-camera composes a portrait around the
        // midpoint of (winner pose, this landmark); the offset constants
        // in `createWinnerCamera` then sit the camera at ~8.5m at 45° off
        // that midpoint. The winner halts just past finishX, so feeding
        // the finish-line center here puts the camera in roughly the
        // same relationship to the winner that the maze cam has to the
        // tree-versus-winner pair.
        winnerCamTarget: { x: arena.length, z: 0 },
      };
    }

    case 'maze-race': {
      if (!arena.mazeConfig) {
        throw new Error('maze-race arena loaded without mazeConfig — loader bug');
      }
      const layout = generateMazeLayout({ config: arena.mazeConfig, seed });
      const wallsGroup = createMazeWalls(layout);
      const finishTree = createMazeFinishTree(layout);
      const eventModule = createMazeRaceModule({ layout });

      // Static camera. The maze is centered at world origin (length × width
      // square). A fixed-angle vantage that frames the entire grid keeps
      // the maze stationary in screen-space — no camera tracking, no leader
      // hysteresis, no jitter. Robots move *within* the frame.
      //
      // Camera distance scales with `arena.width` so a doubled maze stays
      // framed. Tilt is roughly 30° off vertical (atan(0.55 / 1.05)),
      // giving an isometric-feeling overhead with enough perspective to
      // read wall heights vs. floor.
      //
      // STAGING_BUFFER extends the framing past the maze grid edge so the
      // entrance-staging queues (which spawn ~10m OUTSIDE the cell grid;
      // see STAGING_PAD + STAGING_ROW_GAP × STAGING_LANES in
      // `src/sim/maze-race.ts`) all fit within the camera frustum. The
      // +Z staging is most sensitive to clipping because the camera sits
      // at +Z looking back toward origin — its FOV is tightest on that
      // edge.
      const STAGING_BUFFER = 16;
      const halfMaze = Math.max(arena.length, arena.width) / 2 + STAGING_BUFFER;
      const camY = halfMaze * 2.1;
      const camZ = halfMaze * 1.1;
      const staticCameraPlacement: StaticCameraPlacement = {
        position: { x: 0, y: camY, z: camZ },
        lookAt: { x: 0, y: 0, z: 0 },
      };

      return {
        eventModule,
        sceneObjects: [wallsGroup, finishTree],
        staticCameraPlacement,
        winnerCamTarget: getMazeFinishTreeWorldPos(layout),
      };
    }

    default: {
      // Exhaustive guard. When S7-04 adds 'obstacle-gauntlet' to the
      // ArenaType union, TypeScript flags this as a never-narrow
      // violation and forces the new arm to land.
      const _exhaustive: never = arena.type;
      throw new Error(`unknown arena.type: ${String(_exhaustive)}`);
    }
  }
}

/** Per-mounted-scene state used by the camera effect to attach handlers. */
interface SceneRefs {
  renderer: ReturnType<typeof createRenderer>;
  camera: THREE.PerspectiveCamera;
  built: ArenaSetup;
}

export function App() {
  const peekMode = isPeekMode();
  const containerRef = useRef<HTMLDivElement>(null);
  // A fresh seed is picked on first mount and on every Race Again click.
  // The useEffect below depends on `seed`, so changing it triggers full
  // teardown + remount.
  const [seed, setSeed] = useState<number>(() => pickRandomSeed());
  // null = arena cam (static or follow-leader, picked by arena type).
  // number = follow that robot id over-the-shoulder.
  const [cameraTargetId, setCameraTargetId] = useState<number | null>(null);
  // True after the user has clicked Arena post-race-end. Suppresses the
  // winner-cam auto-switch so the user can keep the wide static view.
  // Reset on every Race Again so each new race gets its own portrait.
  const [winnerCamSuppressed, setWinnerCamSuppressed] = useState(false);
  // Loaded roster — kept in state so the WinnerCard can read the
  // winner's name + traits after the race ends. Null while loading.
  const [roster, setRoster] = useState<RobotRoster | null>(null);
  // Bumped each time the main effect finishes building the scene. The
  // camera effect keys off this so it knows when refs are ready.
  const [sceneVersion, setSceneVersion] = useState(0);
  const sceneRefs = useRef<SceneRefs | null>(null);
  const [stats, setStats] = useState<RaceStats>({
    fps: 0,
    robotCount: 0,
    loadStatus: 'loading',
    seed,
    arenaId: '',
    totalTicks: 0,
    currentTick: 0,
    isDone: false,
    winnerId: null,
  });

  const handleRaceAgain = () => {
    setSeed(pickRandomSeed());
    setCameraTargetId(null);
    setWinnerCamSuppressed(false);
  };

  useEffect(() => {
    // Reset transient race fields on (re)mount so the HUD doesn't briefly
    // show last race's winner / final tick while assets reload.
    setStats((s) => ({
      ...s,
      loadStatus: 'loading',
      seed,
      winnerId: null,
      isDone: false,
      currentTick: 0,
      totalTicks: 0,
      errorMessage: undefined,
    }));

    const container = containerRef.current;
    if (!container) return;

    // Camera built up-front so it can be passed into renderer.mount(). The
    // follower mutates this camera each frame — it never replaces it.
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      500,
    );

    let renderer: ReturnType<typeof createRenderer> | null = null;
    let switcher: ReturnType<typeof createAnimationStateSwitcher> | null = null;
    let bridge: ReturnType<typeof createSimRendererBridge> | null = null;
    let cancelled = false;
    let fpsRaf = 0;

    (async () => {
      try {
        // Arena loads first so the renderer can size its ground plane to
        // the race course. Roster loads in parallel — independent fetch.
        const arenaPath = arenaPathFromHash();
        const [arena, loadedRoster] = await Promise.all([
          loadArena({ arenaPath }),
          loadRoster(),
        ]);
        if (cancelled) return;
        // Stash roster for the WinnerCard. Stat scaffold + sim still
        // use the local `loadedRoster` reference below to keep the
        // sim setup synchronous with the load.
        setRoster(loadedRoster);
        const roster = loadedRoster;

        // Sprint races run along +X (length × width oriented). Maze
        // arenas are square grids centered on the origin (length and
        // width are equal). Ground extents differ per arena type.
        const isMaze = arena.type === 'maze-race';
        const isGauntlet = arena.type === 'obstacle-gauntlet';
        const groundExtents = isMaze
          ? {
              sizeX: arena.length + GROUND_PAD_X * 2,
              sizeZ: arena.width + GROUND_PAD_Z * 2,
              centerX: 0,
              centerZ: 0,
            }
          : isGauntlet
          ? {
              // Lateral extent matches the course (= bridge) width
              // exactly. Robots that drift past ±arena.width/2 fall
              // off the floor into the black void — the visual cue
              // that conveys "danger". X gets a small pad so the
              // start grid + finish band still have floor under them.
              sizeX: arena.length + GAUNTLET_GROUND_PAD_X * 2,
              sizeZ: arena.width,
              centerX: arena.length / 2,
              centerZ: 0,
            }
          : {
              sizeX: arena.length + GROUND_PAD_X * 2,
              sizeZ: arena.width + GROUND_PAD_Z * 2,
              centerX: arena.length / 2,
              centerZ: 0,
            };

        renderer = createRenderer({
          placePlaceholderGrid: false,
          groundExtents,
          groundColor: isMaze
            ? MAZE_GROUND_COLOR
            : isGauntlet
            ? GAUNTLET_GROUND_COLOR
            : undefined,
          backgroundColor: isGauntlet ? GAUNTLET_BACKGROUND_COLOR : undefined,
        });
        await renderer.mount(container, camera);
        if (cancelled) return;

        // Build the deterministic race result + visuals + leader rule
        // for the chosen arena type.
        const built = buildArenaSetup({ arena, roster, seed, renderer });
        for (const obj of built.sceneObjects) {
          renderer.addToScene(obj);
        }
        const result = runSim({
          seed,
          roster,
          arena,
          eventModule: built.eventModule,
          maxTicks: arena.maxTicks,
        });
        const driver = createSimDriver({ result });

        switcher = createAnimationStateSwitcher(renderer);
        bridge = createSimRendererBridge({
          renderer,
          switcher,
          driver,
          onEvent: (event) => {
            if (event.type === 'simEnd') {
              setStats((s) => ({ ...s, winnerId: event.winnerId }));
            }
            built.onSimEvent?.(event);
          },
        });
        bridge.start();

        // The camera effect (separate `useEffect`) reads these refs and
        // attaches whatever follow handler matches the current camera
        // target. Doing it here instead of inline keeps switching modes
        // mid-race cheap (no renderer / sim teardown).
        sceneRefs.current = { renderer, camera, built };
        setSceneVersion((v) => v + 1);

        setStats((s) => ({
          ...s,
          robotCount: renderer!.getAllInstances().length,
          loadStatus: 'ready',
          seed,
          arenaId: arena.id,
          totalTicks: result.ticks,
        }));

        // Lightweight per-frame stats sampler — piggy-backs on rAF without
        // touching the renderer or bridge internals. FPS is averaged over
        // ~1 s windows; current tick polls the driver each frame. Once the
        // driver reports done, we pin the displayed tick to totalTicks so
        // the HUD reads "ticks/ticks (100%)" rather than "ticks-1/ticks".
        let frameCount = 0;
        let lastSampleAt = performance.now();
        const sampleStats = () => {
          if (cancelled) return;
          frameCount++;
          const now = performance.now();
          const done = driver.isDone();
          const tick = done ? driver.getTotalTicks() : driver.getCurrentTick();
          // Per-arena visuals updater (gauntlet hammer rotation +
          // bridge crumble). Runs every frame against the integer
          // sim tick — the sub-tick lag is < 17 ms which is
          // imperceptible for a swinging hammer.
          built.visualsUpdate?.(tick);
          if (now - lastSampleAt >= 1000) {
            const fps = (frameCount * 1000) / (now - lastSampleAt);
            setStats((s) => ({ ...s, fps, currentTick: tick, isDone: done }));
            frameCount = 0;
            lastSampleAt = now;
          } else {
            setStats((s) => ({ ...s, currentTick: tick, isDone: done }));
          }
          fpsRaf = requestAnimationFrame(sampleStats);
        };
        fpsRaf = requestAnimationFrame(sampleStats);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStats((s) => ({ ...s, loadStatus: 'error', errorMessage: msg }));
      }
    })();

    return () => {
      cancelled = true;
      if (fpsRaf) cancelAnimationFrame(fpsRaf);
      // Disposal order: bridge (writes to instance.root) → switcher
      // (reads renderer-owned mixers) → renderer. The camera handle is
      // owned by the camera effect, which tears down on `sceneVersion`
      // change before the new scene mounts — no double-dispose risk.
      sceneRefs.current = null;
      bridge?.dispose();
      switcher?.dispose();
      renderer?.dispose();
    };
  }, [seed]);

  // Camera effect — toggles between arena cam (static / leader-follow,
  // depending on arena type), over-the-shoulder for a specific robot,
  // and the winner-portrait cam that auto-activates on race-end.
  // Re-runs whenever the scene is rebuilt, the user changes the
  // explicit target, the suppression toggle changes, or the race ends
  // and a winner is announced. Switching cameras mid-race does NOT
  // touch the renderer, sim driver, or bridge: only the camera handle.
  //
  // Mode priority:
  //   1. Explicit shoulder follow (`cameraTargetId !== null`).
  //   2. Auto winner portrait (race done + winner + tree target +
  //      `winnerCamSuppressed === false`).
  //   3. Static / follow-leader arena cam, depending on arena type.
  useEffect(() => {
    if (sceneVersion === 0) return;
    const refs = sceneRefs.current;
    if (!refs) return;

    let handle: { dispose: () => void } | null = null;

    const shouldShowWinner =
      cameraTargetId === null &&
      !winnerCamSuppressed &&
      stats.isDone &&
      stats.winnerId !== null &&
      refs.built.winnerCamTarget !== undefined;

    if (cameraTargetId !== null) {
      const sh = createRobotShoulderCamera({
        camera: refs.camera,
        renderer: refs.renderer,
        targetRobotId: cameraTargetId,
      });
      sh.start();
      handle = sh;
    } else if (shouldShowWinner) {
      const wc = createWinnerCamera({
        camera: refs.camera,
        renderer: refs.renderer,
        winnerRobotId: stats.winnerId as number,
        treeWorldPos: refs.built.winnerCamTarget!,
      });
      wc.start();
      handle = wc;
    } else if (refs.built.staticCameraPlacement) {
      // Snap once and leave the camera alone.
      const p = refs.built.staticCameraPlacement.position;
      const l = refs.built.staticCameraPlacement.lookAt;
      refs.camera.position.set(p.x, p.y, p.z);
      refs.camera.lookAt(l.x, l.y, l.z);
      handle = { dispose: () => {} };
    } else {
      const f = createFollowLeaderCamera({
        camera: refs.camera,
        renderer: refs.renderer,
        leaderResolver: refs.built.leaderResolver,
        settings: refs.built.cameraSettings,
      });
      f.start();
      handle = f;
    }

    return () => {
      handle?.dispose();
    };
  }, [
    sceneVersion,
    cameraTargetId,
    winnerCamSuppressed,
    stats.isDone,
    stats.winnerId,
  ]);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {peekMode ? (
        <PeekOverlay
          loadStatus={stats.loadStatus}
          errorMessage={stats.errorMessage}
          arenaId={stats.arenaId}
          onRaceAgain={handleRaceAgain}
        />
      ) : (
        <DevHud stats={stats} />
      )}
      <CameraControl
        targetId={cameraTargetId}
        robotCount={stats.robotCount || CONFIG.renderer.robotCount}
        winnerCamActive={
          cameraTargetId === null &&
          !winnerCamSuppressed &&
          stats.isDone &&
          stats.winnerId !== null
        }
        onSetTarget={setCameraTargetId}
        onForceArena={() => {
          setCameraTargetId(null);
          setWinnerCamSuppressed(true);
        }}
      />
      {roster &&
        cameraTargetId === null &&
        !winnerCamSuppressed &&
        stats.isDone &&
        stats.winnerId !== null && (
          <WinnerCard winner={roster[stats.winnerId]} />
        )}
    </div>
  );
}

interface CameraControlProps {
  targetId: number | null;
  robotCount: number;
  winnerCamActive: boolean;
  onSetTarget: (id: number | null) => void;
  onForceArena: () => void;
}

/**
 * Top-right toggle: an "Arena" button + a "Robot #" input + an optional
 * "WIN" indicator that lights up when the auto-winner-cam is active.
 *
 * - Arena button clears any shoulder follow AND suppresses the winner
 *   cam, snapping to the wide static arena view.
 * - Robot # input parses an id on Enter / blur; in-range values switch
 *   to the over-the-shoulder cam.
 * - WIN indicator is purely informational: it pulses while the
 *   winner-portrait cam is up.
 */
function CameraControl({
  targetId,
  robotCount,
  winnerCamActive,
  onSetTarget,
  onForceArena,
}: CameraControlProps) {
  const [text, setText] = useState<string>(targetId === null ? '' : String(targetId));

  // Keep the input in sync if the parent clears the target externally.
  useEffect(() => {
    setText(targetId === null ? '' : String(targetId));
  }, [targetId]);

  const apply = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      onSetTarget(null);
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 0 || n >= robotCount) {
      onSetTarget(null);
      setText('');
      return;
    }
    onSetTarget(n);
  };

  // Effective mode drives the visual highlighting. Note that "arena"
  // here just means "not shoulder, not winner" — it covers both the
  // normal in-race view and the user-forced wide view post-race.
  const isShoulder = targetId !== null;
  const isWinner = !isShoulder && winnerCamActive;
  const isArenaActive = !isShoulder && !isWinner;

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 8px',
        background: 'rgba(0, 0, 0, 0.6)',
        color: '#e6e6e6',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12,
        borderRadius: 6,
        backdropFilter: 'blur(4px)',
      }}
    >
      <span style={{ color: '#8a8a96', letterSpacing: '0.06em' }}>CAM</span>
      <button
        type="button"
        onClick={onForceArena}
        style={{
          padding: '3px 8px',
          fontSize: 12,
          fontFamily: 'inherit',
          background: isArenaActive ? '#22e6ff' : 'transparent',
          color: isArenaActive ? '#0a0a0f' : '#e6e6e6',
          border: `1px solid ${isArenaActive ? '#22e6ff' : '#8a8a96'}`,
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Arena
      </button>
      {isWinner && (
        <span
          style={{
            padding: '3px 8px',
            fontSize: 12,
            fontFamily: 'inherit',
            color: '#0a0a0f',
            background: '#ff2ec4',
            border: '1px solid #ff2ec4',
            borderRadius: 4,
            letterSpacing: '0.08em',
            boxShadow: '0 0 12px rgba(255, 46, 196, 0.7)',
          }}
        >
          WIN
        </span>
      )}
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder="Robot #"
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        onBlur={apply}
        style={{
          width: 64,
          padding: '3px 6px',
          fontSize: 12,
          fontFamily: 'inherit',
          background: targetId !== null ? 'rgba(34, 230, 255, 0.15)' : 'rgba(255,255,255,0.05)',
          color: '#e6e6e6',
          border: `1px solid ${targetId !== null ? '#22e6ff' : '#8a8a96'}`,
          borderRadius: 4,
          outline: 'none',
        }}
      />
    </div>
  );
}

interface DevHudProps {
  stats: RaceStats;
}

function DevHud({ stats }: DevHudProps) {
  const progress =
    stats.totalTicks > 0 ? Math.min(100, (stats.currentTick / stats.totalTicks) * 100) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '8px 12px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: '#22e6ff',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.6,
        borderRadius: 6,
        pointerEvents: 'none',
      }}
    >
      <div>Robo Rhapsody Sim — Dev HUD</div>
      <div>Robots: {stats.robotCount} / {CONFIG.renderer.robotCount}</div>
      <div>FPS: {stats.fps.toFixed(1)}</div>
      <div>Status: {stats.loadStatus}</div>
      {stats.loadStatus === 'ready' && (
        <>
          <div>Arena: {stats.arenaId} · Seed: {stats.seed}</div>
          <div>
            Tick: {stats.currentTick} / {stats.totalTicks} ({progress.toFixed(0)}%)
          </div>
          <div>
            Winner:{' '}
            {stats.winnerId !== null ? `robot ${stats.winnerId}` : '—'}
          </div>
        </>
      )}
      {stats.errorMessage && (
        <div style={{ color: '#ff5577' }}>Error: {stats.errorMessage}</div>
      )}
    </div>
  );
}

interface PeekOverlayProps {
  loadStatus: LoadStatus;
  errorMessage?: string;
  arenaId: string;
  onRaceAgain: () => void;
}

const peekButtonStyle = {
  color: 'rgba(230, 230, 230, 0.85)',
  textDecoration: 'none',
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
  fontSize: 14,
  letterSpacing: '0.04em',
  padding: '6px 10px',
  background: 'rgba(0, 0, 0, 0.35)',
  borderRadius: 6,
  backdropFilter: 'blur(4px)',
  border: 'none',
  cursor: 'pointer',
} as const;

function PeekOverlay({ loadStatus, errorMessage, arenaId, onRaceAgain }: PeekOverlayProps) {
  const caption =
    arenaId === 'arena-02'
      ? 'MAZE RACE · ARENA 02'
      : arenaId === 'arena-03'
        ? 'OBSTACLE GAUNTLET · ARENA 03'
        : 'SPRINT RACE · ARENA 01';
  const goBack = (e: MouseEvent) => {
    e.preventDefault();
    window.location.hash = '';
  };
  const raceAgain = (e: MouseEvent) => {
    e.preventDefault();
    onRaceAgain();
  };
  return (
    <>
      {/* Top-left controls — Back + Race Again, low-key */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 18,
          display: 'flex',
          gap: 8,
        }}
      >
        <a href="#" onClick={goBack} style={peekButtonStyle}>
          ← Back
        </a>
        <button
          type="button"
          onClick={raceAgain}
          disabled={loadStatus === 'loading'}
          style={{
            ...peekButtonStyle,
            opacity: loadStatus === 'loading' ? 0.5 : 1,
            cursor: loadStatus === 'loading' ? 'wait' : 'pointer',
          }}
        >
          ↻ Race Again
        </button>
      </div>

      {/* Training caption — bottom-left, mono, low opacity */}
      <div
        style={{
          position: 'absolute',
          bottom: 18,
          left: 18,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12,
          letterSpacing: '0.16em',
          color: 'rgba(230, 230, 230, 0.55)',
          pointerEvents: 'none',
        }}
      >
        {caption}
      </div>

      {/* Loading + error states only */}
      {loadStatus === 'loading' && (
        <div style={overlayCenter}>Loading robots…</div>
      )}
      {loadStatus === 'error' && (
        <div style={{ ...overlayCenter, color: '#ff5577' }}>
          Couldn't load the training scene{errorMessage ? `: ${errorMessage}` : '.'}
        </div>
      )}
    </>
  );
}

const overlayCenter = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
  fontSize: 16,
  color: 'rgba(230, 230, 230, 0.85)',
  background: 'rgba(0, 0, 0, 0.55)',
  padding: '12px 20px',
  borderRadius: 8,
  pointerEvents: 'none' as const,
} as const;

// --- Winner Card ------------------------------------------------------
//
// Cyberpunk info panel anchored to the right side of the viewport,
// vertically centered. Rendered when the winner camera is active. The
// winner camera frames its subjects toward screen-left, leaving the
// right side clean for this panel.
//
// Palette mirrors the landing page (`src/landing.tsx`):
//   - bg: #0a0a0f
//   - text: #e6e6e6 / #8a8a96 dim
//   - brand pink: #ff2ec4
//   - accent cyan: #22e6ff

const TRAIT_COLORS: Record<string, string> = {
  'FULL SEND': '#ff2ec4',
  DEGEN: '#ffb84a',
  CIPHER: '#22e6ff',
  DOUBTER: '#a288ff',
  ALTRUIST: '#7dff9e',
};

interface WinnerCardProps {
  winner: import('@/sim/robot-roster').RobotRosterEntry;
}

function WinnerCard({ winner }: WinnerCardProps) {
  const rows: ReadonlyArray<readonly [string, number]> = [
    ['FULL SEND', winner.traits.fullSend],
    ['DEGEN', winner.traits.degen],
    ['CIPHER', winner.traits.cipher],
    ['DOUBTER', winner.traits.doubter],
    ['ALTRUIST', winner.traits.altruist],
  ];

  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 300,
        padding: '18px 18px 16px',
        background: 'rgba(10, 10, 15, 0.88)',
        border: '1px solid #22e6ff',
        borderRadius: 10,
        boxShadow:
          '0 0 24px rgba(34, 230, 255, 0.35), inset 0 0 12px rgba(255, 46, 196, 0.08)',
        backdropFilter: 'blur(6px)',
        color: '#e6e6e6',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        pointerEvents: 'none',
      }}
    >
      {/* Header: WINNER tag + ID */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            color: '#ff2ec4',
            fontSize: 11,
            letterSpacing: '0.18em',
            textShadow: '0 0 8px rgba(255, 46, 196, 0.6)',
          }}
        >
          ▍ WINNER
        </span>
        <span style={{ color: '#8a8a96', fontSize: 11, letterSpacing: '0.12em' }}>
          ID&nbsp;
          <span style={{ color: '#22e6ff' }}>
            #{String(winner.id).padStart(2, '0')}
          </span>
        </span>
      </div>

      {/* Name */}
      <div
        style={{
          fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '-0.01em',
          textShadow: '0 0 12px rgba(255, 46, 196, 0.45)',
          marginBottom: 14,
          wordBreak: 'break-word',
        }}
      >
        {winner.name}
      </div>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background:
            'linear-gradient(90deg, transparent, rgba(34, 230, 255, 0.5), transparent)',
          marginBottom: 12,
        }}
      />

      {/* Traits */}
      <div style={{ fontSize: 11, letterSpacing: '0.06em' }}>
        {rows.map(([label, value]) => (
          <TraitBar key={label} label={label} value={value} />
        ))}
      </div>

      {/* Footer marker */}
      <div
        style={{
          marginTop: 12,
          fontSize: 10,
          color: '#8a8a96',
          letterSpacing: '0.18em',
          textAlign: 'right',
        }}
      >
        ROBO_RHAPSODY · v0.1
      </div>
    </div>
  );
}

interface TraitBarProps {
  label: string;
  value: number;
}

function TraitBar({ label, value }: TraitBarProps) {
  const color = TRAIT_COLORS[label] ?? '#22e6ff';
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 3,
          color: color,
        }}
      >
        <span>{label}</span>
        <span style={{ color: '#e6e6e6' }}>{String(value).padStart(2, ' ')}</span>
      </div>
      <div
        style={{
          width: '100%',
          height: 4,
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>
    </div>
  );
}
