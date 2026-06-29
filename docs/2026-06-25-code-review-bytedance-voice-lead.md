# Code Review — 字节语音前端负责人视角（全量豆包能力版）

> 审查模型：Claude Sonnet 4.6 | 日期：2026-06-25
> 用途：竞标 Demo 修复指导 + 全量豆包语音能力接入最佳实践

---

## 零、紧急安全告警 🔴

`voice-doubao/` 目录下的截图中包含明文 API 凭证（AppID、Access Token、Secret Key、API Key）。
**这些图片在 Git 仓库中，任何拿到这个 repo 的人都能直接用你的配额。**

**立即执行：**
1. 登录火山引擎控制台 → 重新生成 Access Token 和 API Key
2. 把旧凭证截图移出 Git 仓库（git rm + .gitignore）
3. 所有凭证改用环境变量注入：

```bash
# .env.local（加入 .gitignore）
VITE_WS_URL=http://localhost:5001
VOLCENGINE_APP_ID=xxx
VOLCENGINE_ACCESS_TOKEN=xxx
VOLCENGINE_API_KEY=xxx
VOLCENGINE_TTS2_INSTANCE=xxx
VOLCENGINE_VOICE_CLONE_INSTANCE=xxx
```

---

## 一、豆包语音能力全景 vs 当前接入状态

| 豆包能力 | 已开通 | 当前 Demo 状态 | 竞标价值 |
|---------|--------|---------------|---------|
| **流式语音识别** (火山引擎 v3) | ✅ | ✅ 已接入 | ★★★ |
| **语音合成 (TTS 基础版)** | ✅ | ⚠️ 服务端代理，无丰富 UI | ★★ |
| **语音合成 2.0** (SeedTTS 2.0) | ✅ 已开通实例 | ❌ 未接入 | ★★★★ |
| **声音复刻 2.0** | ✅ 已开通实例，已有声音 ID | ❌ 未接入 | ★★★★★ |
| **端到端实时语音交互** | ✅ 已开通实例 | ❌ 未接入 | ★★★★★ |
| **同声传译 2.0** | ✅ 已开通实例 | ❌ 未接入 | ★★★★★ |
| **录音文件识别 2.0** | ✅ | ❌ 未接入 | ★★★ |
| **语音播客大模型** | ✅ 100万 token | ❌ 未接入 | ★★★★ |
| **音色设计** | ✅ | ❌ 未接入 | ★★★ |

**核心问题：已开通 9 项服务，Demo 只用了 1 项。竞标对手如果全部接入，你会被完全碾压。**

---

## 二、当前已实现部分的 Code Review（vosk-realtime-asr）

### P0 严重问题（竞标前必修）

#### 2.1 Socket.IO transport 顺序导致首帧延迟 ~300ms

```ts
// WebSocketClient.ts:62 ❌
transports: ['polling', 'websocket'],
```

polling 在前意味着每次连接都先建 HTTP 长轮询，再 upgrade，多一个 RTT。对实时语音致命。

```ts
// ✅ 修改为
transports: ['websocket'],
```

#### 2.2 硬编码 `localhost:5001`，换机器即崩

```ts
// App.tsx:18 ❌
const ws = useWebSocket('http://localhost:5001');

// ✅ 修改为
const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:5001';
const ws = useWebSocket(WS_URL);
```

#### 2.3 `startRecording()` Promise 无超时，可永久挂起

```ts
// WebSocketClient.ts:221 ❌
this._recordingReadyPromise = new Promise<void>((resolve) => {
  this._recordingReadyResolve = resolve;
  // 没有 reject！服务端不响应 → 永远 pending
});

// ✅ 修改为
this._recordingReadyPromise = new Promise<void>((resolve, reject) => {
  this._recordingReadyResolve = resolve;
  setTimeout(() => reject(new Error('recording_started timeout')), 8000);
});
```

#### 2.4 回调模式只支持单一监听者

```ts
// WebSocketClient.ts ❌ 所有 onXxx 方法都是单槽位，后注册覆盖前
// ✅ 改用 eventemitter3
import EventEmitter from 'eventemitter3';
class WebSocketClient extends EventEmitter {
  // this.emit('transcription', result)
  // 多个消费者都能监听，互不影响
}
```

#### 2.5 TTS ObjectURL 内存泄漏

```ts
// useTtsPlayback.ts ❌ createObjectURL 从不 revoke
audio.onended = () => {
  URL.revokeObjectURL(audio.src);  // ✅ 播完立即释放
  drainQueue();
};
```

#### 2.6 Production 构建 console.log 满天飞

```ts
// ✅ WebSocketClient.ts 顶部替换
const log = import.meta.env.DEV ? console.log.bind(console) : () => {};
const warn = import.meta.env.DEV ? console.warn.bind(console) : () => {};
```

---

### P1 性能问题

#### 2.7 200 张 framer-motion 卡片导致滚动卡顿

`TranscriptHero.tsx` 对所有 results（最多 200 条）都套 `AnimatePresence/motion.article`，Chromium 200 个 WAAPI 动画并行时帧率掉到 20fps。

```tsx
// ✅ 换用虚拟列表
import { useVirtualizer } from '@tanstack/react-virtual';
const rowVirtualizer = useVirtualizer({
  count: results.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 88,
  overscan: 5,
});
```

#### 2.8 每条 FINAL 全量三次 O(n) 遍历

`mergeConsecutiveSameSpeaker` + `dedupeSameTextSameSpeaker` + `slice(-200)` 每次都对全量 results 做。
优化方向：维护 `Map<startTime, index>` O(1) 查找，增量更新而非全量重算。

#### 2.9 音频发送无背压控制

```ts
// App.tsx:41 ❌ 无限速发送
ws.clientRef.current?.sendAudio(buf);

// ✅ 滑动窗口背压
const MAX_INFLIGHT = 3;
if (inflightCount < MAX_INFLIGHT) {
  socket.emit('audio_data', buf, () => inflightCount--);
  inflightCount++;
}
```

---

### P2 代码质量

| 问题 | 位置 | 说明 |
|------|------|------|
| 状态机逻辑散布 | App.tsx 3 个 useEffect | 7 个状态转换分散，建议集中或用 XState |
| 多处 `any` 类型 | WebSocketClient.ts:295,318 | strict 模式下报警 |
| App.tsx 导出混乱 | App.tsx:13-16 | default export 是另一个文件的 AppShell |
| 死代码 | `waitForRecordingReady` | 定义但从未调用 |

---

## 三、豆包能力全量接入方案

### 3.1 整体架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                   豆包语音 Demo 全能力架构                        │
│                                                                 │
│  功能模块                                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  实时转写    │ │  同声传译   │ │  声音复刻 │ │  端到端交互  │  │
│  │(已实现✅)   │ │(未接入❌)   │ │(未接入❌) │ │(未接入❌)   │  │
│  └──────┬──────┘ └──────┬──────┘ └────┬─────┘ └──────┬──────┘  │
│         └───────────────┴──────────────┴──────────────┘         │
│                                  │                              │
│  网络层                           ▼                              │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  NestJS Gateway (5001)                               │       │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────────────┐│       │
│  │  │ ASR Room │ │  TTS Room │ │ Realtime Voice Room  ││       │
│  │  │(Socket.IO│ │(Socket.IO)│ │   (WebSocket)        ││       │
│  │  └──────────┘ └───────────┘ └──────────────────────┘│       │
│  └──────────────────────────────────────────────────────┘       │
│                                  │                              │
│  豆包 API 层                       ▼                              │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Volcengine SDK                                      │       │
│  │  ASR v3 | TTS 2.0 | Voice Clone | Realtime Voice    │       │
│  │  Simultaneous Interpretation | Voice Podcast        │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.2 同声传译 2.0（最高竞标价值）

豆包同声传译 2.0 支持：输入音频 → 实时输出翻译文本 + 合成音频（80元/百万 token 输入，300元/百万 token 输出音频）。

**Demo 效果：麦克风说中文 → 实时显示英文字幕 + 播放英文语音**

```tsx
// components/SimultaneousInterpretation.tsx
interface SIConfig {
  sourceLang: 'zh' | 'en' | 'ja';
  targetLang: 'zh' | 'en' | 'ja' | 'ko';
  outputAudio: boolean;  // 是否同时输出合成语音
}

// 双列布局：左侧原文实时转写，右侧翻译实时滚动
// 底部字幕栏双语对照
```

**服务端接入要点（NestJS）：**
```ts
// server-nest/src/si/si.gateway.ts
@SubscribeMessage('si:start')
async startSI(client: Socket, config: SIConfig) {
  const session = new DoubaoSISession({
    appId: process.env.VOLCENGINE_APP_ID,
    token: process.env.VOLCENGINE_ACCESS_TOKEN,
    model: 'Doubao-同声传译-2.0',
    sourceLang: config.sourceLang,
    targetLang: config.targetLang,
  });
  session.onPartial((text, translation) => {
    client.emit('si:partial', { text, translation });
  });
  session.onFinal((text, translation, audio) => {
    client.emit('si:final', { text, translation });
    if (audio) client.emit('si:audio', { audio_base64: audio });
  });
}
```

---

### 3.3 声音复刻 2.0（视觉震撼力最强）

已开通实例，已有声音 ID（训练中）。核心演示流：

```
用户录音 3~30s → 上传声音样本 → 触发克隆训练 → 克隆完成后用克隆声音朗读转写内容
```

**前端 UI 设计：**
```tsx
// components/VoiceClone.tsx
// 步骤 1: 录制声音样本（波形可视化，显示录音质量评分）
// 步骤 2: 训练进度条（轮询状态，~2-5分钟）
// 步骤 3: 克隆成功 → 在 TranscriptHero 旁边显示"用我的声音朗读"按钮
// 步骤 4: 选中任意一段转写文本 → 用克隆声音合成并播放
```

**与现有 TtsPlayer 集成：**
```ts
// 扩展 TtsAudioPayload
interface TtsAudioPayload {
  audio_base64: string;
  format: 'mp3';
  voiceId?: string;         // 新增：使用哪个声音（克隆声音 ID 或预置音色）
  isClonedVoice?: boolean;  // 新增：是克隆声音时 UI 显示特殊标记
}
```

---

### 3.4 语音合成 2.0（替换现有 TTS）

当前 demo 用的是基础 TTS，而 SeedTTS 2.0 支持：
- 情感控制（喜/怒/悲/恐）
- 语速/音调/音量精细调节
- 多说话风格（新闻播报/客服/故事）

```ts
// server-nest/src/tts/tts.service.ts
async synthesize(text: string, options: TTSOptions): Promise<Buffer> {
  return await volcengine.tts({
    model: 'Doubao-语音合成-2.0',
    instanceId: process.env.VOLCENGINE_TTS2_INSTANCE,
    text,
    voiceType: options.voiceId ?? 'zh_female_tianmei',
    emotion: options.emotion,    // happy/sad/angry/fear
    speedRatio: options.speed,   // 0.5~2.0
    pitchRatio: options.pitch,   // 0.5~2.0
  });
}
```

**前端扩展 TtsPlayer：**
```tsx
// 在 TtsPlayer 浮窗里增加情感选择器和语速滑块
// 让评审现场直观感受 TTS 2.0 vs 基础 TTS 的音质差距
```

---

### 3.5 端到端实时语音交互（类 ChatGPT Voice）

已开通 `Doubao_scene_SLM` 实例，支持全双工语音对话。

**Demo 效果：与 AI 实时语音对话，无需按"发送"——像打电话一样**

```ts
// server-nest/src/realtime-voice/realtime-voice.gateway.ts
// 全双工 WebSocket 桥接：
// 浏览器麦克风 → PCM → Server → Doubao Realtime Voice API → 音频流 → 浏览器播放
// 同时在 UI 展示对话轮次字幕（ASR + LLM 回复文本）

@WebSocketGateway({ namespace: '/realtime-voice' })
export class RealtimeVoiceGateway {
  @SubscribeMessage('rv:audio')
  handleAudio(client: Socket, data: ArrayBuffer) {
    this.sessions.get(client.id)?.sendAudio(data);
  }
}
```

**前端组件：**
```tsx
// components/RealtimeVoiceChat.tsx
// - 对话气泡（用户语音 → 识别文本，AI 回复文本 + 音频）
// - 实时音频波形（输入 + 输出）
// - 说话状态指示（listening/thinking/speaking）
```

---

### 3.6 语音播客大模型（100万 token 免费额度，绝对加分）

输入：文章/话题/文稿 → 输出：双人对话播客音频 + 字幕

```tsx
// components/PodcastGenerator.tsx
// 步骤 1: 输入文本或 URL
// 步骤 2: 选择播客风格（对谈/独白/新闻）
// 步骤 3: 选择主播音色（从预置 + 克隆声音中选）
// 步骤 4: 流式生成，实时显示字幕 + 播放音频
// 步骤 5: 下载完整播客 MP3 + SRT 字幕

// 与 vosk-realtime-asr 复用：生成完的播客可以放到 TranscriptHero 里展示字幕
```

---

### 3.7 录音文件识别 2.0（异步批量转写）

适合"上传文件 → 高精度转写"场景，精度优于实时流式：

```tsx
// components/FileTranscription.tsx
// 拖拽上传音频文件（mp3/wav/m4a/flac）
// 显示转写进度（轮询 task status）
// 完成后显示带说话人、时间戳的转写结果
// 一键导出 TXT/MD/SRT
```

---

## 四、前端最佳实践方案（对标飞书妙记技术栈）

### 4.1 目录结构重组

```
voice-portfolio/
├── vosk-realtime-asr/          # 现有实时 ASR（重命名为更通用的名字）
│   └── client/src/
│       ├── features/           # 按功能切分（而非组件/hooks 平铺）
│       │   ├── asr/            # 实时语音识别
│       │   ├── tts/            # 语音合成 2.0
│       │   ├── voice-clone/    # 声音复刻
│       │   ├── si/             # 同声传译
│       │   ├── realtime-voice/ # 端到端语音交互
│       │   └── podcast/        # 语音播客
│       ├── shared/             # 公共组件（AudioVisualizer, SpeakerTimeline 等）
│       └── store/              # Zustand 全局状态
```

### 4.2 共享音频采集层（所有功能复用）

```ts
// shared/audio/AudioCaptureWorklet.ts
// AudioWorklet（离主线程）替代 ScriptProcessorNode（已 deprecated）
class AudioCaptureWorklet {
  async init(constraints?: MediaStreamConstraints) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints ?? { audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('/audio-processor.js');  // 已有！
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'audio-processor');
    source.connect(worklet);
    return worklet;
  }
}
// 所有功能模块（ASR/SI/RealtimeVoice）共用同一个 worklet 实例
```

### 4.3 说话人时间轴可视化（竞标视觉核心）

```tsx
// shared/components/SpeakerTimeline.tsx
// 用 canvas 绘制，性能优于 SVG/DOM
// 横轴: 时间（秒），纵轴: 发言人，色块: utterance 区间
// 与 TranscriptHero 联动：点击色块高亮对应卡片
// 支持缩放（鼠标滚轮）、拖拽平移
```

### 4.4 Zustand + Immer 状态管理

```ts
// store/voiceStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';

export const useVoiceStore = create(devtools(immer((set) => ({
  // 共享状态
  activeFeature: 'asr' as Feature,
  audioLevel: 0,

  // ASR 状态（从 useTranscription 迁移）
  asr: { results: [], speakers: [], metrics: {} },

  // TTS 状态
  tts: { queue: [], isPlaying: false, currentVoiceId: 'default' },

  // SI 状态
  si: { sourceLang: 'zh', targetLang: 'en', pairs: [] },
}))));
```

### 4.5 功能入口 Tab 导航

```tsx
// AppShell.tsx — 顶部 Tab 切换不同豆包能力
const FEATURES = [
  { id: 'asr',     label: '实时转写',   icon: '🎙️', badge: 'LIVE' },
  { id: 'si',      label: '同声传译',   icon: '🌐', badge: 'NEW' },
  { id: 'clone',   label: '声音复刻',   icon: '🎭', badge: 'NEW' },
  { id: 'realtime',label: '语音对话',   icon: '💬', badge: 'NEW' },
  { id: 'podcast', label: '语音播客',   icon: '🎧', badge: 'NEW' },
  { id: 'file',    label: '文件识别',   icon: '📁', },
];
```

---

## 五、竞标前优先级总清单

```
P0 — 安全（今天，30min）:
  ☐ 火山引擎控制台重置 Access Token + API Key
  ☐ 截图移出 Git（git rm voice-doubao/*.png + .gitignore）
  ☐ 建 .env.example 文档化所需环境变量

P0 — 稳定性（今天，2-4h）:
  ☐ transports: ['websocket']
  ☐ VITE_WS_URL 环境变量
  ☐ startRecording() 8s 超时 reject
  ☐ TTS ObjectURL revokeObjectURL
  ☐ Production 构建过滤 console.log

P1 — 性能（明天，4-8h）:
  ☐ @tanstack/react-virtual 虚拟列表
  ☐ eventemitter3 重构 WebSocketClient
  ☐ 音频背压控制

P1 — 竞标核心新功能（本周，3-5天）:
  ☐ 语音合成 2.0 替换现有 TTS（音质立竿见影，半天工作量）
  ☐ 同声传译 2.0 基础 Demo（最高 wow factor）
  ☐ 说话人时间轴可视化
  ☐ 声音复刻 2.0 UI（如声音 ID 已完成训练）

P2 — 竞标加分（时间允许）:
  ☐ 端到端实时语音交互（ChatGPT Voice 同款体验）
  ☐ 语音播客生成器
  ☐ 录音文件识别 + 导出
  ☐ XState 状态机
  ☐ Playwright E2E
  ☐ AudioWorklet 统一采集层
  ☐ Socket 鉴权 token
```

---

## 六、当前代码亮点（竞标 PPT 应重点展示）

| 亮点 | 位置 | 说明 |
|------|------|------|
| TDD 全覆盖 | `__tests__/` | 848 行 reducer 测试 + E2E pipeline，展示工程纪律 |
| 纯函数 Reducer | `transcriptionReducer.ts` | 无 I/O、无 timer，可确定性测试 |
| F1 握手门控 | `WebSocketClient + App` | 解决"开头丢字"行业级问题，协议理解深度 |
| utterance 驱动合并 | `reducer:277` | start_time 稳定身份，处理标点/数字漂移 |
| F7 grace window | `App.tsx:66-78` | 1.5s grace + 3s fallback 双重保护 |
| djb2 speaker hash | `getSpeakerColor` | 同 ID 永远同色，无状态持久化，elegant design |
| 三主题支持 | `styles.css` | dark/light/hc 高对比度，无障碍 |
| 多说话人识别 | `SpeakerCard + SpeakerList` | 双击改名、颜色持久、session 级序号 |

---

## 七、评分

| 维度 | 当前分 | 接入全量豆包后预期分 |
|------|--------|-------------------|
| 代码质量 | 7.5 | 8.5 |
| 功能完整度 | 4.0 | 9.0 |
| 竞标视觉冲击力 | 5.0 | 9.5 |
| 工程规范 | 8.0 | 8.5 |
| **综合** | **6.2** | **9.0** |

**核心结论：技术底子不错，但 voice-doubao 里开通的服务一个都没接进来，是最大的失分点。先修 P0 安全问题，再花 3-5 天接入同声传译 + TTS 2.0 + 声音复刻，综合分可以从 6.2 跳到 9.0。**
