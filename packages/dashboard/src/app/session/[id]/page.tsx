'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSession, getCalls, type Session, type Call } from '@/lib/api';
import { formatTokens, formatCost, formatDuration, formatDate } from '@/lib/format';
import CallTimeline from '@/components/CallTimeline';
import CallDetail from '@/components/CallDetail';
import TokenBreakdown from '@/components/TokenBreakdown';

export default function SessionDetailPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        getSession(params.id),
        getCalls(params.id),
      ]);
      setSession(s);
      setCalls(c);
      setError(null);
    } catch {
      setError('Could not load session');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

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
        <a href="/sessions" style={{ fontSize: '12px' }}>Back to sessions</a>
      </div>
    );
  }

  const tokenBars = [
    { label: 'Input', tokens: session.inputTokens, color: '#9D7F8C' },
    { label: 'Output', tokens: session.outputTokens, color: '#7F9D8C' },
  ];

  // Build per-call token bars for a per-call flame graph
  const callTokenBars = calls.map((c, i) => ({
    label: `#${i + 1} ${c.model}`,
    tokens: c.inputTokens + c.outputTokens,
    color: '#9D7F8C',
  }));

  return (
    <div>
      {/* Back link */}
      <a href="/sessions" style={{ fontSize: '11px', color: '#505050', display: 'inline-block', marginBottom: '16px' }}>
        &larr; all sessions
      </a>

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
            {session.id} &middot; Started {formatDate(session.startedAt)}
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

      {/* Session-level token breakdown */}
      <div style={{
        border: '1px solid #2A2A2A',
        borderRadius: '2px',
        padding: '12px 16px',
        marginBottom: '16px',
      }}>
        <TokenBreakdown bars={tokenBars} totalTokens={session.totalTokens} />
      </div>

      {/* Per-call token flame graph */}
      {callTokenBars.length > 0 && (
        <div style={{
          border: '1px solid #2A2A2A',
          borderRadius: '2px',
          padding: '12px 16px',
          marginBottom: '16px',
        }}>
          <TokenBreakdown bars={callTokenBars} totalTokens={session.totalTokens} />
        </div>
      )}

      {/* Share link */}
      {session.key && (
        <div style={{
          fontSize: '11px',
          color: '#505050',
          marginBottom: '16px',
          padding: '8px 12px',
          border: '1px solid #2A2A2A',
          borderRadius: '2px',
        }}>
          Shareable link: <a href={`/s/${session.key}`}>/s/{session.key}</a>
        </div>
      )}

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
