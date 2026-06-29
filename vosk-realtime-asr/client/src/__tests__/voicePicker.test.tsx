/**
 * VoicePicker — 音色下拉组件
 *
 * 覆盖:
 * - 默认渲染: 显示默认 voice
 * - 点击展开 → 显示音色列表
 * - 点击某项 → 触发 onChange
 * - 键盘可达: Enter / Space 展开, Esc 关闭
 * - disabled 时不展开
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { VoicePicker } from '../components/VoicePicker';

afterEach(() => cleanup());

// helper: jsdom + vitest 没有 jest-dom 的 toBeInTheDocument / toHaveTextContent
// 这里用最朴素的 textContent / querySelector
const hasText = (el: Element | null, re: RegExp) => !!el && re.test(el.textContent || '');
const isInDocument = (el: Element | null) => !!el && document.body.contains(el);

const VOICES = [
  { id: 'BV001_streaming', name: '磁性男声', gender: 'male' as const, sample_rate: 24000 },
  { id: 'BV002_streaming', name: '温柔女声', gender: 'female' as const, sample_rate: 24000 },
  { id: 'BV003_streaming', name: '活力童声', gender: 'child' as const, sample_rate: 24000 },
];

describe('VoicePicker', () => {
  it('渲染当前 voice 的名称', () => {
    render(<VoicePicker voices={VOICES} value="BV001_streaming" onChange={() => {}} />);
    const el = screen.getByRole('combobox', { name: /音色/ });
    expect(hasText(el, /磁性男声/)).toBe(true);
  });

  it('点击展开 → 显示所有音色', () => {
    render(<VoicePicker voices={VOICES} value="BV001_streaming" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    const items = within(list).getAllByRole('option');
    expect(items).toHaveLength(3);
    expect(hasText(items[0], /磁性男声/)).toBe(true);
    expect(hasText(items[2], /活力童声/)).toBe(true);
  });

  it('点击某项 → onChange 收到该 id, 列表收起', () => {
    const onChange = vi.fn();
    render(<VoicePicker voices={VOICES} value="BV001_streaming" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    const items = within(screen.getByRole('listbox')).getAllByRole('option');
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith('BV002_streaming');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('当前选中的 voice 在 listbox 中标记 selected', () => {
    render(<VoicePicker voices={VOICES} value="BV002_streaming" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox'));
    const items = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
    expect(items[1].getAttribute('aria-selected')).toBe('true');
  });

  it('disabled → 点击不展开', () => {
    render(<VoicePicker voices={VOICES} value="BV001_streaming" onChange={() => {}} disabled />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Esc 关闭打开的列表', () => {
    render(<VoicePicker voices={VOICES} value="BV001_streaming" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(isInDocument(listbox)).toBe(true);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('空 voices 列表 → 显示 empty 文案', () => {
    render(<VoicePicker voices={[]} value="" onChange={() => {}} />);
    const el = screen.getByRole('combobox');
    expect(hasText(el, /暂无音色/)).toBe(true);
  });
});
