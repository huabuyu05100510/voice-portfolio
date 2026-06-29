/**
 * TDD: conversationReducer 全 action 覆盖
 * Model: MiniMax-M3
 */
import { describe, it, expect } from 'vitest';
import {
  conversationReducer,
  initialConversationState,
  type ConversationState,
} from '../conversationReducer';

// ----------------------------------------------------------------------------
// CONNECT_START / CONNECT_OPEN / CONNECT_FAIL / DISCONNECT
// ----------------------------------------------------------------------------
describe('conversationReducer / connection lifecycle', () => {
  it('CONNECT_START: 重置到 connecting, 清空 messages & metrics', () => {
    const s0: ConversationState = {
      ...initialConversationState,
      status: 'speaking',
      messages: [
        { id: 'old', role: 'assistant', text: 'old', timestamp: 1 },
      ],
      metrics: {
        ...initialConversationState.metrics,
        userMessages: 5,
      },
    };
    const s1 = conversationReducer(s0, { type: 'CONNECT_START' });
    expect(s1.status).toBe('connecting');
    expect(s1.messages).toEqual([]);
    expect(s1.metrics.userMessages).toBe(0);
  });

  it('CONNECT_OPEN: 设置 listening, 记录 startedAt', () => {
    const s1 = conversationReducer(initialConversationState, {
      type: 'CONNECT_OPEN',
      timestamp: 12345,
    });
    expect(s1.status).toBe('listening');
    expect(s1.startedAt).toBe(12345);
    expect(s1.error).toBeNull();
  });

  it('CONNECT_FAIL: 状态 → error, 写入 error 信息', () => {
    const s1 = conversationReducer(initialConversationState, {
      type: 'CONNECT_FAIL',
      error: '凭证缺失',
    });
    expect(s1.status).toBe('error');
    expect(s1.error).toBe('凭证缺失');
  });

  it('DISCONNECT: listening → idle, 不丢已提交 messages', () => {
    let s = conversationReducer(initialConversationState, { type: 'CONNECT_OPEN', timestamp: 1 });
    s = conversationReducer(s, {
      type: 'USER_MESSAGE',
      text: '你好',
      timestamp: 100,
    });
    s = conversationReducer(s, {
      type: 'AI_TEXT_DELTA',
      text: '你',
      responseId: 'r1',
    });
    s = conversationReducer(s, {
      type: 'AI_TEXT_DONE',
      fullText: '你好',
      responseId: 'r1',
      timestamp: 200,
    });
    s = conversationReducer(s, { type: 'DISCONNECT' });
    expect(s.status).toBe('idle');
    expect(s.messages.length).toBe(2);
    expect(s.messages[1].text).toBe('你好');
  });
});

// ----------------------------------------------------------------------------
// STATUS_CHANGE
// ----------------------------------------------------------------------------
describe('conversationReducer / STATUS_CHANGE', () => {
  it('变状态', () => {
    const s1 = conversationReducer(initialConversationState, {
      type: 'STATUS_CHANGE',
      status: 'speaking',
    });
    expect(s1.status).toBe('speaking');
  });

  it('同状态幂等 (返回新引用但不变化)', () => {
    const s0 = { ...initialConversationState, status: 'listening' as const };
    const s1 = conversationReducer(s0, { type: 'STATUS_CHANGE', status: 'listening' });
    expect(s1).toBe(s0); // 引用相同 (pure 优化)
  });
});

// ----------------------------------------------------------------------------
// USER_MESSAGE
// ----------------------------------------------------------------------------
describe('conversationReducer / USER_MESSAGE', () => {
  it('final 用户消息 append, status → thinking, 计数 +1', () => {
    const s1 = conversationReducer(initialConversationState, {
      type: 'USER_MESSAGE',
      text: '今天天气',
      timestamp: 100,
    });
    expect(s1.messages).toHaveLength(1);
    expect(s1.messages[0]).toMatchObject({
      role: 'user',
      text: '今天天气',
      interim: undefined,
    });
    expect(s1.status).toBe('thinking');
    expect(s1.metrics.userMessages).toBe(1);
  });

  it('interim 用户消息不计数, 不切 status', () => {
    const s0 = { ...initialConversationState, status: 'listening' as const };
    const s1 = conversationReducer(s0, {
      type: 'USER_MESSAGE',
      text: '今',
      timestamp: 50,
      interim: true,
    });
    expect(s1.messages[0].interim).toBe(true);
    expect(s1.status).toBe('listening');
    expect(s1.metrics.userMessages).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// AI_TEXT_DELTA / AI_TEXT_DONE
// ----------------------------------------------------------------------------
describe('conversationReducer / AI streaming text', () => {
  it('连续 DELTA 同 response_id 累加 streamingText', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '你',
      responseId: 'r1',
    });
    s = conversationReducer(s, { type: 'AI_TEXT_DELTA', text: '好', responseId: 'r1' });
    expect(s.streamingText).toBe('你好');
    expect(s.streamingResponseId).toBe('r1');
  });

  it('切换 response_id 自动 commit 上一个 + 开新流', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '第一句',
      responseId: 'r1',
    });
    s = conversationReducer(s, { type: 'AI_TEXT_DELTA', text: '第二句', responseId: 'r2' });
    // 第一个 AI 消息已被 commit 到 messages
    expect(s.messages.some((m) => m.id === 'r1' && m.text === '第一句')).toBe(true);
    // streamingText 是新 r2 的累积
    expect(s.streamingText).toBe('第二句');
    expect(s.streamingResponseId).toBe('r2');
  });

  it('AI_TEXT_DONE 把 streamingText 提交为 message.text', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '完整',
      responseId: 'r1',
    });
    s = conversationReducer(s, {
      type: 'AI_TEXT_DONE',
      fullText: '完整回答',
      responseId: 'r1',
      timestamp: 100,
    });
    expect(s.streamingText).toBe('');
    expect(s.streamingResponseId).toBeNull();
    expect(s.messages.some((m) => m.id === 'r1' && m.text === '完整回答')).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// AI_AUDIO_CHUNK
// ----------------------------------------------------------------------------
describe('conversationReducer / AI_AUDIO_CHUNK', () => {
  it('累计对应 responseId 的 audioBytes', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: 'x',
      responseId: 'r1',
    });
    s = conversationReducer(s, { type: 'AI_AUDIO_CHUNK', bytes: 1024, responseId: 'r1' });
    s = conversationReducer(s, { type: 'AI_AUDIO_CHUNK', bytes: 2048, responseId: 'r1' });
    const msg = s.messages.find((m) => m.id === 'r1');
    expect(msg?.audioBytes).toBe(1024 + 2048);
  });

  it('未知 responseId 静默忽略 (audio chunk 可能先于 delta)', () => {
    const s1 = conversationReducer(initialConversationState, {
      type: 'AI_AUDIO_CHUNK',
      bytes: 100,
      responseId: 'unknown',
    });
    expect(s1.messages).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// BARGE_IN (打断)
// ----------------------------------------------------------------------------
describe('conversationReducer / BARGE_IN', () => {
  it('打断时 commit 当前 streaming 为 interrupted=true', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '我正在说',
      responseId: 'r1',
    });
    s = conversationReducer(s, { type: 'BARGE_IN', timestamp: 100 });
    expect(s.streamingText).toBe('');
    expect(s.streamingResponseId).toBeNull();
    const msg = s.messages.find((m) => m.id === 'r1');
    expect(msg?.interrupted).toBe(true);
    expect(msg?.text).toBe('我正在说');
    expect(s.status).toBe('listening');
  });

  it('累计 barge_in 计数', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'CONNECT_OPEN',
      timestamp: 1,
    });
    s = conversationReducer(s, { type: 'AI_TEXT_DELTA', text: 'a', responseId: 'r1' });
    s = conversationReducer(s, { type: 'BARGE_IN', timestamp: 100 });
    s = conversationReducer(s, { type: 'AI_TEXT_DELTA', text: 'b', responseId: 'r2' });
    s = conversationReducer(s, { type: 'BARGE_IN', timestamp: 200 });
    expect(s.metrics.bargeIn.count).toBe(2);
    expect(s.metrics.bargeIn.lastAt).toBe(200);
  });
});

// ----------------------------------------------------------------------------
// TURN_DONE
// ----------------------------------------------------------------------------
describe('conversationReducer / TURN_DONE', () => {
  it('提交 streaming → listening, 累加 latency stats', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '回答',
      responseId: 'r1',
    });
    s = conversationReducer(s, {
      type: 'TURN_DONE',
      responseId: 'r1',
      timestamp: 500,
      latencyMs: 320,
    });
    expect(s.status).toBe('listening');
    expect(s.metrics.aiMessages).toBe(1);
    expect(s.metrics.latency.turns).toBe(1);
    expect(s.metrics.latency.totalMs).toBe(320);
    expect(s.metrics.latency.lastMs).toBe(320);
  });

  it('多次 turn 累计平均延迟可计算', () => {
    let s = conversationReducer(initialConversationState, { type: 'CONNECT_OPEN', timestamp: 1 });
    for (let i = 0; i < 3; i++) {
      s = conversationReducer(s, { type: 'AI_TEXT_DELTA', text: 'x', responseId: `r${i}` });
      s = conversationReducer(s, {
        type: 'TURN_DONE',
        responseId: `r${i}`,
        timestamp: 100 + i,
        latencyMs: 100 * (i + 1),
      });
    }
    expect(s.metrics.latency.turns).toBe(3);
    expect(s.metrics.latency.totalMs).toBe(600); // 100+200+300
  });
});

// ----------------------------------------------------------------------------
// AI_MESSAGE_REPLACE
// ----------------------------------------------------------------------------
describe('conversationReducer / AI_MESSAGE_REPLACE', () => {
  it('替换被打断的 AI 消息文本', () => {
    let s = conversationReducer(initialConversationState, {
      type: 'AI_TEXT_DELTA',
      text: '原',
      responseId: 'r1',
    });
    s = conversationReducer(s, { type: 'BARGE_IN', timestamp: 100 });
    s = conversationReducer(s, {
      type: 'AI_MESSAGE_REPLACE',
      responseId: 'r1',
      text: '补完文本',
      timestamp: 150,
    });
    const msg = s.messages.find((m) => m.id === 'r1');
    expect(msg?.text).toBe('补完文本');
    expect(msg?.interrupted).toBe(true); // 保留 interrupted 标记
  });
});

// ----------------------------------------------------------------------------
// CLEAR
// ----------------------------------------------------------------------------
describe('conversationReducer / CLEAR', () => {
  it('完全重置回 initialConversationState', () => {
    let s = conversationReducer(initialConversationState, { type: 'CONNECT_OPEN', timestamp: 1 });
    s = conversationReducer(s, { type: 'USER_MESSAGE', text: 'x', timestamp: 2 });
    s = conversationReducer(s, { type: 'CLEAR' });
    expect(s).toEqual(initialConversationState);
  });
});