/**
 * getSpeakerColor — 任意人数稳定 hash 着色
 *
 * 会议室场景可能有 >6 人, 不能用 6 色 palette 循环撞色;
 * 也不能用 index (不稳, 重排就变). 必须 id 稳定 hash.
 */
import { describe, it, expect } from 'vitest';
import { getSpeakerColor, SPEAKER_COLOR_PALETTE } from '../state/transcriptionReducer';

describe('getSpeakerColor — 任意人数稳定着色', () => {
  it('同一个 speaker id 永远映射到同一颜色 (稳定性)', () => {
    const c1 = getSpeakerColor('spk-A');
    const c2 = getSpeakerColor('spk-A');
    const c3 = getSpeakerColor('spk-A');
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
  });

  it('不同 speaker id 大概率映射到不同颜色 (区分度)', () => {
    const ids = ['spk-1', 'spk-2', 'spk-3', 'spk-4', 'spk-5', 'spk-6'];
    const colors = new Set(ids.map(getSpeakerColor));
    // 6 个人至少应该有 4 种以上不同颜色 (允许少量哈希碰撞)
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it('颜色一定落在 palette 内', () => {
    const c = getSpeakerColor('any-id');
    expect(SPEAKER_COLOR_PALETTE).toContain(c);
  });

  it('支持任意人数 (>12 自动循环, 不报错不撞库)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `spk-${i}`);
    const colors = ids.map(getSpeakerColor);
    // 全部都在 palette 内
    for (const c of colors) {
      expect(SPEAKER_COLOR_PALETTE).toContain(c);
    }
    // 50 人应该用到 palette 中绝大多数颜色 (>10)
    expect(new Set(colors).size).toBeGreaterThanOrEqual(10);
  });

  it('Speaker "0" (volcengine 常见 ID) 也稳定着色', () => {
    const c = getSpeakerColor('0');
    expect(SPEAKER_COLOR_PALETTE).toContain(c);
    expect(getSpeakerColor('0')).toBe(c);
  });
});
