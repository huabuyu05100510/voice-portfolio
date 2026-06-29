/**
 * 类型定义
 */

// ============================================================================
// 转写结果
// ============================================================================
export interface Speaker {
  id: string;
  label: string;
  color?: string;
  /** 该说话人累计说话时长 (秒) — 火山引擎 final 帧计算 */
  duration_sec?: number;
  /** 该说话人累计字符数 — 火山引擎 final 帧统计 */
  chars?: number;
  /** 该说话人累计词数 */
  words?: number;
  /** 用户已手动改名 — sticky, 服务端后续推送同 id 不能覆盖 label */
  userEdited?: boolean;
}

export interface Utterance {
  text: string;
  start_time: number;
  end_time: number;
  speaker_id: string;
  words?: WordInfo[];
  /** 火山引擎 v3 full 协议: true = 该句已确定不再变化 (官方句子边界信号) */
  definite?: boolean;
}

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  fullText?: string;
  latency?: number;
  timestamp?: string;
  words?: WordInfo[];
  /** 当前句子的说话人 ID (e.g. 'spk0') — 火山引擎分角色新增 */
  speaker_id?: string;
  /** 本会话已出现的所有说话人 (前端按 palette 着色) */
  speakers?: Speaker[];
  /** final 才有: 完整分段 + 词级时间戳 (火山引擎 final 帧) */
  utterances?: Utterance[];
  /** F2: 服务端告知是否累积模式 (false = 一句一返, true = 全文累积) */
  isCumulative?: boolean;
  /** 火山引擎 v3 full 协议: 该卡片对应的 utterance start_time (稳定身份) */
  start_time?: number;
  /** 火山引擎 v3 full 协议: 该卡片对应的 utterance end_time */
  end_time?: number;
  /** 火山引擎 v3 full 协议: true = 该句已确定, reducer 不再用后续帧覆盖 */
  definite?: boolean;
}

export interface WordInfo {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** 火山引擎词级 speaker (可选) */
  speaker_id?: string;
}

// ============================================================================
// 会话指标
// ============================================================================
export interface SessionMetrics {
  audioBytes: number;
  transcriptionChars: number;
  chunksProcessed: number;
  avgLatency: number;
  totalLatencies?: number;
  startTime: number;
}

// ============================================================================
// 服务端指标
// ============================================================================
export interface ServerMetrics {
  connections: {
    total: number;
    active: number;
  };
  transcription: {
    charsTotal: number;
    errorsTotal: number;
  };
  audio: {
    bytesReceived: number;
    chunksProcessed: number;
  };
  system: {
    cpuPercent: number;
    memoryMb: number;
  };
  uptimeSeconds: number;
}

// ============================================================================
// 状态枚举
// ============================================================================
export type AppStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'paused'
  | 'error'
  | 'completed';

export type WebSocketState =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';

// ============================================================================
// WebSocket 消息类型
// ============================================================================
export interface WSMessage {
  event: string;
  session_id?: string;
  text?: string;
  is_final?: boolean;
  full_text?: string;
  latency_ms?: number;
  timestamp?: string;
  metrics?: SessionMetrics;
  stats?: TranscriptionStats;
}

export interface TranscriptionStats {
  total_chars: number;
  total_audio_bytes: number;
  total_chunks: number;
  avg_latency_ms: number;
  duration_seconds: number;
}

// ============================================================================
// 音频 Profile (模块 C: 纯净模式 / 会议模式)
// ============================================================================
export type AudioProfileId = 'pure' | 'meeting';

export interface AudioProfile {
  id: AudioProfileId;
  label: string;
  description: string;
  constraints: MediaTrackConstraints;
}

export const AUDIO_PROFILES: Record<AudioProfileId, AudioProfile> = {
  pure: {
    id: 'pure',
    label: '纯净模式',
    description: '关闭 NS/AEC/AGC，原始 PCM 喂 ASR (高精度)',
    constraints: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  },
  meeting: {
    id: 'meeting',
    label: '会议模式',
    description: '开启 NS/AEC/AGC，适合远场 / 嘈杂环境',
    constraints: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  },
};

// ============================================================================
// Realtime Voice (Sprint 13 — 端到端实时语音交互)
// ============================================================================
export type Role = 'user' | 'assistant';

export interface ConversationMessage {
  /** 唯一 id (user: user-<ts>, assistant: response_id from server) */
  id: string;
  role: Role;
  /** 文本内容 (assistant 可能中途被截断, 见 interrupted) */
  text: string;
  /** 服务端 / 客户端时间戳 (performance.now()) */
  timestamp: number;
  /** 用户语音是否还在识别中 (interim) */
  interim?: boolean;
  /** 助理消息是否被用户打断 */
  interrupted?: boolean;
  /** 累计接收的 AI 音频字节数 */
  audioBytes?: number;
}

/** 引擎运行时指标 (模块 C: PerfMonitor audio.* 指标源) */
export interface AudioEngineMetrics {
  baseLatency: number;       // AudioContext.baseLatency (s)
  outputLatency: number;     // AudioContext.outputLatency (s), 不支持时为 0
  underrunCount: number;     // Worklet 检测到的 underrun 累计
  requiresResampling: number | null; // 采样率不匹配时记下 actual sr, 否则 null
}