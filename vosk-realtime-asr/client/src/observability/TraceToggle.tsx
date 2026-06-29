/**
 * TraceToggle UI 组件 (Module B)
 *
 * 演示用 — 一键开关 OTel, 关掉后浏览器不再向 /otel 发送 trace 数据.
 */
import { useEffect, useState } from 'react';
import { isObservabilityEnabled, setObservabilityEnabled } from './otel';

export interface TraceToggleProps {
  /** 默认开启状态, 不传则读 isObservabilityEnabled() */
  defaultEnabled?: boolean;
}

export function TraceToggle({ defaultEnabled }: TraceToggleProps) {
  const [on, setOn] = useState<boolean>(
    defaultEnabled ?? isObservabilityEnabled(),
  );

  useEffect(() => {
    setObservabilityEnabled(on);
  }, [on]);

  return (
    <button
      type="button"
      data-testid="trace-toggle"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid ' + (on ? '#52c41a' : '#888'),
        background: on ? 'rgba(82,196,26,0.12)' : 'transparent',
        color: on ? '#52c41a' : '#aaa',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      Trace: {on ? 'ON' : 'OFF'}
    </button>
  );
}

export default TraceToggle;
