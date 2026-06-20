/**
 * 类型定义
 */

// ============================================================================
// 转写结果
// ============================================================================
export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  fullText?: string;
  latency?: number;
  timestamp?: string;
  words?: WordInfo[];
}

export interface WordInfo {
  word: string;
  start: number;
  end: number;
  confidence: number;
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