/**
 * VoiceLibrary 独立测试 (按 TDD 红绿要求)
 *
 * 覆盖:
 *  - 音色列表渲染
 *  - 试听按钮 (仅 ready 可点)
 *  - 删除按钮
 *  - 空态
 *  - active 高亮
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VoiceLibrary } from '../components/VoiceLibrary';

describe('VoiceLibrary 渲染', () => {
  beforeEach(() => {
    cleanup();
  });

  it('渲染每个音色一张卡片', () => {
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 1700000000 },
          { voice_id: 'S_b', name: '声音B', status: 'training', created_at: 1700000100 },
        ]}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.getByText('声音A')).toBeTruthy();
    expect(screen.getByText('声音B')).toBeTruthy();
  });

  it('试听按钮 disabled 当 status != ready', () => {
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'training', created_at: 1700000000 },
        ]}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /试听 声音A/ });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('试听按钮 enabled 当 status = ready', () => {
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 1700000000 },
        ]}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /试听 声音A/ });
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('点击试听按钮触发 onPreview', () => {
    const onPreview = vi.fn();
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 1700000000 },
        ]}
        onDelete={vi.fn()}
        onPreview={onPreview}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /试听 声音A/ }));
    expect(onPreview).toHaveBeenCalledWith('S_a');
  });

  it('点击删除按钮触发 onDelete', () => {
    const onDelete = vi.fn();
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 1700000000 },
        ]}
        onDelete={onDelete}
        onPreview={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /删除 声音A/ }));
    expect(onDelete).toHaveBeenCalledWith('S_a');
  });

  it('空态显示提示', () => {
    render(<VoiceLibrary voices={[]} onDelete={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.getByText(/还没有音色/)).toBeTruthy();
  });

  it('activeVoiceId 高亮对应卡片', () => {
    const { container } = render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 0 },
        ]}
        activeVoiceId="S_a"
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    const card = container.querySelector('.voice-card');
    expect(card?.classList.contains('is-active')).toBe(true);
  });

  it('onSetActive 触发回调 (ready 时显示)', () => {
    const onSetActive = vi.fn();
    render(
      <VoiceLibrary
        voices={[
          { voice_id: 'S_a', name: '声音A', status: 'ready', created_at: 0 },
        ]}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
        onSetActive={onSetActive}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /设为默认 声音A/ }));
    expect(onSetActive).toHaveBeenCalledWith('S_a');
  });
});
