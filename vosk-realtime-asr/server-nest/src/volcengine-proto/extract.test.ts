import { describe, it, expect } from '@jest/globals';
import { extractUtterances } from './extract';

describe('extractUtterances', () => {
  it('从完整 payload {result:{utterances}} 抽取', () => {
    const r = extractUtterances({
      result: {
        utterances: [
          {
            text: '你好',
            start_time: 100,
            end_time: 500,
            additions: { speaker_id: 'spk0' },
            definite: true,
          },
        ],
      },
    });
    expect(r.utterances.length).toBe(1);
    expect(r.utterances[0].text).toBe('你好');
    expect(r.utterances[0].speaker_id).toBe('spk0');
    expect(r.utterances[0].definite).toBe(true);
    expect(r.speakers.length).toBe(1);
    expect(r.speakers[0]).toEqual({ id: 'spk0', label: '发言人 1' });
  });

  it('直接 result 入参 (无 outer result 嵌套)', () => {
    const r = extractUtterances({
      utterances: [{ text: 'x', additions: { speaker_id: 'a' } }],
    });
    expect(r.utterances.length).toBe(1);
    expect(r.utterances[0].speaker_id).toBe('a');
  });

  it('多 speaker: label 按出现顺序递增', () => {
    const r = extractUtterances({
      utterances: [
        { text: '甲', additions: { speaker_id: 'b' } },
        { text: '乙', additions: { speaker_id: 'a' } },
        { text: '丙', additions: { speaker_id: 'b' } },
      ],
    });
    expect(r.speakers).toEqual([
      { id: 'b', label: '发言人 1' },
      { id: 'a', label: '发言人 2' },
    ]);
  });

  it('兼容老版本 speaker_id 直接在 utterance 顶层', () => {
    const r = extractUtterances({
      utterances: [{ text: '老', speaker_id: 'old_spk' }],
    });
    expect(r.utterances[0].speaker_id).toBe('old_spk');
  });

  it('缺失 speaker_id: 返回 null, 不进 speakers', () => {
    const r = extractUtterances({
      utterances: [{ text: '无名' }],
    });
    expect(r.utterances[0].speaker_id).toBeNull();
    expect(r.speakers).toEqual([]);
  });

  it('空 utterances', () => {
    const r = extractUtterances({ result: { utterances: [] } });
    expect(r.utterances).toEqual([]);
    expect(r.speakers).toEqual([]);
  });

  it('definite 缺省时为 false', () => {
    const r = extractUtterances({
      utterances: [{ text: 'x', additions: { speaker_id: 's' } }],
    });
    expect(r.utterances[0].definite).toBe(false);
  });

  it('words 字段透传', () => {
    const r = extractUtterances({
      utterances: [
        {
          text: '你好',
          additions: { speaker_id: 's' },
          words: [{ word: '你', start: 0, end: 100 }],
        },
      ],
    });
    expect(r.utterances[0].words.length).toBe(1);
    expect(r.utterances[0].words[0].word).toBe('你');
  });
});
