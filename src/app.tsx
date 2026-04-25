import { useEffect, useRef, useState } from 'preact/hooks';
import { createRenderer } from './renderer/renderer';
import { createAnimationStateSwitcher } from './animation/state-switcher';
import type { RobotAnimationState } from './animation/state-switcher';
import { CONFIG } from './config';

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

export function App() {
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
    </div>
  );
}
