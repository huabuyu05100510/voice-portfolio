/**
 * ProfileToggle + AUDIO_PROFILES 单元测试
 *
 * 覆盖:
 *   1) AUDIO_PROFILES 包含 pure / meeting 两个 id
 *   2) 约束字段正确 (pure 关闭 NS/AEC/AGC, meeting 开启)
 *   3) ProfileToggle 点击切换触发 onChange
 *   4) 当前激活的 profile 有 is-active class
 *   5) disabled 时点击不触发 onChange
 */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ProfileToggle } from '../components/ProfileToggle';
import { AUDIO_PROFILES } from '../types';

describe('AUDIO_PROFILES 配置', () => {
  it('包含 pure 和 meeting 两个 profile', () => {
    expect(Object.keys(AUDIO_PROFILES).sort()).toEqual(['meeting', 'pure']);
  });

  it('pure 模式: 关闭 NS/AEC/AGC, sampleRate=16000, 单声道', () => {
    const c = AUDIO_PROFILES.pure.constraints;
    expect(c.echoCancellation).toBe(false);
    expect(c.noiseSuppression).toBe(false);
    expect(c.autoGainControl).toBe(false);
    expect(c.sampleRate).toBe(16000);
    expect(c.channelCount).toBe(1);
  });

  it('meeting 模式: 开启 NS/AEC/AGC', () => {
    const c = AUDIO_PROFILES.meeting.constraints;
    expect(c.echoCancellation).toBe(true);
    expect(c.noiseSuppression).toBe(true);
    expect(c.autoGainControl).toBe(true);
    expect(c.sampleRate).toBe(16000);
    expect(c.channelCount).toBe(1);
  });

  it('每个 profile 有 label + description + id 字段', () => {
    for (const p of Object.values(AUDIO_PROFILES)) {
      expect(p.id).toBeTruthy();
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('ProfileToggle 组件', () => {
  it('渲染两个 radio 按钮 (pure + meeting), 当前值高亮', () => {
    const { container } = render(<ProfileToggle value="meeting" />);
    const root = container.querySelector('[data-profile-toggle]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-active')).toBe('meeting');

    const buttons = container.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(2);

    // 激活态 class
    const activeBtn = container.querySelector('button.is-active');
    expect(activeBtn).not.toBeNull();
    expect(activeBtn?.getAttribute('data-profile-id')).toBe('meeting');
  });

  it('点击 "纯净模式" 触发 onChange("pure")', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="meeting" onChange={onChange} />);
    const pureBtn = container.querySelector('button[data-profile-id="pure"]') as HTMLButtonElement;
    fireEvent.click(pureBtn);
    expect(onChange).toHaveBeenCalledWith('pure');
  });

  it('点击 "会议模式" 触发 onChange("meeting")', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="pure" onChange={onChange} />);
    const meetingBtn = container.querySelector('button[data-profile-id="meeting"]') as HTMLButtonElement;
    fireEvent.click(meetingBtn);
    expect(onChange).toHaveBeenCalledWith('meeting');
  });

  it('点击当前激活的按钮不触发 onChange (no-op)', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="pure" onChange={onChange} />);
    const pureBtn = container.querySelector('button[data-profile-id="pure"]') as HTMLButtonElement;
    fireEvent.click(pureBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=true 时点击不触发 onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileToggle value="meeting" onChange={onChange} disabled />);
    const pureBtn = container.querySelector('button[data-profile-id="pure"]') as HTMLButtonElement;
    fireEvent.click(pureBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=true 时按钮有 disabled 属性', () => {
    const { container } = render(<ProfileToggle value="meeting" disabled />);
    const buttons = container.querySelectorAll('button[role="radio"]');
    buttons.forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
