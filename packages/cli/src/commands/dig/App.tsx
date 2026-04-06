import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { CallData, SessionData, ViewState } from './types.js';
import { TreeView } from './TreeView.js';
import { DetailView } from './DetailView.js';
import { LiveView } from './LiveView.js';
import { FlameView } from './FlameView.js';
import { SearchView } from './SearchView.js';
import { SessionsView } from './SessionsView.js';
import { KeysView } from './KeysView.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatDuration } from '../../format.js';

interface AppProps {
  initialSessionId?: string;
}

export function App({ initialSessionId }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const [view, setView] = useState<ViewState>('tree');
  const [calls, setCalls] = useState<CallData[]>([]);
  const [session, setSession] = useState<SessionData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Load session (one-shot, no SSE)
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const s = await fetchApi<SessionData>(`/internal/session/${sessionId}`);
      setSession(s);
      setIsActive(s.status === 'active' || s.last_status === 'active');
      const c = await fetchApi<CallData[]>(`/internal/calls/${sessionId}`);
      setCalls(c);
      setSelectedIndex(Math.max(0, c.length - 1));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    async function init() {
      if (initialSessionId) {
        await loadSession(initialSessionId);
      } else {
        try {
          const sessions = await fetchApi<SessionData[]>('/internal/sessions');
          if (sessions.length > 0) {
            await loadSession(sessions[0].id);
          }
        } catch { /* ignore */ }
      }
    }
    init();
  }, [initialSessionId, loadSession]);

  // No SSE — dig is static. Only manual refresh with 'r'.

  // Keyboard handling for tree view
  useInput((input, key) => {
    if (view !== 'tree') return;

    if (input === 'q') { exit(); return; }
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelectedIndex(Math.min(calls.length - 1, selectedIndex + 1));
    if (key.return && calls.length > 0) setView('detail');
    if (input === 'w') setView('live');
    if (input === 'f') setView('flame');
    if (input === '/') setView('search');
    if (input === 's') setView('sessions');
    if (input === '?') setView('keys');
    // 'r' manually refreshes from SQLite
    if (input === 'r' && session?.id) {
      loadSession(session.id);
    }
  });

  const sessionKey = session?.key ?? '...';
  const totalLatency = calls.reduce((s, c) => s + c.latency_ms, 0);
  const totalTokens = calls.reduce((s, c) => s + c.token_count_input + (c.token_count_cache_read ?? 0) + c.token_count_output, 0);
  const totalCost = calls.reduce((s, c) => s + c.estimated_cost_usd, 0);
  const lastStatus = calls.length > 0 ? calls[calls.length - 1].status : 'running';

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text color="#c4607a">starnose  v0.1.0</Text>
          <Text color="#505050">{sessionKey}  [? keys]</Text>
        </Box>
        {session && (
          <>
            <Text color="#A0A0A0">"{session.title}"</Text>
            <Text color="#505050">
              {calls.length} calls · {formatTokens(totalTokens)} · {formatCost(totalCost)} · {formatDuration(totalLatency)} · {lastStatus === 'error' ? '✗ failed' : '✓ done'}
            </Text>
          </>
        )}
      </Box>

      {/* Active session notice */}
      {isActive && view === 'tree' && (
        <Box paddingX={1}>
          <Text color="#c4607a">  ⚠ session in progress — use snose sense to watch live</Text>
        </Box>
      )}
      {isActive && view === 'tree' && (
        <Box paddingX={1}>
          <Text color="#505050">    press r to refresh this view manually</Text>
        </Box>
      )}

      {/* Views */}
      {view === 'tree' && (
        <TreeView
          calls={calls}
          selectedIndex={selectedIndex}
          sessionKey={sessionKey}
          width={width}
        />
      )}

      {view === 'detail' && calls[selectedIndex] && (
        <DetailView
          call={calls[selectedIndex]}
          onBack={() => setView('tree')}
        />
      )}

      {view === 'live' && (
        <LiveView
          calls={calls}
          sessionKey={sessionKey}
          onBack={() => setView('tree')}
        />
      )}

      {view === 'flame' && (
        <FlameView
          calls={calls}
          sessionKey={sessionKey}
          onBack={() => setView('tree')}
          width={width}
        />
      )}

      {view === 'search' && (
        <SearchView
          onBack={() => setView('tree')}
          onSelect={(id) => {
            loadSession(id);
            setView('tree');
          }}
        />
      )}

      {view === 'sessions' && (
        <SessionsView
          onBack={() => setView('tree')}
          onSelect={(id) => {
            loadSession(id);
            setView('tree');
          }}
        />
      )}

      {view === 'keys' && (
        <KeysView onBack={() => setView('tree')} />
      )}
    </Box>
  );
}
