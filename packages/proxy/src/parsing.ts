import { countTokens } from './tokens.js';

export interface SkillInfo {
  name: string;
  content: string;
  tokens: number;
}

export interface SystemBreakdown {
  skills: SkillInfo[];
  baseClaude: { content: string; tokens: number };
  toolDefinitions: { name: string; tokens: number }[];
  other: { content: string; tokens: number };
}

export function parseSystemPrompt(systemPrompt: string): SystemBreakdown {
  const skills: SkillInfo[] = [];
  let remaining = systemPrompt;
  let match: RegExpExecArray | null;

  // Method 1: XML tags <skill name="X">...</skill>
  const xmlSkillRegex = /<skill\s+name=["']([^"']+)["']>([\s\S]*?)<\/skill>/g;
  while ((match = xmlSkillRegex.exec(systemPrompt)) !== null) {
    const content = match[2].trim();
    skills.push({
      name: match[1],
      content,
      tokens: countTokens(content),
    });
    remaining = remaining.replace(match[0], '');
  }

  // Method 2: Claude Code <system-reminder> tags — extract named sections
  if (skills.length === 0) {
    const reminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
    while ((match = reminderRegex.exec(systemPrompt)) !== null) {
      const content = match[1].trim();
      const name = inferSectionName(content);
      skills.push({ name, content, tokens: countTokens(content) });
      remaining = remaining.replace(match[0], '');
    }
  }

  // Method 3: Markdown headers ## Skill: X or # Section headers
  if (skills.length === 0) {
    // Try explicit skill headers first
    const mdSkillRegex = /## Skill:\s*(.+)\n([\s\S]*?)(?=\n## |$)/g;
    while ((match = mdSkillRegex.exec(systemPrompt)) !== null) {
      const content = match[2].trim();
      skills.push({
        name: match[1].trim(),
        content,
        tokens: countTokens(content),
      });
      remaining = remaining.replace(match[0], '');
    }

    // Fall back to major # headers
    if (skills.length === 0) {
      const headerRegex = /^# (.+)$/gm;
      const headers: { name: string; start: number }[] = [];
      while ((match = headerRegex.exec(systemPrompt)) !== null) {
        headers.push({ name: match[1].trim(), start: match.index });
      }
      if (headers.length > 0) {
        for (let i = 0; i < headers.length; i++) {
          const start = headers[i].start;
          const end = i + 1 < headers.length ? headers[i + 1].start : systemPrompt.length;
          const content = systemPrompt.slice(start, end).trim();
          if (content.length > 100) {
            skills.push({
              name: headers[i].name.slice(0, 40),
              content,
              tokens: countTokens(content),
            });
          }
        }
        remaining = '';
      }
    }
  }

  // Method 4: YAML frontmatter ---\nname: X\n---
  if (skills.length === 0) {
    const yamlSkillRegex = /---\nname:\s*(.+)\n---\n([\s\S]*?)(?=\n---\nname:|$)/g;
    while ((match = yamlSkillRegex.exec(systemPrompt)) !== null) {
      const content = match[2].trim();
      skills.push({
        name: match[1].trim(),
        content,
        tokens: countTokens(content),
      });
      remaining = remaining.replace(match[0], '');
    }
  }

  // Method 5: Large sections — split on triple newlines, try to name them
  if (skills.length === 0 && systemPrompt.length > 2000) {
    const sections = systemPrompt.split(/\n\n\n+/);
    if (sections.length > 1) {
      sections.forEach((section) => {
        const trimmed = section.trim();
        if (trimmed.length > 200) {
          const name = inferSectionName(trimmed);
          skills.push({ name, content: trimmed, tokens: countTokens(trimmed) });
        }
      });
      remaining = '';
    }
  }

  remaining = remaining.trim();

  // Extract tool definitions from remaining
  const toolDefinitions: { name: string; tokens: number }[] = [];
  const toolDefRegex = /"name"\s*:\s*"([^"]+)"/g;
  const toolSection = remaining.match(/"tools"\s*:\s*\[[\s\S]*?\]/);
  if (toolSection) {
    while ((match = toolDefRegex.exec(toolSection[0])) !== null) {
      toolDefinitions.push({ name: match[1], tokens: 0 });
    }
  }

  // Ensure baseClaude always has the full system prompt token count
  // even when skills consumed everything
  const totalSkillTokens = skills.reduce((s, sk) => s + sk.tokens, 0);
  const totalSystemTokens = countTokens(systemPrompt);
  const baseTokens = remaining ? countTokens(remaining) : Math.max(0, totalSystemTokens - totalSkillTokens);

  return {
    skills,
    baseClaude: {
      content: remaining,
      tokens: baseTokens,
    },
    toolDefinitions,
    other: { content: '', tokens: 0 },
    totalTokens: totalSystemTokens,
  } as SystemBreakdown & { totalTokens: number };
}

function inferSectionName(content: string): string {
  // Try to extract a meaningful name from the first line or content
  const firstLine = content.split('\n')[0].trim();

  // Check for known patterns
  if (/tool|function|available/i.test(firstLine) && firstLine.length < 80) return firstLine.slice(0, 40);
  if (/CLAUDE\.md|codebase|instructions/i.test(content.slice(0, 200))) return 'CLAUDE.md';
  if (/memory|MEMORY\.md/i.test(content.slice(0, 200))) return 'auto-memory';
  if (/skill/i.test(content.slice(0, 200))) return 'skills';
  if (/hook|event/i.test(content.slice(0, 200))) return 'hooks';
  if (/session|environment/i.test(content.slice(0, 200))) return 'environment';
  if (/companion|Rind/i.test(content.slice(0, 200))) return 'companion';
  if (/git|commit|branch/i.test(content.slice(0, 500))) return 'git-workflow';
  if (/code.*review|review.*code/i.test(content.slice(0, 500))) return 'code-review';
  if (/test|spec|assert/i.test(content.slice(0, 500))) return 'testing';
  if (/security|auth/i.test(content.slice(0, 500))) return 'security';
  if (/style|tone|format/i.test(content.slice(0, 500))) return 'style-guide';

  // Use first meaningful words from first line
  const cleaned = firstLine.replace(/^[#\-*>\s]+/, '').slice(0, 40);
  if (cleaned.length > 5) return cleaned;

  return 'system';
}

export interface ToolCallInfo {
  toolName: string;
  toolInput: string;
  toolResult: string;
}

const TOOL_CATEGORIES: Record<string, string[]> = {
  Read: ['read_file', 'view', 'cat', 'Read'],
  Write: ['write_file', 'Write', 'create_file'],
  Edit: ['edit_file', 'str_replace', 'Edit', 'MultiEdit'],
  Bash: ['bash', 'Bash', 'run_command'],
  Search: ['search', 'grep', 'glob', 'Glob', 'Grep'],
  List: ['list_directory', 'ls', 'LS'],
};

export function categorizeToolCall(name: string): string {
  for (const [category, names] of Object.entries(TOOL_CATEGORIES)) {
    if (names.includes(name)) return category;
  }
  return name;
}

export function extractToolCalls(messages: any[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = [];

  for (const msg of messages) {
    if (!msg.content) continue;

    // Tool use blocks (assistant messages)
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            toolName: block.name ?? 'unknown',
            toolInput: typeof block.input === 'string'
              ? block.input.slice(0, 200)
              : JSON.stringify(block.input ?? {}).slice(0, 200),
            toolResult: '',
          });
        }
        // Tool results
        if (block.type === 'tool_result') {
          const lastCall = toolCalls[toolCalls.length - 1];
          if (lastCall && !lastCall.toolResult) {
            const content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content ?? '');
            lastCall.toolResult = content.slice(0, 500);
          }
        }
      }
    }
  }

  return toolCalls;
}

export function extractToolCallsFromResponse(content: any[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = [];
  if (!Array.isArray(content)) return toolCalls;

  for (const block of content) {
    if (block.type === 'tool_use') {
      toolCalls.push({
        toolName: block.name ?? 'unknown',
        toolInput: typeof block.input === 'string'
          ? block.input.slice(0, 200)
          : JSON.stringify(block.input ?? {}).slice(0, 200),
        toolResult: '',
      });
    }
  }

  return toolCalls;
}

const INSTRUCTION_PATTERN = /(don't|never|always|make sure|important|note:|remember:|do not|avoid|ensure)/i;

export function extractUserMessages(messages: any[]): string[] {
  const result: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      result.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          result.push(block.text);
        }
      }
    }
  }
  return result;
}

export function detectMissingContext(
  currentMessages: any[],
  previousCallsMessages: { callIndex: number; messages: any[] }[]
): { callIndex: number; content: string }[] {
  const currentUserMsgs = extractUserMessages(currentMessages);
  const missing: { callIndex: number; content: string }[] = [];
  const seen = new Set<string>(); // deduplicate

  // Check last 10 previous calls
  const recentCalls = previousCallsMessages.slice(-10);

  for (const prev of recentCalls) {
    const prevUserMsgs = extractUserMessages(prev.messages);
    for (const msg of prevUserMsgs) {
      if (!INSTRUCTION_PATTERN.test(msg)) continue;

      // Check if this message (or something very similar) exists in current messages
      const isPresent = currentUserMsgs.some(currentMsg => {
        // Exact match
        if (currentMsg === msg) return true;
        // Fuzzy: check if the instruction's core content appears in any current message
        // Normalize whitespace and compare
        const normPrev = msg.replace(/\s+/g, ' ').trim().toLowerCase();
        const normCurr = currentMsg.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normCurr === normPrev) return true;
        // Check if the key instruction text is contained in a current message
        if (normCurr.includes(normPrev)) return true;
        if (normPrev.length > 20 && normCurr.includes(normPrev.slice(0, Math.floor(normPrev.length * 0.8)))) return true;
        return false;
      });

      if (!isPresent) {
        const key = msg.slice(0, 100);
        if (!seen.has(key)) {
          seen.add(key);
          missing.push({ callIndex: prev.callIndex, content: msg });
        }
      }
    }
  }

  return missing;
}
