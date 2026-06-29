/**
 * conversationReducer
 * --------------------
 * Pure reducer that owns all voice conversation state transitions.
 * Centralising this makes every state mutation unit-testable without React.
 *
 * Designed for TDD: no I/O, no timers, no globals. Same in -> same out.
 *
 * 状态机:
 *   idle → connecting → listening ⇄ thinking ⇄ speaking → completed → idle
 *
 * 事件:
 *   - 用户消息 (USER_MESSAGE): 用户语音被 ASR 转写完成
 *   - AI 文本流 (AI_TEXT_DELTA / AI_TEXT_DONE): LLM 输出文字流
 *   - AI 音频流 (AI_AUDIO_CHUNK): TTS 输出音频块
 *   - 打断 (BARGE_IN): 用户在 AI 说话时开始说话, 截断 AI 回复
 *   - 轮次结束 (TURN_DONE): 服务端 response.done
 *   - 连接 (CONNECT / DISCONNECT / ERROR)
 *
 * Author: MiniMax-M3 (Sprint 13 — Realtime Voice)
 */
import type { ConversationMessage, ConversationState, Role } from '../types';

// ============================================================================
// State
// ============================================================================
export type ConversationStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'completed'
  | 'error';

export interface BargeInStats {
  /** 累计打断次数 */
  count: number;
  /** 最近一次打断时间戳 (performance.now()) */
  lastAt: number | null;
}

export interface LatencyStats {
  /** 累计轮次 */
  turns: number;
  /** 累计端到端延迟 (用户停下 → AI 第一条 audio delta) */
  totalMs: number;
  /** 最近一次端到端延迟 */
  lastMs: number | null;
}

export interface ConversationMetrics {
  bargeIn: BargeInStats;
  latency: LatencyStats;
  /** 累计用户消息数 */
  userMessages: number;
  /** 累计 AI 回复数 */
  aiMessages: number;
}

export interface ConversationState {
  status: ConversationStatus;
  messages: ConversationMessage[];
  /** 当前正在流式接收的 AI 文本 (打字机) */
  streamingText: string;
  /** 当前正在播放的 AI response_id (用于打断时对齐) */
  streamingResponseId: string | null;
  /** 错误信息 */
  error: string | null;
  /** 会话级 metrics */
  metrics: ConversationMetrics;
  /** 会话开始时间戳 */
  startedAt: number | null;
}

export const initialConversationState: ConversationState = {
  status: 'idle',
  messages: [],
  streamingText: '',
  streamingResponseId: null,
  error: null,
  metrics: {
    bargeIn: { count: 0, lastAt: null },
    latency: { turns: 0, totalMs: 0, lastMs: null },
    userMessages: 0,
    aiMessages: 0,
  },
  startedAt: null,
};

// ============================================================================
// Actions
// ============================================================================
export type ConversationAction =
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_OPEN'; timestamp: number }
  | { type: 'CONNECT_FAIL'; error: string }
  | { type: 'DISCONNECT' }
  | { type: 'STATUS_CHANGE'; status: ConversationStatus }
  | { type: 'USER_MESSAGE'; text: string; timestamp: number; interim?: boolean }
  | { type: 'AI_TEXT_DELTA'; text: string; responseId: string }
  | { type: 'AI_TEXT_DONE'; fullText: string; responseId: string; timestamp: number }
  | { type: 'AI_AUDIO_CHUNK'; bytes: number; responseId: string }
  | { type: 'BARGE_IN'; timestamp: number; responseId?: string | null }
  | { type: 'TURN_DONE'; responseId: string; timestamp: number; latencyMs?: number }
  | { type: 'AI_MESSAGE_REPLACE'; responseId: string; text: string; timestamp: number }
  | { type: 'CLEAR' };

// ============================================================================
// Helpers
// ============================================================================
const MAX_MESSAGES = 200;

function findMessageIndex(
  messages: ConversationMessage[],
  id: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === id) return i;
  }
  return -1;
}

function ensureAiMessage(
  messages: ConversationMessage[],
  responseId: string,
  timestamp: number,
): ConversationMessage[] {
  const idx = findMessageIndex(messages, responseId);
  if (idx >= 0) return messages;
  const newMsg: ConversationMessage = {
    id: responseId,
    role: 'assistant' as Role,
    text: '',
    timestamp,
    audioBytes: 0,
    interrupted: false,
  };
  return [...messages, newMsg].slice(-MAX_MESSAGES);
}

// ============================================================================
// Reducer
// ============================================================================
export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'CONNECT_START': {
      return {
        ...initialConversationState,
        status: 'connecting',
      };
    }

    case 'CONNECT_OPEN': {
      return {
        ...state,
        status: 'listening',
        error: null,
        startedAt: action.timestamp,
      };
    }

    case 'CONNECT_FAIL': {
      return {
        ...state,
        status: 'error',
        error: action.error,
      };
    }

    case 'DISCONNECT': {
      // 如果还在 streaming, 完成它 (标记 current message 为 done)
      const messages =
        state.streamingText || state.streamingResponseId
          ? commitStreamingAiMessage(state)
          : state.messages;
      return {
        ...state,
        status: 'idle',
        messages,
        streamingText: '',
        streamingResponseId: null,
      };
    }

    case 'STATUS_CHANGE': {
      if (state.status === action.status) return state;
      return { ...state, status: action.status };
    }

    case 'USER_MESSAGE': {
      const userMsg: ConversationMessage = {
        id: `user-${action.timestamp}`,
        role: 'user',
        text: action.text,
        timestamp: action.timestamp,
        interim: action.interim,
      };
      return {
        ...state,
        status: action.interim ? state.status : 'thinking',
        messages: [...state.messages, userMsg].slice(-MAX_MESSAGES),
        metrics: {
          ...state.metrics,
          userMessages: action.interim
            ? state.metrics.userMessages
            : state.metrics.userMessages + 1,
        },
      };
    }

    case 'AI_TEXT_DELTA': {
      // 同 response_id 持续累加 (打字机); 切换 response_id 时提交上一段, 开新段
      const currentId = state.streamingResponseId;
      let messages: ConversationMessage[];
      let streamingText: string;
      if (currentId && currentId !== action.responseId) {
        // 切换: 提交旧的, 开始新流
        messages = commitStreamingAiMessage(state);
        messages = ensureAiMessage(messages, action.responseId, action.timestamp || Date.now());
        streamingText = action.text;
      } else if (currentId === action.responseId) {
        // 同 id 累加
        messages = state.messages;
        streamingText = state.streamingText + action.text;
      } else {
        // 首次
        messages = ensureAiMessage(state.messages, action.responseId, action.timestamp || Date.now());
        streamingText = action.text;
      }
      return {
        ...state,
        status: 'speaking',
        streamingText,
        streamingResponseId: action.responseId,
        messages,
      };
    }

    case 'AI_TEXT_DONE': {
      const messages = commitStreamingAiMessage(state, action.fullText);
      return {
        ...state,
        status: 'speaking',
        streamingText: '',
        streamingResponseId: null,
        messages,
      };
    }

    case 'AI_AUDIO_CHUNK': {
      const idx = findMessageIndex(state.messages, action.responseId);
      if (idx < 0) return state;
      const messages = [...state.messages];
      const prev = messages[idx];
      messages[idx] = {
        ...prev,
        audioBytes: (prev.audioBytes || 0) + action.bytes,
      };
      return { ...state, messages };
    }

    case 'BARGE_IN': {
      // 1) 立即把当前流式文本标记为 interrupted, 提交为已打断的 AI 消息
      const messages = commitStreamingAiMessage(state, undefined, true);
      return {
        ...state,
        status: 'listening',
        streamingText: '',
        streamingResponseId: null,
        messages,
        metrics: {
          ...state.metrics,
          bargeIn: {
            count: state.metrics.bargeIn.count + 1,
            lastAt: action.timestamp,
          },
        },
      };
    }

    case 'TURN_DONE': {
      const messages = commitStreamingAiMessage(state);
      const newTurns = state.metrics.latency.turns + 1;
      const totalMs =
        state.metrics.latency.totalMs + (action.latencyMs ?? 0);
      return {
        ...state,
        status: 'listening',
        messages,
        metrics: {
          ...state.metrics,
          aiMessages: state.metrics.aiMessages + 1,
          latency: {
            turns: newTurns,
            totalMs,
            lastMs: action.latencyMs ?? state.metrics.latency.lastMs,
          },
        },
      };
    }

    case 'AI_MESSAGE_REPLACE': {
      // 打断后服务端可能再推一段补完的文本, 替换已打断的 AI 消息的 text
      const idx = findMessageIndex(state.messages, action.responseId);
      if (idx < 0) return state;
      const messages = [...state.messages];
      messages[idx] = { ...messages[idx], text: action.text };
      return { ...state, messages };
    }

    case 'CLEAR': {
      return { ...initialConversationState };
    }
  }
}

// ============================================================================
// Internal helpers (exported for unit testing)
// ============================================================================
function commitStreamingAiMessage(
  state: ConversationState,
  fullTextOverride?: string,
  interrupted = false,
): ConversationMessage[] {
  const responseId = state.streamingResponseId;
  const streamingText = state.streamingText;
  if (!responseId) {
    // 没有 streaming 中, 但可能有 interim user message; 直接返回
    return state.messages;
  }
  const idx = findMessageIndex(state.messages, responseId);
  if (idx < 0) {
    if (!streamingText && !fullTextOverride) return state.messages;
    const newMsg: ConversationMessage = {
      id: responseId,
      role: 'assistant',
      text: fullTextOverride ?? streamingText,
      timestamp: Date.now(),
      interrupted,
    };
    return [...state.messages, newMsg].slice(-MAX_MESSAGES);
  }
  const messages = [...state.messages];
  const prev = messages[idx];
  messages[idx] = {
    ...prev,
    text: fullTextOverride ?? (streamingText || prev.text),
    interrupted: prev.interrupted || interrupted,
  };
  return messages;
}