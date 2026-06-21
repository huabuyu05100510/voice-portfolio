/**
 * transcriptionRenderer.test.tsx — Sprint 8
 * 验证空状态组件渲染: SVG 装饰 + 快捷键提示
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TranscriptionRenderer } from '../TranscriptionRenderer';

describe('TranscriptionRenderer 空状态', () => {
  it('空态渲染包含 SVG 微光', () => {
    const { container } = render(
      <TranscriptionRenderer results={[]} currentText="" fullText="" speakers={[]} />
    );
    const orbit = container.querySelector('.empty-orbit');
    expect(orbit).toBeTruthy();
    expect(orbit?.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3);
  });

  it('空态渲染快捷键提示 (Space)', () => {
    const { container } = render(
      <TranscriptionRenderer results={[]} currentText="" fullText="" speakers={[]} />
    );
    const kbd = container.querySelector('.empty-hint kbd');
    expect(kbd).toBeTruthy();
    expect(kbd?.textContent).toBe('Space');
  });

  it('空态 role=status (a11y)', () => {
    const { container } = render(
      <TranscriptionRenderer results={[]} currentText="" fullText="" speakers={[]} />
    );
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('有结果时不显示空状态', () => {
    const { container } = render(
      <TranscriptionRenderer
        results={[{ text: '你好', isFinal: true }]}
        currentText=""
        fullText="你好"
        speakers={[]}
      />
    );
    expect(container.querySelector('.empty-state')).toBeFalsy();
  });
});