/**
 * DebugPanel — Sprint 9 可折叠调试抽屉
 * 默认仅显示一个 chip, 点击展开 240px 高的日志
 *
 * Author: Claude Opus 4.8
 */
import React, { useState } from 'react';
import type { DebugEntry } from './hooks/useDebugLog';
import { BugIcon, ChevronDownIcon, ChevronRightIcon } from './design/icons';

export interface DebugPanelProps {
  entries: DebugEntry[];
}

export const DebugPanel: React.FC<DebugPanelProps> = React.memo(({ entries }) => {
  const [open, setOpen] = useState(false);

  return (
    <section
      className="debug-drawer"
      data-open={open}
      role="region"
      aria-label="调试日志"
    >
      <button
        type="button"
        className="debug-drawer-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <BugIcon size={14} />
        <span>调试日志</span>
        <span className="debug-drawer-count">{entries.length}</span>
        <span className="debug-drawer-chevron" aria-hidden="true">
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
      </button>
      {open && (
        <div className="debug-drawer-body">
          {entries.length === 0 ? (
            <div className="debug-empty">暂无日志 — 点"示例音频"触发</div>
          ) : (
            entries.slice(-15).reverse().map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className={`debug-entry debug-${e.step.toLowerCase()}`}
              >
                <span className="debug-ts">
                  {new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className="debug-step">[{e.step}]</span>
                <span className="debug-detail">{e.detail}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
});

DebugPanel.displayName = 'DebugPanel';