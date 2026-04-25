import { useEffect, useRef, useState } from 'preact/hooks';
import { createRenderer } from './renderer/renderer';
import { CONFIG } from './config';

type LoadStatus = 'loading' | 'ready' | 'error';

interface RendererStats {
  fps: number;
  robotCount: number;
  loadStatus: LoadStatus;
  errorMessage?: string;
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<RendererStats>({
    fps: 0,
    robotCount: 0,
    loadStatus: 'loading',
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = createRenderer();
    let cancelled = false;
    let fpsRaf = 0;

    renderer
      .mount(container)
      .then(() => {
        if (cancelled) return;
        setStats((s) => ({
          ...s,
          robotCount: renderer.getAllInstances().length,
          loadStatus: 'ready',
        }));

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
      if (fpsRaf) cancelAnimationFrame(fpsRaf);
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
        <div>S4-04 — 85-Instance Renderer</div>
        <div>Robots: {stats.robotCount} / {CONFIG.renderer.robotCount}</div>
        <div>FPS: {stats.fps.toFixed(1)}</div>
        <div>Status: {stats.loadStatus}</div>
        {stats.errorMessage && (
          <div style={{ color: '#ff5577' }}>Error: {stats.errorMessage}</div>
        )}
      </div>
    </div>
  );
}
