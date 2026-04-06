'use client';

import { useState } from 'react';
import type { Call } from '@/lib/api';
import { formatTokens, formatLatency, formatCost, formatTimestamp } from '@/lib/format';

interface CallTimelineProps {
  calls: Call[];
  onSelectCall: (call: Call) => void;
  selectedCallId?: string;
}

export default function CallTimeline({ calls, onSelectCall, selectedCallId }: CallTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!calls.length) {
    return (
      <div style={{ color: '#505050', fontSize: '12px', padding: '16px 0' }}>
        No calls recorded yet
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {calls.map((call, index) => {
        const isExpanded = expandedId === call.id;
        const isSelected = selectedCallId === call.id;
        const totalTokens = call.inputTokens + call.outputTokens;

        return (
          <div key={call.id}>
            <div
              onClick={() => {
                setExpandedId(isExpanded ? null : call.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                border: '1px solid',
                borderColor: isSelected ? '#9D7F8C' : '#2A2A2A',
                borderRadius: '2px',
                cursor: 'pointer',
                background: isSelected ? 'rgba(157, 127, 140, 0.05)' : 'transparent',
                fontSize: '12px',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Index */}
              <span style={{
                color: '#505050',
                width: '28px',
                flexShrink: 0,
                textAlign: 'right',
                fontSize: '11px',
              }}>
                #{index + 1}
              </span>

              {/* Timeline dot and line */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '12px',
                flexShrink: 0,
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: call.status === 'error' ? '#CF6F6F' : '#9D7F8C',
                }} />
              </div>

              {/* Time */}
              <span style={{
                color: '#505050',
                width: '65px',
                flexShrink: 0,
                fontSize: '11px',
              }}>
                {formatTimestamp(call.timestamp)}
              </span>

              {/* Model */}
              <span style={{
                color: '#A0A0A0',
                width: '120px',
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {call.model}
              </span>

              {/* Token bar */}
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                minWidth: 0,
              }}>
                <div style={{
                  flex: 1,
                  height: '4px',
                  background: '#1A1A1A',
                  borderRadius: '1px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    background: '#9D7F8C',
                    width: `${Math.min(100, (totalTokens / 100000) * 100)}%`,
                    minWidth: '2px',
                  }} />
                </div>
                <span style={{ color: '#505050', flexShrink: 0, fontSize: '11px' }}>
                  {formatTokens(totalTokens)}
                </span>
              </div>

              {/* Latency */}
              <span style={{
                color: '#505050',
                width: '55px',
                flexShrink: 0,
                textAlign: 'right',
                fontSize: '11px',
              }}>
                {formatLatency(call.latency)}
              </span>

              {/* Cost */}
              <span style={{
                color: '#505050',
                width: '50px',
                flexShrink: 0,
                textAlign: 'right',
                fontSize: '11px',
              }}>
                {formatCost(call.cost)}
              </span>
            </div>

            {/* Expanded preview */}
            {isExpanded && (
              <div style={{
                border: '1px solid #2A2A2A',
                borderTop: 'none',
                borderRadius: '0 0 2px 2px',
                padding: '12px',
                background: '#0A0A0A',
              }}>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  marginBottom: '12px',
                  fontSize: '11px',
                }}>
                  <div>
                    <span style={{ color: '#505050' }}>Input: </span>
                    <span style={{ color: '#A0A0A0' }}>{formatTokens(call.inputTokens)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#505050' }}>Output: </span>
                    <span style={{ color: '#A0A0A0' }}>{formatTokens(call.outputTokens)}</span>
                  </div>
                  {call.cacheReadTokens !== undefined && call.cacheReadTokens > 0 && (
                    <div>
                      <span style={{ color: '#505050' }}>Cache read: </span>
                      <span style={{ color: '#A0A0A0' }}>{formatTokens(call.cacheReadTokens)}</span>
                    </div>
                  )}
                  {call.cacheWriteTokens !== undefined && call.cacheWriteTokens > 0 && (
                    <div>
                      <span style={{ color: '#505050' }}>Cache write: </span>
                      <span style={{ color: '#A0A0A0' }}>{formatTokens(call.cacheWriteTokens)}</span>
                    </div>
                  )}
                </div>

                {call.filesRead && call.filesRead.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#505050', marginBottom: '4px' }}>Files read:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {call.filesRead.slice(0, 5).map((f, i) => (
                        <span key={i} style={{
                          fontSize: '11px',
                          color: '#A0A0A0',
                          padding: '2px 6px',
                          border: '1px solid #2A2A2A',
                          borderRadius: '2px',
                        }}>
                          {f.path.split('/').pop()} ({formatTokens(f.tokens)})
                        </span>
                      ))}
                      {call.filesRead.length > 5 && (
                        <span style={{ fontSize: '11px', color: '#505050' }}>
                          +{call.filesRead.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {call.thinkingContent && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#505050', marginBottom: '4px' }}>Thinking preview:</div>
                    <pre style={{
                      fontSize: '11px',
                      color: '#A0A0A0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '60px',
                      overflow: 'hidden',
                    }}>
                      {call.thinkingContent.slice(0, 200)}{call.thinkingContent.length > 200 ? '...' : ''}
                    </pre>
                  </div>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCall(call);
                  }}
                  style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    color: '#9D7F8C',
                    borderColor: '#9D7F8C',
                  }}
                >
                  Open full detail
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
