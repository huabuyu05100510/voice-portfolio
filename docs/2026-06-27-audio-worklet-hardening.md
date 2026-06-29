# 模块 C — AudioWorklet + 录音性能加固 技术方案

**模型:** MiniMax-M3 (Claude Code · Opus 4.6 同级)
**日期:** 2026-06-27
**作者:** MiniMax-M3
**关联重构方案:** [refactor-plan-frontend-expert.md](./2026-06-27-refactor-plan-frontend-expert.md)

---

## 1. 目标

对**已在 AudioWorklet 主路径**的录音链路做生产化加固，展示"基础功底分层清晰"。

### 调研核心结论
- ✅ **已 AudioWorklet**，不是 ScriptProcessorNode 迁移
- ✅ 16kHz 协商通过 getUserMedia + AudioContext 双重 native 协商
- ✅ Float32 → Int16 PCM 在 worklet 线程内完成，transferable buffer 零拷贝
- ⚠️ AudioContext 状态机未监听（自动 suspend / interrupted 不会恢复）
- ⚠️ 采样率无运行时校验（浏览器忽略约束时不会降级）
- ⚠️ NS/AEC/AGC 全开，无 profile 切换
- ⚠️ `VisualizerPanel` 实现完整但**未挂入主界面**
- ⚠️ `baseLatency` / `outputLatency` 仅 console.log，未接 PerfMonitor

---

## 2. 改造范围

### 2.1 文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `client/public/audio-processor.js` | 修改 | 加软重采样兜底 + underrun 检测 + postMessage 状态 |
| `client/src/AudioCapture.ts` | 修改 | `onstatechange` / `onerror` 监听；采样率校验；profile 配置对象 |
| `client/src/hooks/useRecorder.ts` | 修改 | 错误路径增加 trace span + error 上报 |
| `client/src/components/Sidebar.tsx` | 修改 | 加"纯净模式 / 会议模式" toggle UI |
| `client/src/AppLayout.tsx` | 修改 | 挂载 `<VisualizerPanel>`（已实现未挂） |
| `client/src/PerfMonitor.tsx` | 修改 | 新增 `audio.baseLatency` / `audio.outputLatency` / `audio.underrunCount` |
| `client/src/observability/otel.ts` | 修改 | 注入 audio.* 自定义 metric |
| `client/src/types.ts` | 修改 | 新增 `AudioProfile` 类型 |

### 2.2 新增测试

- `__tests__/audio-processor.test.ts` — worklet 处理器单测（mock AudioWorkletProcessor）
- `__tests__/AudioCapture.test.ts` — 引擎单测（mock AudioContext）
- `__tests__/audioProfile.test.tsx` — toggle 切换测试
- `__tests__/e2eAudioPipeline.test.ts` — e2e：启动 → audio.worklet span 在 Jaeger 中存在

---

## 3. 关键技术细节

### 3.1 AudioContext 状态机监听

```ts
// client/src/AudioCapture.ts
export class AudioCaptureEngine {
  private audioContext: AudioContext | null = null;

  private setupContextHandlers() {
    if (!this.audioContext) return;
    this.audioContext.onstatechange = () => {
      this.logger.log('audio.context.state', this.audioContext!.state);
      if (this.audioContext!.state === 'suspended') {
        // 自动恢复（Chrome 后台 tab 可能自动 suspend）
        this.audioContext!.resume().catch((e) => {
          this.logger.error('audio.context.resume.failed', String(e));
        });
      }
      if (this.audioContext!.state === 'interrupted') {
        // 移动端 Safari 切后台触发
        this.emit('interrupted');
      }
    };
    this.audioContext.onerror = (e) => {
      this.logger.error('audio.context.error', String((e as any).error?.message ?? e));
      this.emit('error', new Error('AudioContext error'));
    };
  }

  async initialize() {
    // ... 原有逻辑
    this.audioContext = new AudioContext({ ... });
    this.setupContextHandlers();

    // 采样率兜底校验
    if (this.audioContext.sampleRate !== AudioCaptureEngine.CONFIG.sampleRate) {
      const actual = this.audioContext.sampleRate;
      this.logger.warn('audio.sampleRate.mismatch', {
        expected: AudioCaptureEngine.CONFIG.sampleRate,
        actual,
      });
      // 标记需要软重采样（在 worklet 中处理）
      this.requiresResampling = actual;
    }
  }
}
```

### 3.2 Worklet 软重采样兜底

```js
// client/public/audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferSize = options.processorOptions?.bufferSize ?? 2048;
    this.targetSampleRate = 16000;
    this.sourceSampleRate = sampleRate; // AudioWorklet 全局
    this.needsResampling = this.sourceSampleRate !== this.targetSampleRate;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.underrunCount = 0;
    this.lastTickTime = currentTime;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // underrun 检测（currentTime 跳变 > 50ms）
    const dt = currentTime - this.lastTickTime;
    if (dt > 0.05) this.underrunCount++;
    this.lastTickTime = currentTime;

    const inputChannel = input[0];
    if (!this.isRecording) return true;

    // 软重采样（线性插值兜底）
    const samples = this.needsResampling
      ? this.resampleLinear(inputChannel)
      : inputChannel;

    for (let i = 0; i < samples.length && this.bufferIndex < this.bufferSize; i++) {
      this.buffer[this.bufferIndex++] = samples[i];
    }

    if (this.bufferIndex >= this.bufferSize) this.flushBuffer();
    return true;
  }

  resampleLinear(input) {
    const ratio = this.resampleRatio;
    const outputLen = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, input.length - 1);
      const frac = srcIdx - idx0;
      output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
    }
    return output;
  }

  flushBuffer() {
    const pcmData = new Int16Array(this.bufferIndex);
    for (let i = 0; i < this.bufferIndex; i++) {
      const sample = Math.max(-1, Math.min(1, this.buffer[i]));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    this.port.postMessage({
      type: 'audio',
      pcm: pcmData.buffer,
      underrunCount: this.underrunCount,
    }, [pcmData.buffer]);
    this.bufferIndex = 0;
  }
}
registerProcessor('audio-processor', AudioProcessor);
```

### 3.3 AudioProfile 类型

```ts
// client/src/types.ts
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
    description: '关闭 NS/AEC/AGC，原始 PCM 喂 ASR（高精度）',
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
```

### 3.4 PerfMonitor audio 指标

```tsx
// client/src/PerfMonitor.tsx (新增)
// 在已有 PerfMonitor 组件增加 audio.* 指标
<div className="metric-row">
  <span>Audio baseLatency</span>
  <span>{audioBaseLatency?.toFixed(3) ?? '—'} s</span>
</div>
<div className="metric-row">
  <span>Audio outputLatency</span>
  <span>{audioOutputLatency?.toFixed(3) ?? '—'} s</span>
</div>
<div className="metric-row">
  <span>Worklet underruns</span>
  <span>{underrunCount}</span>
</div>
```

---

## 4. TDD 拆分

### 4.1 红

#### `__tests__/audio-processor.test.ts`

```ts
// 用 vitest + mock AudioWorkletProcessor
import { AudioProcessor } from '../../public/audio-processor';

describe('audio-processor (worklet)', () => {
  it('converts Float32 to Int16 PCM correctly', () => {
    // 构造 inputs[0][0] = [0.5, -0.5, 0, 1, -1]
    // 期望输出 Int16Array 对应值
  });

  it('flushes when buffer fills', () => {
    // 构造 2048+ samples，期望 flushBuffer 调用
  });

  it('detects underrun when currentTime jumps', () => {
    // 模拟 currentTime 跳变 > 50ms
  });

  it('resamples when sourceSampleRate != 16000', () => {
    // 模拟 sampleRate=48000，期望降频到 16000
  });
});
```

#### `__tests__/AudioCapture.test.ts`

```ts
describe('AudioCaptureEngine', () => {
  it('registers onstatechange handler', () => {
    // mock AudioContext → 创建引擎 → 验证 handler 注册
  });

  it('auto-resumes on suspended state', () => {
    // 触发 statechange to suspended → 验证 resume() 被调用
  });

  it('throws when sampleRate mismatches', () => {
    // mock AudioContext.sampleRate = 48000 → 期望警告但不抛错（软重采样）
  });

  it('destroys AudioContext on destroy()', () => {
    // destroy → 验证 audioContext.close() 被调用
  });
});
```

#### `__tests__/audioProfile.test.tsx`

```tsx
import { render, fireEvent } from '@testing-library/react';
import { ProfileToggle } from '../components/ProfileToggle';

it('updates getUserMedia constraints when profile changes', () => {
  const onChange = vi.fn();
  const { getByRole } = render(<ProfileToggle onChange={onChange} />);
  fireEvent.click(getByRole('button', { name: /纯净模式/ }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ echoCancellation: false })
  );
});
```

### 4.2 绿
按"关键技术细节"实施。

### 4.3 回归

```bash
npm test -- audio-processor --run
npm test -- AudioCapture --run
npm test -- audioProfile --run
npm test -- e2eAudioPipeline --run
npm test -- --run  # 全量回归
```

---

## 5. VisualizerPanel 挂载

### 5.1 现状
- `src/components/Visualizer.tsx` 实现完整（频谱/音高/VAD/能量条 4 维度）
- `AppLayout.tsx` 全文未 import Visualizer

### 5.2 改动

```tsx
// client/src/AppLayout.tsx
import { VisualizerPanel } from './components/Visualizer';

// 在 Sidebar 内或主区旁挂载
{mediaStream && (
  <VisualizerPanel
    stream={mediaStream}
    audioData={latestAudio}
    active={isRecording}
  />
)}
```

### 5.3 测试
`VisualizerPanel` 自身测试如缺需补（建议加 `__tests__/Visualizer.test.tsx`）。

---

## 6. 关键风险与对策

| 风险 | 对策 |
|------|------|
| **软重采样引入 CPU 压力** | 仅在 native 协商失败时启用（`needsResampling` flag） |
| **关闭 NS/AEC/AGC 降低识别精度** | 加 profile + A/B 验证按钮；不影响默认体验 |
| **VisualizerPanel 60fps 影响性能** | 已有 rAF 60 帧窗口；提供"低性能模式"开关（关掉频谱保留波形） |
| **Worklet 测 jsdom 缺 AudioContext** | 手写 stub（`globalThis.sampleRate = 16000; globalThis.currentTime = ...`） |
| **AudioContext.onstatechange 跨浏览器不一致** | 仅依赖标准事件；额外 try/catch 兜底 |

---

## 7. 验证（端到端）

### 7.1 自动化

```bash
cd vosk-realtime-asr/client
npm test -- audio-processor --run
npm test -- AudioCapture --run
npm test -- audioProfile --run
npm test -- e2eAudioPipeline --run
npm test -- --run  # 全量回归
```

### 7.2 手动

```bash
npm run dev
# 浏览器开 http://localhost:5173
# 验证 1：Sidebar 出现"纯净模式 / 会议模式" toggle
# 验证 2：VisualizerPanel 显示频谱 + 音高 + VAD + 能量条
# 验证 3：PerfMonitor 显示 audio.baseLatency / outputLatency / underruns
# 验证 4：切"纯净模式" → 重新录制 → 看识别准确率变化（A/B）
```

### 7.3 验收标准

- [ ] 4 个新增测试文件全绿
- [ ] VisualizerPanel 视觉回归（截图对比）
- [ ] PerfMonitor audio.* 指标正确显示
- [ ] 采样率 mismatch 不再静默失败（有日志 + 软重采样生效）
- [ ] AudioContext 自动 suspend 后能 resume
- [ ] 全量 22 个 vitest 无回归
- [ ] e2e audio.worklet span 在 Jaeger 中存在（依赖模块 B）

---

## 8. 后续可扩展（不在本轮范围）

- 多设备切换（enumerateDevices）
- baseLatency / outputLatency 历史曲线图
- WebGL 频谱（性能极限优化）
- Web Worker 跑 ACF（基频检测）释放主线程
- SharedArrayBuffer 替代 transferable

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 初版 AudioWorklet 加固技术方案 |