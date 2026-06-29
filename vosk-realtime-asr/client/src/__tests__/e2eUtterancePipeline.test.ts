/**
 * 端到端集成测试: 服务端 payload → WebSocketClient 映射 → reducer
 *
 * 用 DIAG 实测抓到的真实帧序列 (result_type=full, utt_count=1, stable start_time,
 * definite=false, text 累积增长) 验证整个管道产 1 张不断增长的卡, 不再分句.
 *
 * 这条测试复刻 WebSocketClient.ts:93-107 的映射 + App.tsx:43-48 的 dispatch 路径,
 * 是最贴近生产行为的回归门.
 */
import { describe, it, expect } from 'vitest';
import {
  transcriptionReducer,
  initialTranscriptionState,
  type TranscriptionState,
} from '../state/transcriptionReducer';
import type { TranscriptionResult } from '../types';

/**
 * 复刻 WebSocketClient.ts:93-107 的服务端 payload → TranscriptionResult 映射.
 * 任何字段增删必须同步两边, 这是管道契约的单一真相.
 */
function mapServerPayload(data: any): TranscriptionResult {
  return {
    text: data.text || '',
    isFinal: data.is_final || false,
    fullText: data.full_text || '',
    latency: data.latency_ms || 0,
    timestamp: data.timestamp || '',
    words: data.words || [],
    speaker_id: data.speaker_id,
    speakers: data.speakers || [],
    utterances: data.utterances || [],
    isCumulative: data.is_cumulative,
  };
}

/**
 * 构造一帧服务端 payload, 模拟 DIAG 实测的 full 协议帧.
 * 关键: utterances[0] 带稳定 start_time + definite=false + 累积增长的 text.
 */
function buildFullFrame(opts: {
  text: string;
  startTime: number;
  endTime: number;
  speakerId?: string;
  definite?: boolean;
}): object {
  const speakerId = opts.speakerId ?? '0';
  return {
    text: opts.text,
    is_final: true,
    is_cumulative: true,
    full_text: opts.text,
    latency_ms: 12,
    timestamp: '2026-06-24T15:34:34Z',
    speaker_id: speakerId,
    speakers: [{ id: speakerId, label: '发言人 1' }],
    utterances: [
      {
        text: opts.text,
        start_time: opts.startTime,
        end_time: opts.endTime,
        definite: opts.definite ?? false,
        speaker_id: speakerId,
        additions: { fixed_prefix_result: '' },
        words: [
          { text: opts.text.slice(0, 1) || '哎', start_time: opts.startTime, end_time: opts.startTime + 80 },
        ],
      },
    ],
  };
}

/**
 * 复刻 App.tsx:43-48 的 dispatch 路径:
 *   if (r.isFinal) pushFinal(r, r.isCumulative) else pushPartial(...)
 * pushFinal 内部 dispatch TRANSCRIPT_FINAL { result, timestamp, isCumulative }
 */
function dispatchFrame(state: TranscriptionState, serverPayload: object): TranscriptionState {
  const r = mapServerPayload(serverPayload);
  if (r.isFinal) {
    return transcriptionReducer(state, {
      type: 'TRANSCRIPT_FINAL',
      result: r,
      timestamp: 1,
      isCumulative: r.isCumulative,
    });
  }
  return transcriptionReducer(state, {
    type: 'TRANSCRIPT_PARTIAL',
    text: r.text,
    fullText: r.fullText ?? '',
    speakerId: r.speaker_id ?? null,
  });
}

describe('E2E / 真实 full 协议帧序列 → 单卡累积 (DIAG 实测复刻)', () => {
  it('DIAG 实测序列: 同 start_time 累积增长的 14 帧 → 1 张卡, 文本为最长帧', () => {
    // DIAG 实测: start_time 全程 2712, text 从 "哎，那" 累积增长到完整长句
    const frames = [
      '哎，那',
      '哎，那你问你',
      '哎，那你问你朋男朋友',
      '哎，那你问你朋男朋友，他挑了',
      '哎，那你问你朋男朋友，他挑了一身衣服，然后',
      '哎，那你问你朋男朋友，他挑了一身衣服，然后他',
      '哎，那你问你朋男朋友，他挑了一身衣服，然后他的这个衣品',
      '哎，那你问你朋男朋友，他挑了一身衣服，然后他的这个衣品就觉得',
      '哎，那你问你朋男朋友，他挑了一身衣服，然后他的这个衣品就觉得就一般',
    ];
    const START = 2712;
    let state: TranscriptionState = { ...initialTranscriptionState };
    for (let i = 0; i < frames.length; i++) {
      const payload = buildFullFrame({
        text: frames[i],
        startTime: START,        // 全程同一 start_time (DIAG 实测)
        endTime: START + 300 * (i + 1),
        definite: false,         // 流式中间帧 definite=false (DIAG 实测)
      });
      state = dispatchFrame(state, payload);
    }

    // 核心断言: 全程 1 张卡
    expect(state.results.length).toBe(1);
    // 文本为最长一帧
    expect(state.results[0].text).toBe(frames[frames.length - 1]);
    // 卡片携带 stable identity
    expect(state.results[0].start_time).toBe(START);
    expect(state.results[0].definite).toBe(false);
  });

  it('第二句开始 (新 start_time) 才新增卡 — 2 句对话 → 2 张卡, 无文本重叠', () => {
    let state: TranscriptionState = { ...initialTranscriptionState };

    // 句 1: start_time=2712, 累积 3 帧
    for (const t of ['你好', '你好我是', '你好我是王楚然']) {
      state = dispatchFrame(state, buildFullFrame({ text: t, startTime: 2712, endTime: 3000 }));
    }
    expect(state.results.length).toBe(1);
    expect(state.results[0].text).toBe('你好我是王楚然');

    // 句 2: 新 start_time=5000 (说话人换了一句)
    for (const t of ['今天', '今天天气', '今天天气真好']) {
      state = dispatchFrame(state, buildFullFrame({ text: t, startTime: 5000, endTime: 6000 }));
    }
    expect(state.results.length).toBe(2);
    expect(state.results[0].text).toBe('你好我是王楚然');
    expect(state.results[0].start_time).toBe(2712);
    expect(state.results[1].text).toBe('今天天气真好');
    expect(state.results[1].start_time).toBe(5000);
    // 关键: 第二句不包含第一句的文本 (无滑动窗口重叠)
    expect(state.results[1].text).not.toContain('王楚然');
  });

  it('数字↔中文数字重写: 同 start_time 即使文本完全不同也只更新不新增', () => {
    // DIAG 截图中 "24,000" → "2万四千" 的真实重写场景
    let state: TranscriptionState = { ...initialTranscriptionState };
    state = dispatchFrame(state, buildFullFrame({
      text: '王楚然 24,000', startTime: 1000, endTime: 2000, definite: false,
    }));
    state = dispatchFrame(state, buildFullFrame({
      text: '王楚然 2万四千', startTime: 1000, endTime: 2000, definite: false,
    }));
    state = dispatchFrame(state, buildFullFrame({
      text: '王楚然 两万四千块', startTime: 1000, endTime: 2000, definite: false,
    }));
    expect(state.results.length).toBe(1);
    expect(state.results[0].text).toBe('王楚然 两万四千块');
  });

  it('多说话人: 每人按各自 start_time 独立成卡, 互不合并', () => {
    let state: TranscriptionState = { ...initialTranscriptionState };
    // 说话人 A 说一句
    state = dispatchFrame(state, buildFullFrame({
      text: '我是 A', startTime: 1000, endTime: 2000, speakerId: '0',
    }));
    // 说话人 B 说一句
    state = dispatchFrame(state, buildFullFrame({
      text: '我是 B', startTime: 3000, endTime: 4000, speakerId: '1',
    }));
    // A 又说一句
    state = dispatchFrame(state, buildFullFrame({
      text: 'A 再说', startTime: 5000, endTime: 6000, speakerId: '0',
    }));
    expect(state.results.length).toBe(3);
    expect(state.results[0].speaker_id).toBe('0');
    expect(state.results[1].speaker_id).toBe('1');
    expect(state.results[2].speaker_id).toBe('0');
    expect(state.speakers.length).toBe(2);
  });

  /**
   * 真实会议室场景: 一帧内多个 utterance, 每个不同 speaker_id 不同 start_time.
   * 这是 full 协议的核心能力 — 服务端把同时间窗内的多个说话人 utterance 一次返回.
   * 客户端必须把这 N 个 utterance 映射成 N 张卡, 不能合并.
   */
  it('N 说话人同帧 (full 协议核心): 一帧 utterances[] 含 4 个不同 speaker → 4 张卡', () => {
    let state: TranscriptionState = { ...initialTranscriptionState };
    // 构造一帧含 4 个 utterance 的 full 帧 (multi-utterance payload)
    const multiUttPayload = {
      text: '主持人提问张三回答李四补充王五总结',
      is_final: true,
      is_cumulative: true,
      full_text: '主持人提问张三回答李四补充王五总结',
      latency_ms: 20,
      timestamp: '2026-06-24T16:00:00Z',
      speaker_id: '0',
      speakers: [
        { id: '0', label: '主持人' },
        { id: '1', label: '张三' },
        { id: '2', label: '李四' },
        { id: '3', label: '王五' },
      ],
      utterances: [
        { text: '请问这个方案怎么样', start_time: 1000, end_time: 2000, definite: true,  speaker_id: '0', additions: { fixed_prefix_result: '' }, words: [] },
        { text: '我觉得不错',         start_time: 2200, end_time: 2800, definite: true,  speaker_id: '1', additions: { fixed_prefix_result: '' }, words: [] },
        { text: '我补充一点成本',     start_time: 3000, end_time: 3800, definite: true,  speaker_id: '2', additions: { fixed_prefix_result: '' }, words: [] },
        { text: '总结一下四个方向',   start_time: 4000, end_time: 5000, definite: true,  speaker_id: '3', additions: { fixed_prefix_result: '' }, words: [] },
      ],
    };
    state = dispatchFrame(state, multiUttPayload);
    expect(state.results.length).toBe(4);
    expect(state.speakers.length).toBe(4);
    // 每张卡的 speaker_id 按 utterance 数组里的真实 id, 不是顶层 speaker_id='0'
    expect(state.results[0].speaker_id).toBe('0');
    expect(state.results[1].speaker_id).toBe('1');
    expect(state.results[2].speaker_id).toBe('2');
    expect(state.results[3].speaker_id).toBe('3');
    // 每张卡 start_time 不同 (身份稳定)
    expect(state.results[0].start_time).toBe(1000);
    expect(state.results[3].start_time).toBe(4000);
  });

  /**
   * 流式累积场景: 5 个说话人交错发言, 服务端逐帧返回累积的 utterances[].
   * 每帧的 utterances[] 包含此前所有未 definite 的 utterance + 新增的.
   * 客户端要保证: 已 definite 的旧卡锁定不被覆盖, 新增 utterance 独立成卡.
   */
  it('5 说话人流式交错: 累积帧序列 → 5 张独立卡, 文本不串', () => {
    let state: TranscriptionState = { ...initialTranscriptionState };

    // 帧 1: A 开始说 (definite=false, 流式中)
    state = dispatchFrame(state, {
      text: 'A 开始', is_final: true, is_cumulative: true, full_text: 'A 开始',
      latency_ms: 10, timestamp: 't1', speaker_id: '0',
      speakers: [{ id: '0', label: 'A' }],
      utterances: [
        { text: 'A 开始', start_time: 1000, end_time: 1500, definite: false, speaker_id: '0', words: [], additions: {} },
      ],
    });
    expect(state.results.length).toBe(1);

    // 帧 2: A 继续 + B 插话 (A 仍 definite=false 因为还在说, B 新开始)
    state = dispatchFrame(state, {
      text: 'A 继续说 B 插话', is_final: true, is_cumulative: true, full_text: 'A 继续说 B 插话',
      latency_ms: 10, timestamp: 't2', speaker_id: '0',
      speakers: [{ id: '0', label: 'A' }, { id: '1', label: 'B' }],
      utterances: [
        { text: 'A 继续说', start_time: 1000, end_time: 2200, definite: true, speaker_id: '0', words: [], additions: {} },
        { text: 'B 插话',   start_time: 2400, end_time: 2800, definite: false, speaker_id: '1', words: [], additions: {} },
      ],
    });
    expect(state.results.length).toBe(2);

    // 帧 3: C/D/E 全部出现, B 已 definite
    state = dispatchFrame(state, {
      text: 'A 继续说 B 插话 C 来 D 接 E 总结', is_final: true, is_cumulative: true,
      full_text: 'A 继续说 B 插话 C 来 D 接 E 总结',
      latency_ms: 10, timestamp: 't3', speaker_id: '0',
      speakers: [
        { id: '0', label: 'A' }, { id: '1', label: 'B' }, { id: '2', label: 'C' },
        { id: '3', label: 'D' }, { id: '4', label: 'E' },
      ],
      utterances: [
        { text: 'A 继续说',     start_time: 1000, end_time: 2200, definite: true, speaker_id: '0', words: [], additions: {} },
        { text: 'B 插话',       start_time: 2400, end_time: 2800, definite: true, speaker_id: '1', words: [], additions: {} },
        { text: 'C 来',         start_time: 3000, end_time: 3300, definite: true, speaker_id: '2', words: [], additions: {} },
        { text: 'D 接',         start_time: 3400, end_time: 3700, definite: true, speaker_id: '3', words: [], additions: {} },
        { text: 'E 总结',       start_time: 3800, end_time: 4200, definite: true, speaker_id: '4', words: [], additions: {} },
      ],
    });
    // 核心: 5 张卡, 每张 speaker_id 正确
    expect(state.results.length).toBe(5);
    expect(state.speakers.length).toBe(5);
    const speakerIds = state.results.map((r) => r.speaker_id);
    expect(speakerIds).toEqual(['0', '1', '2', '3', '4']);
    // 每张卡文本不串 (没把别人的字并进来)
    expect(state.results[0].text).toBe('A 继续说');
    expect(state.results[1].text).toBe('B 插话');
    expect(state.results[4].text).toBe('E 总结');
  });

  /**
   * 退化场景: 服务端某帧不带 utterances[] (空数组), 之前 definite 锁定的卡保留.
   */
  it('空 utterances 帧: 不清空已 definite 锁定的卡片', () => {
    let state: TranscriptionState = { ...initialTranscriptionState };
    // 帧 1: 2 个 utterance 都 definite
    state = dispatchFrame(state, {
      text: 'A B', is_final: true, is_cumulative: true, full_text: 'A B',
      latency_ms: 10, timestamp: 't1', speaker_id: '0',
      speakers: [{ id: '0', label: 'A' }, { id: '1', label: 'B' }],
      utterances: [
        { text: 'A 说', start_time: 1000, end_time: 1500, definite: true, speaker_id: '0', words: [], additions: {} },
        { text: 'B 说', start_time: 2000, end_time: 2500, definite: true, speaker_id: '1', words: [], additions: {} },
      ],
    });
    expect(state.results.length).toBe(2);

    // 帧 2: utterances=[] (服务端边界帧或 ack)
    state = dispatchFrame(state, {
      text: '', is_final: true, is_cumulative: true, full_text: '',
      latency_ms: 10, timestamp: 't2', speaker_id: '0',
      speakers: [], utterances: [],
    });
    // 之前的卡必须保留
    expect(state.results.length).toBe(2);
    expect(state.results[0].text).toBe('A 说');
    expect(state.results[1].text).toBe('B 说');
  });
});
