/**
 * useTtsPlayback — TTS 音频顺序播放队列
 *
 * 收到 tts_audio 事件 → 推入队列 → 用单个 <audio> 元素 onended 触发下一句
 * 保证: 一句播完再播下一句, 不重叠. 静音/取消支持.
 *
 * 纯前端 hook, 不直接耦合 WebSocketClient — consumer 把 onTtsAudio 注册到 ws 即可.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { TtsAudioPayload } from '../WebSocketClient';

export interface TtsPlaybackState {
  /** 是否启用 (false = 收到也不播) */
  enabled: boolean;
  /** 当前正在播放的源文本关联 utterance_start (供 UI 高亮) */
  currentUtteranceStart: number | null;
  /** 队列长度 */
  queueLength: number;
  /** 切换 enabled */
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  /** 跳过当前正在播的, 立即播下一句 */
  skip: () => void;
  /** 清空队列 */
  clear: () => void;
  /** ws 事件到达时调用 */
  enqueue: (p: TtsAudioPayload) => void;
}

export const useTtsPlayback = (initialEnabled = true): TtsPlaybackState => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<TtsAudioPayload[]>([]);
  const enabledRef = useRef<boolean>(initialEnabled);
  const playingRef = useRef<boolean>(false);

  const [enabled, setEnabledState] = useState<boolean>(initialEnabled);
  const [currentUtteranceStart, setCurrentUtteranceStart] = useState<
    number | null
  >(null);
  const [queueLength, setQueueLength] = useState<number>(0);

  // 保持 ref 与 state 同步 (ref 给异步回调读, state 给 rerender)
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // 初始化 audio 元素
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener('ended', () => {
      playingRef.current = false;
      setCurrentUtteranceStart(null);
      drain();
    });
    audio.addEventListener('error', () => {
      playingRef.current = false;
      setCurrentUtteranceStart(null);
      drain();
    });
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drain = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || playingRef.current) return;
    if (!enabledRef.current) {
      // 静音: 丢弃队列 (避免取消静音后突然堆叠)
      queueRef.current.length = 0;
      setQueueLength(0);
      return;
    }
    const next = queueRef.current.shift();
    if (!next) {
      setQueueLength(0);
      return;
    }
    setQueueLength(queueRef.current.length);
    playingRef.current = true;
    setCurrentUtteranceStart(next.utterance_start ?? null);
    const blob = b64ToBlob(next.audio_base64, 'audio/mpeg');
    const url = URL.createObjectURL(blob);
    audio.src = url;
    audio.play().catch((e) => {
      // 自动播放被浏览器拦截 (用户没交互过页面)
      console.warn('[TtsPlayer] play blocked:', e);
      playingRef.current = false;
      setCurrentUtteranceStart(null);
      // 失败后清理 url, 等下一段
      URL.revokeObjectURL(url);
      setTimeout(drain, 0);
    });
    audio.onpause = () => {
      // play() 失败或自然 ended 后会触发; 只在 src 还在时清理 url
      // (ended handler 已经处理, 这里只兜底)
    };
  }, []);

  const enqueue = useCallback(
    (p: TtsAudioPayload) => {
      if (!enabledRef.current) return; // 静音状态直接丢
      queueRef.current.push(p);
      setQueueLength(queueRef.current.length);
      drain();
    },
    [drain],
  );

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      enabledRef.current = v;
      if (!v) {
        // 立即停止当前播放
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        playingRef.current = false;
        queueRef.current.length = 0;
        setQueueLength(0);
        setCurrentUtteranceStart(null);
      } else {
        // 开启: 尝试立刻开始 (如果队列里有东西)
        setTimeout(drain, 0);
      }
    },
    [drain],
  );

  const toggle = useCallback(() => {
    setEnabled(!enabledRef.current);
  }, [setEnabled]);

  const skip = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    playingRef.current = false;
    setCurrentUtteranceStart(null);
    setTimeout(drain, 0);
  }, [drain]);

  const clear = useCallback(() => {
    queueRef.current.length = 0;
    setQueueLength(0);
  }, []);

  return {
    enabled,
    currentUtteranceStart,
    queueLength,
    toggle,
    setEnabled,
    skip,
    clear,
    enqueue,
  };
};

/** base64 → Blob (避免大字符串 base64 解码到 dataURL 卡 UI) */
function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
