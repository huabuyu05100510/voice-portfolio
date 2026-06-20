/**
 * useRecorder
 * -----------
 * 封装 AudioCaptureEngine + 波形可视化, 暴露简洁的 start/stop 接口。
 *
 * 设计要点:
 * - 内部维护 engine ref + waveform visualizer ref (命令式资源)
 * - onAudioData 用 ref 存储最新回调, 避免 useCallback stale closure
 * - 暴露 MediaStream 给上层 Visualizer (AnalyserNode 直连)
 *
 * Author: Claude Opus 4.8
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioCaptureEngine } from '../AudioCapture';
import { WaveformVisualizer } from '../WaveformVisualizer';

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'error';

export interface UseRecorderOptions {
  /** 音频数据块回调 (每 0.25s 一个 Int16Array) */
  onAudioData?: (data: Int16Array) => void;
}

export interface UseRecorderReturn {
  status: RecorderStatus;
  error: string | null;
  /** Mic MediaStream — 给 Visualizer AnalyserNode 用 */
  mediaStream: MediaStream | null;
  /** 最近一块音频 (fallback 渲染, 无 MediaStream 时用) */
  latestAudio: Int16Array | null;
  /** 给 App 持有的 canvas ref 喂给 wave visualizer */
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  start: () => Promise<void>;
  stop: () => void;
}

export const useRecorder = (
  options: UseRecorderOptions = {},
): UseRecorderReturn => {
  const { onAudioData } = options;
  const onAudioDataRef = useRef(onAudioData);
  onAudioDataRef.current = onAudioData;

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [latestAudio, setLatestAudio] = useState<Int16Array | null>(null);

  const engineRef = useRef<AudioCaptureEngine | null>(null);
  const waveRef = useRef<WaveformVisualizer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const start = useCallback(async () => {
    try {
      setStatus('starting');
      setError(null);
      const engine = new AudioCaptureEngine();
      await engine.initialize();
      engineRef.current = engine;

      engine.onAudioData((data) => {
        // 推到 wave visualizer
        waveRef.current?.update(data);
        setLatestAudio(data);
        // 透传给外部 reducer
        onAudioDataRef.current?.(data);
      });

      const stream = engine.getMediaStream();
      if (stream) setMediaStream(stream);

      // 波形: 若 canvas 已 bind, 启动 visualizer
      if (canvasRef.current && !waveRef.current) {
        waveRef.current = new WaveformVisualizer(canvasRef.current);
        waveRef.current.start();
      }

      engine.start();
      setStatus('recording');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '录音启动失败';
      setError(msg);
      setStatus('error');
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current?.destroy();
    engineRef.current = null;

    waveRef.current?.stop();
    waveRef.current = null;
    canvasRef.current = null;

    setMediaStream(null);
    setLatestAudio(null);
    setStatus('idle');
  }, []);

  const bindWaveformCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    // 如果 canvas 重新绑定, 而正在录音, 重建 visualizer
    if (el && engineRef.current && !waveRef.current) {
      waveRef.current = new WaveformVisualizer(el);
      waveRef.current.start();
    }
  }, []);

  // 卸载时释放资源
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
      waveRef.current?.stop();
      waveRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    mediaStream,
    latestAudio,
    bindWaveformCanvas,
    start,
    stop,
  };
};