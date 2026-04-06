'use client';

import { useState } from 'react';
import type { Call } from '@/lib/api';
import { formatTokens, formatLatency, formatCost, truncatePath } from '@/lib/format';
import TokenBreakdown from './TokenBreakdown';

interface CallDetailProps {
  call: Call;
  onClose: () => void;
}

type Tab = 'read' | 'thinking' | 'system' | 'missing' | 'raw';

export default function CallDetail({ call, onClose }: CallDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('read');
  const [showRequest, setShowRequest] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'read', label: 'What it read' },
    { key: 'thinking', label: 'What it was thinking' },
    { key: 'system', label: 'What it was given' },
    { key: 'missing', label: 'What it was missing' },
    { key: 'raw', label: 'Raw JSON' },
  ];

  const tokenBars = [
    { label: 'Input', tokens: call.inputTokens, color: '#9D7F8C' },
    { label: 'Output', tokens: call.outputTokens, color: '#7F9D8C' },
    ...(call.cacheReadTokens ? [{ label: 'Cache read', tokens: call.cacheReadTokens, color: '#7F8C9D' }] : []),
    ...(call.cacheWriteTokens ? [{ label: 'Cache write', tokens: call.cacheWriteTokens, color: '#8C7F9D' }] : []),
  ];

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: '600px',
      maxWidth: '100vw',
      background: '#0F0F0F',
      borderLeft: '1px solid #2A2A2A',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }} className="slide-in-right">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid #2A2A2A',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px' }}>
            Call #{call.id.slice(0, 8)}
          </div>
          <div style={{ fontSize: '11px', color: '#A0A0A0', marginTop: '2px' }}>
            {call.model} &middot; {formatLatency(call.latency)} &middot; {formatCost(call.cost)}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none',
          border: 'none',
          color: '#505050',
          fontSize: '18px',
          cursor: 'pointer',
          padding: '4px 8px',
          lineHeight: 1,
        }}>
          &times;
        </button>
      </div>

      {/* Token breakdown */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
        <TokenBreakdown
          bars={tokenBars}
          totalTokens={call.inputTokens + call.outputTokens}
        />
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #2A2A2A',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 14px',
              fontSize: '11px',
              border: 'none',
              borderBottom: activeTab === t.key ? '1px solid #9D7F8C' : '1px solid transparent',
              borderRadius: 0,
              color: activeTab === t.key ? '#F0F0F0' : '#505050',
              background: 'none',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {activeTab === 'read' && (
          <div>
            {call.filesRead && call.filesRead.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {call.filesRead.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    border: '1px solid #2A2A2A',
                    borderRadius: '2px',
                    fontSize: '12px',
                  }}>
                    <span style={{ color: '#A0A0A0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncatePath(f.path, 60)}
                    </span>
                    <span style={{ color: '#505050', flexShrink: 0, marginLeft: '8px' }}>
                      {formatTokens(f.tokens)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#505050', fontSize: '12px' }}>No files read in this call</div>
            )}
          </div>
        )}

        {activeTab === 'thinking' && (
          <div>
            {call.thinkingContent ? (
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '12px',
                color: '#A0A0A0',
                lineHeight: 1.7,
              }}>
                {call.thinkingContent}
              </pre>
            ) : (
              <div style={{ color: '#505050', fontSize: '12px' }}>No thinking block in this call</div>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div>
            {call.systemBreakdown && call.systemBreakdown.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {call.systemBreakdown.map((s, i) => (
                  <div key={i} style={{
                    border: '1px solid #2A2A2A',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: '#141414',
                      fontSize: '12px',
                    }}>
                      <span style={{ fontWeight: 500 }}>{s.label}</span>
                      <span style={{ color: '#505050' }}>{formatTokens(s.tokens)}</span>
                    </div>
                    {s.content && (
                      <pre style={{
                        padding: '8px 10px',
                        fontSize: '11px',
                        color: '#A0A0A0',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '200px',
                        overflow: 'auto',
                      }}>
                        {s.content}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#505050', fontSize: '12px' }}>No system breakdown available</div>
            )}
          </div>
        )}

        {activeTab === 'missing' && (
          <div>
            {call.compactedContext ? (
              <div>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  marginBottom: '12px',
                  fontSize: '12px',
                }}>
                  <div>
                    <span style={{ color: '#505050' }}>Original: </span>
                    <span>{formatTokens(call.compactedContext.originalTokens)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#505050' }}>Compacted: </span>
                    <span>{formatTokens(call.compactedContext.compactedTokens)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#505050' }}>Saved: </span>
                    <span style={{ color: '#9D7F8C' }}>
                      {formatTokens(call.compactedContext.originalTokens - call.compactedContext.compactedTokens)}
                    </span>
                  </div>
                </div>
                {call.compactedContext.summary && (
                  <pre style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '12px',
                    color: '#A0A0A0',
                    lineHeight: 1.7,
                    border: '1px solid #2A2A2A',
                    borderRadius: '2px',
                    padding: '12px',
                  }}>
                    {call.compactedContext.summary}
                  </pre>
                )}
              </div>
            ) : (
              <div style={{ color: '#505050', fontSize: '12px' }}>No compacted context in this call</div>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <button
                onClick={() => setShowRequest(!showRequest)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid #2A2A2A',
                  borderRadius: '2px',
                  fontSize: '12px',
                  color: '#A0A0A0',
                  background: '#141414',
                  cursor: 'pointer',
                }}
              >
                {showRequest ? '- ' : '+ '}Request JSON
              </button>
              {showRequest && call.request != null && (
                <pre style={{
                  padding: '10px',
                  fontSize: '11px',
                  color: '#A0A0A0',
                  border: '1px solid #2A2A2A',
                  borderTop: 'none',
                  borderRadius: '0 0 2px 2px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {JSON.stringify(call.request, null, 2)}
                </pre>
              )}
            </div>
            <div>
              <button
                onClick={() => setShowResponse(!showResponse)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid #2A2A2A',
                  borderRadius: '2px',
                  fontSize: '12px',
                  color: '#A0A0A0',
                  background: '#141414',
                  cursor: 'pointer',
                }}
              >
                {showResponse ? '- ' : '+ '}Response JSON
              </button>
              {showResponse && call.response != null && (
                <pre style={{
                  padding: '10px',
                  fontSize: '11px',
                  color: '#A0A0A0',
                  border: '1px solid #2A2A2A',
                  borderTop: 'none',
                  borderRadius: '0 0 2px 2px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {JSON.stringify(call.response, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
