import { fetchApi, isProxyRunning } from '../api.js';
import { formatTokens, formatCost, formatDuration } from '../format.js';
import chalk from 'chalk';

const mauve = chalk.hex('#e8607a');
const dim = chalk.hex('#505050');
const normal = chalk.hex('#F0F0F0');

function safeJsonParse<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s); } catch { return fb; }
}

function computeCostBreakdown(calls: any[]) {
  const totalCost = calls.reduce((s, c) => s + (c.estimated_cost_usd ?? 0), 0);
  const totalTokens = calls.reduce(
    (s, c) => s + (c.token_count_input ?? 0) + (c.token_count_cache_read ?? 0) + (c.token_count_output ?? 0),
    0,
  );
  const ppt = totalTokens > 0 ? totalCost / totalTokens : 0;

  let skillTok = 0, ctxTok = 0;
  for (const c of calls) {
    const bd = safeJsonParse<any>(c.system_breakdown, null);
    const totalIn = (c.token_count_input ?? 0) + (c.token_count_cache_read ?? 0);
    if (bd) {
      const sk = (bd.skills ?? []).reduce((s: number, x: any) => s + (x.tokens ?? 0), 0);
      const sys = bd.baseClaude?.tokens ?? 0;
      skillTok += sk;
      ctxTok += Math.max(0, totalIn - sys - sk);
    } else {
      ctxTok += totalIn;
    }
  }
  const skillCost = skillTok * ppt;
  const contextCost = ctxTok * ppt;
  const workCost = Math.max(0, totalCost - skillCost - contextCost);
  return { skillCost, contextCost, workCost, totalCost };
}

export async function commandSummary(): Promise<void> {
  if (!(await isProxyRunning())) return;

  let payload: { session: any; calls: any[] } | null = null;
  try {
    payload = await fetchApi<{ session: any; calls: any[] } | null>('/internal/session/last-completed');
  } catch { return; }

  if (!payload || !payload.session || !payload.calls?.length) return;

  const { calls } = payload;
  // 1h cutoff
  const lastCallTs = Math.max(...calls.map(c => c.timestamp ?? 0));
  if (lastCallTs > 0 && Date.now() - lastCallTs > 60 * 60 * 1000) return;

  const totalTokens = calls.reduce(
    (s, c) => s + (c.token_count_input ?? 0) + (c.token_count_cache_read ?? 0) + (c.token_count_output ?? 0),
    0,
  );
  const totalLatency = calls.reduce((s, c) => s + (c.latency_ms ?? 0), 0);
  const bd = computeCostBreakdown(calls);
  const workPct = bd.totalCost > 0 ? (bd.workCost / bd.totalCost) * 100 : 0;

  const hr = '─'.repeat(54);
  console.log();
  console.log(dim('── ') + mauve('starnose') + dim(' ' + hr.slice(11)));
  console.log(
    `${normal(`${calls.length} calls`)} ${dim('·')} ${normal(formatTokens(totalTokens))} ${dim('·')} ${normal(formatCost(bd.totalCost))} ${dim('·')} ${normal(formatDuration(totalLatency))}`
  );
  console.log(
    `${dim('skill')} ${normal(formatCost(bd.skillCost))} ${dim('·')} ${dim('history')} ${normal(formatCost(bd.contextCost))} ${dim('·')} ${dim('work')} ${normal(formatCost(bd.workCost))}`
  );
  if (workPct < 10) {
    console.log(mauve(`⚠ only ${workPct.toFixed(0)}% was actual work`));
  }
  console.log(dim('→ snose dig to inspect'));
  console.log(dim(hr));
}
