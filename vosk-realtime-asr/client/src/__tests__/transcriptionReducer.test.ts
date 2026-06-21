/**
 * TDD: transcriptionReducer 全 action 覆盖
 * Author: Claude Opus 4.8
 */
import { describe, it, expect } from 'vitest';
import {
  transcriptionReducer,
  initialTranscriptionState,
  getSpeakerColor,
  type TranscriptionState,
} from '../state/transcriptionReducer';
import type { TranscriptionResult, WordInfo } from '../types';

const buildWord = (over: Partial<WordInfo> = {}): WordInfo => ({
  word: '你',
  start: 0,
  end: 0.5,
  confidence: 0.99,
  ...over,
});

const buildResult = (over: Partial<TranscriptionResult> = {}): TranscriptionResult => ({
  text: '你好',
  isFinal: true,
  fullText: '你好',
  ...over,
});

// ----------------------------------------------------------------------------
// TRANSCRIPT_PARTIAL
// ----------------------------------------------------------------------------
describe('transcriptionReducer / TRANSCRIPT_PARTIAL', () => {
  it('更新 currentText, 不动 results', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState, results: [buildResult()] };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_PARTIAL',
      text: '你正',
      fullText: '你好你正',
    });
    expect(s1.currentText).toBe('你正');
    expect(s1.fullText).toBe('你好你正');
    expect(s1.results).toEqual(s0.results);     // 没变
  });

  it('fullText 为空时, 保留上一次的 fullText (服务端偶尔不发)', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState, fullText: '上次保留' };
    const s1 = transcriptionReducer(s0, { type: 'TRANSCRIPT_PARTIAL', text: 'p', fullText: '' });
    expect(s1.fullText).toBe('上次保留');
  });
});

// ----------------------------------------------------------------------------
// TRANSCRIPT_FINAL
// ----------------------------------------------------------------------------
describe('transcriptionReducer / TRANSCRIPT_FINAL', () => {
  it('append 到 results, 清空 currentText, 累计 transcriptionChars', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好', fullText: '你好' }),
    });
    expect(s1.results).toHaveLength(1);
    expect(s1.results[0].text).toBe('你好');
    expect(s1.currentText).toBe('');
    expect(s1.fullText).toBe('你好');
    expect(s1.metrics.transcriptionChars).toBe(2);   // 你好.length
  });

  it('接收服务端累积的 words, 重置 finalStartTime 为 performance.now()', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      words: [buildWord({ word: '旧' })],
      finalStartTime: 12345,
    };
    const before = performance.now();
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ words: [buildWord({ word: '新' })] }),
    });
    expect(s1.words[0].word).toBe('新');
    expect(s1.finalStartTime).toBeGreaterThanOrEqual(before);
    expect(s1.finalStartTime).not.toBe(12345);
  });

  it('final 不带 words 时, 沿用旧 words (karaoke 滚动时不消失)', () => {
    const oldWords = [buildWord({ word: '保留' })];
    const s0: TranscriptionState = { ...initialTranscriptionState, words: oldWords };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ words: [] }),
    });
    expect(s1.words).toEqual(oldWords);
  });

  it('结果数组达到上限 MAX_RESULTS (200) 后, 旧的会被淘汰', () => {
    let s: TranscriptionState = { ...initialTranscriptionState };
    for (let i = 0; i < 250; i++) {
      s = transcriptionReducer(s, {
        type: 'TRANSCRIPT_FINAL',
        result: buildResult({ text: `第${i}` }),
      });
    }
    expect(s.results).toHaveLength(200);
    expect(s.results[0].text).toBe('第50');     // 最早 50 个被淘汰
    expect(s.results[199].text).toBe('第249');
  });
});

// ----------------------------------------------------------------------------
// CLEAR
// ----------------------------------------------------------------------------
describe('transcriptionReducer / CLEAR', () => {
  it('清空 results / currentText / fullText / words / finalStartTime', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult()],
      currentText: 'p',
      fullText: 'p',
      words: [buildWord()],
      finalStartTime: 99,
    };
    const s1 = transcriptionReducer(s0, { type: 'CLEAR' });
    expect(s1.results).toEqual([]);
    expect(s1.currentText).toBe('');
    expect(s1.fullText).toBe('');
    expect(s1.words).toEqual([]);
    expect(s1.finalStartTime).toBe(0);
  });

  it('保留 metrics.startTime (整次会话累计仍有意义)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      metrics: { ...initialTranscriptionState.metrics, startTime: 12345 },
    };
    const s1 = transcriptionReducer(s0, { type: 'CLEAR' });
    expect(s1.metrics.startTime).toBe(12345);
  });
});

// ----------------------------------------------------------------------------
// METRICS_UPDATE
// ----------------------------------------------------------------------------
describe('transcriptionReducer / METRICS_UPDATE', () => {
  it('整体替换 metrics (来自服务端 session_status)', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState };
    const next = {
      audioBytes: 1000,
      transcriptionChars: 200,
      chunksProcessed: 50,
      avgLatency: 12.5,
      totalLatencies: 0,
      startTime: 0,
    };
    const s1 = transcriptionReducer(s0, { type: 'METRICS_UPDATE', metrics: next });
    expect(s1.metrics).toEqual(next);
  });
});

// ----------------------------------------------------------------------------
// AUDIO_CHUNK_RECORDED
// ----------------------------------------------------------------------------
describe('transcriptionReducer / AUDIO_CHUNK_RECORDED', () => {
  it('累加 audioBytes, 累加 chunksProcessed', () => {
    let s: TranscriptionState = { ...initialTranscriptionState };
    s = transcriptionReducer(s, { type: 'AUDIO_CHUNK_RECORDED', byteLength: 8000 });
    s = transcriptionReducer(s, { type: 'AUDIO_CHUNK_RECORDED', byteLength: 8000 });
    s = transcriptionReducer(s, { type: 'AUDIO_CHUNK_RECORDED', byteLength: 4000 });
    expect(s.metrics.audioBytes).toBe(20000);
    expect(s.metrics.chunksProcessed).toBe(3);
  });
});

// ----------------------------------------------------------------------------
// SESSION_RESET
// ----------------------------------------------------------------------------
describe('transcriptionReducer / SESSION_RESET', () => {
  it('整体重置, 但接受新 startTime', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: 'old' })],
      currentText: 'partial',
      fullText: 'full',
    };
    const s1 = transcriptionReducer(s0, { type: 'SESSION_RESET', startTime: 99999 });
    expect(s1.results).toEqual([]);
    expect(s1.currentText).toBe('');
    expect(s1.fullText).toBe('');
    expect(s1.metrics.startTime).toBe(99999);
  });
});

// ----------------------------------------------------------------------------
// 未知 action
// ----------------------------------------------------------------------------
describe('transcriptionReducer / unknown action', () => {
  it('返回原 state (类型安全)', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState, currentText: 'x' };
    // @ts-expect-error testing unknown action
    const s1 = transcriptionReducer(s0, { type: 'NOPE' });
    expect(s1).toBe(s0);
  });
});

// ----------------------------------------------------------------------------
// 火山引擎分角色: getSpeakerColor
// ----------------------------------------------------------------------------
describe('getSpeakerColor', () => {
  it('同一 id 永远返回同一颜色 (稳定 hash)', () => {
    expect(getSpeakerColor('spk0')).toBe(getSpeakerColor('spk0'));
    expect(getSpeakerColor('spk1')).toBe(getSpeakerColor('spk1'));
  });

  it('不同 id 大概率返回不同颜色', () => {
    const colors = ['spk0', 'spk1', 'spk2', 'spk3', 'spk4', 'spk5', 'spk6', 'spk7'].map(getSpeakerColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(6); // 8 选 6+, 调色板 8 色保证够分
  });
});

// ----------------------------------------------------------------------------
// 火山引擎分角色: TRANSCRIPT_FINAL 合并 speakers
// ----------------------------------------------------------------------------
describe('transcriptionReducer / TRANSCRIPT_FINAL + speakers', () => {
  it('新增 speaker 自动分配 color, 已存在的 label 更新', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '你好',
        speaker_id: 'spk0',
        speakers: [{ id: 'spk0', label: '发言人 1' }],
      }),
    });
    expect(s1.speakers).toHaveLength(1);
    expect(s1.speakers[0].id).toBe('spk0');
    expect(s1.speakers[0].label).toBe('发言人 1');
    expect(s1.speakers[0].color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(s1.currentSpeakerId).toBe('spk0');
  });

  it('后续 final 累积 speakers, 不重复', () => {
    let s: TranscriptionState = { ...initialTranscriptionState };
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '你好',
        speaker_id: 'spk0',
        speakers: [{ id: 'spk0', label: '发言人 1' }],
      }),
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '我是字节',
        speaker_id: 'spk1',
        speakers: [
          { id: 'spk0', label: '发言人 1' },
          { id: 'spk1', label: '发言人 2' },
        ],
      }),
    });
    expect(s.speakers).toHaveLength(2);
    expect(s.speakers.map((x) => x.id)).toEqual(['spk0', 'spk1']);
    // spk0 颜色应保持不变 (稳定 hash)
    const spk0Color1 = s.speakers.find((x) => x.id === 'spk0')!.color;
    expect(spk0Color1).toBe(getSpeakerColor('spk0'));
    expect(s.currentSpeakerId).toBe('spk1');
  });

  it('utterances 累加到 currentUtterances', () => {
    const s0: TranscriptionState = { ...initialTranscriptionState };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '你好世界。我是字节。',
        speaker_id: 'spk0',
        utterances: [
          {
            text: '你好世界。', start_time: 0, end_time: 1500,
            speaker_id: 'spk0', words: [],
          },
          {
            text: '我是字节。', start_time: 1500, end_time: 3000,
            speaker_id: 'spk1', words: [],
          },
        ],
      }),
    });
    expect(s1.currentUtterances).toHaveLength(2);
    expect(s1.currentUtterances[0].speaker_id).toBe('spk0');
    expect(s1.currentUtterances[1].speaker_id).toBe('spk1');
  });
});

// ----------------------------------------------------------------------------
// TRANSCRIPT_PARTIAL + speakerId (火山引擎 partial 也带 speaker)
// ----------------------------------------------------------------------------
describe('transcriptionReducer / TRANSCRIPT_PARTIAL + speakerId', () => {
  it('speakerId 更新 currentSpeakerId', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      speakers: [{ id: 'spk0', label: '发言人 1', color: '#00d4ff' }],
      currentSpeakerId: 'spk0',
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_PARTIAL',
      text: '你好',
      fullText: '',
      speakerId: 'spk1',
    });
    expect(s1.currentSpeakerId).toBe('spk1');
  });

  it('speakerId 缺省时, 保留上一次的 currentSpeakerId', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      currentSpeakerId: 'spk0',
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_PARTIAL',
      text: 'p',
      fullText: '',
      // speakerId 不传 → undefined → 保留 spk0
    });
    expect(s1.currentSpeakerId).toBe('spk0');
  });
});