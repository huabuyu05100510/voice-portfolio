/**
 * 回归测试: streamPcmToServer 必须把整段样本切完, 不能因为闭包陷阱只发 1 个 chunk
 * 修复前: 在 playSampleAudio 里用闭包里的 state.status 校验, setState 没生效, 循环只跑 1 次
 * 修复后: 抽离为纯函数 + cancelled 信号位
 */
import { describe, it, expect, vi } from 'vitest';
import { streamPcmToServer } from '../samplePlayer';

function makeMockWs() {
  const sends: ArrayBuffer[] = [];
  return {
    sendAudio: vi.fn((buf: ArrayBuffer) => { sends.push(buf); }),
    sends,
  };
}

describe('streamPcmToServer', () => {
  it('6 秒 16kHz 样本应切 24 块 (4 samples 块大小 = 0.25s @ 16kHz)', async () => {
    const ws = makeMockWs();
    const samples = new Int16Array(16000 * 6); // 6 秒
    const result = await streamPcmToServer(samples, ws as any, { delayMs: 0 });
    expect(result.chunksSent).toBe(24);
    expect(ws.sendAudio).toHaveBeenCalledTimes(24);
    expect(result.bytesSent).toBe(24 * 4000 * 2);
  });

  it('回归: 不要在第一个 chunk 之后 break (闭包陷阱)', async () => {
    // 这个测试是修复前的 bug 回归 — 老代码会因 state.status 闭包问题只发 1 个 chunk
    const ws = makeMockWs();
    const samples = new Int16Array(16000 * 2); // 2 秒 -> 8 chunks
    await streamPcmToServer(samples, ws as any, { delayMs: 0 });
    expect(ws.sendAudio.mock.calls.length).toBe(8);
    expect(ws.sendAudio.mock.calls.length).toBeGreaterThan(1);
  });

  it('尊重 signal.cancelled', async () => {
    const ws = makeMockWs();
    // 用较长样本 + 20ms 间隔, 保证能中途取消
    const samples = new Int16Array(16000 * 6); // 6 秒
    const signal = { cancelled: false };
    const promise = streamPcmToServer(samples, ws as any, { delayMs: 20, signal });
    // 等 50ms 后取消 (期间已发 ~2 个 chunk)
    await new Promise(r => setTimeout(r, 50));
    signal.cancelled = true;
    await promise;
    const called = ws.sendAudio.mock.calls.length;
    expect(called).toBeGreaterThan(0);
    expect(called).toBeLessThan(24);  // 不发完 24 个
  });

  it('每次 sendAudio 收到的是独立的 ArrayBuffer, 大小为 8000 字节 (4000 Int16)', async () => {
    const ws = makeMockWs();
    const samples = new Int16Array(16000 * 1); // 1s -> 4 chunks
    await streamPcmToServer(samples, ws as any, { delayMs: 0 });
    for (const buf of ws.sends) {
      expect(buf).toBeInstanceOf(ArrayBuffer);
      expect(buf.byteLength).toBe(8000);
    }
  });

  it('onChunk 回调被每个块触发, 提供正确的 index', async () => {
    const ws = makeMockWs();
    const onChunk = vi.fn();
    const samples = new Int16Array(16000 * 1); // 4 chunks
    await streamPcmToServer(samples, ws as any, { delayMs: 0, onChunk });
    expect(onChunk).toHaveBeenCalledTimes(4);
    expect(onChunk.mock.calls.map(c => c[1])).toEqual([0, 1, 2, 3]);
  });

  it('空样本不发任何 chunk', async () => {
    const ws = makeMockWs();
    const result = await streamPcmToServer(new Int16Array(0), ws as any, { delayMs: 0 });
    expect(result.chunksSent).toBe(0);
    expect(ws.sendAudio).not.toHaveBeenCalled();
  });

  it('wsClient=null 时不抛错, 只调用 onChunk', async () => {
    const onChunk = vi.fn();
    const samples = new Int16Array(16000 * 1);
    const result = await streamPcmToServer(samples, null, { delayMs: 0, onChunk });
    expect(result.chunksSent).toBe(4);
    expect(onChunk).toHaveBeenCalledTimes(4);
  });
});
