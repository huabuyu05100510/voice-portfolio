/**
 * TDD: RealtimeChat component
 *
 * Model: MiniMax-M3
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RealtimeChat } from '../components/RealtimeChat';
import {
  initialConversationState,
  type ConversationState,
} from '../state/conversationReducer';
import type { ConversationMessage } from '../types';

afterEach(() => cleanup());

function makeState(over: Partial<ConversationState> = {}): ConversationState {
  return { ...initialConversationState, ...over };
}

describe('RealtimeChat / 基础渲染', () => {
  it('idle 状态显示空态提示', () => {
    render(
      <RealtimeChat
        state={makeState()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/和 AI 自由对话/)).toBeDefined();
    const buttons = screen.getAllByRole('button');
    expect(buttons.some((b) => b.textContent?.includes('开始对话'))).toBe(true);
  });

  it('connecting 状态按钮 disabled + 显示连接中文案', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'connecting' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /连接中|开始/ });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/正在建立连接/)).toBeDefined();
  });

  it('listening 状态显示「在听」 pill + 麦克风图标', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'listening' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId('status-pill').textContent).toContain('在听');
  });

  it('speaking 状态显示「AI 正在说话」 + waveform', () => {
    const { container } = render(
      <RealtimeChat
        state={makeState({ status: 'speaking' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId('status-pill').textContent).toContain('AI 正在说话');
    expect(container.querySelector('.rt-ptt-speaking')).toBeTruthy();
  });

  it('error 状态显示连接错误文案', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'error', error: '凭证缺失' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('连接错误')).toBeDefined();
    expect(screen.getByText(/请检查服务端配置/)).toBeDefined();
  });
});

describe('RealtimeChat / 交互', () => {
  it('点击开始对话按钮 → 调用 onConnect', () => {
    const onConnect = vi.fn();
    render(
      <RealtimeChat
        state={makeState()}
        onConnect={onConnect}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const startBtn = buttons.find((b) => b.textContent?.includes('开始对话'));
    fireEvent.click(startBtn!);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('已连接状态显示「结束」按钮, 点击调用 onDisconnect', () => {
    const onDisconnect = vi.fn();
    render(
      <RealtimeChat
        state={makeState({ status: 'listening' })}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结束对话' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('点击清空按钮 → 调用 onClear', () => {
    const onClear = vi.fn();
    const messages: ConversationMessage[] = [
      { id: 'u1', role: 'user', text: 'hi', timestamp: 1 },
    ];
    render(
      <RealtimeChat
        state={makeState({ messages, status: 'listening' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '清空对话历史' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('PTT 按钮: 鼠标按下激活状态', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'listening' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const ptt = screen.getByTestId('ptt-button');
    expect(ptt.classList.contains('rt-ptt-active')).toBe(true);
    fireEvent.mouseDown(ptt);
    expect(ptt.classList.contains('rt-ptt-press')).toBe(true);
    fireEvent.mouseUp(ptt);
    expect(ptt.classList.contains('rt-ptt-press')).toBe(false);
  });
});

describe('RealtimeChat / 消息气泡', () => {
  it('渲染用户消息 + AI 消息', () => {
    const messages: ConversationMessage[] = [
      { id: 'u1', role: 'user', text: '你好', timestamp: 1 },
      { id: 'r1', role: 'assistant', text: '你好, 有什么可以帮你?', timestamp: 2 },
    ];
    render(
      <RealtimeChat
        state={makeState({ messages })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId('user-bubble').textContent).toContain('你好');
    expect(screen.getByTestId('ai-bubble').textContent).toContain('有什么可以帮你');
  });

  it('被打断的 AI 消息显示「· 被打断」标签', () => {
    const messages: ConversationMessage[] = [
      { id: 'r1', role: 'assistant', text: '我正在回答...', timestamp: 1, interrupted: true },
    ];
    render(
      <RealtimeChat
        state={makeState({ messages })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const ai = screen.getByTestId('ai-bubble');
    expect(ai.textContent).toContain('被打断');
    expect(ai.classList.contains('rt-message-interrupted')).toBe(true);
  });

  it('streaming text 直接渲染到打字机气泡', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'speaking', streamingText: '正在实时输' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const bubble = screen.getByTestId('streaming-bubble');
    expect(bubble.textContent).toContain('正在实时输');
    expect(bubble.querySelector('.rt-cursor')).toBeTruthy();
  });
});

describe('RealtimeChat / 指标', () => {
  it('显示轮次 / 打断 / 延迟', () => {
    render(
      <RealtimeChat
        state={makeState({
          status: 'listening',
          metrics: {
            ...initialConversationState.metrics,
            aiMessages: 5,
            bargeIn: { count: 2, lastAt: 1 },
            latency: { turns: 5, totalMs: 5000, lastMs: 850 },
          },
        })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId('metric-turns').textContent).toBe('轮次 5');
    expect(screen.getByTestId('metric-barge-in').textContent).toBe('打断 2');
    expect(screen.getByTestId('metric-latency').textContent).toBe('延迟 850ms');
  });

  it('无延迟时不显示延迟指标', () => {
    render(
      <RealtimeChat
        state={makeState({ status: 'listening' })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('metric-latency')).toBeNull();
  });
});

describe('RealtimeChat / 可访问性', () => {
  it('有 role=region aria-label', () => {
    render(
      <RealtimeChat
        state={makeState()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const region = screen.getByRole('region', { name: '端到端实时语音对话' });
    expect(region).toBeDefined();
  });

  it('消息容器 aria-live=polite (打字机自动播报)', () => {
    render(
      <RealtimeChat
        state={makeState()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });
});