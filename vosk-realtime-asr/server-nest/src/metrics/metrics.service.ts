/**
 * MetricsService — prom-client 指标容器
 * 对应 Python 端的 server/metrics.py MetricsCollector
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // 连接
  readonly connectionsTotal = new Counter({
    name: 'connections_total',
    help: 'Total incoming client connections',
    labelNames: ['client_type'],
    registers: [this.registry],
  });
  readonly connectionsActive = new Gauge({
    name: 'connections_active',
    help: 'Currently active client connections',
    registers: [this.registry],
  });

  // ASR
  readonly transcriptionResultsTotal = new Counter({
    name: 'transcription_results_total',
    help: 'Transcription results emitted',
    labelNames: ['is_final'],
    registers: [this.registry],
  });
  readonly transcriptionCharsTotal = new Counter({
    name: 'transcription_chars_total',
    help: 'Characters transcribed',
    labelNames: ['language'],
    registers: [this.registry],
  });
  readonly transcriptionLatency = new Histogram({
    name: 'transcription_latency_ms',
    help: 'ASR end-to-end latency',
    buckets: [50, 100, 200, 500, 1000, 2000, 5000],
    registers: [this.registry],
  });
  readonly audioBytesTotal = new Counter({
    name: 'audio_bytes_total',
    help: 'Audio bytes received from clients',
    registers: [this.registry],
  });

  // TTS
  readonly ttsRequestsTotal = new Counter({
    name: 'tts_requests_total',
    help: 'TTS HTTP calls',
    labelNames: ['status'],
    registers: [this.registry],
  });
  readonly ttsLatency = new Histogram({
    name: 'tts_latency_ms',
    help: 'TTS synthesis latency',
    buckets: [100, 300, 1000, 3000, 10000],
    registers: [this.registry],
  });
  readonly ttsAudioBytesTotal = new Counter({
    name: 'tts_audio_bytes_total',
    help: 'TTS audio bytes synthesized',
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  /** Prometheus 文本暴露 */
  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
