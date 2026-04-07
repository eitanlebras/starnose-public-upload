import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { CallData, SessionData, ViewState } from './types.js';
import { TreeView } from './TreeView.js';
import { LiveView } from './LiveView.js';
import { FlameView } from './FlameView.js';
import { SessionsView } from './SessionsView.js';
import { KeysView } from './KeysView.js';
import { SearchView } from './SearchView.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatDuration } from '../../format.js';

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function computeCostBreakdown(calls: CallData[]): { skillCost: number; contextCost: number; workCost: number; totalCost: number } {
  const totalCost = calls.reduce((s, c) => s + c.estimated_cost_usd, 0);
  const totalTokens = calls.reduce((s, c) => s + c.token_count_input + (c.token_count_cache_read ?? 0) + c.token_count_output, 0);
  const pricePerToken = totalTokens > 0 ? totalCost / totalTokens : 0;

  let skillTokensTotal = 0;
  let contextTokensTotal = 0;

  for (const c of calls) {
    const breakdown: any = safeJsonParse(c.system_breakdown, null);
    const totalIn = c.token_count_input + (c.token_count_cache_read ?? 0);

    if (breakdown) {
      const skillTokens = (breakdown.skills ?? []).reduce((s: number, sk: any) => s + (sk.tokens ?? 0), 0);
      const sysTokens = breakdown.baseClaude?.tokens ?? 0;
      const convTokens = Math.max(0, totalIn - sysTokens - skillTokens);
      skillTokensTotal += skillTokens;
      contextTokensTotal += convTokens;
    } else {
      contextTokensTotal += totalIn;
    }
  }

  const skillCost = skillTokensTotal * pricePerToken;
  const contextCost = contextTokensTotal * pricePerToken;
  const workCost = Math.max(0, totalCost - skillCost - contextCost);
  return { skillCost, contextCost, workCost, totalCost };
}

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

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Force a full redraw when switching major views to prevent stacked remnants.
  useEffect(() => {
    if (!stdout) return;
    stdout.write('\x1b[2J\x1b[H');
  }, [view, stdout]);

  // Load session
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

  // Initial load: identify current session, then load requested or current
  useEffect(() => {
    async function init() {
      let currentId: string | null = null;
      try {
        const current = await fetchApi<any>('/internal/session/current');
        if (current?.id) currentId = current.id;
      } catch {}
      if (!currentId) {
        try {
          const sessions = await fetchApi<SessionData[]>('/internal/sessions');
          if (sessions.length > 0) currentId = sessions[0].id;
        } catch {}
      }
      setCurrentSessionId(currentId);

      const target = initialSessionId ?? currentId;
      if (target) {
        await loadSession(target);
      }
    }
    init();
  }, [initialSessionId, loadSession]);

  const isCurrent = !!currentSessionId && session?.id === currentSessionId;

  // Handle session selection from browser
  const handleSessionSelect = useCallback((id: string) => {
    loadSession(id);
    setView('tree');
  }, [loadSession]);

  // Keyboard — only active in tree view
  useInput((input, key) => {
    if (view !== 'tree') return;

    if (input === 'q') { exit(); return; }
    if (input === 'w') { setView('live'); return; }
    if (input === 'f') { setView('flame'); return; }
    if (input === '/') {
      setView('search');
      return;
    }
    if (input === 's') { setView('sessions'); return; }
    if (input === '?') { setView('keys'); return; }
    if (input === 'r' && session?.id) { loadSession(session.id); return; }
  });

  // High-cost conversion: once cost crosses $5 on a past session (can't happen on current
  // because we only show current), nudge. Here we nudge when *viewing* a large session.
  // On the current session this is handled by snose sense.

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
          <Text color="#e62050">starnose  v0.1.0</Text>
          <Text color="#505050">
            {sessionKey}  {isCurrent ? <Text color="#e62050">● live</Text> : null}  [? keys]
          </Text>
        </Box>
        {session && (
          <>
            <Text color="#A0A0A0">"{session.title}"</Text>
            <Text color="#505050">
              {calls.length} calls · {formatTokens(totalTokens)} · {formatCost(totalCost)} · {formatDuration(totalLatency)} · {lastStatus === 'error' ? '✗ failed' : '✓ done'}
            </Text>
            {calls.length > 0 && (() => {
              const bd = computeCostBreakdown(calls);
              const workPct = bd.totalCost > 0 ? (bd.workCost / bd.totalCost) * 100 : 0;
              const workWarn = bd.totalCost > 0 && workPct < 5;
              return (
                <>
                  <Text color="#505050">
                    skill overhead {formatCost(bd.skillCost)} · history {formatCost(bd.contextCost)} · work {formatCost(bd.workCost)}
                  </Text>
                  {workWarn && (
                    <Text color="#e62050">⚠ only {workPct.toFixed(1)}% was actual work</Text>
                  )}
                </>
              );
            })()}
          </>
        )}
      </Box>

      {/* Active session notice */}
      {isActive && view === 'tree' && isCurrent && (
        <Box paddingX={1}>
          <Text color="#e62050">  ⚠ session in progress — use snose sense to watch live</Text>
        </Box>
      )}

      {/* Views */}
      {view === 'tree' && (
        <TreeView
          calls={calls}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          sessionKey={sessionKey}
          width={width}
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

      {view === 'sessions' && (
        <SessionsView
          onBack={() => setView('tree')}
          onSelect={handleSessionSelect}
          currentSessionId={currentSessionId}
        />
      )}

      {view === 'search' && (
        <SearchView
          onBack={() => setView('tree')}
          onSelect={handleSessionSelect}
        />
      )}

      {view === 'keys' && (
        <KeysView onBack={() => setView('tree')} />
      )}

      {/* Footer */}
      {view === 'tree' && (
        <Box paddingX={1}>
          <Text color="#505050">
            ↑↓ nav · ←→ group · s sessions · / search · q quit
          </Text>
        </Box>
      )}
    </Box>
  );
}
