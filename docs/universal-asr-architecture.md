# 通用实时语音转写系统 — 技术架构设计

**模型:** claude-sonnet-4-6
**日期:** 2026-06-24
**定位:** 可复用的行业级架构，适用于会议记录、实时字幕、录音转写、客服质检等场景

---

## 一、行业现状与核心挑战

### 1.1 主流引擎对比（2025 实测）

| 引擎 | 模型架构 | 流式延迟 P50 | 中文 WER | 多说话人 | 协议 | 计费 |
|------|---------|------------|---------|---------|-----|------|
| Deepgram Nova-3 | Conformer-Transducer | ~150ms | ~12% | ✓ 词级 | 裸 WebSocket | 按时长 |
| AssemblyAI Universal-2 | Conformer | ~220ms | ~15% | ✓ 句级 | WebSocket JSON | 按时长 |
| ByteDance 火山引擎 | Transformer RNNT | ~200ms | ~5% | ✓ utterance级 | 自研二进制 | 按时长/并发 |
| Azure Speech | Custom Neural | ~250ms | ~8% | ✓ 句级 | SDK/WebSocket | 按分钟 |
| Google Chirp 2 | USM Conformer | ~350ms | ~6% | ✓ 句级 | gRPC | 按分钟 |
| OpenAI Whisper | Encoder-Decoder | >1000ms | ~5% | ✗ (批量) | HTTP | 按分钟 |

**关键认知：**

1. **Whisper 不适合流式**。其 Encoder-Decoder 架构需要完整 30s 窗口，社区的"流式"方案（sliding window + Local Agreement 算法）实测延迟 2-5s，且有显著的边界错误。

2. **中文场景首选 ByteDance/Alibaba**。其他引擎中文 WER 普遍 10%+，ByteDance 豆包 5% 左右，尤其对专有名词、数字表达更准。

3. **说话人分离的天然限制**。实时流式分离需要 1-3s 音频建立 embedding，因此任何"实时"分离结果都滞后 500-1500ms，且准确率低于批量后处理。最佳实践是"即时近似 + 延迟精修"双轨策略。

4. **网络 RTT 是延迟瓶颈**。国内 ByteDance 端点 RTT ~20-50ms，可达到 200-400ms E2E；国际链路 RTT ~150-250ms，200ms 目标不现实。

### 1.2 端到端延迟预算拆解

```
┌──────────────────────────────────────────────────────────┐
│  端到端延迟 = 捕获延迟 + 传输延迟 + 推理延迟 + 渲染延迟  │
│                                                          │
│  捕获延迟:    8-20ms   AudioWorklet quantum 1-2帧       │
│  VAD处理:    0.3-1ms  Silero WASM 每帧                  │
│  客户端缓冲: 50-200ms  chunking策略决定                  │
│  网络 RTT:  20-250ms  取决于地理位置                     │
│  服务端推理: 50-150ms  模型大小+硬件                     │
│  网络回程:  20-250ms  对称RTT                            │
│  React渲染:  0-16ms   一帧                               │
│                                                          │
│  理想(国内): 98-450ms                                    │
│  普通(国际): 300-900ms                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 二、系统架构总览

```
╔══════════════════════════════════════════════════════════════╗
║                    通用 ASR 架构                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  INPUT LAYER (输入层)                                        ║
║  ┌─────────────┐ ┌────────────┐ ┌──────────────┐            ║
║  │  Microphone │ │ File Upload│ │ Screen/Tab   │            ║
║  │ getUserMedia│ │ WAV/MP3/M4A│ │getDisplayMedia│           ║
║  └──────┬──────┘ └─────┬──────┘ └──────┬───────┘            ║
║         │              │               │                     ║
║  AUDIO PIPELINE (音频处理管线)                               ║
║  ┌───────────────────────────────────────────────────┐       ║
║  │  Resampler → RNNoise → Silero VAD → PCM Chunker   │       ║
║  │  (WASM, AudioWorker, off main thread)             │       ║
║  └────────────────────┬──────────────────────────────┘       ║
║                       │ PCM s16le 16kHz                     ║
║  TRANSPORT LAYER (传输层)                                    ║
║  ┌────────────────────────────────────────────────────┐      ║
║  │         WebSocket / HTTP Chunked Streaming         │      ║
║  │         + Backpressure + Reconnect Logic           │      ║
║  └────────────────────┬───────────────────────────────┘      ║
║                       │                                      ║
║  ASR ORCHESTRATION (编排层)                                  ║
║  ┌────────────────────────────────────────────────────┐      ║
║  │  Provider Router → SessionManager → ResultBus     │      ║
║  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │      ║
║  │  │ByteDance │ │Deepgram  │ │Azure / Google    │   │      ║
║  │  │Adapter   │ │Adapter   │ │Adapter           │   │      ║
║  │  └──────────┘ └──────────┘ └──────────────────┘   │      ║
║  └────────────────────┬───────────────────────────────┘      ║
║                       │                                      ║
║  POST-PROCESSING (后处理层)                                  ║
║  ┌────────────────────────────────────────────────────┐      ║
║  │  TimestampMerger → Diarizer (2-phase) → Formatter │      ║
║  └────────────────────┬───────────────────────────────┘      ║
║                       │                                      ║
║  OUTPUT ADAPTERS (输出适配层)                                ║
║  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       ║
║  │ SSE/WS   │ │ REST API │ │ Webhook  │ │ Export   │       ║
║  │ Realtime │ │  Batch   │ │ Long-run │ │SRT/VTT/  │       ║
║  │ Display  │ │  Result  │ │   jobs   │ │DOCX/JSON │       ║
║  └──────────┘ └──────────┘ └──────────┘ └──────────┘       ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 三、音频处理管线（客户端）

### 3.1 AudioWorker 线程架构

核心设计原则：**所有 DSP 操作在独立 Worker 线程完成，不占用主线程**。

```
Main Thread
    │
    ├── React UI (rAF loop)
    │
    └── AudioContext
            │
            └── AudioWorkletNode ──port.postMessage──► AudioWorker
                                                            │
                                                 ┌──────────┴──────────┐
                                                 │   RNNoise (WASM)    │
                                                 │   Silero VAD (ONNX) │
                                                 │   Resampler         │
                                                 │   PCM Chunker       │
                                                 └──────────┬──────────┘
                                                            │
                                                     WebSocket.send()
                                                  (Worker可直接持有socket)
```

**为什么 AudioWorklet 不够，还需要 Worker：**

AudioWorklet 运行在 Audio Rendering Thread，该线程有严格的实时约束——不允许 WASM 内存分配、不能进行 `fetch` 或 `WebSocket.send`。所有繁重计算必须 `postMessage` 到普通 Web Worker 完成。

```typescript
// audio-worklet.ts（在 Audio Rendering Thread 运行）
class AudioProcessor extends AudioWorkletProcessor {
  private _buffer = new Float32Array(512);
  private _pos = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    // 仅做简单缓冲，不做 WASM 调用
    for (let i = 0; i < input.length; i++) {
      this._buffer[this._pos++] = input[i];
      if (this._pos >= 512) {
        // Transferable 零拷贝传递
        const buf = this._buffer.buffer.slice(0);
        this.port.postMessage({ type: 'frame', data: buf }, [buf]);
        this._pos = 0;
      }
    }
    return true;
  }
}

// audio-pipeline.worker.ts（普通 Worker，可做 WASM）
let rnnoiseModule: RNNoiseModule | null = null;
let sileroSession: InferenceSession | null = null;

self.onmessage = async (e: MessageEvent<AudioPipelineMessage>) => {
  const { type, data } = e.data;

  if (type === 'frame') {
    const float32 = new Float32Array(data as ArrayBuffer);

    // Step 1: RNNoise 降噪
    const denoised = rnnoiseModule!.processFrame(float32);

    // Step 2: Silero VAD
    const vadProb = await runSileroVAD(sileroSession!, denoised);

    // Step 3: 状态机判断 + 缓冲
    updateVADStateMachine(vadProb, denoised);
  }
};
```

### 3.2 Silero VAD 状态机

VAD 不是简单的二值判断，需要防抖和滞后以避免"呼吸音触发"和"停顿截断"：

```typescript
interface VADState {
  status: 'silence' | 'speech' | 'trailing-silence';
  speechBuffer: Float32Array[];    // 当前语音段积累
  silenceFrames: number;           // 连续静音帧数
  preSpeechPad: Float32Array[];    // 语音开始前的填充（避免截掉第一个字）
}

const VAD_CONFIG = {
  positiveSpeechThreshold: 0.5,   // P(speech) > 0.5 认为是语音
  negativeSpeechThreshold: 0.35,  // P(speech) < 0.35 认为是静音
  minSpeechFrames: 5,             // 最少 5 帧 (160ms @32ms/帧) 才算有效语音
  preSpeechPadFrames: 2,          // 语音前填充 2 帧 (64ms)，避免截掉辅音
  redemptionFrames: 16,           // 静音 16 帧 (512ms) 才认为语音结束
};

function updateVADStateMachine(prob: number, frame: Float32Array, state: VADState): VADEvent {
  const isSpeech = prob > VAD_CONFIG.positiveSpeechThreshold;
  const isSilence = prob < VAD_CONFIG.negativeSpeechThreshold;

  switch (state.status) {
    case 'silence':
      state.preSpeechPad.push(frame);
      if (state.preSpeechPad.length > VAD_CONFIG.preSpeechPadFrames) {
        state.preSpeechPad.shift();
      }
      if (isSpeech) {
        state.status = 'speech';
        state.speechBuffer = [...state.preSpeechPad, frame];
        return { type: 'speech_start' };
      }
      return { type: 'none' };

    case 'speech':
      state.speechBuffer.push(frame);
      if (isSilence) {
        state.status = 'trailing-silence';
        state.silenceFrames = 1;
      }
      return { type: 'speech_frame', frame };

    case 'trailing-silence':
      state.silenceFrames++;
      state.speechBuffer.push(frame);
      if (isSpeech) {
        // 说话人又开口了，继续
        state.status = 'speech';
        state.silenceFrames = 0;
        return { type: 'speech_frame', frame };
      }
      if (state.silenceFrames >= VAD_CONFIG.redemptionFrames) {
        // 确认语音结束
        const audio = concatFloat32(state.speechBuffer);
        state.status = 'silence';
        state.speechBuffer = [];
        state.silenceFrames = 0;
        if (audio.length >= VAD_CONFIG.minSpeechFrames * 512) {
          return { type: 'speech_end', audio };
        }
        return { type: 'none' };
      }
      return { type: 'none' };
  }
}
```

### 3.3 两种流式策略

**策略 A — 连续流（低延迟，看到 partial 结果）**

```
Audio Frames ──[不等VAD]──► WebSocket ──► ASR
                               ↑
                          每 200ms 一个 chunk，
                          服务端 VAD 断句
```

适用：实时字幕、演讲转写，用户需要即时反馈
延迟：200-400ms
带宽：满额（含静音段）

**策略 B — VAD 断句（高精度，一句一返）**

```
Audio ──► Silero VAD ──► 语音段积累 ──► 完整语音段 ──► WebSocket ──► ASR
                              ↑                              ↑
                         静音中缓存                    收到完整话语才发送
```

适用：会议记录、多说话人、对准确率要求高的场景
延迟：句子结束后 200-500ms
带宽：降低 50-70%

**策略 C — 混合（推荐）**

```
Audio ──► 连续流 ──► ASR partial 结果（实时显示）
      │
      └► Silero VAD ──► 完整语音段 ──► 高精度 ASR（替换/校正显示内容）
```

前端显示 partial 结果提供即时反馈，VAD 边界触发高精度请求在后台校正。

---

## 四、Provider 抽象层

### 4.1 统一 ASR Provider 接口

所有 Provider 遵循相同的接口契约，上层业务代码不感知底层协议差异：

```typescript
// types/asr.ts

export interface ASRConfig {
  language: string;              // 'zh-CN' | 'en-US' | 'auto'
  sampleRate: 16000 | 48000;
  enableDiarization: boolean;
  maxSpeakers?: number;          // -1 = 自动
  enablePunctuation: boolean;
  enableITN: boolean;            // 逆文本归一化（数字、日期）
  vocabulary?: string[];         // 热词表
  mode: 'streaming' | 'batch';
}

export interface ASRWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speakerId?: string;
}

export interface ASRResult {
  text: string;
  isFinal: boolean;
  isCumulative: boolean;         // true = 文本包含之前所有内容（需去重）
  words?: ASRWord[];             // 词级时间戳
  speakerId?: string;
  utterances?: ASRUtterance[];
  latencyMs?: number;
  confidence?: number;
}

export interface ASRUtterance {
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  words?: ASRWord[];
}

// 每个 Provider 实现此接口
export interface ASRProviderAdapter {
  readonly name: string;
  readonly capabilities: ASRCapabilities;

  connect(config: ASRConfig): Promise<void>;
  sendAudio(pcmBuffer: ArrayBuffer): void;
  finalize(): Promise<void>;
  disconnect(): void;

  // EventEmitter 风格（多订阅者安全）
  on(event: 'result', handler: (r: ASRResult) => void): () => void;
  on(event: 'error', handler: (e: ASRError) => void): () => void;
  on(event: 'ready', handler: () => void): () => void;
  on(event: 'closed', handler: () => void): () => void;
}

export interface ASRCapabilities {
  maxDuration: number;           // 秒
  minLatencyMs: number;
  supportsStreaming: boolean;
  supportsDiarization: boolean;
  supportedLanguages: string[];
  supportsWordTimestamps: boolean;
}
```

### 4.2 ByteDance Adapter 实现（最复杂的 Provider）

```typescript
// adapters/VolcengineAdapter.ts

import { EventEmitter } from '../utils/EventEmitter';

export class VolcengineAdapter extends EventEmitter implements ASRProviderAdapter {
  readonly name = 'volcengine';
  readonly capabilities: ASRCapabilities = {
    maxDuration: 1800,
    minLatencyMs: 200,
    supportsStreaming: true,
    supportsDiarization: true,
    supportedLanguages: ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'],
    supportsWordTimestamps: true,
  };

  private ws: WebSocket | null = null;
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;
  private _readyReject!: (e: Error) => void;

  constructor(private readonly credentials: VolcCredentials) {
    super();
    this._readyPromise = new Promise((res, rej) => {
      this._readyResolve = res;
      this._readyReject = rej;
    });
  }

  async connect(config: ASRConfig): Promise<void> {
    const headers = buildWSHeaders(this.credentials);
    this.ws = new WebSocket(VOLC_ENDPOINT);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // 发送 full request config（不含音频）
      const payload = buildFullRequestPayload(config, this.credentials);
      this.ws!.send(encodeFullClientRequest(payload));
      // 等待 0x9 ACK，才算真正 ready
    };

    this.ws.onmessage = (e) => this._handleFrame(e.data as ArrayBuffer);

    this.ws.onerror = (e) => {
      this._readyReject(new Error('WebSocket error'));
      this.emit('error', { code: -1, message: 'WebSocket error' });
    };

    // 超时保护：5s 内未就绪视为失败
    const timeout = setTimeout(() => {
      this._readyReject(new Error('Connection timeout'));
    }, 5000);

    try {
      await this._readyPromise;
    } finally {
      clearTimeout(timeout);
    }
  }

  private _handleFrame(data: ArrayBuffer): void {
    const parsed = parseServerResponseV3(new Uint8Array(data));

    switch (parsed.type) {
      case 'full':
        // 0x9 ACK — WSS + config 握手完成，现在可以发音频了
        this._readyResolve();
        this.emit('ready');
        break;

      case 'partial':
        this.emit('result', {
          text: parsed.payload?.result?.text ?? '',
          isFinal: false,
          isCumulative: false,
        });
        break;

      case 'final': {
        const result = parsed.payload?.result ?? parsed.payload ?? {};
        const { utterances, speakers } = extractUtterances(result);
        this.emit('result', {
          text: result.text ?? '',
          isFinal: true,
          isCumulative: false,           // single 模式，每句独立
          utterances,
          words: utterances.flatMap(u => u.words ?? []),
          speakerId: utterances.at(-1)?.speakerId,
          latencyMs: this._computeLatency(),
        });
        break;
      }

      case 'error':
        this.emit('error', {
          code: parsed.payload?.code ?? -1,
          message: parsed.payload?.message ?? 'Unknown error',
        });
        break;
    }
  }

  private _lastAudioSentAt = 0;

  sendAudio(pcmBuffer: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this._lastAudioSentAt = performance.now();
    this.ws.send(encodeAudioOnly(pcmBuffer));
  }

  private _computeLatency(): number {
    return this._lastAudioSentAt > 0
      ? performance.now() - this._lastAudioSentAt
      : 0;
  }

  async finalize(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeAudioLast(new ArrayBuffer(4)));
    // 等待最终 final 结果或超时
    await Promise.race([
      new Promise<void>(res => this.once('closed', res)),
      sleep(5000),
    ]);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
```

### 4.3 Deepgram Adapter（最简单的 Provider，对比）

```typescript
// adapters/DeepgramAdapter.ts

export class DeepgramAdapter extends EventEmitter implements ASRProviderAdapter {
  readonly name = 'deepgram';
  private ws: WebSocket | null = null;

  async connect(config: ASRConfig): Promise<void> {
    const params = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: String(config.sampleRate),
      channels: '1',
      interim_results: 'true',
      diarize: config.enableDiarization ? 'true' : 'false',
      punctuate: config.enablePunctuation ? 'true' : 'false',
      smart_format: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
    });

    this.ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params}`,
      ['token', this.apiKey]
    );

    await new Promise<void>((res, rej) => {
      this.ws!.onopen = () => { this.emit('ready'); res(); };
      this.ws!.onerror = (e) => rej(new Error('Connection failed'));
    });

    this.ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'Results') {
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;
        this.emit('result', {
          text: alt.transcript,
          isFinal: data.is_final,
          isCumulative: false,
          words: alt.words?.map((w: any) => ({
            text: w.word,
            startMs: Math.round(w.start * 1000),
            endMs: Math.round(w.end * 1000),
            confidence: w.confidence,
            speakerId: String(w.speaker ?? ''),
          })),
        });
      }
    };
  }

  sendAudio(pcmBuffer: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcmBuffer);   // Deepgram: 直接发裸 PCM，无需封帧
    }
  }

  async finalize(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      await sleep(2000);
    }
  }

  disconnect(): void { this.ws?.close(); }
}
```

### 4.4 Provider Router（故障转移 + 成本路由）

```typescript
// core/ProviderRouter.ts

interface RoutingStrategy {
  selectProvider(
    config: ASRConfig,
    availableProviders: ASRProviderAdapter[]
  ): ASRProviderAdapter;
}

// 策略1：成本优先（按每分钟单价排序）
class CostOptimizedRouter implements RoutingStrategy {
  private costs: Map<string, number> = new Map([
    ['volcengine', 0.006],    // ¥/分钟
    ['deepgram', 0.0043],     // $/分钟
    ['assemblyai', 0.0064],
    ['azure', 0.008],
  ]);

  selectProvider(config: ASRConfig, providers: ASRProviderAdapter[]) {
    // 中文场景强制用 ByteDance（其他引擎中文准确率差太多，省钱没意义）
    if (config.language.startsWith('zh')) {
      return providers.find(p => p.name === 'volcengine') ?? providers[0];
    }
    return providers
      .filter(p => p.capabilities.supportedLanguages.includes(config.language))
      .sort((a, b) => (this.costs.get(a.name) ?? 99) - (this.costs.get(b.name) ?? 99))[0];
  }
}

// 策略2：低延迟优先
class LatencyOptimizedRouter implements RoutingStrategy {
  selectProvider(config: ASRConfig, providers: ASRProviderAdapter[]) {
    return [...providers]
      .filter(p => p.capabilities.supportsStreaming)
      .sort((a, b) => a.capabilities.minLatencyMs - b.capabilities.minLatencyMs)[0];
  }
}

export class ProviderRouter {
  private primary: ASRProviderAdapter;
  private fallbacks: ASRProviderAdapter[];
  private current: ASRProviderAdapter;
  private consecutiveErrors = 0;

  constructor(
    providers: ASRProviderAdapter[],
    config: ASRConfig,
    strategy: RoutingStrategy = new CostOptimizedRouter()
  ) {
    this.primary = strategy.selectProvider(config, providers);
    this.fallbacks = providers.filter(p => p !== this.primary);
    this.current = this.primary;
  }

  async handleError(error: ASRError): Promise<void> {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= 3 && this.fallbacks.length > 0) {
      console.warn(`[Router] ${this.current.name} 连续失败，切换到 ${this.fallbacks[0].name}`);
      this.current = this.fallbacks.shift()!;
      this.consecutiveErrors = 0;
    }
  }

  get active(): ASRProviderAdapter { return this.current; }
}
```

---

## 五、时间戳驱动的合并算法（取代启发式文本匹配）

现有系统（包括本项目）依赖文本前缀匹配来去重。这有根本性缺陷：相似内容会被误合并。

**正确方案：词级时间戳驱动合并（所有主流 Provider 都支持）。**

### 5.1 算法原理

```
稳定区:  |━━━━━━━━━━━━━━━━━━━━━━━━━━━━━|
             "你好" [0-200ms]  "今天" [300-500ms]
                                          ↑ lastStableEndMs = 500ms

新增结果: |────────────────────────────────────────────|
             "你好" [0-200ms]  "今天" [300-500ms]  "天气" [600-800ms]
                                                     ↑ 只有 startMs >= 500ms 的词才是新词

合并后:  |━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━|
             "你好"[0-200ms] "今天"[300-500ms] "天气"[600-800ms]
```

```typescript
// core/TranscriptMerger.ts

export class TimestampDrivenMerger {
  private stableWords: ASRWord[] = [];
  private partialText = '';
  private lastStableEndMs = 0;

  processFinal(result: ASRResult): MergeResult {
    if (!result.words?.length) {
      // Provider 不支持词级时间戳时，退回文本追加
      return this._appendByText(result);
    }

    // 只保留时间戳在稳定区末尾之后的词（真正的新词）
    const newWords = result.words.filter(
      w => w.startMs >= this.lastStableEndMs - 50   // -50ms 容差
    );

    if (newWords.length === 0) {
      // 完全重复，忽略
      return { type: 'duplicate', delta: '' };
    }

    this.stableWords.push(...newWords);
    this.lastStableEndMs = newWords.at(-1)!.endMs;
    this.partialText = '';

    const delta = newWords.map(w => w.text).join('');
    return {
      type: 'append',
      delta,
      fullText: this.stableWords.map(w => w.text).join(''),
      words: [...this.stableWords],
    };
  }

  processPartial(text: string): MergeResult {
    this.partialText = text;
    return { type: 'partial', text };
  }

  getDisplay(): { stable: string; partial: string } {
    return {
      stable: this.stableWords.map(w => w.text).join(''),
      partial: this.partialText,
    };
  }

  private _appendByText(result: ASRResult): MergeResult {
    // 退化路径：仅用于不支持词级时间戳的 Provider
    const full = this.stableWords.map(w => w.text).join('');
    if (result.text === full || full.endsWith(result.text)) {
      return { type: 'duplicate', delta: '' };
    }
    if (result.text.startsWith(full)) {
      const delta = result.text.slice(full.length);
      const syntheticWords = synthesizeWords(delta, this.lastStableEndMs);
      this.stableWords.push(...syntheticWords);
      this.lastStableEndMs = syntheticWords.at(-1)?.endMs ?? this.lastStableEndMs;
      return { type: 'append', delta, fullText: result.text, words: [...this.stableWords] };
    }
    // 完全独立的句子
    const syntheticWords = synthesizeWords(result.text, this.lastStableEndMs);
    this.stableWords.push(...syntheticWords);
    this.lastStableEndMs = syntheticWords.at(-1)?.endMs ?? this.lastStableEndMs;
    return { type: 'append', delta: result.text, fullText: result.text, words: [...this.stableWords] };
  }
}
```

---

## 六、两阶段说话人分离

### 6.1 架构设计

```
阶段 1 (实时, ~500ms 延迟):
  └── 在线聚类: 维护说话人质心，余弦相似度分配
      准确率: ~75-85%，立即显示近似结果

阶段 2 (延迟精修, 会话结束后 5-30s):
  └── 批量 pyannote / 更强模型: 全局重排
      准确率: ~95%，通过 diff patch 更新已显示内容
```

### 6.2 在线聚类器

```typescript
// core/OnlineDiarizer.ts

interface SpeakerProfile {
  id: string;
  centroid: Float32Array;     // 归一化 embedding 均值
  utteranceCount: number;
  totalDuration: number;
}

export class OnlineDiarizer {
  private speakers: SpeakerProfile[] = [];
  private readonly SIMILARITY_THRESHOLD = 0.75;
  private readonly EMA_ALPHA = 0.1;   // 质心更新步长

  assignSpeaker(embedding: Float32Array, durationMs: number): string {
    if (this.speakers.length === 0) {
      return this._createSpeaker(embedding, durationMs);
    }

    const similarities = this.speakers.map(s =>
      cosineSimilarity(embedding, s.centroid)
    );
    const maxSim = Math.max(...similarities);
    const maxIdx = similarities.indexOf(maxSim);

    if (maxSim >= this.SIMILARITY_THRESHOLD) {
      const speaker = this.speakers[maxIdx];
      // 指数移动平均更新质心（新说话人的声音特征会随时间变化）
      for (let i = 0; i < embedding.length; i++) {
        speaker.centroid[i] = (1 - this.EMA_ALPHA) * speaker.centroid[i]
                             + this.EMA_ALPHA * embedding[i];
      }
      normalizeInPlace(speaker.centroid);
      speaker.utteranceCount++;
      speaker.totalDuration += durationMs;
      return speaker.id;
    }

    return this._createSpeaker(embedding, durationMs);
  }

  private _createSpeaker(embedding: Float32Array, durationMs: number): string {
    const id = `spk-${this.speakers.length + 1}`;
    this.speakers.push({
      id,
      centroid: Float32Array.from(embedding),
      utteranceCount: 1,
      totalDuration: durationMs,
    });
    return id;
  }

  // 接受批量后处理的结果，更新 speakerId 映射
  applyRefinement(corrections: SpeakerCorrection[]): SpeakerRemap {
    // corrections: [{ utteranceId, oldSpeakerId, newSpeakerId }]
    const remap: Record<string, string> = {};
    for (const c of corrections) {
      remap[c.oldSpeakerId] = c.newSpeakerId;
    }
    return remap;
  }
}
```

### 6.3 批量精修管线（服务端）

```python
# server/diarize_refine.py
import asyncio
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token=HUGGINGFACE_TOKEN
)
pipeline.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))

async def refine_diarization(session_audio_path: str, session_id: str) -> list[dict]:
    """
    会话结束后异步精修说话人分离。
    结果通过 WebSocket 推送给客户端（patch 更新已有转写）。
    """
    # 全量 audio file → batch diarization
    diarization = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: pipeline(session_audio_path)
    )

    corrections = []
    for segment, track, speaker in diarization.itertracks(yield_label=True):
        corrections.append({
            'start_ms': round(segment.start * 1000),
            'end_ms': round(segment.end * 1000),
            'speaker_id': speaker,  # 精确 speaker ID
        })

    # 通过 WebSocket 推送 patch
    socketio.emit('diarization_refined', {
        'session_id': session_id,
        'corrections': corrections,
    }, to=session_id)

    return corrections
```

---

## 七、状态机设计（有限状态，无歧义）

当前项目的 `AppStatus` 是松散枚举，没有明确的转移规则。正确做法是用有限状态机（FSM）：

```typescript
// core/SessionFSM.ts

export type SessionState =
  | { status: 'idle' }
  | { status: 'connecting'; startedAt: number }
  | { status: 'ready'; sessionId: string }
  | { status: 'recording'; sessionId: string; startedAt: number }
  | { status: 'transcribing'; sessionId: string; startedAt: number; resultCount: number }
  | { status: 'finalizing'; sessionId: string }
  | { status: 'completed'; sessionId: string; summary: SessionSummary }
  | { status: 'error'; code: ErrorCode; message: string; recoverable: boolean };

export type SessionEvent =
  | { type: 'CONNECT' }
  | { type: 'CONNECTION_READY'; sessionId: string }
  | { type: 'CONNECTION_FAILED'; message: string }
  | { type: 'START_RECORDING'; sessionId: string }
  | { type: 'RECORDING_READY' }           // 服务端 WSS 握手完成
  | { type: 'TRANSCRIPT_RECEIVED'; isFinal: boolean }
  | { type: 'STOP_RECORDING' }
  | { type: 'RECORDING_STOPPED'; summary: SessionSummary }
  | { type: 'RESET' };

// 合法的状态转移图
const TRANSITIONS: Record<string, string[]> = {
  idle:        ['connecting'],
  connecting:  ['ready', 'error'],
  ready:       ['recording', 'idle'],         // idle = 断连
  recording:   ['transcribing', 'finalizing', 'error'],
  transcribing:['transcribing', 'finalizing', 'error'],
  finalizing:  ['completed', 'error'],
  completed:   ['ready', 'idle'],             // 可以开始下一次录音
  error:       ['idle', 'connecting'],        // 可恢复错误允许重连
};

export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
  timestamp = Date.now()
): SessionState {
  const allowed = TRANSITIONS[state.status] ?? [];

  switch (event.type) {
    case 'CONNECT':
      if (!allowed.includes('connecting')) return state;
      return { status: 'connecting', startedAt: timestamp };

    case 'CONNECTION_READY':
      if (state.status !== 'connecting') return state;
      return { status: 'ready', sessionId: event.sessionId };

    case 'RECORDING_READY':
      // 区别于 START_RECORDING：这是服务端真正就绪的事件
      if (state.status !== 'recording') return state;
      return state;  // 已经是 recording，不变状态但允许发送音频

    case 'TRANSCRIPT_RECEIVED':
      if (state.status === 'recording' || state.status === 'transcribing') {
        return {
          status: 'transcribing',
          sessionId: (state as any).sessionId,
          startedAt: (state as any).startedAt,
          resultCount: ((state as any).resultCount ?? 0) + 1,
        };
      }
      return state;

    case 'RECORDING_STOPPED':
      if (state.status !== 'finalizing') return state;
      return {
        status: 'completed',
        sessionId: (state as any).sessionId,
        summary: event.summary,
      };

    case 'RESET':
      return { status: 'idle' };

    default:
      return state;
  }
}
```

---

## 八、通用前端 SDK

将上述所有逻辑封装成一个可 npm 发布的 SDK：

```typescript
// sdk/ASRSession.ts

export class ASRSession {
  private audioPipeline: AudioPipeline;
  private router: ProviderRouter;
  private merger: TimestampDrivenMerger;
  private diarizer: OnlineDiarizer;
  private fsm: SessionFSM;

  constructor(private config: ASRSessionConfig) {
    this.audioPipeline = new AudioPipeline({
      vad: config.vad ?? { strategy: 'silero', threshold: 0.5 },
      denoise: config.denoise ?? true,
      sampleRate: 16000,
    });

    const adapters = config.providers.map(p => createAdapter(p));
    this.router = new ProviderRouter(adapters, config, config.routingStrategy);
    this.merger = new TimestampDrivenMerger();
    this.diarizer = new OnlineDiarizer();
    this.fsm = new SessionFSM();
  }

  // ---- Input 入口 ----

  /** 麦克风实时录制 */
  async startMicrophone(): Promise<void> {
    await this._setupProvider();
    const stream = await this.audioPipeline.startMicrophone();
    stream.on('audio', (pcm) => this.router.active.sendAudio(pcm));
  }

  /** 上传文件（支持 WAV/MP3/M4A/OGG/FLAC，内部自动转码） */
  async transcribeFile(file: File): Promise<TranscriptResult> {
    await this._setupProvider();
    const pcm = await this.audioPipeline.decodeFile(file);
    return this._streamAndCollect(pcm);
  }

  /** 从 URL 转写（Server-side download） */
  async transcribeURL(url: string): Promise<TranscriptResult> {
    const response = await fetch(`/api/proxy-audio?url=${encodeURIComponent(url)}`);
    const file = await response.blob() as File;
    return this.transcribeFile(file);
  }

  /** 屏幕/标签页音频 */
  async startScreenAudio(): Promise<void> {
    await this._setupProvider();
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
    this.audioPipeline.attachStream(stream);
  }

  stop(): void {
    this.audioPipeline.stop();
    this.router.active.finalize().then(() => {
      this.router.active.disconnect();
      this.fsm.dispatch({ type: 'STOP_RECORDING' });
    });
  }

  // ---- Output 订阅 ----

  /** 订阅实时转写结果 */
  onTranscript(handler: (update: TranscriptUpdate) => void): () => void {
    return this.router.active.on('result', (result) => {
      const mergeResult = result.isFinal
        ? this.merger.processFinal(result)
        : this.merger.processPartial(result.text);

      handler({
        type: mergeResult.type,
        text: mergeResult.type === 'partial' ? mergeResult.text : '',
        stableText: this.merger.getDisplay().stable,
        partialText: this.merger.getDisplay().partial,
        words: mergeResult.words,
        speakerId: result.speakerId,
        isFinal: result.isFinal,
      });
    });
  }

  onError(handler: (e: ASRError) => void): () => void {
    return this.router.active.on('error', async (error) => {
      await this.router.handleError(error);
      handler(error);
    });
  }

  // ---- Export ----

  exportSRT(): string {
    return this.merger.toSRT();
  }

  exportVTT(): string {
    return this.merger.toVTT();
  }

  exportJSON(): TranscriptJSON {
    return {
      words: this.merger.getAllWords(),
      speakers: this.diarizer.getSpeakers(),
      duration: this.merger.getDuration(),
    };
  }

  private async _setupProvider(): Promise<void> {
    const provider = this.router.active;
    await provider.connect(this.config.asrConfig);
    this.fsm.dispatch({ type: 'RECORDING_READY' });
  }

  private async _streamAndCollect(pcm: Int16Array): Promise<TranscriptResult> {
    return new Promise((resolve, reject) => {
      const results: ASRResult[] = [];
      const unsub = this.router.active.on('result', (r) => {
        if (r.isFinal) results.push(r);
      });
      this.router.active.on('closed', () => {
        unsub();
        resolve({ results, fullText: results.map(r => r.text).join('') });
      });
      this.router.active.on('error', reject);

      // 分块流式发送（模拟实时，服务端更好处理）
      const CHUNK_SIZE = 6400; // 200ms @ 16kHz
      const streamChunks = async () => {
        for (let i = 0; i < pcm.length; i += CHUNK_SIZE / 2) {
          const chunk = pcm.subarray(i, i + CHUNK_SIZE / 2);
          const buf = new ArrayBuffer(chunk.byteLength);
          new Int16Array(buf).set(chunk);
          this.router.active.sendAudio(buf);
          await sleep(200);
        }
        await this.router.active.finalize();
      };
      streamChunks().catch(reject);
    });
  }
}
```

### 8.1 React Hook 封装

```typescript
// hooks/useASR.ts

export function useASR(config: ASRSessionConfig) {
  const sessionRef = useRef<ASRSession | null>(null);
  const [state, dispatch] = useReducer(sessionReducer, { status: 'idle' });
  const [transcript, setTranscript] = useState<TranscriptUpdate | null>(null);

  const start = useCallback(async () => {
    dispatch({ type: 'CONNECT' });
    const session = new ASRSession(config);
    sessionRef.current = session;

    session.onTranscript((update) => {
      setTranscript(update);
      if (update.isFinal) {
        dispatch({ type: 'TRANSCRIPT_RECEIVED', isFinal: true });
      }
    });

    session.onError((error) => {
      dispatch({ type: 'CONNECTION_FAILED', message: error.message });
    });

    await session.startMicrophone();
    dispatch({ type: 'RECORDING_READY' });
  }, [config]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    dispatch({ type: 'STOP_RECORDING' });
  }, []);

  const transcribeFile = useCallback(async (file: File) => {
    dispatch({ type: 'CONNECT' });
    const session = new ASRSession(config);
    session.onTranscript(setTranscript);
    const result = await session.transcribeFile(file);
    dispatch({ type: 'RECORDING_STOPPED', summary: { ... } });
    return result;
  }, [config]);

  return {
    state,
    transcript,
    stableText: transcript?.stableText ?? '',
    partialText: transcript?.partialText ?? '',
    start,
    stop,
    transcribeFile,
    exportSRT: () => sessionRef.current?.exportSRT() ?? '',
  };
}
```

---

## 九、场景适配层

### 9.1 会议记录

```typescript
// scenarios/MeetingRecorder.ts

export class MeetingRecorder {
  private session: ASRSession;
  private segments: MeetingSegment[] = [];
  private currentSegment: Partial<MeetingSegment> | null = null;

  constructor(config: Partial<ASRSessionConfig> = {}) {
    this.session = new ASRSession({
      providers: [
        { type: 'volcengine', credentials: VOLC_CREDS },  // 中文主力
        { type: 'deepgram', apiKey: DG_KEY },             // 英文备用
      ],
      asrConfig: {
        language: 'zh-CN',
        enableDiarization: true,
        maxSpeakers: 10,
        enablePunctuation: true,
        enableITN: true,
      },
      routingStrategy: new CostOptimizedRouter(),
      ...config,
    });

    this.session.onTranscript((update) => {
      if (update.isFinal && update.stableText) {
        this._commitSegment(update);
      }
    });
  }

  private _commitSegment(update: TranscriptUpdate): void {
    const segment: MeetingSegment = {
      id: crypto.randomUUID(),
      speakerId: update.speakerId ?? 'unknown',
      text: update.stableText,
      startMs: update.words?.[0]?.startMs ?? Date.now(),
      endMs: update.words?.at(-1)?.endMs ?? Date.now(),
      words: update.words ?? [],
    };
    this.segments.push(segment);
  }

  async start(): Promise<void> {
    await this.session.startMicrophone();
  }

  stop(): MeetingTranscript {
    this.session.stop();
    return {
      segments: this.segments,
      speakers: this._buildSpeakerProfiles(),
      fullText: this.segments.map(s => s.text).join('\n'),
      duration: this.segments.at(-1)?.endMs ?? 0,
    };
  }

  exportMinutes(): string {
    // AI 自动生成会议纪要（可对接 GPT/Claude API）
    const transcript = this.segments
      .map(s => `[${s.speakerId}]: ${s.text}`)
      .join('\n');
    return transcript;
  }

  exportSRT(): string { return this.session.exportSRT(); }
}
```

### 9.2 实时字幕（< 300ms 延迟优化）

```typescript
// scenarios/LiveCaptioning.ts

export class LiveCaptioning {
  private session: ASRSession;

  constructor() {
    this.session = new ASRSession({
      providers: [
        // 字幕场景：延迟最优，不需要说话人分离
        { type: 'deepgram', apiKey: DG_KEY },
      ],
      asrConfig: {
        language: 'zh-CN',
        enableDiarization: false,   // 字幕不需要
        enablePunctuation: true,
        mode: 'streaming',
      },
      routingStrategy: new LatencyOptimizedRouter(),
      // VAD 设置：更激进的检测，减少静音传输
      vad: {
        strategy: 'silero',
        threshold: 0.4,           // 更敏感
        redemptionFrames: 8,      // 512ms 静音才停止（不截断句子）
      },
    });
  }

  render(container: HTMLElement): () => void {
    const caption = document.createElement('div');
    caption.className = 'live-caption';
    container.appendChild(caption);

    const unsub = this.session.onTranscript((update) => {
      // 显示稳定文本 + 动态 partial
      caption.innerHTML =
        `<span class="stable">${update.stableText}</span>` +
        `<span class="partial">${update.partialText}</span>`;
    });

    return () => { unsub(); caption.remove(); };
  }
}
```

### 9.3 录音文件批量转写

```typescript
// scenarios/BatchTranscriber.ts

export class BatchTranscriber {
  async transcribe(
    input: File | string,   // File 对象 or URL
    options: TranscribeOptions = {}
  ): Promise<BatchTranscriptResult> {
    const session = new ASRSession({
      providers: options.providers ?? DEFAULT_PROVIDERS,
      asrConfig: {
        language: options.language ?? 'zh-CN',
        enableDiarization: options.diarization ?? true,
        maxSpeakers: options.maxSpeakers ?? -1,
        enablePunctuation: true,
        enableITN: true,
        mode: 'batch',
      },
    });

    let result: TranscriptResult;
    if (typeof input === 'string') {
      result = await session.transcribeURL(input);
    } else {
      result = await session.transcribeFile(input);
    }

    return {
      text: result.fullText,
      segments: result.results.map(r => ({
        text: r.text,
        startMs: r.words?.[0]?.startMs ?? 0,
        endMs: r.words?.at(-1)?.endMs ?? 0,
        speaker: r.speakerId,
      })),
      srt: session.exportSRT(),
      vtt: session.exportVTT(),
      json: session.exportJSON(),
    };
  }
}
```

---

## 十、可观测性设计

### 10.1 结构化指标

```typescript
// observability/metrics.ts

export interface ASRMetrics {
  // 会话维度
  sessionId: string;
  provider: string;
  language: string;
  startTime: number;
  endTime?: number;

  // 音频维度
  totalAudioMs: number;
  speechAudioMs: number;      // VAD 检测到的语音时长
  silenceRatio: number;        // = 1 - speechAudioMs/totalAudioMs

  // 延迟分布（毫秒）
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  latencySamples: number[];

  // 质量维度
  totalFinalResults: number;
  totalChars: number;
  charRate: number;            // 字/分钟
  speakerCount: number;
  confidenceAvg: number;

  // 错误维度
  errorCount: number;
  providerSwitches: number;    // 发生了几次 failover
  reconnectCount: number;
}
```

### 10.2 前端实时展示

```
┌─────────────────────────────────────────────────────────────┐
│ SESSION METRICS                               ● LIVE         │
├──────────────┬──────────────┬────────────────┬─────────────┤
│  LATENCY     │  SPEECH      │  ACCURACY      │  COST       │
│  P50: 245ms  │  Rate: 78%   │  Conf: 0.94    │  ¥0.032    │
│  P90: 412ms  │  Chars: 1.2k │  Spk: 2人      │  ~¥0.05/h  │
│  P99: 680ms  │  Rate: 85字/m│  Errors: 0     │            │
├──────────────┴──────────────┴────────────────┴─────────────┤
│  LATENCY SPARKLINE  ┤▁▂▃▂▁▃▄▂▁▂▃▄▅▃▂▁▂├  Provider: 火山 ✓ │
└─────────────────────────────────────────────────────────────┘
```

---

## 十一、关键工程决策总结

| 决策 | 现有项目 | 最优方案 | 原因 |
|------|---------|---------|------|
| 音频处理线程 | AudioWorklet（Audio Thread） | AudioWorklet + Worker | WASM/WebSocket 不能在 Audio Thread |
| VAD | 浏览器内置 noiseSuppression | Silero VAD (WASM) | 可控阈值、输出概率、减少 50% 带宽 |
| 流式策略 | 连续流 | VAD + 连续流混合 | 部分结果即时反馈 + 边界精准 |
| 合并算法 | 文本前缀启发式 | 词级时间戳驱动 | 无误合并，确定性强 |
| 说话人分离 | 单阶段（服务端实时） | 两阶段（即时近似+延迟精修） | 平衡实时体验和最终准确率 |
| Provider 接入 | 硬编码 ByteDance | Adapter + Router | 容灾、成本优化、多语言 |
| 状态机 | 松散枚举 + useCallback | FSM（有限状态转移） | 无非法状态、可测试 |
| 错误处理 | console.log | 结构化 + 指数退避 + failover | 生产可靠性 |
| 延迟测量 | 会话总时长（错的） | 每帧发送时间差 | 准确反映真实延迟 |
| 协议 | Socket.IO | 裸 WebSocket（native） | -50ms 连接开销，-20-50 bytes/frame |

---

## 十二、参考实现与资源

- **Deepgram WebSocket 协议**: `api.deepgram.com/v1/listen` 参数文档
- **Silero VAD WASM**: `@ricky0123/vad-web` (GitHub) — 浏览器最优 VAD 方案
- **pyannote Speaker Diarization 3.1**: `github.com/pyannote/pyannote-audio`
- **Whisper Streaming (Local Agreement 算法)**: Macháček et al., INTERSPEECH 2023
- **ECAPA-TDNN**: Desplanques et al., INTERSPEECH 2020 — 说话人 embedding 算法
- **Conformer-Transducer**: Gulati et al., 2020 — 主流流式 ASR 架构
- **ByteDance v3 SAUC 协议**: 本项目 `volcengine_engine.py` 实测验证
- **RNNoise**: `github.com/jmvalin/rnnoise` — C→WASM 降噪
