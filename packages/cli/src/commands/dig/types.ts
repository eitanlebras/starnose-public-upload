export type ViewState = 'tree' | 'detail' | 'live' | 'flame' | 'search' | 'sessions' | 'keys';

export interface SearchResult {
  id: string;
  session_id: string;
  call_index: number;
  timestamp: number;
  summary: string;
  status: string;
  estimated_cost_usd: number;
  latency_ms: number;
  skills_detected: string;
  token_count_input: number;
  token_count_output: number;
  token_count_cache_read: number;
  session_key: string;
  session_title: string;
  session_created_at: number;
}

export interface CallData {
  id: string;
  session_id: string;
  call_index: number;
  timestamp: number;
  model: string;
  request_body: string;
  response_body: string;
  system_prompt: string | null;
  thinking: string | null;
  latency_ms: number;
  token_count_input: number;
  token_count_output: number;
  token_count_thinking: number;
  token_count_cache_creation: number;
  token_count_cache_read: number;
  estimated_cost_usd: number;
  tool_calls: string;
  status: string;
  summary: string;
  system_breakdown: string | null;
  skills_detected: string;
  missing_context: string | null;
  compaction_detected: number;
  tokens_before_compaction: number | null;
}

export interface SessionData {
  id: string;
  key: string;
  title: string;
  created_at: number;
  status: string;
  call_count: number;
  total_tokens: number;
  total_cost: number;
  last_status: string;
  peak_tokens: number;
}
