/**
 * designIcons.test.tsx — Sprint 18 新图标契约
 * 验证 UploadIcon / LibraryIcon / RecordVoiceIcon 渲染正常, viewBox/路径存在
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UploadIcon, LibraryIcon, RecordVoiceIcon, ICONS } from '../design/icons';

describe('Sprint 18 新图标', () => {
  it('UploadIcon 渲染 24x24 SVG', () => {
    const { container } = render(<UploadIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelectorAll('path, polyline, line, circle').length).toBeGreaterThan(0);
  });

  it('LibraryIcon 渲染 24x24 SVG (多竖线条)', () => {
    const { container } = render(<LibraryIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    // Library 用 4 条竖线 (path)
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(4);
  });

  it('RecordVoiceIcon 渲染 24x24 SVG (mic + 录音点)', () => {
    const { container } = render(<RecordVoiceIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    // 包含 circle (录音指示点)
    expect(svg.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1);
  });

  it('新图标已注册到 ICONS map', () => {
    expect(ICONS.upload).toBeDefined();
    expect(ICONS.library).toBeDefined();
    expect(ICONS.recordVoice).toBeDefined();
    expect(ICONS.upload).toBe(UploadIcon);
    expect(ICONS.library).toBe(LibraryIcon);
    expect(ICONS.recordVoice).toBe(RecordVoiceIcon);
  });

  it('新图标 size prop 生效', () => {
    const { container } = render(<UploadIcon size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });
});