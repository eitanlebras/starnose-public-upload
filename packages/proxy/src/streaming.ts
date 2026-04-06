import { updateLiveActivity } from './live.js';

export interface StreamResult {
  fullResponse: any;
  thinkingContent: string;
  textContent: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;
  toolUseBlocks: any[];
}

export async function processAnthropicStream(
  response: Response,
  writeChunk: (chunk: string) => void,
): Promise<StreamResult> {
  let thinkingContent = '';
  let textContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let model = '';
  const contentBlocks: any[] = [];
  const toolUseBlocks: any[] = [];
  let currentBlockIndex = -1;
  let messageData: any = null;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });

    // Write chunk to caller immediately for streaming behavior
    writeChunk(chunk);

    buffer += chunk;

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim();
        continue;
      }

      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        let data: any;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        updateLiveActivity();

        switch (data.type ?? currentEvent) {
          case 'message_start': {
            messageData = data.message;
            if (data.message?.model) {
              model = data.message.model;
            }
            const usage = data.message?.usage;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
              cacheReadTokens = usage.cache_read_input_tokens ?? 0;
            }
            break;
          }

          case 'content_block_start': {
            currentBlockIndex = data.index ?? contentBlocks.length;
            const block = data.content_block ?? {};
            contentBlocks[currentBlockIndex] = { ...block };
            if (block.type === 'tool_use') {
              toolUseBlocks.push(contentBlocks[currentBlockIndex]);
              contentBlocks[currentBlockIndex]._inputJson = '';
            }
            break;
          }

          case 'content_block_delta': {
            const delta = data.delta ?? {};
            const idx = data.index ?? currentBlockIndex;

            if (delta.type === 'thinking_delta' && delta.thinking) {
              thinkingContent += delta.thinking;
            } else if (delta.type === 'text_delta' && delta.text) {
              textContent += delta.text;
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
              if (contentBlocks[idx]) {
                contentBlocks[idx]._inputJson =
                  (contentBlocks[idx]._inputJson ?? '') + delta.partial_json;
              }
            }
            break;
          }

          case 'content_block_stop': {
            const idx = data.index ?? currentBlockIndex;
            if (contentBlocks[idx]?._inputJson) {
              try {
                contentBlocks[idx].input = JSON.parse(contentBlocks[idx]._inputJson);
              } catch {
                contentBlocks[idx].input = contentBlocks[idx]._inputJson;
              }
              delete contentBlocks[idx]._inputJson;
            }
            break;
          }

          case 'message_delta': {
            if (data.usage?.output_tokens) {
              outputTokens = data.usage.output_tokens;
            }
            break;
          }

          case 'message_stop':
            break;
        }
      }
    }
  }

  // Reconstruct full response
  const fullResponse = {
    ...(messageData ?? {}),
    content: contentBlocks.map(block => {
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: thinkingContent };
      }
      if (block.type === 'text') {
        return { type: 'text', text: textContent };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        };
      }
      return block;
    }),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  };

  // Estimate thinking tokens from content length
  if (thinkingContent) {
    thinkingTokens = Math.ceil(thinkingContent.length / 4);
  }

  return {
    fullResponse,
    thinkingContent,
    textContent,
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheCreationTokens,
    cacheReadTokens,
    model,
    toolUseBlocks,
  };
}
