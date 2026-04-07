'use client';

import { useEffect, useState, useCallback } from 'react';
import { getCurrentSession, getCalls, createEventSource, type Session, type Call, type LiveData } from '@/lib/api';
import { formatTokens, formatCost, formatDuration, formatDate } from '@/lib/format';
import CallTimeline from '@/components/CallTimeline';
import CallDetail from '@/components/CallDetail';
import LivePanel from '@/components/LivePanel';
import TokenBreakdown from '@/components/TokenBreakdown';

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const s = await getCurrentSession(signal);
      setSession(s);
      setError(null);
      const c = await getCalls(s.id, signal);
      setCalls(c);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Could not reach starnose proxy. Is it running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);

    let es: EventSource | null = null;
    try {
      es = createEventSource();
      es.addEventListener('session-update', () => {
        fetchData();
      });
      es.addEventListener('call-complete', () => {
        fetchData();
      });
      es.onmessage = () => {
        fetchData();
      };
    } catch {
      // SSE not available, fall back to polling
      const interval = setInterval(() => fetchData(), 3000);
      return () => {
        clearInterval(interval);
        controller.abort();
      };
    }

    return () => {
      es?.close();
      controller.abort();
    };
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ color: '#505050', padding: '40px 0' }}>Loading...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ color: '#CF6F6F', fontSize: '14px', marginBottom: '8px' }}>
          Connection error
        </div>
        <div style={{ color: '#505050', fontSize: '12px' }}>{error}</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ color: '#A0A0A0', fontSize: '14px', marginBottom: '8px' }}>
          No active session
        </div>
        <div style={{ color: '#505050', fontSize: '12px' }}>
          Start using Claude through the starnose proxy to see activity here.
        </div>
      </div>
    );
  }

  const aggregateTokenBars = [
    { label: 'Input', tokens: session.inputTokens, color: '#9D7F8C' },
    { label: 'Output', tokens: session.outputTokens, color: '#7F9D8C' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '20px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '16px', fontWeight: 600 }}>
              {session.title || 'Session'}
            </h1>
            <span className={`status-${session.status}`} style={{
              fontSize: '11px',
              padding: '1px 8px',
              border: '1px solid currentColor',
              borderRadius: '2px',
            }}>
              {session.status}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#505050' }}>
            {session.key && <span style={{ color: '#A0A0A0' }}>{session.key} &middot; </span>}
            {session.id.slice(0, 12)} &middot; Started {formatDate(session.startedAt)}
            {session.model && <> &middot; {session.model}</>}
          </div>
        </div>
        <div style={{
          display: 'flex',
          gap: '20px',
          fontSize: '12px',
          textAlign: 'right',
        }}>
          <div>
            <div style={{ color: '#505050', fontSize: '11px' }}>Calls</div>
            <div>{session.totalCalls}</div>
          </div>
          <div>
            <div style={{ color: '#505050', fontSize: '11px' }}>Tokens</div>
            <div>{formatTokens(session.totalTokens)}</div>
          </div>
          <div>
            <div style={{ color: '#505050', fontSize: '11px' }}>Cost</div>
            <div>{formatCost(session.totalCost)}</div>
          </div>
          <div>
            <div style={{ color: '#505050', fontSize: '11px' }}>Time</div>
            <div>{formatDuration(session.totalLatency)}</div>
          </div>
        </div>
      </div>

      {/* Live panel */}
      {session.status === 'active' && <LivePanel />}

      {/* Token breakdown */}
      <div style={{
        border: '1px solid #2A2A2A',
        borderRadius: '2px',
        padding: '12px 16px',
        marginBottom: '16px',
      }}>
        <TokenBreakdown bars={aggregateTokenBars} totalTokens={session.totalTokens} />
      </div>

      {/* Call timeline */}
      <div style={{ marginBottom: '8px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
          Call timeline ({calls.length})
        </h2>
        <CallTimeline
          calls={calls}
          onSelectCall={setSelectedCall}
          selectedCallId={selectedCall?.id}
        />
      </div>

      {/* Call detail drawer */}
      {selectedCall && (
        <>
          <div
            onClick={() => setSelectedCall(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 99,
            }}
          />
          <CallDetail call={selectedCall} onClose={() => setSelectedCall(null)} />
        </>
      )}
    </div>
  );
}
