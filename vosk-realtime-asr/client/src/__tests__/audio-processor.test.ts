/**
 * audio-processor (worklet) 单元测试
 *
 * Worklet 在独立线程运行, vitest + jsdom 缺 AudioWorkletProcessor / sampleRate 全局.
 * 这里用两个策略 mock:
 *   1) 在 import 前注入 `globalThis.sampleRate` / `currentTime` (worklet 内是全局)
 *   2) 通过 loadFromString + eval 把 AudioProcessor 类 inject 到 test scope
 *      (worklet 文件不 import/export, 而是 class extends AudioWorkletProcessor)
 *
 * 覆盖:
 *   - Float32 -> Int16 转换 (边界 -1, 0, 1, 0.5)
 *   - buffer 满时 flushBuffer 触发 postMessage
 *   - 软重采样 (sampleRate=48000 -> 16k 降频)
 *   - underrun 检测 (currentTime 跳变 > 50ms)
 *   - postMessage 协议: { type: 'audio', pcm, underrunCount, needsResampling }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ----------------------------------------------------------------------------
// Worklet 加载器
// ----------------------------------------------------------------------------
function loadWorkletClass(sampleRate: number): any {
  // 关键: globalThis.sampleRate / currentTime 必须在 new Function 之前注入
  (globalThis as any).sampleRate = sampleRate;
  (globalThis as any).currentTime = 0;

  const filePath = resolve(__dirname, '../../public/audio-processor.js');
  const src = readFileSync(filePath, 'utf-8');

  // mock AudioWorkletProcessor: 给每个实例自动塞一个 port, 模拟 worklet runtime
  class MockProcessor {
    port: any;
    constructor() {
      this.port = {
        postMessage: () => {},
        onmessage: null,
      };
    }
  }
  (globalThis as any).AudioWorkletProcessor = MockProcessor;
  (globalThis as any).registerProcessor = vi.fn();

  // 用 Function 构造器代替 eval, 避免 strict mode 作用域问题
  const ctor = new Function(src + '\nreturn AudioProcessor;');
  return ctor();
}

// ----------------------------------------------------------------------------
// 测试 fixture
// ----------------------------------------------------------------------------
function makeInputs(samples: number[] | Float32Array): any {
  const arr = samples instanceof Float32Array ? samples : new Float32Array(samples);
  return [[arr]];
}

/**
 * 创建一个 capture postMessage + 触发 start 消息的 fixture.
 * worklet 构造时会绑 onmessage=null, 我们替换为自定义回调.
 */
function makeEngine(AudioProcessor: any, sampleRate: number) {
  const posted: any[] = [];
  const instance = new AudioProcessor();
  (instance as any).port.postMessage = (msg: any, _transfer?: any[]) => posted.push(msg);
  (instance as any).port.onmessage = (event: any) => {
    const { type } = event.data;
    if (type === 'start') {
      (instance as any).isRecording = true;
      (instance as any).bufferIndex = 0;
    } else if (type === 'stop') {
      (instance as any).isRecording = false;
      (instance as any).flushBuffer();
    }
  };
  // 触发 start
  (instance as any).port.onmessage({ data: { type: 'start' } });
  return { instance, posted };
}

describe('audio-processor (worklet) — Float32 -> Int16 转换', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('buffer 满时 flushBuffer 触发 postMessage (使用正确的 {type, pcm, underrunCount, needsResampling} 协议)', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const { instance, posted } = makeEngine(AudioProcessor, 16000);

    const samples = new Float32Array(2048);
    for (let i = 0; i < samples.length; i++) samples[i] = (i % 100) / 100 - 0.5;
    instance.process(makeInputs(samples), [], {});

    expect(posted.length).toBeGreaterThanOrEqual(1);
    const last = posted[posted.length - 1];
    expect(last).toHaveProperty('type', 'audio');
    expect(last).toHaveProperty('pcm');
    expect(last).toHaveProperty('underrunCount');
    expect(last).toHaveProperty('needsResampling');
    expect(last.pcm).toBeInstanceOf(ArrayBuffer);
    expect(last.pcm.byteLength).toBe(2048 * 2);
    expect(last.needsResampling).toBe(false);
  });

  it('Float32 -> Int16 边界: 0, 0.5, -0.5, 1, -1', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const posted: any[] = [];
    const instance = new AudioProcessor();
    (instance as any).port.postMessage = (m: any) => posted.push(m);
    // 手动注入 5 个样本并 flush
    (instance as any).buffer[0] = 0;
    (instance as any).buffer[1] = 0.5;
    (instance as any).buffer[2] = -0.5;
    (instance as any).buffer[3] = 1;
    (instance as any).buffer[4] = -1;
    (instance as any).bufferIndex = 5;
    (instance as any).flushBuffer();

    const pcm = new Int16Array(posted[0].pcm);
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBeGreaterThanOrEqual(16383);
    expect(pcm[1]).toBeLessThanOrEqual(16384);
    expect(pcm[2]).toBeGreaterThanOrEqual(-16384);
    expect(pcm[2]).toBeLessThanOrEqual(-16383);
    expect(pcm[3]).toBe(32767);
    expect(pcm[4]).toBe(-32768);
  });

  it('Float32 越界值裁剪: 1.5 -> 32767, -1.5 -> -32768', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const posted: any[] = [];
    const instance = new AudioProcessor();
    (instance as any).port.postMessage = (m: any) => posted.push(m);
    (instance as any).buffer[0] = 1.5;
    (instance as any).buffer[1] = -1.5;
    (instance as any).bufferIndex = 2;
    (instance as any).flushBuffer();
    const pcm = new Int16Array(posted[0].pcm);
    expect(pcm[0]).toBe(32767);
    expect(pcm[1]).toBe(-32768);
  });
});

describe('audio-processor (worklet) — 软重采样 (软降频)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('当 sourceSampleRate=48000, target=16000: needsResampling=true, ratio=3', () => {
    const AudioProcessor = loadWorkletClass(48000);
    const instance = new AudioProcessor();
    expect((instance as any).needsResampling).toBe(true);
    expect((instance as any).sourceSampleRate).toBe(48000);
    expect((instance as any).targetSampleRate).toBe(16000);
    expect((instance as any).resampleRatio).toBeCloseTo(3.0, 5);
  });

  it('resampleLinear: 48 个样本 -> 16 个 (48000/16000=3 倍降频)', () => {
    const AudioProcessor = loadWorkletClass(48000);
    const instance = new AudioProcessor();
    const input = new Float32Array(48);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((i / 48) * Math.PI * 2);
    const output: Float32Array = (instance as any).resampleLinear(input);
    expect(output.length).toBe(16);
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBeGreaterThanOrEqual(-1);
      expect(output[i]).toBeLessThanOrEqual(1);
    }
  });

  it('当 sourceSampleRate=16000: needsResampling=false, resampleRatio=1', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const instance = new AudioProcessor();
    expect((instance as any).needsResampling).toBe(false);
    expect((instance as any).resampleRatio).toBe(1);
  });

  it('process() 在 sourceSampleRate=48000 时, postMessage.needsResampling=true', () => {
    const AudioProcessor = loadWorkletClass(48000);
    const { instance, posted } = makeEngine(AudioProcessor, 48000);

    // 推 6144 个样本 -> 重采样后 ~2048 -> 满 buffer
    const samples = new Float32Array(6144);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.1;
    instance.process(makeInputs(samples), [], {});

    expect(posted.length).toBeGreaterThanOrEqual(1);
    const last = posted[posted.length - 1];
    expect(last.needsResampling).toBe(true);
    expect(last.pcm.byteLength).toBe(2048 * 2);
  });
});

describe('audio-processor (worklet) — underrun 检测', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('当 currentTime 跳变 > 50ms, underrunCount 增加', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const instance = new AudioProcessor();
    (globalThis as any).currentTime = 0;
    (instance as any).lastTickTime = 0;

    (instance as any).process(makeInputs(new Float32Array(128)), [], {});
    (globalThis as any).currentTime = 0.06;
    (instance as any).process(makeInputs(new Float32Array(128)), [], {});

    expect((instance as any).underrunCount).toBe(1);
  });

  it('正常 128 帧 ~ 8ms @ 16k: underrunCount 不增加', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const instance = new AudioProcessor();
    (globalThis as any).currentTime = 0;
    (instance as any).lastTickTime = 0;

    (instance as any).process(makeInputs(new Float32Array(128)), [], {});
    (globalThis as any).currentTime = 0.008;
    (instance as any).process(makeInputs(new Float32Array(128)), [], {});
    (globalThis as any).currentTime = 0.016;
    (instance as any).process(makeInputs(new Float32Array(128)), [], {});

    expect((instance as any).underrunCount).toBe(0);
  });

  it('postMessage 时 underrunCount 字段是累计值', () => {
    const AudioProcessor = loadWorkletClass(16000);
    const posted: any[] = [];
    const instance = new AudioProcessor();
    (instance as any).port.postMessage = (m: any) => posted.push(m);
    (instance as any).underrunCount = 5;
    (instance as any).isRecording = true;

    const samples = new Float32Array(2048);
    for (let i = 0; i < samples.length; i++) samples[i] = 0;
    instance.process(makeInputs(samples), [], {});

    expect(posted.length).toBe(1);
    expect(posted[0].underrunCount).toBe(5);
  });
});
