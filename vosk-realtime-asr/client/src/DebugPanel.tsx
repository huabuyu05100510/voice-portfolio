/**
 * DebugPanel — 显示最近 15 条调试日志
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { DebugEntry } from './hooks/useDebugLog';

const PANEL_STYLE: React.CSSProperties = {
  margin: '20px', padding: '16px', background: '#1a1a2e',
  border: '1px solid #3a3a5e', borderRadius: '8px',
  fontFamily: 'monospace', fontSize: '12px',
};

export interface DebugPanelProps {
  entries: DebugEntry[];
}

export const DebugPanel: React.FC<DebugPanelProps> = React.memo(({ entries }) => (
  <section className="debug-panel" style={PANEL_STYLE}>
    <h3 style={{ margin: '0 0 8px', color: '#00d4ff' }}>🐛 调试日志 (最近 15 条)</h3>
    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
      {entries.length === 0
        ? <div style={{ color: '#666' }}>暂无日志 - 点 "🎵 测试示例音频" 触发</div>
        : entries.map((e, i) => (
          <div key={i} style={{ color: e.step === 'ERROR' ? '#ef4444' : '#e0e0e0' }}>
            <span style={{ color: '#888' }}>{new Date(e.ts).toLocaleTimeString()}</span>{' '}
            <span style={{ color: e.step === 'TRANSCRIPT' ? '#10b981' : '#fbbf24', fontWeight: 'bold' }}>[{e.step}]</span>{' '}
            {e.detail}
          </div>
        ))}
    </div>
  </section>
));

DebugPanel.displayName = 'DebugPanel';