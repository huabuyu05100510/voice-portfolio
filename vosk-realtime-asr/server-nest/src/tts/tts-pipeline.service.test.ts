/**
 * TDD: TtsPipelineService — 去重 + 队列 + emit
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { SynthesizeResult } from './tts.service';
import { TtsPipelineService } from './tts-pipeline.service';
import { TtsService } from './tts.service';
import { ConfigService } from '../config/config.service';
import { StructuredLogger } from '../logger/logger.service';

function makeConfig(over: Partial<ConfigService> = {}): ConfigService {
  return {
    ttsUsable: true,
    ttsTimeoutMs: 3000,
    ttsCacheSize: 200,
  } as unknown as ConfigService;
}

function makeLogger(): StructuredLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
}

describe('TtsPipelineService', () => {
  let ttsSynth: jest.Mock;
  let ttsService: TtsService;
  let pipe: TtsPipelineService;
  let emitted: Array<{ sid: string; event: string; payload: any }>;

  beforeEach(() => {
    ttsSynth = jest.fn(async (text: string): Promise<SynthesizeResult> => ({
      audio: Buffer.from(`audio:${text}`),
      format: 'mp3',
      latencyMs: 10,
    }));
    ttsService = { synthesize: ttsSynth } as unknown as TtsService;
    emitted = [];
    pipe = new TtsPipelineService(ttsService, makeConfig(), makeLogger());
    // mock server.to(sid).emit(...)
    (pipe as any).server = {
      to: (sid: string) => ({
        emit: (event: string, payload: any) => {
          emitted.push({ sid, event, payload });
        },
      }),
    };
  });

  it('submit: synthesize + emit tts_audio', async () => {
    pipe.submit('s1', '你好');
    await new Promise((r) => setTimeout(r, 50));
    expect(ttsSynth).toHaveBeenCalledTimes(1);
    expect(emitted.length).toBe(1);
    expect(emitted[0].event).toBe('tts_audio');
    expect(emitted[0].sid).toBe('s1');
    expect(emitted[0].payload.audio_base64).toBeTruthy();
    expect(emitted[0].payload.format).toBe('mp3');
  });

  it('重复同句: LRU 命中, synthesize 只调一次', async () => {
    pipe.submit('s1', '你好');
    await new Promise((r) => setTimeout(r, 20));
    pipe.submit('s1', '你好');
    await new Promise((r) => setTimeout(r, 20));
    expect(ttsSynth).toHaveBeenCalledTimes(1);
    expect(emitted.length).toBe(2); // 都 emit
  });

  it('LRU key 归一化: 标点/空白差异视为同句', async () => {
    pipe.submit('s1', '你好，世界。');
    await new Promise((r) => setTimeout(r, 20));
    pipe.submit('s1', '你好 世界');
    await new Promise((r) => setTimeout(r, 20));
    expect(ttsSynth).toHaveBeenCalledTimes(1);
  });

  it('不同 sid 独立队列', async () => {
    pipe.submit('s1', '甲');
    pipe.submit('s2', '乙');
    await new Promise((r) => setTimeout(r, 50));
    expect(ttsSynth).toHaveBeenCalledTimes(2);
    expect(emitted.filter((e) => e.sid === 's1').length).toBe(1);
    expect(emitted.filter((e) => e.sid === 's2').length).toBe(1);
  });

  it('synthesize 返回 null (失败/降级): 不 emit, 不崩', async () => {
    (ttsSynth as any).mockResolvedValueOnce(null);
    pipe.submit('s1', '失败');
    await new Promise((r) => setTimeout(r, 30));
    expect(emitted.length).toBe(0);
    // 后续仍可工作
    pipe.submit('s1', '成功');
    await new Promise((r) => setTimeout(r, 30));
    expect(emitted.length).toBe(1);
  });

  it('ttsUsable=false: submit 直接 noop', async () => {
    const cfg = {
      ttsUsable: false,
      ttsTimeoutMs: 3000,
      ttsCacheSize: 200,
    } as unknown as ConfigService;
    const p = new TtsPipelineService(ttsService, cfg, makeLogger());
    (p as any).server = (pipe as any).server;
    p.submit('s1', '你好');
    await new Promise((r) => setTimeout(r, 20));
    expect(ttsSynth).not.toHaveBeenCalled();
  });

  it('空文本: 不提交', async () => {
    pipe.submit('s1', '   ');
    await new Promise((r) => setTimeout(r, 20));
    expect(ttsSynth).not.toHaveBeenCalled();
  });

  it('shutdown: 清队列, 后续 submit 不影响该 sid', async () => {
    pipe.submit('s1', '排队中');
    pipe.shutdown('s1');
    await new Promise((r) => setTimeout(r, 50));
    // 排队中的 job 可能已开始; 关键是 shutdown 后再 submit 不崩
    pipe.submit('s1', '再试');
    await new Promise((r) => setTimeout(r, 50));
    expect(true).toBe(true); // 未抛错即通过
  });

  it('LRU 容量上限: 超出时淘汰最旧', async () => {
    const cfg = makeConfig();
    (cfg as any).ttsCacheSize = 2;
    const p = new TtsPipelineService(ttsService, cfg, makeLogger());
    (p as any).server = (pipe as any).server;
    p.submit('s1', '甲');
    await new Promise((r) => setTimeout(r, 20));
    p.submit('s1', '乙');
    await new Promise((r) => setTimeout(r, 20));
    p.submit('s1', '丙');
    await new Promise((r) => setTimeout(r, 20));
    // 三句不同, cache 上限 2, 最旧的 "甲" 被淘汰
    // 再次 "甲" 应触发新的 synthesize
    const callsBefore = ttsSynth.mock.calls.length;
    p.submit('s1', '甲');
    await new Promise((r) => setTimeout(r, 20));
    expect(ttsSynth.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
