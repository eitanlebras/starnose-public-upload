'use client';

import { useEffect, useState, useRef } from 'react';
import { createEventSource, getLive, type LiveData, type FileRef } from '@/lib/api';
import { formatTokens, truncatePath } from '@/lib/format';

export default function LivePanel() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let mounted = true;

    async function init() {
      try {
        const data = await getLive();
        if (mounted) setLive(data);
      } catch {
        if (mounted) setError('Proxy not reachable');
        return;
      }

      try {
        es = createEventSource();
        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as LiveData;
            if (mounted) {
              setLive(data);
              setError(null);
            }
          } catch {
            // ignore parse errors
          }
        };
        es.onerror = () => {
          if (mounted) setError('SSE connection lost');
        };
      } catch {
        if (mounted) setError('Could not connect to event stream');
      }
    }

    init();

    return () => {
      mounted = false;
      es?.close();
    };
  }, []);

  // Draw sparkline
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live?.tokenHistory?.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const data = live.tokenHistory;
    const max = Math.max(...data, 1);

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#9D7F8C';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h - (data[i] / max) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill area under
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(157, 127, 140, 0.1)';
    ctx.fill();
  }, [live?.tokenHistory]);

  if (error) {
    return (
      <div style={{
        border: '1px solid #2A2A2A',
        borderRadius: '2px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <div style={{ color: '#505050', fontSize: '12px' }}>{error}</div>
      </div>
    );
  }

  if (!live) {
    return (
      <div style={{
        border: '1px solid #2A2A2A',
        borderRadius: '2px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <div style={{ color: '#505050', fontSize: '12px' }}>Connecting...</div>
      </div>
    );
  }

  const currentCall = live.currentCall;
  const isActive = currentCall?.active;

  return (
    <div style={{
      border: '1px solid #2A2A2A',
      borderRadius: '2px',
      padding: '16px',
      marginBottom: '16px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isActive && (
            <span className="pulse" style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#6FCF6F',
              display: 'inline-block',
            }} />
          )}
          <span style={{ fontSize: '12px', fontWeight: 600 }}>
            {isActive ? 'Active call' : 'Idle'}
          </span>
          {currentCall?.model && (
            <span style={{ fontSize: '11px', color: '#A0A0A0' }}>{currentCall.model}</span>
          )}
        </div>
        {live.tokenHistory && live.tokenHistory.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#505050' }}>context growth</span>
            <canvas
              ref={canvasRef}
              width={120}
              height={24}
              style={{ display: 'block' }}
            />
          </div>
        )}
      </div>

      {live.recentFiles && live.recentFiles.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11px', color: '#505050', marginBottom: '4px' }}>
            Files read
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {live.recentFiles.slice(0, 8).map((f: FileRef, i: number) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                padding: '2px 0',
              }}>
                <span style={{ color: '#A0A0A0' }}>{truncatePath(f.path)}</span>
                <span style={{ color: '#505050' }}>{formatTokens(f.tokens)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
