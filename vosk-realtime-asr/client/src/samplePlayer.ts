/**
 * samplePlayer - 纯函数, 把 PCM 样本切成 0.25s 块通过 wsClient 推到 Vosk
 * 抽离自 App.playSampleAudio, 便于单元测试
 */
import type { WebSocketClient } from './WebSocketClient';

export interface StreamOptions {
  chunkSize?: number;   // 每块样本数 (默认 4000, 16kHz 下 0.25s)
  delayMs?: number;     // 块间延时 (默认 50ms)
  onChunk?: (chunk: Int16Array, index: number) => void;
  signal?: { cancelled: boolean };  // 外部中断信号
}

export async function streamPcmToServer(
  samples: Int16Array,
  wsClient: WebSocketClient | null,
  opts: StreamOptions = {}
): Promise<{ chunksSent: number; bytesSent: number }> {
  const { chunkSize = 4000, delayMs = 50, onChunk, signal } = opts;
  let chunksSent = 0;
  let bytesSent = 0;

  for (let i = 0; i < samples.length; i += chunkSize) {
    if (signal?.cancelled) break;
    const chunk = samples.subarray(i, i + chunkSize);
    if (onChunk) onChunk(new Int16Array(chunk), chunksSent);

    if (wsClient) {
      // 修复: 直接发 ArrayBuffer, 避免 SharedArrayBuffer 类型冲突
      const sendBuf = new ArrayBuffer(chunk.byteLength);
      new Int16Array(sendBuf).set(chunk);
      wsClient.sendAudio(sendBuf);
    }

    chunksSent++;
    bytesSent += chunk.byteLength;
    if (delayMs > 0) await sleep(delayMs);
  }
  return { chunksSent, bytesSent };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
