import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { createRenderer } from '@/renderer/renderer';
import { createAnimationStateSwitcher } from '@/animation/state-switcher';
import { createSimDriver } from '@/sim/sim-driver';
import { createSimRendererBridge } from '@/sim/sim-renderer-bridge';
import { createFollowLeaderCamera } from '@/camera/follow-leader-camera';
import { runSim } from '@/sim/engine';
import { createSprintRaceModule } from '@/sim/sprint-race';
import { loadRoster } from '@/sim/robot-roster';
import { loadArena } from '@/sim/arena';
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
  winnerId: number | null;
  errorMessage?: string;
}

/** Peek mode hides the dev HUD and shows a minimal training caption +
 *  back link. Triggered by the '#peek' hash from the Landing page. */
function isPeekMode(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#peek';
}

export function App() {
  const peekMode = isPeekMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<RaceStats>({
    fps: 0,
    robotCount: 0,
    loadStatus: 'loading',
    seed: CONFIG.sim.defaultSeed,
    arenaId: '',
    totalTicks: 0,
    currentTick: 0,
    winnerId: null,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Renderer skips the placeholder grid layout because the sim's first
    // pose write (frame 1 of the bridge loop) overrides positions anyway.
    // Robots remain stacked at origin for the brief moment between mount
    // and the first bridge tick — invisible to the eye.
    const renderer = createRenderer({ placePlaceholderGrid: false });
    // Camera built up-front so it can be passed into mount(). The follower
    // mutates this camera each frame — it never replaces it.
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      500,
    );
    let switcher: ReturnType<typeof createAnimationStateSwitcher> | null = null;
    let bridge: ReturnType<typeof createSimRendererBridge> | null = null;
    let follower: ReturnType<typeof createFollowLeaderCamera> | null = null;
    let cancelled = false;
    let fpsRaf = 0;
    let tickRaf = 0;

    Promise.all([renderer.mount(container, camera), loadRoster(), loadArena()])
      .then(([, roster, arena]) => {
        if (cancelled) return;

        // Build the deterministic race result, then a driver to play it.
        const result = runSim({
          seed: CONFIG.sim.defaultSeed,
          roster,
          arena,
          eventModule: createSprintRaceModule(),
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
          },
        });
        bridge.start();

        follower = createFollowLeaderCamera({ camera, renderer });
        follower.start();

        setStats((s) => ({
          ...s,
          robotCount: renderer.getAllInstances().length,
          loadStatus: 'ready',
          seed: CONFIG.sim.defaultSeed,
          arenaId: arena.id,
          totalTicks: result.ticks,
        }));

        // Lightweight per-frame stats sampler — piggy-backs on rAF without
        // touching the renderer or bridge internals. FPS is averaged over
        // ~1 s windows; current tick polls the driver each frame.
        let frameCount = 0;
        let lastSampleAt = performance.now();
        const sampleStats = () => {
          if (cancelled) return;
          frameCount++;
          const now = performance.now();
          if (now - lastSampleAt >= 1000) {
            const fps = (frameCount * 1000) / (now - lastSampleAt);
            setStats((s) => ({ ...s, fps, currentTick: driver.getCurrentTick() }));
            frameCount = 0;
            lastSampleAt = now;
          } else {
            setStats((s) => ({ ...s, currentTick: driver.getCurrentTick() }));
          }
          fpsRaf = requestAnimationFrame(sampleStats);
        };
        fpsRaf = requestAnimationFrame(sampleStats);
        tickRaf = fpsRaf;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStats((s) => ({ ...s, loadStatus: 'error', errorMessage: msg }));
      });

    return () => {
      cancelled = true;
      if (fpsRaf) cancelAnimationFrame(fpsRaf);
      if (tickRaf && tickRaf !== fpsRaf) cancelAnimationFrame(tickRaf);
      // Disposal order: follower (only mutates camera) → bridge (writes
      // to instance.root) → switcher (reads renderer-owned mixers) →
      // renderer. Reverse order would touch disposed objects.
      follower?.dispose();
      bridge?.dispose();
      switcher?.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {peekMode ? (
        <PeekOverlay loadStatus={stats.loadStatus} errorMessage={stats.errorMessage} />
      ) : (
        <DevHud stats={stats} />
      )}
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
      <div>S6-02 — Sim ↔ Renderer Bridge</div>
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
}

function PeekOverlay({ loadStatus, errorMessage }: PeekOverlayProps) {
  const goBack = (e: MouseEvent) => {
    e.preventDefault();
    window.location.hash = '';
  };
  return (
    <>
      {/* Back link — top-left, low-key */}
      <a
        href="#"
        onClick={goBack}
        style={{
          position: 'absolute',
          top: 16,
          left: 18,
          color: 'rgba(230, 230, 230, 0.85)',
          textDecoration: 'none',
          fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
          fontSize: 14,
          letterSpacing: '0.04em',
          padding: '6px 10px',
          background: 'rgba(0, 0, 0, 0.35)',
          borderRadius: 6,
          backdropFilter: 'blur(4px)',
        }}
      >
        ← Back
      </a>

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
        SPRINT RACE · ARENA 01
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
