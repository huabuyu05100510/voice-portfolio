/**
 * RealtimeChat — 全屏沉浸式语音对话 UI
 *
 * 参考 ChatGPT Voice Mode / Pi.ai:
 *  - 大圆形"按住说话"按钮 + 呼吸光晕
 *  - 用户/AI 消息左右分栏气泡
 *  - AI 文字打字机效果 (streamingText 直接渲染)
 *  - AI 音频播放时显示波形动画
 *  - 打断 (barge-in) 时停止动画, 显示 ⋯⋯
 *  - 顶部状态 pill: idle / connecting / listening / thinking / speaking / error
 *
 * Model: MiniMax-M3 (Sprint 13)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage } from '../types';
import type { ConversationState, ConversationStatus } from '../state/conversationReducer';

export interface RealtimeChatProps {
  state: ConversationState;
  onConnect: () => void;
  onDisconnect: () => void;
  onClear: () => void;
  /** 自定义 WS URL (默认从 import.meta.env 推断) */
  wsUrl?: string;
}

const STATUS_LABEL: Record<ConversationStatus, string> = {
  idle: '未连接',
  connecting: '正在建立连接…',
  listening: '在听',
  thinking: '思考中…',
  speaking: 'AI 正在说话',
  completed: '已完成',
  error: '连接错误',
};

export const RealtimeChat: React.FC<RealtimeChatProps> = ({
  state,
  onConnect,
  onDisconnect,
  onClear,
  wsUrl,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pressActive, setPressActive] = useState(false);

  // 自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.streamingText]);

  const isAiSpeaking = state.status === 'speaking';
  const isListening = state.status === 'listening';
  const isThinking = state.status === 'thinking';
  const isActive = isAiSpeaking || isListening || isThinking;
  const hasError = state.status === 'error';
  const isConnected = state.status !== 'idle' && state.status !== 'error' && state.status !== 'connecting';

  return (
    <div className="realtime-chat" role="region" aria-label="端到端实时语音对话">
      <header className="rt-header">
        <div className={`rt-status-pill rt-status-${state.status}`} data-testid="status-pill">
          <span className="rt-status-dot" aria-hidden="true" />
          <span>{STATUS_LABEL[state.status]}</span>
        </div>
        <div className="rt-metrics">
          <span data-testid="metric-turns">轮次 {state.metrics.aiMessages}</span>
          <span data-testid="metric-barge-in">打断 {state.metrics.bargeIn.count}</span>
          {state.metrics.latency.lastMs != null && (
            <span data-testid="metric-latency">
              延迟 {Math.round(state.metrics.latency.lastMs)}ms
            </span>
          )}
        </div>
        <div className="rt-actions">
          <button
            type="button"
            className="rt-btn rt-btn-ghost"
            onClick={onClear}
            aria-label="清空对话历史"
            disabled={state.messages.length === 0}
          >
            清空
          </button>
          {!isConnected ? (
            <button
              type="button"
              className="rt-btn rt-btn-primary"
              onClick={onConnect}
              aria-label="开始对话"
              disabled={state.status === 'connecting'}
            >
              {state.status === 'connecting' ? '连接中…' : '开始对话'}
            </button>
          ) : (
            <button
              type="button"
              className="rt-btn rt-btn-danger"
              onClick={onDisconnect}
              aria-label="结束对话"
            >
              结束
            </button>
          )}
        </div>
      </header>

      <div className="rt-messages" ref={scrollRef} role="log" aria-live="polite">
        {state.messages.length === 0 && !state.streamingText && (
          <div className="rt-empty">
            <h2>和 AI 自由对话</h2>
            <p>点击下方按钮开始, 像打电话一样和 AI 实时语音交流.</p>
            <p className="rt-empty-hint">提示: AI 说话时你可以随时打断.</p>
          </div>
        )}
        {state.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {state.streamingText && (
          <div
            className="rt-message rt-message-assistant rt-streaming"
            data-testid="streaming-bubble"
          >
            <div className="rt-bubble">
              <span className="rt-cursor" aria-hidden="true" />
              {state.streamingText}
            </div>
            <span className="rt-bubble-meta">实时输出…</span>
          </div>
        )}
      </div>

      <footer className="rt-footer">
        <button
          type="button"
          className={`rt-ptt ${isActive ? 'rt-ptt-active' : ''} ${pressActive ? 'rt-ptt-press' : ''} ${isAiSpeaking ? 'rt-ptt-speaking' : ''} ${hasError ? 'rt-ptt-error' : ''}`}
          onMouseDown={() => setPressActive(true)}
          onMouseUp={() => setPressActive(false)}
          onMouseLeave={() => setPressActive(false)}
          onTouchStart={() => setPressActive(true)}
          onTouchEnd={() => setPressActive(false)}
          disabled={!isConnected}
          aria-label={isAiSpeaking ? 'AI 正在说话, 你可以打断' : '语音按钮'}
          data-testid="ptt-button"
        >
          <span className="rt-ptt-inner">
            {isAiSpeaking ? (
              <WaveIcon />
            ) : isListening ? (
              <MicIcon />
            ) : isThinking ? (
              <DotSpinner />
            ) : (
              <MicIcon />
            )}
          </span>
          <span className="rt-ptt-halo" aria-hidden="true" />
        </button>
        <p className="rt-ptt-label">
          {!isConnected
            ? hasError
              ? '请检查服务端配置 (火山引擎凭证)'
              : '点击上方「开始对话」连接'
            : isAiSpeaking
              ? '正在说话 · 你可以随时打断'
              : isListening
                ? '在听 · 请说话'
                : isThinking
                  ? 'AI 思考中…'
                  : '准备就绪'}
        </p>
      </footer>
    </div>
  );
};

// ----------------------------------------------------------------------------
// MessageBubble
// ----------------------------------------------------------------------------
const MessageBubble: React.FC<{ message: ConversationMessage }> = React.memo(({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div
      className={`rt-message ${isUser ? 'rt-message-user' : 'rt-message-assistant'}${message.interrupted ? ' rt-message-interrupted' : ''}`}
      data-testid={isUser ? 'user-bubble' : 'ai-bubble'}
    >
      <div className="rt-bubble">
        {message.text || (isUser ? '(空)' : '')}
      </div>
      <span className="rt-bubble-meta">
        {isUser ? '你' : 'AI'}
        {message.interrupted && <em className="rt-bubble-interrupted">· 被打断</em>}
        {message.audioBytes != null && message.audioBytes > 0 && (
          <em className="rt-bubble-audio">{Math.round(message.audioBytes / 1024)}KB</em>
        )}
      </span>
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ----------------------------------------------------------------------------
// Icons (内联 SVG, 不用第三方)
// ----------------------------------------------------------------------------
const MicIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <path
      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
      fill="currentColor"
    />
  </svg>
);

const WaveIcon: React.FC = () => (
  <span className="rt-wave" aria-hidden="true">
    <span /><span /><span /><span /><span />
  </span>
);

const DotSpinner: React.FC = () => (
  <span className="rt-dots" aria-hidden="true">
    <span /><span /><span />
  </span>
);

export default RealtimeChat;

// ============================================================================
// Helper hook for default ws URL
// ============================================================================
export function defaultRealtimeWsUrl(): string {
  const env = (import.meta as any).env ?? {};
  if (env.VITE_REALTIME_WS_URL) return env.VITE_REALTIME_WS_URL as string;
  const base = env.VITE_WS_URL ?? 'http://localhost:5001';
  if (base.startsWith('ws://') || base.startsWith('wss://')) return `${base}/api/realtime`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}/api/realtime`;
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}/api/realtime`;
  return `${base}/api/realtime`;
}