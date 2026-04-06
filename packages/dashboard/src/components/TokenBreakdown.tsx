'use client';

import { formatTokens } from '@/lib/format';
import { useState } from 'react';

interface TokenBar {
  label: string;
  tokens: number;
  color: string;
}

interface TokenBreakdownProps {
  bars: TokenBar[];
  totalTokens: number;
}

export default function TokenBreakdown({ bars, totalTokens }: TokenBreakdownProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!bars.length || totalTokens === 0) {
    return (
      <div style={{ color: '#505050', fontSize: '12px', padding: '8px 0' }}>
        No token data
      </div>
    );
  }

  const maxTokens = Math.max(...bars.map(b => b.tokens));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: '#A0A0A0',
        marginBottom: '4px',
      }}>
        <span>Token breakdown</span>
        <span>{formatTokens(totalTokens)} total</span>
      </div>
      {bars.map((bar, i) => {
        const pct = maxTokens > 0 ? (bar.tokens / maxTokens) * 100 : 0;
        const isHovered = hoveredIndex === i;
        return (
          <div
            key={i}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              position: 'relative',
            }}
          >
            <span style={{
              width: '100px',
              flexShrink: 0,
              color: '#A0A0A0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {bar.label}
            </span>
            <div style={{
              flex: 1,
              height: '16px',
              background: '#1A1A1A',
              borderRadius: '1px',
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: bar.color,
                opacity: isHovered ? 1 : 0.7,
                transition: 'opacity 0.15s',
                minWidth: bar.tokens > 0 ? '2px' : '0',
              }} />
            </div>
            <span style={{
              width: '70px',
              flexShrink: 0,
              textAlign: 'right',
              color: isHovered ? '#F0F0F0' : '#505050',
              transition: 'color 0.15s',
            }}>
              {formatTokens(bar.tokens)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
