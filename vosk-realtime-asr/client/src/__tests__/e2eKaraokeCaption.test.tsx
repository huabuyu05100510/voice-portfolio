/**
 * 端到端集成测试: 服务端 final payload → CaptionBar 卡拉OK 渲染
 *
 * 模拟: 客户端接收到 火山引擎 v3 final 段 (含 words[])
 * 验证: CaptionBar 把 words 拆成 .transcript-word 序列
 *       推进 rAF 后当前词有 is-active class + word-progress 子元素
 *
 * 因为项目无 MSW, 采用组件级 e2e:
 *  - 复用 e2eUtterancePipeline.test.ts 的服务端 payload 构造模式
 *  - 直接 mount <CaptionBar> 模拟 reducer 状态
 *  - 输出 DOM HTML 作"截图占位" (changes 报告引用)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { CaptionBar } from '../components/CaptionBar';
import type { WordInfo, Speaker } from '../types';

const SAMPLE_SPEAKER: Speaker = { id: 'spk-0', label: '发言人 1', color: '#22d3ee' };

/** 构造 5 词 final 段, 模拟 2.5s 句长 */
function buildFinalWords(): WordInfo[] {
  return [
    { word: '你', start: 0.0, end: 0.5, confidence: 0.95, speaker_id: 'spk-0' },
    { word: '好', start: 0.5, end: 1.0, confidence: 0.95, speaker_id: 'spk-0' },
    { word: '世', start: 1.0, end: 1.5, confidence: 0.95, speaker_id: 'spk-0' },
    { word: '界', start: 1.5, end: 2.0, confidence: 0.95, speaker_id: 'spk-0' },
    { word: '!', start: 2.0, end: 2.5, confidence: 0.95, speaker_id: 'spk-0' },
  ];
}

describe('E2E / 服务端 final 段 → CaptionBar 卡拉OK 渲染', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts CaptionBar with final words → DOM 含 .transcript-word 序列', () => {
    const words = buildFinalWords();
    const finalStart = 5000; // 假设 final 段开始于 performance.now() = 5000
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 100);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="你好世界!"
        currentSpeaker={SAMPLE_SPEAKER}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    const spans = container.querySelectorAll('.transcript-word');
    expect(spans.length).toBe(5);
    expect(spans[0].textContent).toContain('你');
    expect(spans[1].textContent).toContain('好');
    expect(spans[2].textContent).toContain('世');
    expect(spans[3].textContent).toContain('界');
    expect(spans[4].textContent).toContain('!');
  });

  it('rAF 推进到 "好" 区间 → 第 2 个 span 标记 is-active + 进度条', () => {
    const words = buildFinalWords();
    const finalStart = 5000;
    // 当前 time = 0.6s (在 "好" 区间 0.5-1.0 内)
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 600);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="你好世界!"
        currentSpeaker={SAMPLE_SPEAKER}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    const active = container.querySelector('.transcript-word.is-active');
    expect(active?.textContent).toContain('好');
    // 进度条应存在
    const progress = active?.querySelector('.word-progress');
    expect(progress).toBeTruthy();
    // 宽度 0..100% (0.6s 落在 [0.5, 1.0] 内 20%)
    const width = (progress as HTMLElement | null)?.style.width;
    expect(width).toMatch(/^\d+(\.\d+)?%$/);
  });

  it('没有 words 时降级为纯文本', () => {
    const { container } = render(
      <CaptionBar
        currentText="等待 partial"
        fullText=""
        currentSpeaker={null}
        isRecording={true}
      />
    );
    expect(container.querySelectorAll('.transcript-word').length).toBe(0);
    expect(container.textContent).toContain('等待 partial');
  });

  it('karaokeEnabled=false 时降级为纯文本 (K 键关闭后状态)', () => {
    const words = buildFinalWords();
    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="你好世界!"
        currentSpeaker={SAMPLE_SPEAKER}
        isRecording={true}
        words={words}
        finalStartTime={5000}
        karaokeEnabled={false}
      />
    );
    // 不应渲染 .transcript-word
    expect(container.querySelectorAll('.transcript-word').length).toBe(0);
    // 应包含原文本
    expect(container.textContent).toContain('你好世界');
  });

  it('导出 DOM HTML 作"截图占位" (changes 报告引用)', () => {
    const words = buildFinalWords();
    const finalStart = 5000;
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 1250); // "世"

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="你好世界!"
        currentSpeaker={SAMPLE_SPEAKER}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // 抓 DOM HTML 序列化作"截图"
    const html = container.outerHTML;
    expect(html).toContain('caption-bar');
    expect(html).toContain('transcript-word is-active');
    expect(html).toContain('word-progress');
    // 此 html 字符串可由 changes 报告引用
    // eslint-disable-next-line no-console
    console.log('[E2E_SCREENSHOT]', html.length, 'bytes');
  });
});
