const DEFAULT_PORT = 3001;

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // In browser, use the proxy port from meta tag or default
    const meta = document.querySelector('meta[name="starnose-port"]');
    const port = meta?.getAttribute('content') || String(DEFAULT_PORT);
    return `http://localhost:${port}`;
  }
  return `http://localhost:${DEFAULT_PORT}`;
}

async function fetchApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export interface Session {
  id: string;
  key?: string;
  title?: string;
  status: 'active' | 'completed' | 'error';
  startedAt: string;
  endedAt?: string;
  totalCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  totalLatency: number;
  model?: string;
}

export interface Call {
  id: string;
  sessionId: string;
  timestamp: string;
  model: string;
  latency: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost: number;
  status: 'success' | 'error';
  filesRead?: FileRef[];
  thinkingContent?: string;
  systemBreakdown?: SystemBreakdown[];
  compactedContext?: CompactedContext;
  request?: unknown;
  response?: unknown;
}

export interface FileRef {
  path: string;
  tokens: number;
}

export interface SystemBreakdown {
  label: string;
  tokens: number;
  content?: string;
}

export interface CompactedContext {
  originalTokens: number;
  compactedTokens: number;
  summary?: string;
}

export interface LiveData {
  session: Session | null;
  currentCall?: Partial<Call> & { active: boolean };
  recentFiles?: FileRef[];
  tokenHistory?: number[];
}

export function getCurrentSession(signal?: AbortSignal): Promise<Session> {
  return fetchApi<Session>('/internal/session/current', signal);
}

export function getSession(id: string, signal?: AbortSignal): Promise<Session> {
  return fetchApi<Session>(`/internal/session/${id}`, signal);
}

export function getSessions(signal?: AbortSignal): Promise<Session[]> {
  return fetchApi<Session[]>('/internal/sessions', signal);
}

export function getCalls(sessionId: string, signal?: AbortSignal): Promise<Call[]> {
  return fetchApi<Call[]>(`/internal/calls/${sessionId}`, signal);
}

export function getLive(signal?: AbortSignal): Promise<LiveData> {
  return fetchApi<LiveData>('/internal/live', signal);
}

export function searchSessions(q: string, signal?: AbortSignal): Promise<Session[]> {
  return fetchApi<Session[]>(`/internal/search?q=${encodeURIComponent(q)}`, signal);
}

export function createEventSource(): EventSource {
  const base = getBaseUrl();
  return new EventSource(`${base}/internal/events`);
}
