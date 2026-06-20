/**
 * useSampleAudio — 拉取 /sample-cn.wav 并走流式管线, 不需要麦克风
 * Author: Claude Opus 4.8
 */
import { useCallback } from 'react';
import { streamPcmToServer } from '../samplePlayer';
import type { WebSocketClient } from '../WebSocketClient';
import type { UseTranscriptionReturn } from './useTranscription';
import type { UseDebugLogReturn } from './useDebugLog';
import type { AppStatus } from '../types';

export interface UseSampleAudioReturn {
  play: (deps: {
    wsClient: WebSocketClient | null;
    tr: UseTranscriptionReturn;
    dbg: UseDebugLogReturn;
    setStatus: (s: AppStatus) => void;
  }) => Promise<void>;
}

export const useSampleAudio = (): UseSampleAudioReturn => {
  const play = useCallback(async ({ wsClient, tr, dbg, setStatus }: {
    wsClient: WebSocketClient | null;
    tr: UseTranscriptionReturn;
    dbg: UseDebugLogReturn;
    setStatus: (s: AppStatus) => void;
  }) => {
    try {
      dbg.push('CLICK', '测试按钮被点击');
      const res = await fetch('/sample-cn.wav');
      if (!res.ok) throw new Error(`fetch sample failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      const samples = new Int16Array(buf.byteLength > 44 ? buf.slice(44) : buf);
      dbg.push('DECODE', `Int16Array 长度 ${samples.length}`);
      wsClient?.startRecording();
      tr.reset(Date.now());
      dbg.push('WS', 'emit start_recording');
      setStatus('recording');
      const r = await streamPcmToServer(samples, wsClient, {
        chunkSize: 4000, delayMs: 50,
        onChunk: (c) => tr.recordAudioChunk(c.byteLength),
      });
      dbg.push('STREAM_DONE', `发了 ${r.chunksSent} 个 chunk`);
      wsClient?.stopRecording();
      setStatus('completed');
    } catch (err) {
      dbg.push('ERROR', err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);
  return { play };
};