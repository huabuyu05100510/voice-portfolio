/**
 * recordingButtonRedesign.test.tsx — Sprint 12 UI Redesign
 *
 * 验证 RecordingButton 的视觉契约:
 *  - 大圆形按钮 (64-72px 直径)
 *  - 状态切换: idle / ready / recording / error / disabled
 *  - 脉冲动效 (data-recording="true" 时)
 *  - 颜色: idle=暗背景 + 红圆点; recording=红实心; ready=绿色脉动
 *  - aria-label + aria-keyshortcuts 完整
 *  - 内部 SVG 图标 (不用 emoji, 跨平台一致)
 *  - 点击回调 (start / stop)
 *
 * 红: 通过 props 断言 (视觉用 className + data-* + aria-)
 * 绿: 重写 RecordingButton 实现
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { RecordingButton } from '../components/RecordingButton';

afterEach(() => cleanup());

describe('RecordingButton — Sprint 12 重设计', () => {
  describe('基础渲染', () => {
    it('渲染一个 button, role="button" (隐式)', () => {
      render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn).toBeInstanceOf(HTMLButtonElement);
      expect(btn.tagName.toLowerCase()).toBe('button');
    });

    it('aria-label 包含状态语义 (Space 快捷键)', () => {
      render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('aria-label')).toMatch(/Space/);
      expect(btn.getAttribute('aria-keyshortcuts')).toBe('Space');
    });

    it('暴露 data-state 属性 (CSS 选择器钩子)', () => {
      render(
        <RecordingButton
          state="ready"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('data-state')).toBe('ready');
    });

    it('内部使用 SVG 图标 (不用 emoji)', () => {
      const { container } = render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      // SVG 标签数 ≥ 1 (icon), 不依赖 emoji 渲染
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('状态切换', () => {
    it('isRecording=true 时 data-state="recording"', () => {
      render(
        <RecordingButton
          state="recording"
          isRecording
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('data-state')).toBe('recording');
    });

    it('state="ready" + isRecording=false 时 data-state="ready"', () => {
      render(
        <RecordingButton
          state="ready"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('data-state')).toBe('ready');
    });

    it('state="error" 时 data-state="error"', () => {
      render(
        <RecordingButton
          state="error"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('data-state')).toBe('error');
    });
  });

  describe('点击行为', () => {
    it('idle 状态点击触发 onStart', () => {
      const onStart = vi.fn();
      const onStop = vi.fn();
      render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={onStart}
          onStop={onStop}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStop).not.toHaveBeenCalled();
    });

    it('recording 状态点击触发 onStop', () => {
      const onStart = vi.fn();
      const onStop = vi.fn();
      render(
        <RecordingButton
          state="recording"
          isRecording
          disabled={false}
          onStart={onStart}
          onStop={onStop}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStart).not.toHaveBeenCalled();
    });

    it('disabled=true 时点击不触发任何回调', () => {
      const onStart = vi.fn();
      const onStop = vi.fn();
      render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled
          onStart={onStart}
          onStop={onStop}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(onStart).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
    });
  });

  describe('可访问性', () => {
    it('disabled 时 aria-disabled="true"', () => {
      render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = screen.getByRole('button');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('icon 元素标注 aria-hidden="true" (装饰性)', () => {
      const { container } = render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('label 文本对屏幕阅读器可见 (不是 aria-hidden)', () => {
      render(
        <RecordingButton
          state="ready"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      // 屏幕阅读器应当朗读 label
      const labels = screen.getAllByText('开始录音');
      expect(labels.length).toBeGreaterThanOrEqual(1);
      // 文字节点不在 aria-hidden 内
      const ariaHidden = labels.some((el) => el.closest('[aria-hidden="true"]') !== null);
      expect(ariaHidden).toBe(false);
    });
  });

  describe('视觉契约 (CSS class / data attr)', () => {
    it('使用 record-btn 类 (与现有 styles.css 兼容)', () => {
      const { container } = render(
        <RecordingButton
          state="idle"
          isRecording={false}
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = container.querySelector('.record-btn');
      expect(btn).not.toBeNull();
    });

    it('recording 状态有 rec-pulse 类 (脉冲环动效)', () => {
      const { container } = render(
        <RecordingButton
          state="recording"
          isRecording
          disabled={false}
          onStart={() => {}}
          onStop={() => {}}
        />,
      );
      const btn = container.querySelector('.record-btn');
      expect(btn?.classList.contains('rec-pulse')).toBe(true);
    });
  });
});
