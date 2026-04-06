import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { CallData } from './types.js';
import { formatTokens, formatCost, formatLatency, circledNumber } from '../../format.js';

interface Props {
  call: CallData;
  onBack: () => void;
}

type SectionKey = 'stats' | 'read' | 'thinking' | 'given' | 'sent' | 'missing' | 'decision' | 'request' | 'response';

const SECTION_ORDER: SectionKey[] = ['stats', 'read', 'thinking', 'given', 'sent', 'missing', 'decision', 'request', 'response'];

const NAVIGABLE_SECTIONS: Set<SectionKey> = new Set(['read', 'given', 'decision', 'missing']);

// ─── Nav item types ──────────────────────────────────────────

interface NavItem {
  id: string;
  type: 'group-header' | 'file' | 'more-files' | 'system-prompt' | 'skill' | 'tool-group' | 'missing-item';
  label: string;
  detail: string;
  groupKey?: string;
  data?: any;
}

interface MiniDetailData {
  title: string;
  rows: Array<{ label: string; value: string }>;
  footer?: string;
}

// ─── Tool result summarization ────────────────────────────────

interface ToolCallInfo {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
}

function normalizeToolName(name: string): string {
  const map: Record<string, string> = {
    read_file: 'Read', view: 'Read', cat: 'Read',
    bash: 'Bash', run_command: 'Bash',
    glob: 'Glob', grep: 'Grep', search: 'Grep',
    edit_file: 'Edit', str_replace: 'Edit', MultiEdit: 'Edit',
    write_file: 'Write', create_file: 'Write',
  };
  return map[name] ?? name;
}

function extractArg(input: string): string {
  if (!input) return '';
  if (input.startsWith('{')) {
    try {
      const obj = JSON.parse(input);
      if (obj.command) return obj.command.split('\n')[0];
      if (obj.file_path) {
        const m = obj.file_path.match(/([^/\\]+\.[a-z]+)/i);
        return m ? m[1] : obj.file_path.slice(-40);
      }
      if (obj.pattern) return `"${obj.pattern}"`;
      if (obj.subagent_type) return obj.subagent_type;
      if (obj.description) return obj.description;
    } catch {}
  }
  return input.split('\n')[0];
}

function extractFilename(input: string): string {
  if (!input) return 'file';
  if (input.startsWith('{')) {
    try {
      const obj = JSON.parse(input);
      if (obj.command) return obj.command.split('\n')[0].slice(0, 36);
      const path = obj.file_path ?? obj.path ?? '';
      if (path) {
        const m = path.match(/([^/\\]+)$/);
        return m ? m[1] : path.slice(-36);
      }
      if (obj.pattern) return `"${obj.pattern}"`;
      if (obj.subagent_type) return obj.subagent_type;
      if (obj.description) return obj.description.slice(0, 36);
    } catch {}
  }
  const m = input.match(/([^/\\]+)$/);
  return m ? m[1] : input.slice(0, 36);
}

function summarizeResult(toolName: string, result?: string): string {
  if (!result) return 'done';
  const lines = result.split('\n').filter(l => l.trim());
  if (lines.length === 0) return 'done';

  const normalized = normalizeToolName(toolName);

  switch (normalized) {
    case 'Read':
      return `${lines.length} lines`;
    case 'Edit':
      return `${lines.length > 1 ? lines.length + ' edits' : '1 edit'}`;
    case 'Write':
      return 'written';
    case 'Grep': {
      const matchLines = lines.filter(l => l.includes(':'));
      return matchLines.length > 0 ? `${matchLines.length} matches` : `${lines.length} lines`;
    }
    case 'Glob':
      return `${lines.length} files`;
    case 'Bash': {
      if (result.includes('EXIT: 0') || result.includes('exit code 0')) return 'success';
      if (/EXIT:\s*[1-9]/.test(result) || /exit code [1-9]/.test(result)) {
        const m = result.match(/EXIT:\s*(\d+)|exit code (\d+)/);
        return `error (exit ${m?.[1] ?? m?.[2] ?? '?'})`;
      }
      if (lines.length === 1) {
        const first = lines[0].trim();
        if (/^[drwx-]{10}/.test(first)) return '1 item';
        if (first.startsWith('/') || first.startsWith('./')) return 'done';
        if (first.length <= 25 && !first.includes('\t')) return first;
      }
      return `${lines.length} lines`;
    }
    case 'Agent':
      return `${lines.length} lines`;
    default:
      return `${lines.length} lines`;
  }
}

function groupToolCalls(toolCalls: ToolCallInfo[]): Map<string, ToolCallInfo[]> {
  const groups = new Map<string, ToolCallInfo[]>();
  for (const tc of toolCalls) {
    const name = normalizeToolName(tc.toolName);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(tc);
  }
  return groups;
}

function readSummary(toolCalls: ToolCallInfo[]): string {
  if (toolCalls.length === 0) return 'no tool calls';
  const groups = groupToolCalls(toolCalls);
  const parts: string[] = [];
  for (const [name, calls] of groups) {
    parts.push(`${name}×${calls.length}`);
  }
  return parts.slice(0, 4).join(' · ');
}

// ─── Navigation helpers ─────────────────────────────────────

function extractFullPath(input: string): string {
  if (!input) return '';
  if (input.startsWith('{')) {
    try {
      const obj = JSON.parse(input);
      return obj.file_path ?? obj.path ?? '';
    } catch { return ''; }
  }
  return input;
}

function shortenDir(fullPath: string): { dir: string; file: string } {
  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length <= 1) return { dir: './', file: parts[0] ?? '' };
  const file = parts[parts.length - 1];
  const dirParts = parts.slice(Math.max(0, parts.length - 3), parts.length - 1);
  return { dir: dirParts.join('/') + '/', file };
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

function computeReadItems(toolCalls: ToolCallInfo[], expandedGroups: Set<string>): NavItem[] {
  const items: NavItem[] = [];

  // Group file-based tools by directory
  const fileCallsByDir = new Map<string, Array<{ tc: ToolCallInfo; file: string; tokens: number }>>();
  const otherCalls = new Map<string, ToolCallInfo[]>();

  for (const tc of toolCalls) {
    const norm = normalizeToolName(tc.toolName);
    if (FILE_TOOLS.has(norm)) {
      const fullPath = extractFullPath(tc.toolInput ?? '');
      const { dir, file } = shortenDir(fullPath);
      if (!fileCallsByDir.has(dir)) fileCallsByDir.set(dir, []);
      const tokens = Math.ceil((tc.toolResult?.length ?? 0) / 4);
      fileCallsByDir.get(dir)!.push({ tc, file: file || extractFilename(tc.toolInput ?? ''), tokens });
    } else {
      if (!otherCalls.has(norm)) otherCalls.set(norm, []);
      otherCalls.get(norm)!.push(tc);
    }
  }

  for (const [dir, files] of fileCallsByDir) {
    items.push({
      id: `gh:${dir}`,
      type: 'group-header',
      label: dir,
      detail: '',
      groupKey: dir,
    });

    const isExpanded = expandedGroups.has(dir);
    const showCount = isExpanded ? files.length : Math.min(3, files.length);

    for (let i = 0; i < showCount; i++) {
      const f = files[i];
      items.push({
        id: `f:${dir}:${i}`,
        type: 'file',
        label: f.file,
        detail: formatTokens(f.tokens),
        groupKey: dir,
        data: { toolName: f.tc.toolName, tokens: f.tokens, result: summarizeResult(f.tc.toolName, f.tc.toolResult) },
      });
    }

    if (!isExpanded && files.length > 3) {
      const hiddenTokens = files.slice(3).reduce((s, f) => s + f.tokens, 0);
      items.push({
        id: `more:${dir}`,
        type: 'more-files',
        label: `+${files.length - 3} more files`,
        detail: formatTokens(hiddenTokens),
        groupKey: dir,
      });
    }
  }

  for (const [name, calls] of otherCalls) {
    items.push({
      id: `tg:read:${name}`,
      type: 'tool-group',
      label: `${name} (${calls.length})`,
      detail: calls.slice(0, 2).map(tc => extractFilename(tc.toolInput ?? '')).join(', '),
      data: { toolName: name, calls },
    });
  }

  return items;
}

function computeGivenItems(breakdown: any, totalIn: number): NavItem[] {
  if (!breakdown) return [];
  const items: NavItem[] = [];

  const sysTokens = breakdown.baseClaude?.tokens ?? 0;
  const pct = totalIn > 0 ? ((sysTokens / totalIn) * 100).toFixed(0) : '0';
  items.push({
    id: 'sys-prompt',
    type: 'system-prompt',
    label: 'system prompt',
    detail: `${formatTokens(sysTokens)}   ${pct}%`,
  });

  const skills = breakdown.skills ?? [];
  for (const sk of skills) {
    const callPct = totalIn > 0 ? ((sk.tokens / totalIn) * 100).toFixed(1) : '0';
    const sysPct = sysTokens > 0 ? ((sk.tokens / sysTokens) * 100).toFixed(1) : '0';
    const isHighest = sk.tokens === Math.max(...skills.map((s: any) => s.tokens));
    items.push({
      id: `skill:${sk.name}`,
      type: 'skill',
      label: `skill: ${sk.name}`,
      detail: `${formatTokens(sk.tokens)}  ${callPct}%`,
      data: { name: sk.name, tokens: sk.tokens, callPct, sysPct, isHighest },
    });
  }

  return items;
}

function computeDecisionItems(toolGroups: Map<string, ToolCallInfo[]>): NavItem[] {
  const items: NavItem[] = [];
  for (const [name, calls] of toolGroups) {
    const summaryParts = calls.slice(0, 3).map(tc => {
      const arg = extractArg(tc.toolInput ?? '');
      const m = arg.match(/([^/\\]+\.[a-z]+)/i);
      return m ? m[1] : arg.slice(0, 20);
    });
    const more = calls.length > 3 ? ` · +${calls.length - 3} more` : '';
    items.push({
      id: `dec:${name}`,
      type: 'tool-group',
      label: `${name}×${calls.length}`,
      detail: summaryParts.join(' · ') + more,
      data: { toolName: name, calls },
    });
  }
  return items;
}

function computeMissingItems(missingCtx: any[]): NavItem[] {
  return missingCtx.map((mc, i) => ({
    id: `miss:${i}`,
    type: 'missing-item' as const,
    label: `call ${circledNumber(mc.callIndex)}`,
    detail: `"${(mc.content ?? '').replace(/\n/g, ' ').slice(0, 50)}"`,
    data: mc,
  }));
}

// ─── Mini detail builders ───────────────────────────────────

function buildFileDetail(item: NavItem, totalIn: number): MiniDetailData {
  const d = item.data ?? {};
  const pct = totalIn > 0 ? ((d.tokens / totalIn) * 100).toFixed(1) : '0';
  return {
    title: item.label,
    rows: [
      { label: 'tokens', value: String(d.tokens ?? 0) },
      { label: 'tool', value: normalizeToolName(d.toolName ?? 'Read') },
      { label: 'result', value: d.result ?? 'done' },
    ],
    footer: `this file consumed ${pct}% of total call tokens`,
  };
}

function buildSkillDetail(item: NavItem): MiniDetailData {
  const d = item.data ?? {};
  return {
    title: item.label,
    rows: [
      { label: 'tokens', value: String(d.tokens ?? 0) },
      { label: '% of call', value: `${d.callPct}%` },
      { label: '% of system', value: `${d.sysPct}%` },
    ],
    footer: d.isHighest ? 'this is your highest-cost skill.' : undefined,
  };
}

function buildToolGroupDetail(item: NavItem): MiniDetailData {
  const d = item.data ?? {};
  const calls: ToolCallInfo[] = d.calls ?? [];
  const toolName = d.toolName ?? '';

  if (toolName === 'Bash') {
    return {
      title: `Bash commands (${calls.length})`,
      rows: calls.slice(0, 10).map(tc => {
        const cmd = extractArg(tc.toolInput ?? '').slice(0, 40);
        const result = summarizeResult(tc.toolName, tc.toolResult);
        return { label: cmd, value: `→ ${result}` };
      }),
    };
  }

  return {
    title: `${toolName} (${calls.length} calls)`,
    rows: calls.slice(0, 10).map(tc => {
      const arg = extractFilename(tc.toolInput ?? '');
      const result = summarizeResult(tc.toolName, tc.toolResult);
      return { label: arg, value: `→ ${result}` };
    }),
  };
}

function buildMissingDetail(item: NavItem): MiniDetailData {
  const mc = item.data ?? {};
  return {
    title: `missing from call ${circledNumber(mc.callIndex)}`,
    rows: [
      { label: 'content', value: (mc.content ?? '').slice(0, 200) },
    ],
  };
}

// ─── Mini detail overlay component ──────────────────────────

function MiniDetailOverlay({ data, width }: { data: MiniDetailData; width: number }): React.ReactElement {
  const boxWidth = Math.min(width - 4, 56);
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box borderStyle="single" borderColor="#c4607a" flexDirection="column" paddingX={1} width={boxWidth}>
        <Box justifyContent="space-between">
          <Text color="#c4607a" bold>{data.title}</Text>
          <Text color="#505050">[esc to close]</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {data.rows.map((row, i) => (
            <Text key={i} color="#A0A0A0">  {row.label.padEnd(14)} {row.value}</Text>
          ))}
        </Box>
        {data.footer && (
          <Box marginTop={1}>
            <Text color="#505050">  {data.footer}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Main component ──────────────────────────────────────────

export function DetailView({ call, onBack }: Props) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const [focusedSection, setFocusedSection] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(() => {
    const s = new Set<SectionKey>(SECTION_ORDER);
    const mc = safeJsonParse(call.missing_context ?? 'null', []) ?? [];
    if (mc.length > 0) s.delete('missing');
    return s;
  });
  const [navLevel, setNavLevel] = useState<1 | 2>(1);
  const [itemIndex, setItemIndex] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [miniDetail, setMiniDetail] = useState<MiniDetailData | null>(null);

  const toolCalls: ToolCallInfo[] = safeJsonParse(call.tool_calls, []);
  const missingCtx: any[] = safeJsonParse(call.missing_context ?? 'null', []) ?? [];
  const breakdown: any = safeJsonParse(call.system_breakdown ?? 'null', null);
  let reqBody: any = {};
  let resBody: any = {};
  try { reqBody = JSON.parse(call.request_body ?? '{}'); } catch { /* ignore */ }
  try { resBody = JSON.parse(call.response_body ?? '{}'); } catch { /* ignore */ }

  const messages = reqBody.messages ?? [];
  const userMsg = messages.filter((m: any) => m.role === 'user').pop();
  const userMsgText = typeof userMsg?.content === 'string'
    ? userMsg.content
    : Array.isArray(userMsg?.content)
      ? userMsg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      : '';

  const totalIn = call.token_count_input + (call.token_count_cache_read ?? 0);
  const skillCount = breakdown?.skills?.length ?? 0;
  const convTokens = totalIn - (breakdown?.baseClaude?.tokens ?? 0) - (breakdown?.skills?.reduce((s: number, sk: any) => s + sk.tokens, 0) ?? 0);

  const visibleSections = SECTION_ORDER;
  const toolGroups = groupToolCalls(toolCalls);

  // Compute items for sections
  function getItems(section: SectionKey): NavItem[] {
    switch (section) {
      case 'read': return computeReadItems(toolCalls, expandedGroups);
      case 'given': return computeGivenItems(breakdown, totalIn);
      case 'decision': return computeDecisionItems(toolGroups);
      case 'missing': return computeMissingItems(missingCtx);
      default: return [];
    }
  }

  const currentSection = visibleSections[focusedSection];
  const currentItems = getItems(currentSection);

  // Clamp itemIndex
  const clampedItemIndex = Math.min(itemIndex, Math.max(0, currentItems.length - 1));

  function handleItemEnter(item: NavItem) {
    switch (item.type) {
      case 'group-header':
        setExpandedGroups(prev => {
          const next = new Set(prev);
          if (next.has(item.groupKey!)) next.delete(item.groupKey!);
          else next.add(item.groupKey!);
          return next;
        });
        break;
      case 'more-files':
        setExpandedGroups(prev => new Set([...prev, item.groupKey!]));
        break;
      case 'file':
        setMiniDetail(buildFileDetail(item, totalIn));
        break;
      case 'skill':
        setMiniDetail(buildSkillDetail(item));
        break;
      case 'system-prompt':
        break;
      case 'tool-group':
        setMiniDetail(buildToolGroupDetail(item));
        break;
      case 'missing-item':
        setMiniDetail(buildMissingDetail(item));
        break;
    }
  }

  useInput((input, key) => {
    // Mini detail overlay: only esc closes
    if (miniDetail) {
      if (key.escape) setMiniDetail(null);
      return;
    }

    // Level 2: item navigation
    if (navLevel === 2) {
      if (key.escape) {
        setNavLevel(1);
        return;
      }
      if (key.upArrow) {
        setItemIndex(Math.max(0, clampedItemIndex - 1));
        return;
      }
      if (key.downArrow) {
        setItemIndex(Math.min(currentItems.length - 1, clampedItemIndex + 1));
        return;
      }
      if (key.return) {
        const item = currentItems[clampedItemIndex];
        if (item) handleItemEnter(item);
        return;
      }
      if (key.tab) {
        setNavLevel(1);
        setFocusedSection((focusedSection + 1) % visibleSections.length);
        setItemIndex(0);
        return;
      }
      return;
    }

    // Level 1: section navigation
    if (key.escape) { onBack(); return; }

    if (key.upArrow) {
      setFocusedSection(Math.max(0, focusedSection - 1));
      return;
    }
    if (key.downArrow) {
      setFocusedSection(Math.min(visibleSections.length - 1, focusedSection + 1));
      return;
    }
    if (key.tab) {
      if (NAVIGABLE_SECTIONS.has(currentSection) && currentItems.length > 0) {
        // Auto-expand and enter Level 2
        setCollapsed(prev => {
          const next = new Set(prev);
          next.delete(currentSection);
          return next;
        });
        setNavLevel(2);
        setItemIndex(0);
      } else {
        setFocusedSection((focusedSection + 1) % visibleSections.length);
      }
      return;
    }

    if (key.leftArrow) {
      setCollapsed(prev => new Set([...prev, currentSection]));
      return;
    }
    if (key.rightArrow || key.return) {
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(currentSection)) {
          next.delete(currentSection);
        } else {
          next.add(currentSection);
        }
        return next;
      });
      return;
    }
  });

  const idx = circledNumber(call.call_index);

  // ── Section header summaries ──

  function sectionSummary(section: SectionKey): string {
    switch (section) {
      case 'stats':
        return `${call.status} · ${formatLatency(call.latency_ms)} · ${formatTokens(totalIn)} · ${formatCost(call.estimated_cost_usd)}`;
      case 'read':
        return readSummary(toolCalls);
      case 'thinking':
        return call.thinking ? `${call.thinking.split('\n').length} lines` : 'not enabled';
      case 'given': {
        const sysT = formatTokens(breakdown?.baseClaude?.tokens ?? 0);
        return breakdown
          ? `${sysT} system · ${skillCount} skills · ${formatTokens(Math.max(0, convTokens))} conv`
          : 'no breakdown';
      }
      case 'sent': {
        if (!userMsgText) return 'no user message';
        if (isSystemReminder(userMsgText)) return 'system-reminder (injected)';
        return `"${userMsgText.replace(/\n/g, ' ').slice(0, 40)}"`;
      }
      case 'missing':
        return missingCtx.length > 0 ? `${missingCtx.length} instructions lost` : 'none';
      case 'decision': {
        if (toolCalls.length === 0) return 'no tool calls';
        const groups = groupToolCalls(toolCalls);
        const parts: string[] = [];
        for (const [name, calls] of groups) {
          parts.push(`${name}×${calls.length}`);
        }
        return parts.join(' · ');
      }
      case 'request':
        return '(large — expand to view)';
      case 'response':
        return '(large — expand to view)';
      default:
        return '';
    }
  }

  function sectionHeader(section: SectionKey, label: string, isFocused: boolean): React.ReactNode {
    const isCollapsed = collapsed.has(section);
    const arrow = isCollapsed ? '▶' : '▼';
    const hasMissing = section === 'missing' && missingCtx.length > 0;
    const color = hasMissing ? '#c4607a' : isFocused ? '#F0F0F0' : '#505050';
    const prefix = hasMissing ? '⚠ ' : '';
    const cursor = isFocused ? '► ' : '  ';
    const summary = isCollapsed ? `   ${sectionSummary(section)}` : '';
    const inLevel2 = isFocused && navLevel === 2;
    return (
      <Box>
        <Text color={color} bold={isFocused} dimColor={inLevel2}>{cursor}{arrow} {prefix}{label}</Text>
        {isCollapsed && <Text color="#505050">{summary}</Text>}
      </Box>
    );
  }

  // ── Render a nav item row ──

  function renderItemRow(item: NavItem, isSelected: boolean): React.ReactNode {
    const padW = Math.max(0, termWidth - 8);

    if (isSelected) {
      let text: string;
      switch (item.type) {
        case 'group-header':
          text = item.label;
          break;
        case 'file':
          text = `  ${item.label.padEnd(32)} ${item.detail}`;
          break;
        case 'more-files':
          text = `  ${item.label}    ${item.detail}`;
          break;
        case 'system-prompt':
          text = `${item.label.padEnd(20)} ${item.detail}`;
          break;
        case 'skill':
          text = `  ${item.label.padEnd(24)} ${item.detail}`;
          break;
        case 'tool-group':
          text = `${item.label.padEnd(16)} ${item.detail}`;
          break;
        case 'missing-item':
          text = `${item.label}: ${item.detail}`;
          break;
        default:
          text = item.label;
      }
      return (
        <Box key={item.id}>
          <Text backgroundColor="#c4607a" color="#0F0F0F">{'► ' + text.padEnd(padW)}</Text>
        </Box>
      );
    }

    switch (item.type) {
      case 'group-header':
        return <Text key={item.id} color="#505050">    {item.label}</Text>;
      case 'file':
        return <Text key={item.id} color="#A0A0A0">      {item.label.padEnd(32)} {item.detail}</Text>;
      case 'more-files':
        return <Text key={item.id} color="#c4607a">      {item.label}    {item.detail}</Text>;
      case 'system-prompt':
        return <Text key={item.id} color="#A0A0A0">    {item.label.padEnd(20)} {item.detail}</Text>;
      case 'skill':
        return <Text key={item.id} color="#505050">      {item.label.padEnd(24)} {item.detail}</Text>;
      case 'tool-group':
        return <Text key={item.id} color="#A0A0A0">    {item.label.padEnd(16)} {item.detail}</Text>;
      case 'missing-item':
        return <Text key={item.id} color="#c4607a">    {item.label}: {item.detail}</Text>;
      default:
        return null;
    }
  }

  // ── Render navigable content for a section ──

  function renderNavContent(section: SectionKey): React.ReactNode {
    const items = getItems(section);
    const sIdx = visibleSections.indexOf(section);
    const isActive = focusedSection === sIdx && navLevel === 2;

    if (items.length === 0) return <Text color="#505050">    (empty)</Text>;

    return (
      <Box flexDirection="column">
        {items.map((item, i) => renderItemRow(item, isActive && i === clampedItemIndex))}
      </Box>
    );
  }

  function renderSection(key: SectionKey, label: string, content: React.ReactNode): React.ReactNode {
    const sectionIdx = visibleSections.indexOf(key);
    if (sectionIdx === -1) return null;
    const isFocused = focusedSection === sectionIdx;
    const isCollapsed = collapsed.has(key);

    return (
      <Box flexDirection="column" paddingX={1} marginTop={0}>
        {sectionHeader(key, label, isFocused)}
        {!isCollapsed && content}
      </Box>
    );
  }

  // ── Status bar text ──

  let statusText: string;
  if (miniDetail) {
    statusText = '  esc close';
  } else if (navLevel === 2) {
    statusText = '  ↑↓ items · enter select · esc back to sections';
  } else {
    statusText = '  ↑↓ sections · → expand · ← collapse · tab enter items · esc back';
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#c4607a">call {idx}  {call.summary}   </Text>
        <Text color="#505050">[esc to close]</Text>
      </Box>

      {/* STATS */}
      {renderSection('stats', 'STATS', (
        <Box flexDirection="column">
          <Text color="#A0A0A0">    status    {call.status}</Text>
          <Text color="#A0A0A0">    latency   {formatLatency(call.latency_ms)}</Text>
          <Text color="#A0A0A0">    tokens    {formatTokens(totalIn)} in{(call.token_count_cache_read ?? 0) > 0 ? ` (+ ${formatTokens(call.token_count_cache_read)} cached)` : ''} / {formatTokens(call.token_count_output)} out</Text>
          <Text color="#A0A0A0">    cost      {formatCost(call.estimated_cost_usd)}</Text>
          <Text color="#A0A0A0">    model     {call.model}</Text>
          {totalIn > 50000 && convTokens > 0 && (
            <Text color="#c4607a">    ⚠ {formatTokens(Math.max(0, convTokens))} is conversation history ({messages.length} turns)</Text>
          )}
          {totalIn > 50000 && convTokens > 0 && (
            <Text color="#505050">      context is very large — compaction likely soon</Text>
          )}
        </Box>
      ))}

      {/* WHAT IT READ — navigable */}
      {renderSection('read', 'WHAT IT READ', renderNavContent('read'))}

      {/* WHAT IT WAS THINKING */}
      {renderSection('thinking', 'WHAT IT WAS THINKING', (
        call.thinking ? (
          <Box flexDirection="column">
            {call.thinking.split('\n').slice(0, 12).map((line, i) => (
              <Text key={i} color="#A0A0A0">    {line.slice(0, 80)}</Text>
            ))}
            {call.thinking.split('\n').length > 12 && (
              <Text color="#505050">    ... ({call.thinking.split('\n').length - 12} more lines)</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text color="#505050">    extended thinking not enabled</Text>
            <Text color="#505050">    tip: set CLAUDE_CODE_THINKING=1 to enable</Text>
          </Box>
        )
      ))}

      {/* WHAT IT WAS GIVEN — navigable */}
      {renderSection('given', 'WHAT IT WAS GIVEN', (
        breakdown ? (
          <Box flexDirection="column">
            {renderNavContent('given')}
            <Text color="#A0A0A0">    conversation       {formatTokens(Math.max(0, convTokens))}  ({messages.length} turns)</Text>
          </Box>
        ) : (
          <Text color="#505050">    (no system breakdown available)</Text>
        )
      ))}

      {/* WHAT YOU SENT */}
      {renderSection('sent', 'WHAT YOU SENT', (
        userMsgText ? (
          isSystemReminder(userMsgText) ? (
            <Box flexDirection="column">
              <Text color="#c4607a">    system-reminder (injected by Claude Code automatically)</Text>
              <Text color="#505050">    not a message you typed</Text>
              <Text color="#A0A0A0">    "{userMsgText.replace(/\n/g, ' ').slice(0, 80)}"</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="#A0A0A0">    "{userMsgText.slice(0, 120)}"</Text>
            </Box>
          )
        ) : (
          <Text color="#505050">    (no user message in this call)</Text>
        )
      ))}

      {/* WHAT IT WAS MISSING — navigable */}
      {renderSection('missing', 'WHAT IT WAS MISSING', renderNavContent('missing'))}

      {/* DECISION — navigable */}
      {renderSection('decision', 'DECISION', renderNavContent('decision'))}

      {/* RAW REQUEST */}
      {renderSection('request', 'RAW REQUEST', (
        <Box flexDirection="column">
          {JSON.stringify(reqBody, null, 2).split('\n').slice(0, 30).map((line, i) => (
            <Text key={i} color="#505050">    {line}</Text>
          ))}
          <Text color="#505050">    ... (truncated)</Text>
        </Box>
      ))}

      {/* RAW RESPONSE */}
      {renderSection('response', 'RAW RESPONSE', (
        <Box flexDirection="column">
          {JSON.stringify(resBody, null, 2).split('\n').slice(0, 30).map((line, i) => (
            <Text key={i} color="#505050">    {line}</Text>
          ))}
          <Text color="#505050">    ... (truncated)</Text>
        </Box>
      ))}

      {/* Mini detail overlay */}
      {miniDetail && <MiniDetailOverlay data={miniDetail} width={termWidth} />}

      {/* Navigation hint */}
      <Box marginTop={1} paddingX={1}>
        <Text color="#505050">{statusText}</Text>
      </Box>
    </Box>
  );
}

function isSystemReminder(text: string): boolean {
  return text.includes('<system-reminder>') || text.includes('system-reminder');
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
