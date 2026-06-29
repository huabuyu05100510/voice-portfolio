/**
 * TranscriptHero 性能优化测试 (Task 13.2)
 *
 * 验证: 200+ results 时只有最后 50 条使用 framer-motion 包裹
 *       data-performance 属性追踪可见数量
 *       MAX_LAYOUT_ITEMS=5 限制 layout 动画
 *
 * Author: Claude Opus 4.6
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { TranscriptHero } from '../components/TranscriptHero';
import type { TranscriptionResult } from '../types';

/** 批量创建 mock 转写结果 */
function createMockResults(count: number): TranscriptionResult[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `This is sentence number ${i + 1}.`,
    isFinal: true,
    fullText: `This is sentence number ${i + 1}.`,
    timestamp: new Date().toISOString(),
    speaker_id: `spk${i % 3}`,
    definite: true,
    start_time: i * 1000,
    end_time: (i + 1) * 1000,
  }));
}

describe('TranscriptHero performance optimization (13.2)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all results as articles regardless of count', () => {
    const results = createMockResults(200);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const articles = container.querySelectorAll('.transcript-item');
    expect(articles.length).toBe(200);
  });

  it('limits motion wrappers to last MAX_MOTION_ITEMS (50) items', () => {
    const results = createMockResults(200);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const articles = container.querySelectorAll('.transcript-item');

    // First 150 items should have data-motion="off"
    for (let i = 0; i < 150; i++) {
      expect(articles[i].getAttribute('data-motion')).toBe('off');
    }

    // Last 50 items should have data-motion="on"
    for (let i = 150; i < 200; i++) {
      expect(articles[i].getAttribute('data-motion')).toBe('on');
    }
  });

  it('limits layout prop to last MAX_LAYOUT_ITEMS (5) motion items', () => {
    const results = createMockResults(200);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const articles = container.querySelectorAll('.transcript-item');

    // Items 150-194 (indices 150-194): motion="on" but layout="off"
    for (let i = 150; i < 195; i++) {
      expect(articles[i].getAttribute('data-motion')).toBe('on');
      expect(articles[i].getAttribute('data-layout')).toBe('off');
    }

    // Last 5 items (indices 195-199): both motion="on" and layout="on"
    for (let i = 195; i < 200; i++) {
      expect(articles[i].getAttribute('data-motion')).toBe('on');
      expect(articles[i].getAttribute('data-layout')).toBe('on');
    }
  });

  it('with fewer than MAX_MOTION_ITEMS results, all are motion-wrapped', () => {
    const results = createMockResults(10);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const articles = container.querySelectorAll('.transcript-item');
    expect(articles.length).toBe(10);

    // All 10 should be motion="on"
    for (let i = 0; i < 10; i++) {
      expect(articles[i].getAttribute('data-motion')).toBe('on');
    }
  });

  it('sets data-performance attribute with visible count on stream container', () => {
    const results = createMockResults(75);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const stream = container.querySelector('.transcript-stream');
    expect(stream).toBeTruthy();
    expect(stream!.getAttribute('data-performance')).toBe('motion=50,layout=5,visible=75');
  });

  it('data-performance updates when results count changes', () => {
    const results = createMockResults(3);
    const { container, rerender } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    const stream = container.querySelector('.transcript-stream');
    expect(stream!.getAttribute('data-performance')).toBe('motion=50,layout=5,visible=3');

    // Add more results
    const moreResults = createMockResults(120);
    rerender(
      <TranscriptHero
        results={moreResults}
        currentText=""
        fullText={moreResults.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    expect(stream!.getAttribute('data-performance')).toBe('motion=50,layout=5,visible=120');
  });

  it('AnimatePresence uses initial={false} to skip entrance animation', () => {
    const results = createMockResults(5);
    const { container } = render(
      <TranscriptHero
        results={results}
        currentText=""
        fullText={results.map((r) => r.text).join(' ')}
        onCopy={vi.fn()}
        canCopy={true}
      />,
    );

    // Verify AnimatePresence is present (it wraps the content)
    // The articles should be direct children of some motion wrapper inside transcript-stream
    const stream = container.querySelector('.transcript-stream');
    expect(stream).toBeTruthy();

    // Articles should exist (rendered without entrance animation due to initial={false})
    const articles = stream!.querySelectorAll('.transcript-item');
    expect(articles.length).toBe(5);
    // All should be visible immediately (opacity is 1 or '', not 0 from entrance animation)
    // framer-motion initial={false} means no entrance animation; animate={{ opacity: 1 }} sets opacity: 1
    articles.forEach((a) => {
      const opacity = (a as HTMLElement).style.opacity;
      expect(opacity).not.toBe('0');
    });
  });
});