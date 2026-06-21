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
}

export interface Utterance {
  text: string;
  start_time: number;
  end_time: number;
  speaker_id: string;
  words?: WordInfo[];
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