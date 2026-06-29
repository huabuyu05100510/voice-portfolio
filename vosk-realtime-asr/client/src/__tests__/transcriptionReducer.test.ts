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

  it('接收服务端累积的 words, 用 action 注入的 timestamp 覆盖 finalStartTime (纯 reducer)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      words: [buildWord({ word: '旧' })],
      finalStartTime: 12345,
    };
    const injectedTs = 99999;
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ words: [buildWord({ word: '新' })] }),
      timestamp: injectedTs,
    });
    expect(s1.words[0].word).toBe('新');
    // A1: reducer 不再自调 performance.now(), 而是直接采用 action 注入的 timestamp
    expect(s1.finalStartTime).toBe(injectedTs);
    expect(s1.finalStartTime).not.toBe(12345);
  });

  it('A1: 未注入 timestamp 时沿用旧值 (reducer 保持纯函数, 无副作用)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      finalStartTime: 12345,
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好' }),
    });
    expect(s1.finalStartTime).toBe(12345);
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
// TRANSCRIPT_FINAL + isCumulative=false (F2: 一句一返模式, 跳过前缀匹配)
// ----------------------------------------------------------------------------
describe('transcriptionReducer / TRANSCRIPT_FINAL + isCumulative=false', () => {
  it('isCumulative=false 时, 即使新文本以旧文本为前缀也不合并, 直接新增', () => {
    // 前缀重合的连续句子, single 模式应各自独立
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: '你好世界' })],
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好世界今天天气真好' }),
      isCumulative: false,
    });
    expect(s1.results).toHaveLength(2);  // 不合并, 各自成卡
    expect(s1.results[0].text).toBe('你好世界');
    expect(s1.results[1].text).toBe('你好世界今天天气真好');
  });

  it('isCumulative=false 时, 即使是同一说话人也不触发 C2 子串合并', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: '今天天气真好', speaker_id: 'spk0' })],
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '今天天气真好我想出去玩', speaker_id: 'spk0' }),
      isCumulative: false,
    });
    expect(s1.results).toHaveLength(2);
  });

  it('isCumulative=true 时, 仍走累积合并路径 (向后兼容)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: '你好世界' })],
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好世界今天' }),
      isCumulative: true,
    });
    expect(s1.results).toHaveLength(1);  // 合并, 就地更新
    expect(s1.results[0].text).toBe('你好世界今天');
  });

  it('未指定 isCumulative (undefined) 时, 默认走累积模式 (兼容老服务端)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: '你好世界' })],
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好世界今天' }),
    });
    expect(s1.results).toHaveLength(1);
    expect(s1.results[0].text).toBe('你好世界今天');
  });

  it('isCumulative=false 时, 重复文本仍被跳过 (path B 在 cumulative 之外生效)', () => {
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [buildResult({ text: '你好世界' })],
    };
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '你好' }),  // 是上一条的子串
      isCumulative: false,
    });
    expect(s1.results).toHaveLength(1);
    expect(s1.results[0].text).toBe('你好世界');
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

  it('服务端每帧重新编号 label — 客户端按 session 首次出现顺序编号, 不信服务端 label', () => {
    // 复刻真实 bug: 服务端 extract_utterances 每帧从 1 重新编号.
    // 帧 1 utts=[spk0, spk1, spk2] → server 发 [{0,"发言人 1"},{1,"发言人 2"},{2,"发言人 3"}]
    // 帧 2 utts=[spk3]            → server 发 [{3,"发言人 1"}]  ← 这里冲突
    // 客户端必须给 spk3 分配 "发言人 4", 而不是 "发言人 1".
    let s: TranscriptionState = { ...initialTranscriptionState };
    // 帧 1: 3 个 speaker (服务端正确编号 1/2/3)
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: 'spk0',
        speakers: [
          { id: 'spk0', label: '发言人 1' },
          { id: 'spk1', label: '发言人 2' },
          { id: 'spk2', label: '发言人 3' },
        ],
        utterances: [
          { text: 'A', start_time: 1000, end_time: 1500, speaker_id: 'spk0', definite: true },
          { text: 'B', start_time: 1600, end_time: 2000, speaker_id: 'spk1', definite: true },
          { text: 'C', start_time: 2100, end_time: 2500, speaker_id: 'spk2', definite: true },
        ],
      }),
    });
    expect(s.speakers.map((x) => x.label)).toEqual(['发言人 1', '发言人 2', '发言人 3']);

    // 帧 2: 服务端只看到一个新 spk3, 错误地从 1 编号 → label "发言人 1"
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: 'spk3',
        speakers: [{ id: 'spk3', label: '发言人 1' }],
        utterances: [
          { text: 'D', start_time: 3000, end_time: 3500, speaker_id: 'spk3', definite: true },
        ],
      }),
    });
    // spk3 必须拿到 session 内唯一的下一个号: "发言人 4"
    const spk3 = s.speakers.find((x) => x.id === 'spk3');
    expect(spk3?.label).toBe('发言人 4');
    // 之前 3 个 speaker 的 label 不被覆盖
    expect(s.speakers.find((x) => x.id === 'spk0')?.label).toBe('发言人 1');
    expect(s.speakers.find((x) => x.id === 'spk1')?.label).toBe('发言人 2');
    expect(s.speakers.find((x) => x.id === 'spk2')?.label).toBe('发言人 3');
    // session 内 label 全部唯一 (无两人共享 "发言人 1")
    const labels = s.speakers.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
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

// ----------------------------------------------------------------------------
// TRANSCRIPT_FINAL · 累积合并 — 标点/空格漂移容错 (会议室场景实测)
// 火山引擎 v3 sauc 累积模式下, 每帧会重新加标点 (句号/逗号/空格来回变),
// 严格 startsWith 会让同一句被拆成 N 张卡片.
// ----------------------------------------------------------------------------
describe('transcriptionReducer / 累积合并 · 标点漂移容错', () => {
  it('句号漂移: "ABC." → "ABCDEF." 应合并成 1 张卡', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABC.' }),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF.' }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('ABCDEF.');
  });

  it('逗号漂移: "ABCDEF 我的首选永远是 d" → "ABCDEF，我的首选永远是 d 座..." 应合并', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF 我的首选永远是 d' }),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF，我的首选永远是 d 座，我认为 d 座就是二等座里的一等' }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('ABCDEF，我的首选永远是 d 座，我认为 d 座就是二等座里的一等');
  });

  it('4 帧连续累积 + 标点漂移: 最终 1 张卡, 文本为最长一帧', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABC.' }),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF.' }),
      timestamp: 2,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF 我的首选永远是 d' }),
      timestamp: 3,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: 'ABCDEF，我的首选永远是 d 座，我认为 d 座就是二等座里的一等' }),
      timestamp: 4,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('ABCDEF，我的首选永远是 d 座，我认为 d 座就是二等座里的一等');
  });

  it('真正不同的句子 (无公共前缀) 仍应追加新卡', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '今天天气不错' }),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({ text: '我们开始开会吧' }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(2);
  });
});

// ----------------------------------------------------------------------------
// 火山引擎 v3 full 协议 · utterance 驱动合并 (definite 字段)
// ----------------------------------------------------------------------------
// 背景: 火山引擎每帧重新加标点 + 数字↔中文数字重写 ("24,000" ↔ "2万四千"),
// 任何文本前缀匹配 (path A/B/C/C2) 都会被破坏. 官方文档方案: 用 utterances[]
// 数组作分段真相, 每个 utterance 有稳定 start_time + definite 标志.
// definite:true = 该句已锁定, 不再用后续帧覆盖.
describe('transcriptionReducer / utterance 驱动合并 (definite)', () => {
  it('同 start_time 的 utterance 即使文本被改写 (数字↔中文数字) 也只更新不新增', () => {
    // 帧 1: "王楚然 24,000"
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '王楚然 24,000',
        utterances: [{
          text: '王楚然 24,000', start_time: 1000, end_time: 2000,
          speaker_id: '0', definite: false,
        }],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('王楚然 24,000');

    // 帧 2: 火山引擎把 "24,000" 改写成 "2万四千" — 文本完全不同, 但 start_time 相同
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '王楚然 2万四千',
        utterances: [{
          text: '王楚然 2万四千', start_time: 1000, end_time: 2000,
          speaker_id: '0', definite: false,
        }],
      }),
      timestamp: 2,
    });
    // 关键断言: 仍是 1 张卡 (按 start_time 就地更新), 不是 2 张
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('王楚然 2万四千');
  });

  it('definite:true 锁定后, 后续同 start_time 帧不再覆盖文本', () => {
    // 帧 1: definite:true 锁定为 "王楚然 24,000"
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '王楚然 24,000',
        utterances: [{
          text: '王楚然 24,000', start_time: 1000, end_time: 2000,
          speaker_id: '0', definite: true,
        }],
      }),
      timestamp: 1,
    });
    // 帧 2: 同 start_time 但文本变了, definite 仍 true
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        text: '王楚然 2万四千',
        utterances: [{
          text: '王楚然 2万四千', start_time: 1000, end_time: 2000,
          speaker_id: '0', definite: true,
        }],
      }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(1);
    // 锁定后保留首次 definite 版本
    expect(s.results[0].text).toBe('王楚然 24,000');
  });

  it('full 协议每帧返回全部 utterances: 多句应映射为多张卡, 按 start_time 稳定', () => {
    // 第一帧: 1 个 utterance
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        utterances: [{
          text: '你好', start_time: 1000, end_time: 1500,
          speaker_id: '0', definite: true,
        }],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);

    // 第二帧: 2 个 utterance (full 协议每帧返全部)
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        utterances: [
          { text: '你好', start_time: 1000, end_time: 1500, speaker_id: '0', definite: true },
          { text: '我是王楚然', start_time: 1600, end_time: 2400, speaker_id: '1', definite: false },
        ],
      }),
      timestamp: 2,
    });
    // 2 张卡, 第一张 definite 锁定不变, 第二张新增
    expect(s.results.length).toBe(2);
    expect(s.results[0].start_time).toBe(1000);
    expect(s.results[0].text).toBe('你好');
    expect(s.results[1].start_time).toBe(1600);
    expect(s.results[1].text).toBe('我是王楚然');
  });

  it('不同 start_time 的 utterance 视为不同句, 不做文本前缀合并', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        utterances: [{
          text: '今天天气', start_time: 1000, end_time: 2000,
          speaker_id: '0', definite: true,
        }],
      }),
      timestamp: 1,
    });
    // 新句不同 start_time 且间隔 > 5s (说话人明显换了回合), 即使同 speaker 也不合并
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        utterances: [{
          text: '今天天气不错我们开会吧', start_time: 8000, end_time: 10000,
          speaker_id: '0', definite: true,
        }],
      }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(2);
  });
});

// ----------------------------------------------------------------------------
// 同说话人连续 utterance 合并 (修复"一人分多张卡"的过度切分)
// ----------------------------------------------------------------------------
// 背景: end_window_size=500 让 VAD 灵敏, 同一人句子间自然停顿 500ms+ 也被切成
// 多个 utterance → UI 出现 3 张全是 "发言人 5" 的卡. 用户要的是:
// 同一人连续讲话 (句子间自然停顿) = 1 张卡, 文本按句拼接.
// 换人才换卡. 间隔超过阈值 (≥2.5s) 视为换回合, 不合并.
describe('transcriptionReducer / 同说话人连续合并', () => {
  it('同一 speaker 连续 3 个 utterance (句间 <2s) → 1 张卡, 文本按句拼接', () => {
    // 复刻实测场景: 发言人 5 一段独白被 VAD 切成 3 句
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '5',
        utterances: [
          { text: '其实啊，我是一个演员。', start_time: 1000, end_time: 2200, speaker_id: '5', definite: true },
          { text: '想学吗？',                 start_time: 2500, end_time: 3000, speaker_id: '5', definite: true },
          { text: '想学我教你啊。',           start_time: 3200, end_time: 4000, speaker_id: '5', definite: true },
        ],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].speaker_id).toBe('5');
    // 3 句按顺序拼成一段 (不丢字, 不改字)
    expect(s.results[0].text).toBe('其实啊，我是一个演员。想学吗？想学我教你啊。');
    // 身份用最早 start_time
    expect(s.results[0].start_time).toBe(1000);
    expect(s.results[0].end_time).toBe(4000);
  });

  it('同 speaker 两个 utterance 但间隔 >2.5s (换回合) → 2 张卡, 不合并', () => {
    // 同一人讲一句, 隔很久又讲一句, 视为不同回合
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '第一段发言', start_time: 1000, end_time: 2000, speaker_id: '0', definite: true },
          { text: '过了五秒我又说', start_time: 8000, end_time: 9000, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(2);
    expect(s.results[0].text).toBe('第一段发言');
    expect(s.results[1].text).toBe('过了五秒我又说');
  });

  it('多说话人交替 (A-B-A) → 3 张卡, 中间 B 阻断 A 的合并', () => {
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: 'A 说一',  start_time: 1000, end_time: 1500, speaker_id: '0', definite: true },
          { text: 'B 说二',  start_time: 1800, end_time: 2200, speaker_id: '1', definite: true },
          { text: 'A 说三',  start_time: 2500, end_time: 3000, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    // 中间被 B 打断, A 的两句不能合并
    expect(s.results.length).toBe(3);
    expect(s.results[0].speaker_id).toBe('0');
    expect(s.results[1].speaker_id).toBe('1');
    expect(s.results[2].speaker_id).toBe('0');
  });

  it('流式累积: 同 speaker 第 2 帧新增 utterance → 合并到已有卡', () => {
    // 帧 1: 一个 utterance
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '你好', start_time: 1000, end_time: 1500, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);

    // 帧 2: 累积, 原句 + 新增一句同 speaker
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '你好', start_time: 1000, end_time: 1500, speaker_id: '0', definite: true },
          { text: '我是王楚然', start_time: 1800, end_time: 2500, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 2,
    });
    // 仍 1 张卡, 文本拼成完整句
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('你好我是王楚然');
  });
});

// ----------------------------------------------------------------------------
// 同文本去重 (修复"同一句话重复 8 次" bug)
// ----------------------------------------------------------------------------
describe('transcriptionReducer / 同文本去重', () => {
  it('utterance start_time 不稳: 同 speaker + 同文本 + 不同 start_time → 1 张卡', () => {
    // 模拟服务端 start_time 漂移: 帧 1 start=1000, 帧 2 同文本 start=1200
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '一句美女硬生生听成美女', start_time: 1000, end_time: 2000, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '一句美女硬生生听成美女', start_time: 1200, end_time: 2000, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 2,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('一句美女硬生生听成美女');
  });

  it('同帧内多 utterance 同 speaker 同文本 → 1 张卡 (不重复)', () => {
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '重复的话', start_time: 1000, end_time: 1500, speaker_id: '0', definite: true },
          { text: '重复的话', start_time: 2000, end_time: 2500, speaker_id: '0', definite: true },
          { text: '重复的话', start_time: 3000, end_time: 3500, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('重复的话');
  });

  it('历史已锁定卡 + 本帧同文本 utterance (不同 start_time): 不新增重复卡', () => {
    // 历史: 已有 1 张锁定卡
    const s0: TranscriptionState = {
      ...initialTranscriptionState,
      results: [
        buildResult({
          text: '你好',
          speaker_id: '0',
          start_time: 1000,
          end_time: 2000,
          definite: true,
        }),
      ],
    };
    // 本帧: 同文本但 start_time 漂移
    const s1 = transcriptionReducer(s0, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '你好', start_time: 1100, end_time: 2000, speaker_id: '0', definite: true },
        ],
      }),
      timestamp: 1,
    });
    expect(s1.results.length).toBe(1);
    expect(s1.results[0].text).toBe('你好');
  });
});

// ----------------------------------------------------------------------------
// mergeConsecutiveSameSpeaker — 前缀文本关系检测 (start_time 漂移场景)
// Bug: start_time 从 100 漂移到 200, preserved + incoming 被拼接成
//      "今天的天气今天的天气不错" 而不是 "今天的天气不错"
// ----------------------------------------------------------------------------
describe('transcriptionReducer / utterance start_time 漂移 - 前缀去重', () => {
  it('start_time 漂移: cur 是 prev 的扩展 → 保留 cur 文本, 不拼接', () => {
    // 帧 1: start_time=100
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '今天的天气', start_time: 100, end_time: 1000, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 1,
    });
    expect(s.results.length).toBe(1);

    // 帧 2: start_time 漂移到 200, 文本是帧 1 的扩展
    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '今天的天气不错', start_time: 200, end_time: 1500, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 2,
    });
    // 应该是 1 张卡, 文本是最新的扩展版, 不能出现"今天的天气今天的天气不错"
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('今天的天气不错');
    expect(s.results[0].text).not.toContain('今天的天气今天');
  });

  it('start_time 漂移连续 3 帧: 每帧扩展文本 → 始终 1 张卡', () => {
    let s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '今天', start_time: 100, end_time: 300, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 1,
    });

    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '今天天气', start_time: 200, end_time: 500, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 2,
    });

    s = transcriptionReducer(s, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '今天天气真好', start_time: 300, end_time: 800, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 3,
    });

    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('今天天气真好');
  });

  it('两个真正独立的句子 (不同文本无前缀关系) → 正常拼接成 1 张卡', () => {
    // 同 speaker 短间隔, 但是真的两句不同的话 → 正常拼接
    const s = transcriptionReducer(initialTranscriptionState, {
      type: 'TRANSCRIPT_FINAL',
      result: buildResult({
        speaker_id: '0',
        utterances: [
          { text: '你好', start_time: 100, end_time: 300, speaker_id: '0', definite: false },
          { text: '请坐', start_time: 400, end_time: 600, speaker_id: '0', definite: false },
        ],
      }),
      timestamp: 1,
    });
    // "你好" 和 "请坐" 无前缀关系 → 正常拼接
    expect(s.results.length).toBe(1);
    expect(s.results[0].text).toBe('你好请坐');
  });
});