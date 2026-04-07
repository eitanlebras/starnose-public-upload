'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSessions, searchSessions, type Session } from '@/lib/api';
import { formatTokens, formatCost, formatDuration, formatDate } from '@/lib/format';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchSessions = useCallback(async (q?: string) => {
    try {
      const data = q ? await searchSessions(q) : await getSessions();
      setSessions(data);
      setError(null);
    } catch {
      setError('Could not reach starnose proxy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchSessions(value || undefined);
    }, 300);
  };

  if (error) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ color: '#CF6F6F', fontSize: '14px', marginBottom: '8px' }}>Connection error</div>
        <div style={{ color: '#505050', fontSize: '12px' }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 600 }}>Sessions</h1>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search sessions..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ color: '#505050', fontSize: '12px' }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div style={{ color: '#505050', fontSize: '12px', padding: '20px 0' }}>
          {query ? 'No sessions matching your search' : 'No sessions recorded yet'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* Header row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '6px 12px',
            fontSize: '11px',
            color: '#505050',
            borderBottom: '1px solid #2A2A2A',
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>Session</span>
            <span style={{ width: '55px', textAlign: 'center' }}>Status</span>
            <span style={{ width: '50px', textAlign: 'right' }}>Calls</span>
            <span style={{ width: '70px', textAlign: 'right' }}>Tokens</span>
            <span style={{ width: '60px', textAlign: 'right' }}>Cost</span>
            <span style={{ width: '60px', textAlign: 'right' }}>Duration</span>
            <span style={{ width: '110px', textAlign: 'right' }}>Started</span>
          </div>

          {sessions.map((s) => (
            <a
              key={s.id}
              href={`/session/${s.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                border: '1px solid #2A2A2A',
                borderRadius: '2px',
                textDecoration: 'none',
                color: 'inherit',
                fontSize: '12px',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#505050'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2A2A2A'; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {s.title || s.id.slice(0, 12)}
                </div>
                {s.key && (
                  <div style={{ fontSize: '11px', color: '#505050', marginTop: '1px' }}>
                    {s.key}
                  </div>
                )}
              </div>
              <span className={`status-${s.status}`} style={{
                width: '55px',
                textAlign: 'center',
                fontSize: '11px',
              }}>
                {s.status}
              </span>
              <span style={{ width: '50px', textAlign: 'right', color: '#A0A0A0' }}>
                {s.totalCalls}
              </span>
              <span style={{ width: '70px', textAlign: 'right', color: '#A0A0A0' }}>
                {formatTokens(s.totalTokens)}
              </span>
              <span style={{ width: '60px', textAlign: 'right', color: '#A0A0A0' }}>
                {formatCost(s.totalCost)}
              </span>
              <span style={{ width: '60px', textAlign: 'right', color: '#A0A0A0' }}>
                {formatDuration(s.totalLatency)}
              </span>
              <span style={{ width: '110px', textAlign: 'right', color: '#505050', fontSize: '11px' }}>
                {formatDate(s.startedAt)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
