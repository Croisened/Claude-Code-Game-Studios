import { useEffect, useRef, useState } from 'preact/hooks';
import { mountRendererSpike } from './renderer/renderer-spike';

interface SpikeStats {
  fps: number;
  drawCalls: number;
  robotCount: number;
  loadStatus: 'loading' | 'ready' | 'error';
  errorMessage?: string;
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<SpikeStats>({
    fps: 0,
    drawCalls: 0,
    robotCount: 0,
    loadStatus: 'loading',
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const dispose = mountRendererSpike(containerRef.current, setStats);
    return dispose;
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
        <div>S4-04 SPIKE — 85-Instance Renderer</div>
        <div>Robots: {stats.robotCount}</div>
        <div>FPS: {stats.fps.toFixed(1)}</div>
        <div>Draw calls: {stats.drawCalls}</div>
        <div>Status: {stats.loadStatus}</div>
        {stats.errorMessage && (
          <div style={{ color: '#ff5577' }}>Error: {stats.errorMessage}</div>
        )}
      </div>
    </div>
  );
}
