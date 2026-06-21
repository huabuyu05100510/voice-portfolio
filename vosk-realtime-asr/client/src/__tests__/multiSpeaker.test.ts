/**
 * multi-speaker.test.ts — Sprint 10
 * 验证 ≥3 说话人场景: palette 覆盖, 红正确合并
 */
import { describe, it, expect } from 'vitest';
import { transcriptionReducer, initialTranscriptionState, SPEAKER_COLOR_PALETTE, getSpeakerColor } from '../state/transcriptionReducer';

describe('多说话人支持', () => {
  it('palette 至少 12 色', () => {
    expect(SPEAKER_COLOR_PALETTE.length).toBeGreaterThanOrEqual(12);
  });

  it('getSpeakerColor: 同一 id 永远同色 (稳定性)', () => {
    const c1 = getSpeakerColor('spk0');
    const c2 = getSpeakerColor('spk0');
    expect(c1).toBe(c2);
  });

  it('getSpeakerColor: 不同 id 给不同色 (区分度)', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(getSpeakerColor(`spk${i}`));
    }
    // 20 个 speaker 至少应得到 8 种不同颜色 (碰撞率 < 60%)
    expect(colors.size).toBeGreaterThanOrEqual(8);
  });

  it('reducer 合并 ≥3 说话人', () => {
    const r1 = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好',
        isFinal: true,
        speaker_id: 'spk0',
        speakers: [{ id: 'spk0', label: '发言人 1' }],
      },
    });
    const r2 = transcriptionReducer(r1, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '我好',
        isFinal: true,
        speaker_id: 'spk1',
        speakers: [{ id: 'spk1', label: '发言人 2' }],
      },
    });
    const r3 = transcriptionReducer(r2, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '他好',
        isFinal: true,
        speaker_id: 'spk2',
        speakers: [{ id: 'spk2', label: '发言人 3' }],
      },
    });
    expect(r3.speakers.length).toBe(3);
    expect(r3.speakers.map((s) => s.id)).toEqual(['spk0', 'spk1', 'spk2']);
    // 每个 speaker 必须有 color (由 reducer 注入)
    for (const s of r3.speakers) {
      expect(s.color).toBeTruthy();
      expect(SPEAKER_COLOR_PALETTE).toContain(s.color);
    }
  });

  it('reducer 合并 ≥5 说话人 (压力大场景)', () => {
    let state = initialTranscriptionState;
    for (let i = 0; i < 5; i++) {
      state = transcriptionReducer(state, {
        type: 'TRANSCRIPT_FINAL',
        result: {
          text: `speaker ${i}`,
          isFinal: true,
          speaker_id: `spk${i}`,
          speakers: [{ id: `spk${i}`, label: `发言人 ${i + 1}` }],
        },
      });
    }
    expect(state.speakers.length).toBe(5);
    // 颜色不应全部相同 (palette 是 12 色, 5 个大概率各不相同)
    const colors = state.speakers.map((s) => s.color);
    expect(new Set(colors).size).toBeGreaterThanOrEqual(4);
  });
});