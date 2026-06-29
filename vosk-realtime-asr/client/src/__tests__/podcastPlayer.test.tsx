/**
 * PodcastPlayer — TDD 红测试
 *
 * 设计: 参考 Apple Podcasts / Spotify
 * - 大封面 + 标题 + 时长
 * - 主持人 A 左对齐气泡, B 右对齐气泡
 * - 章节列表 (点击跳转)
 * - 底部播放控制 (播/暂/前 15s/后 15s/倍速)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PodcastPlayer } from '../components/PodcastPlayer';
import type { PodcastResult } from '../hooks/usePodcastGeneration';

const mockResult: PodcastResult = {
  task_id: 'sync-001',
  total_duration_ms: 180000,
  progress: 1.0,
  script: [
    { role: 'host_a', text: '大家好, 欢迎收听本期节目', audio_url: 'https://x/a.mp3', duration_ms: 4000 },
    { role: 'host_b', text: '今天我们聊一聊 AI Agent 的最新进展', audio_url: 'https://x/b.mp3', duration_ms: 5500 },
    { role: 'host_a', text: '首先回顾上期要点', audio_url: 'https://x/c.mp3', duration_ms: 3000 },
    { role: 'host_b', text: '然后我们深入技术细节', audio_url: 'https://x/d.mp3', duration_ms: 4500 },
  ],
  chapters: [
    { title: '开场介绍', start_ms: 0, end_ms: 4000 },
    { title: '主题探讨', start_ms: 4000, end_ms: 12000 },
  ],
};

// ============================================================================
// 渲染
// ============================================================================
describe('PodcastPlayer — 渲染', () => {
  beforeEach(() => {
    // jsdom 没有 HTMLMediaElement.play() 方法
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染标题 + 总时长 + 章节数', () => {
    render(<PodcastPlayer result={mockResult} />);
    // 总时长 180000ms = 03:00
    expect(screen.getByText(/03:00/)).toBeTruthy();
    // 章节列表
    expect(screen.getByText('开场介绍')).toBeTruthy();
    expect(screen.getByText('主题探讨')).toBeTruthy();
  });

  it('渲染每位主持人气泡', () => {
    render(<PodcastPlayer result={mockResult} />);
    expect(screen.getByText(/大家好, 欢迎收听本期节目/)).toBeTruthy();
    expect(screen.getByText(/今天我们聊一聊 AI Agent/)).toBeTruthy();
  });

  it('host_a 气泡在视觉上靠左 (className 含 host-a), host_b 靠右', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    const hostA = container.querySelector('.podcast-bubble.host-a');
    const hostB = container.querySelector('.podcast-bubble.host-b');
    expect(hostA).toBeTruthy();
    expect(hostB).toBeTruthy();
  });
});

// ============================================================================
// 播放控制
// ============================================================================
describe('PodcastPlayer — 播放控制', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('点击播放按钮 → audio.play 被调用', () => {
    render(<PodcastPlayer result={mockResult} />);
    const playBtn = screen.getByRole('button', { name: /播放|play/i });
    fireEvent.click(playBtn);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('键盘 Space 切换播放/暂停', () => {
    render(<PodcastPlayer result={mockResult} />);
    const root = screen.getByRole('region', { name: /播客播放器/i });
    fireEvent.keyDown(root, { key: ' ' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});

// ============================================================================
// 倍速
// ============================================================================
describe('PodcastPlayer — 倍速切换', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('点击倍速 chip → 当前 rate 更新 + audio.playbackRate 同步', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    // 找到 1.5x chip
    const chip = screen.getByText('1.5x');
    fireEvent.click(chip);
    // audio 元素的 playbackRate 应被设置 (通过 ref)
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.playbackRate).toBe(1.5);
  });

  it('rate 默认 = 1', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.playbackRate).toBe(1);
  });
});

// ============================================================================
// 章节跳转
// ============================================================================
describe('PodcastPlayer — 章节跳转', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('点击章节 → 当前 currentTime 更新到对应 start_ms/1000', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    const chapterItem = screen.getByText('主题探讨');
    fireEvent.click(chapterItem);
    // 章节 1: start_ms=4000, currentTime 应跳到 4 秒
    expect(audio.currentTime).toBeCloseTo(4, 1);
  });
});

// ============================================================================
// 前 15s / 后 15s
// ============================================================================
describe('PodcastPlayer — 快进快退', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('点击后退 15s → currentTime -= 15', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 20;
    const backBtn = container.querySelector('[data-testid="podcast-back-15"]') as HTMLElement;
    fireEvent.click(backBtn);
    expect(audio.currentTime).toBeCloseTo(5, 1);
  });

  it('点击前进 15s → currentTime += 15', () => {
    const { container } = render(<PodcastPlayer result={mockResult} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 10;
    const fwdBtn = container.querySelector('[data-testid="podcast-forward-15"]') as HTMLElement;
    fireEvent.click(fwdBtn);
    expect(audio.currentTime).toBeCloseTo(25, 1);
  });
});