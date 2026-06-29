/**
 * CaptionBar 卡拉OK 逐字高亮 — 组件级测试 (模块 A + Sprint 13.3 DOM优化)
 *
 * 验收:
 *  - 渲染 words 数组为 span.transcript-word 序列
 *  - currentTime 在某词区间时, 对应 span 含 is-active
 *  - K 键切换 karaokeEnabled (内部 hook 管理)
 *  - Sprint 13.3: DOM 优化 — span 元素稳定, rAF 只更新 attributes (O(1))
 *
 * 注意: CaptionBar 内部自管 rAF 推进, 测试通过 mock performance.now()
 * 让 currentTime 进入目标区间, 然后触发 rAF 回调.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { CaptionBar } from '../components/CaptionBar';
import type { WordInfo } from '../types';

describe('CaptionBar 卡拉OK 逐字高亮', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders words as span.transcript-word sequence with correct text', () => {
    const words: WordInfo[] = [
      { word: 'hello', start: 0, end: 0.5, confidence: 1 },
      { word: 'world', start: 0.5, end: 1.0, confidence: 1 },
    ];
    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="hello world"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={0}
        karaokeEnabled={true}
      />
    );
    const spans = container.querySelectorAll('.transcript-word');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toContain('hello');
    expect(spans[1].textContent).toContain('world');
  });

  it('marks active word as is-active when rAF advances into its range', () => {
    const words: WordInfo[] = [
      { word: 'hello', start: 0, end: 1, confidence: 1 },
      { word: 'world', start: 1, end: 2, confidence: 1 },
    ];
    // 锁定 performance.now() 在 finalStartTime + 0.5s (在 "hello" 区间)
    const finalStart = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(finalStart + 500);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="hello world"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    // 推进 rAF 队列 (每个 rAF 会再递归调度一次)
    act(() => {
      vi.advanceTimersByTime(16);
    });

    const active = container.querySelector('.transcript-word.is-active');
    expect(active).toBeTruthy();
    expect(active?.textContent).toContain('hello');

    // "world" 之前还没到, 不应 is-past
    const past = container.querySelector('.transcript-word.is-past');
    expect(past).toBeFalsy();

    nowSpy.mockRestore();
  });

  it('K key toggles karaoke off (移除 is-active, 降级为纯文本)', () => {
    const words: WordInfo[] = [
      { word: 'a', start: 0, end: 0.5, confidence: 1 },
      { word: 'b', start: 0.5, end: 1, confidence: 1 },
    ];
    const finalStart = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 100);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="a b"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    // 推进 rAF 一次, 让 is-active 出现
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(container.querySelector('.transcript-word.is-active')).toBeTruthy();

    // 模拟按 K 键
    act(() => {
      fireEvent.keyDown(document, { key: 'k', code: 'KeyK' });
    });

    // 切换后: 不再有 is-active
    expect(container.querySelector('.transcript-word.is-active')).toBeFalsy();
  });
});

describe('CaptionBar Sprint 13.3 DOM optimization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('karaoke wrapper has data-active-idx and data-progress attributes', () => {
    const words: WordInfo[] = [
      { word: 'hello', start: 0, end: 0.5, confidence: 1 },
      { word: 'world', start: 0.5, end: 1.0, confidence: 1 },
    ];
    const finalStart = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 100);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="hello world"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    const wrapper = container.querySelector('.karaoke');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.getAttribute('data-active-idx')).not.toBeNull();
    expect(wrapper!.getAttribute('data-progress')).not.toBeNull();
  });

  it('span elements have stable data-word-index attribute', () => {
    const words: WordInfo[] = [
      { word: 'one', start: 0, end: 0.3, confidence: 1 },
      { word: 'two', start: 0.3, end: 0.6, confidence: 1 },
      { word: 'three', start: 0.6, end: 1.0, confidence: 1 },
    ];
    const finalStart = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 200);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="one two three"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    const spans = container.querySelectorAll('.transcript-word');
    expect(spans.length).toBe(3);
    // Each span has a stable data-word-index matching its position
    spans.forEach((span, i) => {
      expect(span.getAttribute('data-word-index')).toBe(String(i));
    });
  });

  it('only active-idx and progress attributes change between frames, not DOM structure', () => {
    const words: WordInfo[] = Array.from({ length: 100 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.1,
      end: (i + 1) * 0.1,
      confidence: 1,
    }));
    const finalStart = 1000;
    let now = finalStart + 0; // start at t=0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText={words.map((w) => w.word).join(' ')}
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    // Run a few rAF frames to get into the flow
    act(() => {
      vi.advanceTimersByTime(16);
    });

    // Capture the initial DOM structure (span references)
    const spansBefore = Array.from(container.querySelectorAll('.transcript-word'));
    const wrapperBefore = container.querySelector('.karaoke');
    const activeIdxBefore = wrapperBefore!.getAttribute('data-active-idx');
    const progressBefore = wrapperBefore!.getAttribute('data-progress');

    // Advance time so the active word changes
    now = finalStart + 2000; // advance 2 seconds (should be around word 20)
    act(() => {
      vi.advanceTimersByTime(160);
    });

    const spansAfter = Array.from(container.querySelectorAll('.transcript-word'));
    const wrapperAfter = container.querySelector('.karaoke');
    const activeIdxAfter = wrapperAfter!.getAttribute('data-active-idx');
    const progressAfter = wrapperAfter!.getAttribute('data-progress');

    // Same number of spans (DOM structure is stable, not fully recreated)
    expect(spansAfter.length).toBe(spansBefore.length);

    // The wrapper itself is the same element (no React re-render creating new DOM)
    expect(wrapperBefore).toBe(wrapperAfter);

    // data-active-idx may or may not have changed (depends on timing), but it still tracks
    expect(activeIdxAfter).not.toBeNull();
    expect(progressAfter).not.toBeNull();

    // Assert that at least one of data-active-idx or data-progress changed between frames
    // This confirms the rAF tick is doing something
    const anythingChanged = activeIdxAfter !== activeIdxBefore || progressAfter !== progressBefore;
    expect(anythingChanged).toBe(true);

    nowSpy.mockRestore();
  });

  it('active word gets data-progress attribute for CSS-driven transitions', () => {
    const words: WordInfo[] = [
      { word: 'hello', start: 0, end: 1, confidence: 1 },
      { word: 'world', start: 1, end: 2, confidence: 1 },
    ];
    const finalStart = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(finalStart + 500); // mid-word

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="hello world"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    const activeSpan = container.querySelector('.transcript-word.is-active');
    expect(activeSpan).toBeTruthy();
    // Active word span should have data-progress attribute (set by rAF tick)
    const dp = activeSpan!.getAttribute('data-progress');
    expect(dp).not.toBeNull();
    const progress = parseFloat(dp!);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(1);
  });

  it('past words get is-past class when active advances', () => {
    const words: WordInfo[] = [
      { word: 'a', start: 0, end: 0.5, confidence: 1 },
      { word: 'b', start: 0.5, end: 1.0, confidence: 1 },
      { word: 'c', start: 1.0, end: 1.5, confidence: 1 },
    ];
    const finalStart = 1000;
    let now = finalStart + 200; // in "a" range
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { container } = render(
      <CaptionBar
        currentText=""
        fullText="a b c"
        currentSpeaker={null}
        isRecording={true}
        words={words}
        finalStartTime={finalStart}
        karaokeEnabled={true}
      />
    );

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // "a" should be active
    expect(container.querySelector('.transcript-word[data-word-index="0"]')?.classList.contains('is-active')).toBe(true);

    // Advance time to "c" range
    now = finalStart + 1200;
    act(() => {
      vi.advanceTimersByTime(160);
    });

    // "a" should now be is-past
    const aSpan = container.querySelector('.transcript-word[data-word-index="0"]');
    expect(aSpan?.classList.contains('is-past')).toBe(true);
    expect(aSpan?.classList.contains('is-active')).toBe(false);

    // "c" should now be active
    const cSpan = container.querySelector('.transcript-word[data-word-index="2"]');
    expect(cSpan?.classList.contains('is-active')).toBe(true);

    nowSpy.mockRestore();
  });
});