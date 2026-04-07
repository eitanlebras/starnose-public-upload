'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSessions, getCalls, type Session, type Call } from '@/lib/api';
import { formatTokens, formatCost, formatDuration, formatDate } from '@/lib/format';
import CallTimeline from '@/components/CallTimeline';
import CallDetail from '@/components/CallDetail';
import TokenBreakdown from '@/components/TokenBreakdown';

export default function ShareableSessionPage({ params }: { params: { key: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Find session by key from the sessions list
      const sessions = await getSessions();
      const match = sessions.find((s) => s.key === params.key);
      if (!match) {
        setError('Session not found');
        setLoading(false);
        return;
      }
      setSession(match);
      const c = await getCalls(match.id);
      setCalls(c);
      setError(null);
    } catch {
      setError('Could not load session');
    } finally {
      setLoading(false);
    }
  }, [params.key]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div style={{ color: '#505050', padding: '40px 0' }}>Loading...</div>;
  }

  if (error || !session) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ color: '#CF6F6F', fontSize: '14px', marginBottom: '8px' }}>
          {error || 'Session not found'}
        </div>
        <div style={{ color: '#505050', fontSize: '12px' }}>
          This shared session link may have expired or the proxy may not be reachable.
        </div>
      </div>
    );
  }

  const tokenBars = [
    { label: 'Input', tokens: session.inputTokens, color: '#9D7F8C' },
    { label: 'Output', tokens: session.outputTokens, color: '#7F9D8C' },
  ];

  return (
    <div>
      {/* Shared session badge */}
      <div style={{
        fontSize: '11px',
        color: '#9D7F8C',
        marginBottom: '16px',
        padding: '6px 10px',
        border: '1px solid #9D7F8C',
        borderRadius: '2px',
        display: 'inline-block',
      }}>
        Read-only shared view
      </div>

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
            <span style={{ color: '#A0A0A0' }}>{session.key}</span>
            {' '}&middot; Started {formatDate(session.startedAt)}
            {session.endedAt && <> &middot; Ended {formatDate(session.endedAt)}</>}
            {session.model && <> &middot; {session.model}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '20px', fontSize: '12px', textAlign: 'right' }}>
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

      {/* Token breakdown */}
      <div style={{
        border: '1px solid #2A2A2A',
        borderRadius: '2px',
        padding: '12px 16px',
        marginBottom: '16px',
      }}>
        <TokenBreakdown bars={tokenBars} totalTokens={session.totalTokens} />
      </div>

      {/* Call timeline */}
      <h2 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
        Call timeline ({calls.length})
      </h2>
      <CallTimeline
        calls={calls}
        onSelectCall={setSelectedCall}
        selectedCallId={selectedCall?.id}
      />

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
