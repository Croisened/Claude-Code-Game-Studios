import { useEffect, useRef, useState } from 'preact/hooks';
import { createRenderer } from '@/renderer/renderer';
import { createAnimationStateSwitcher } from '@/animation/state-switcher';
import type { RobotAnimationState } from '@/animation/types';
import { CONFIG } from '@/config';

type LoadStatus = 'loading' | 'ready' | 'error';

interface RendererStats {
  fps: number;
  robotCount: number;
  loadStatus: LoadStatus;
  cycleState: RobotAnimationState;
  errorMessage?: string;
}

const CYCLE_ORDER: RobotAnimationState[] = ['idle', 'run', 'death'];
const CYCLE_INTERVAL_MS = 3000;

/** Peek mode hides the dev HUD and shows a minimal training caption +
 *  back link. Triggered by the '#peek' hash from the Landing page. */
function isPeekMode(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#peek';
}

export function App() {
  const peekMode = isPeekMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<RendererStats>({
    fps: 0,
    robotCount: 0,
    loadStatus: 'loading',
    cycleState: 'idle',
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = createRenderer();
    let switcher: ReturnType<typeof createAnimationStateSwitcher> | null = null;
    let cancelled = false;
    let fpsRaf = 0;
    let cycleTimer: ReturnType<typeof setInterval> | null = null;

    renderer
      .mount(container)
      .then(() => {
        if (cancelled) return;
        switcher = createAnimationStateSwitcher(renderer);
        // Robots are already 'idle' (switcher default = CYCLE_ORDER[0]).
        // Don't re-set on tick 0 — that would be 85 no-op calls.
        setStats((s) => ({
          ...s,
          robotCount: renderer.getAllInstances().length,
          loadStatus: 'ready',
          cycleState: CYCLE_ORDER[0],
        }));

        // Demo cycle: every 3 seconds, advance to the next state. Lives in
        // the App Shell, not the renderer or switcher — Sprint 5+ replaces
        // this with sim-driven state changes.
        let cycleIdx = 0;
        cycleTimer = setInterval(() => {
          if (cancelled || !switcher) return;
          cycleIdx = (cycleIdx + 1) % CYCLE_ORDER.length;
          const nextState = CYCLE_ORDER[cycleIdx];
          for (let id = 0; id < CONFIG.renderer.robotCount; id++) {
            switcher.setState(id, nextState);
          }
          setStats((s) => ({ ...s, cycleState: nextState }));
        }, CYCLE_INTERVAL_MS);

        // Standalone FPS counter that piggy-backs on rAF without touching
        // the renderer's internals.
        let frameCount = 0;
        let lastSampleAt = performance.now();
        const sampleFps = () => {
          if (cancelled) return;
          frameCount++;
          const now = performance.now();
          if (now - lastSampleAt >= 1000) {
            const fps = (frameCount * 1000) / (now - lastSampleAt);
            setStats((s) => ({ ...s, fps }));
            frameCount = 0;
            lastSampleAt = now;
          }
          fpsRaf = requestAnimationFrame(sampleFps);
        };
        fpsRaf = requestAnimationFrame(sampleFps);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStats((s) => ({ ...s, loadStatus: 'error', errorMessage: msg }));
      });

    return () => {
      cancelled = true;
      if (cycleTimer) clearInterval(cycleTimer);
      if (fpsRaf) cancelAnimationFrame(fpsRaf);
      // Switcher must dispose before the renderer (it reads renderer-owned
      // mixers; reverse order would touch disposed mixers).
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
  stats: RendererStats;
}

function DevHud({ stats }: DevHudProps) {
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
      <div>S4-05 — Renderer + State Switcher</div>
      <div>Robots: {stats.robotCount} / {CONFIG.renderer.robotCount}</div>
      <div>FPS: {stats.fps.toFixed(1)}</div>
      <div>Status: {stats.loadStatus}</div>
      <div>Cycle: {stats.cycleState}</div>
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
        ROBOT TRAINING · DAY 1
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
