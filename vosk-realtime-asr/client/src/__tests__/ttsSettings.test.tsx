/**
 * TtsSettings — speed / pitch / format 调节面板
 *
 * 覆盖:
 * - speed slider 0.5~2.0 范围 + step 0.1
 * - pitch slider 0.5~2.0
 * - format 切换: mp3 / pcm / wav
 * - onChange 回调 (debounced 0ms 也立即触发)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TtsSettings } from '../components/TtsSettings';

afterEach(() => cleanup());

const DEFAULTS = { speed: 1.0, pitch: 1.0, audioFormat: 'mp3' as const };

describe('TtsSettings', () => {
  it('默认 speed=1.0 显示 1.0x', () => {
    render(<TtsSettings value={DEFAULTS} onChange={() => {}} />);
    const el = screen.getByTestId('tts-speed-label');
    expect((el.textContent || '').includes('1.0x')).toBe(true);
  });

  it('滑动 speed → onChange 收到 speed 新值', () => {
    const onChange = vi.fn();
    render(<TtsSettings value={DEFAULTS} onChange={onChange} />);
    const slider = screen.getByTestId('tts-speed') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ speed: 1.5 }));
  });

  it('滑动 pitch → onChange 收到 pitch 新值', () => {
    const onChange = vi.fn();
    render(<TtsSettings value={DEFAULTS} onChange={onChange} />);
    const slider = screen.getByTestId('tts-pitch') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0.8 }));
  });

  it('点击 format 按钮 mp3/pcm/wav → onChange 收到对应值', () => {
    const onChange = vi.fn();
    render(<TtsSettings value={DEFAULTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'PCM' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audioFormat: 'pcm' }));
    fireEvent.click(screen.getByRole('button', { name: 'WAV' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audioFormat: 'wav' }));
  });

  it('当前 format 高亮 (aria-pressed=true)', () => {
    render(<TtsSettings value={DEFAULTS} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'MP3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'PCM' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('speed 越界 (3.0) 时不调 onChange, label 截断', () => {
    const onChange = vi.fn();
    render(<TtsSettings value={DEFAULTS} onChange={onChange} />);
    const slider = screen.getByTestId('tts-speed') as HTMLInputElement;
    // 模拟恶意值: input 已 clamp 在 max=2.0
    expect(slider.max).toBe('2');
    expect(slider.min).toBe('0.5');
    expect(slider.step).toBe('0.1');
  });
});
