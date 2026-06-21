/**
 * incremental-merge.test.ts — Sprint 11
 * 验证连续 final (同说话人, 累积文本) 合并为单条, 不重复
 * + 文本连续但 speaker_id 不稳定场景
 */
import { describe, it, expect } from 'vitest';
import {
  transcriptionReducer,
  initialTranscriptionState,
} from '../state/transcriptionReducer';

describe('Sprint 11 — 同说话人增量合并', () => {
  it('同说话人 + 文本是前缀扩展 → 就地更新, 不新增', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '看是不是热了？热了，恒温了',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    expect(state.results.length).toBe(1);

    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '看是不是热了？热了，恒温了，哎呀',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    expect(state.results.length).toBe(1);
    expect(state.results[0].text).toBe('看是不是热了？热了，恒温了，哎呀');
  });

  it('文本连续但 speaker_id 不稳定 (spk0 → spk0_xxx) → 仍合并', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '谁说我？哎？这是第二',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    // 模拟火山引擎同一说话人返回不同 ID
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '谁说我？哎？这是第二天，是',
        isFinal: true,
        speaker_id: 'spk0_a1b2', // 不同 ID, 同一说话人
      },
    });
    // 文本明显是累积扩展, 应合并
    expect(state.results.length).toBe(1);
  });

  it('用户实际场景: 4 次 final 累积文本 → 1 个卡片', () => {
    let state = initialTranscriptionState;
    const finals = [
      '谁说我？哎？这是第二',
      '谁说我？哎？这是第二天，是',
      '谁说我？哎？这是第二天，是不是',
      '谁说我？哎？这是第二天，是不是你？那你',
    ];
    for (const text of finals) {
      state = transcriptionReducer(state, {
        type: 'TRANSCRIPT_FINAL',
        result: {
          text,
          isFinal: true,
          speaker_id: 'spk0',  // 同 ID
        },
      });
    }
    expect(state.results.length).toBe(1);
    expect(state.results[0].text).toBe(finals[finals.length - 1]);
  });

  it('不同说话人 → 新增卡片', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好我是张三',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好我是李四',
        isFinal: true,
        speaker_id: 'spk1',
      },
    });
    expect(state.results.length).toBe(2);
  });

  it('同说话人但文本不相关 (新句子) → 新增卡片', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '今天天气真好啊',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '我们去公园散步吧',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    expect(state.results.length).toBe(2);
  });

  it('空文本 → 跳过', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    expect(state.results.length).toBe(1);
  });

  it('重复推送 (新文本是旧文本子串) → 跳过', () => {
    let state = initialTranscriptionState;
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好我是张三',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    state = transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: {
        text: '你好',
        isFinal: true,
        speaker_id: 'spk0',
      },
    });
    expect(state.results.length).toBe(1);
  });
});