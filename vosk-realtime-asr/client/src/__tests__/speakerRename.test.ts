/**
 * 说话人重命名 — 会议室场景必需 (把"发言人 1"改成"主持人"等)
 *
 * 关键约束: 用户改过的 label 必须 sticky, 后续服务端推同 id 的 speaker 不能覆盖。
 */
import { describe, it, expect } from 'vitest';
import { transcriptionReducer, initialTranscriptionState } from '../state/transcriptionReducer';
import type { TranscriptionResult } from '../types';

function finalResult(text: string, speakerId: string, speakerLabel?: string): TranscriptionResult {
  return {
    text,
    isFinal: true,
    speaker_id: speakerId,
    speakers: speakerLabel ? [{ id: speakerId, label: speakerLabel }] : [],
    timestamp: '2026-06-24T00:00:00Z',
  };
}

describe('RENAME_SPEAKER', () => {
  it('dispatch RENAME_SPEAKER 后, 对应 speaker 的 label 更新', () => {
    let s = { ...initialTranscriptionState };
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: finalResult('你好', '0', '发言人 1'),
      timestamp: 1,
    });
    expect(s.speakers[0].label).toBe('发言人 1');

    s = transcriptionReducer(s, {
      type: 'RENAME_SPEAKER',
      speakerId: '0',
      label: '主持人',
    });
    expect(s.speakers[0].label).toBe('主持人');
  });

  it('用户改过的 label 必须 sticky — 服务端后续推送同 id 不能覆盖', () => {
    let s = { ...initialTranscriptionState };
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: finalResult('你好', '0', '发言人 1'),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'RENAME_SPEAKER',
      speakerId: '0',
      label: '主持人',
    });
    // 服务端又推了一次, 带原始 label "发言人 1"
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: finalResult('继续讲话', '0', '发言人 1'),
      timestamp: 2,
      isCumulative: false,
    });
    // 用户的 "主持人" 不能被覆盖
    expect(s.speakers.find((sp) => sp.id === '0')?.label).toBe('主持人');
  });

  it('RENAME 到空 label 应被忽略 (不能把名字清空)', () => {
    let s = { ...initialTranscriptionState };
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: finalResult('你好', '0', '发言人 1'),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'RENAME_SPEAKER',
      speakerId: '0',
      label: '   ',
    });
    expect(s.speakers[0].label).toBe('发言人 1');
  });

  it('RENAME 不存在的 speakerId 应 no-op', () => {
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'RENAME_SPEAKER',
      speakerId: 'nonexistent',
      label: '某某',
    });
    expect(s).toBe(initialTranscriptionState);
  });
});
