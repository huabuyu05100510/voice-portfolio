# Vosk Realtime ASR — 客户端架构

> 技术方案 · 模型: **Claude Opus 4.8** · Sprint 5 (2026-06-20, Sprint 7 更新整体架构图)
>
> 目标读者: 后接手 / review / 5 年后再回看的工程师。
> 一句话: **Hooks + Reducer 把 700+ 行的 App.tsx 拆成 4 个职责单一 hook + 1 个纯函数 reducer, UI 全部下沉到 layout 组件, App 只剩组合**。

---

## 0. 整体架构 (Sprint 7 总览)

```
                          ┌─────────────────────────────┐
                          │  Browser (port 3000)         │
                          │  ┌───────────────────────┐  │
                          │  │  AppShell (a11y 注入)  │  │
                          │  └──────────┬────────────┘  │
                          │             │                │
                          │  ┌──────────▼────────────┐   │
                          │  │   App.tsx (98 行)    │   │
                          │  └──┬───┬───┬────┬────┬──┘   │
                          │     │   │   │    │    │      │
                          │   WS  Rec Tr  Dbg  SA        │
                          │     │   │   │    │    │      │
                          │     ▼   ▼   ▼    ▼    ▼      │
                          │   WS  Audio  Reducer Log Spl │
                          │   Cli Eng (pure)            │
                          │     │   │                    │
                          │     │   ▼                    │
                          │     │  AudioWorklet           │
                          │     │  (16kHz mono Int16)     │
                          │     │                        │
                          │     ▼                        │
                          │  Subtitle · Perf · Visualizer│
                          │  (Canvas 直绘, 零 React)      │
                          └──────────┬──────────────────┘
                                     │ Socket.IO
                                     │ (audio_data / transcription_result)
                          ┌──────────▼──────────────────┐
                          │  Flask-SocketIO (port 5000) │
                          │  ┌────────────────────────┐ │
                          │  │ Vosk Worker            │ │
                          │  │ set_words(True)        │ │
                          │  │ → words[]              │ │
                          │  └────────────────────────┘ │
                          │  ┌────────────────────────┐ │
                          │  │ Prometheus (port 9091) │ │
                          │  └────────────────────────┘ │
                          └─────────────────────────────┘
```

**模块清单**:

| 层 | 模块 | 状态 |
|----|------|------|
| **浏览器-UI** | AppShell / AppLayout / AppHeader / ControlPanel / DebugPanel / HelpOverlay / ThemeSwitcher | 稳定 (Sprint 4-5) |
| **浏览器-组件** | Subtitle / PerfMonitor / Visualizer / TranscriptionRenderer / ObservabilityPanel | 稳定 (Sprint 1-3) |
| **浏览器-hook** | useWebSocket / useRecorder / useTranscription / useDebugLog / useSampleAudio | 稳定 (Sprint 5) |
| **浏览器-引擎** | WebSocketClient / AudioCapture / samplePlayer / WaveformVisualizer | 稳定 |
| **浏览器-状态** | transcriptionReducer (纯函数) | 稳定 (Sprint 5) |
| **浏览器-优化** | rAF 守卫 / React.memo / Worklet 缓存 | Sprint 7 |
| **服务端** | Flask-SocketIO + Vosk Worker + Prometheus | 稳定 (Sprint 1 起未动) |

---

## 1. 设计动机

Sprint 4 收尾时 `App.tsx` 已经膨胀到 **734 行**, 内嵌 4 大块互不相关的逻辑:
1. WebSocketClient 事件订阅 + 状态机 (idle / ready / recording / ...)
2. AudioCaptureEngine 生命周期 (init / start / stop / destroy)
3. Transcription 数据流 (results / currentText / fullText / words / finalStartTime)
4. Debug 日志 (15 条环形缓冲)

加上 7 个 `useState`、5 个 `useRef`、3 个 `useCallback`, 单一组件的可测试性几乎为零。
重构的核心约束是:

- **零回归**: UI 行为、键盘快捷键、可访问性 ARIA、PerfMonitor 全部不变
- **可测**: 每个状态变化都能在 1ms 内通过纯函数验证
- **可读**: 单文件 < 100 行, 命名空间清晰

---

## 2. 顶层架构图

```
                          ┌──────────────────────────────────────┐
                          │            index.tsx                 │
                          │    (ReactDOM.createRoot + Strict)    │
                          └─────────────────┬────────────────────┘
                                            │
                          ┌─────────────────▼────────────────────┐
                          │       AppShell.tsx  (default)        │
                          │  ├─ AccessibilityProvider            │
                          │  ├─ ShortcutBinder (Space/R/M/?/1-3) │
                          │  ├─ HelpOverlay (? 打开)            │
                          │  └─ <App />                          │
                          └─────────────────┬────────────────────┘
                                            │
                          ┌─────────────────▼────────────────────┐
                          │          App.tsx   (98 行)           │
                          │  - 5 个 hook 编排                    │
                          │  - 4 个 callback (start/stop/clear)  │
                          │  - 1 个 JSX: <AppLayout ... />      │
                          └─────────────────┬────────────────────┘
                                            │
              ┌─────────────────┬───────────┼───────────┬──────────────────┐
              ▼                 ▼           ▼           ▼                  ▼
       useWebSocket      useRecorder   useTranscription  useDebugLog  useSampleAudio
       (ws state)        (mic + wave)  (reducer)        (ring buf)   (no-mic 播放)
              │                 │           │           │                  │
              ▼                 ▼           ▼           ▼                  ▼
       WebSocketClient   AudioCaptureEngine  transcriptionReducer   samplePlayer
       (Socket.IO)       (AudioWorklet)      (pure function)         (切块+流)
```

---

## 3. 数据流 (1 个录音周期)

```
┌──────────┐  onAudioData   ┌──────────┐  dispatch    ┌──────────┐  WS audio_data
│ Mic      ├───────────────►│useRecorder├─────────────►│App.tsx   ├──────────────►
│(getUserM)│  Int16Array    │          │  byteLength  │          │  ArrayBuffer
└──────────┘                └────┬─────┘              └────┬─────┘  (sendTimeQueue)
                                 │                        │           │
                                 │ bindWaveformCanvas     │           ▼
                                 ▼                        │     ┌──────────┐
                          ┌────────────┐                  │     │Server    │
                          │Waveform    │                  │     │Vosk      │
                          │Visualizer  │                  │     │Worker    │
                          └────────────┘                  │     └────┬─────┘
                                                            │          │
                                                            │          ▼
                                          ┌─────────┐  ws.onTranscription
                                          │PerfMon  │◄────────── (latency Δt)
                                          └─────────┘
                                                            │
                                                            ▼
                          ┌────────────────────────────────────────────────┐
                          │   transcriptionReducer.transcriptionReducer   │
                          │   - TRANSCRIPT_PARTIAL → {currentText,fullText}│
                          │   - TRANSCRIPT_FINAL   → +results, +words      │
                          │   - AUDIO_CHUNK_RECORDED → metrics++           │
                          │   - CLEAR / RESET / METRICS_UPDATE            │
                          └──────────────────────┬─────────────────────────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │  AppLayout   │
                                          │  + Subtitle  │
                                          │  + Visualizer│
                                          │  + DebugPanel│
                                          └──────────────┘
```

---

## 4. 状态机

### 4.1 AppStatus (顶层 8 态)

```
            ┌────────────┐  ws.connected     ┌────────────┐
            │   idle     ├───────────────────►│  ready     │
            └─────▲──────┘                    └──────┬─────┘
                  │                                  │ click "开始录音"
                  │ ws.disconnected                  ▼
                  │                            ┌────────────┐
                  │                            │ connecting │ (recorder.init)
                  │                            └──────┬─────┘
                  │                                   ▼
                  │                            ┌────────────┐
                  │ click "停止"               │ recording  │
                  │   or stop_recording        └──────┬─────┘
                  │                                   │ partial/final 回包
                  │                                   ▼
                  │                            ┌────────────┐
                  │                            │transcribing│
                  │                            └──────┬─────┘
                  │                                   │ ws.onDisconnected
                  │                                   │ or playSample 完成
                  │                                   ▼
                  │                            ┌────────────┐
                  └────────────────────────────┤ completed  │
                                               └────────────┘
        ┌────────────┐  any error
        │   error    │◄──────────────────────────┐
        └────────────┘                            │
        ▲                                         │
        └──── 任意状态 click "清除" / start_recording 重置
```

转换约束 (在 `App.tsx` 的 `useEffect` / callbacks 里强制):

- `idle → ready`: 只能由 `useWebSocket` 的 `onConnected` 触发
- `ready → recording`: 必须 `wsState === 'connected'` 且点击 "开始录音"
- `recording → completed`: 必须 `stop_recording`, 音频采集器 `destroy`
- `completed → ready`: 用户点击 "清除" 或新一轮 start

### 4.2 transcriptionReducer 状态机

5 种 action, 全是 pure function:

| Action               | 触发源                  | 副作用              |
|----------------------|-------------------------|---------------------|
| `TRANSCRIPT_PARTIAL` | ws.onTranscription(isFinal=false) | 更新 currentText  |
| `TRANSCRIPT_FINAL`   | ws.onTranscription(isFinal=true)  | append results, 重置 finalStartTime |
| `AUDIO_CHUNK_RECORDED` | recorder 每 0.25s 一次 | 累加 audioBytes / chunksProcessed |
| `METRICS_UPDATE`     | ws.onSessionStatus       | 整体替换 metrics  |
| `CLEAR` / `SESSION_RESET` | 用户 R 键 / 新会话  | 重置, 保留 startTime |

不变量 (reducer 测试覆盖):

1. `MAX_RESULTS = 200` 上限, FIFO 淘汰
2. `CLEAR` 后 `metrics.startTime` 保留
3. partial 不带 `fullText` 时, 沿用旧值

---

## 5. 模块依赖图

```
                    ┌──────────────┐
                    │   AppShell   │
                    └──────┬───────┘
                           │ render
                           ▼
                    ┌──────────────┐
                    │     App      │  (98 行, 仅组合)
                    └──┬───┬───┬───┘
                       │   │   │
       ┌───────────────┘   │   └────────────────┐
       ▼                   ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌────────────────┐
│ useWebSocket │   │ useRecorder  │    │ useTranscription│
└──────┬───────┘   └──────┬───────┘    └────────┬───────┘
       │                  │                     │
       ▼                  ▼                     ▼
┌──────────────┐   ┌──────────────┐    ┌────────────────────┐
│WebSocketClient│  │AudioCaptureEng│   │transcriptionReducer│
│  (Socket.IO) │  │  (Worklet)   │    │   (pure function)  │
└──────────────┘   └──────────────┘    └────────────────────┘

       (App 内部直接调用 useDebugLog / useSampleAudio, 不画进依赖图)
```

**依赖方向严格向下**: App → hooks → engine / reducer, 严禁反向引用。

---

## 6. 关键设计决策

### 6.1 为什么用 reducer 而不是更多 useState

- **可测**: `transcriptionReducer(state, action) → newState` 是纯函数, 单测覆盖 12 个 case 只需 5ms
- **可预测**: 所有 transcription 字段在同一处更新, 不存在 "setResults 后忘记 setCurrentText" 的可能
- **可调试**: 可以在 reducer 入口打 `console.log`, 比 4 个 useState 一起看爽得多

### 6.2 为什么 hooks 暴露 callback registration (而不是 props 链)

`useWebSocket` 把 `client: WebSocketClient | null` 暴露给消费者, 而不是把 `onTranscription` 透传, 原因:

- `AudioCaptureEngine` / `WebSocketClient` 都是 **单例资源**, 不允许在 React 树里被卸载 / 重挂
- 让 hook 内部维护 ref, 永远拿最新回调, **彻底规避 stale closure** (老 App.tsx 用 `stateRef.current` 修这个坑, 现在 hook 自己消化)
- App 的 `useEffect` 注册一次即可, 不需要在每个 callback 里加 deps

### 6.3 AppLayout / AppHeader / ControlPanel / DebugPanel 拆分的代价

每个组件文件 < 70 行, 但 **props drilling 加了一层**。值得, 因为:

- App.tsx 从 734 → **98 行** (-87%), 单屏可见
- 每个子组件独立可测 (props 简单)
- ControlPanel 把所有按钮 ARIA label 集中, 后续 Sprint 加 i18n 时只动一个文件

### 6.4 samplePlayer 拆为 useSampleAudio hook

原本 `playSampleAudio` 是 App 内部 60 行的 `async` 块, 内嵌 fetch / decode / stream 三段流程。
抽成 hook 后:

- fetch / decode 失败 → error 日志统一
- 测试可以 mock `fetch` 直接调 hook.play() 验证 dispatch
- App 里只剩 4 行 callback

### 6.5 PerfMonitor / Visualizer / Subtitle 不动

Sprint 1-3 已经把它们做成自驱组件 (rAF / AudioContext AnalyserNode 直连), 不依赖 React state。
所以重构 App.tsx 不会触发任何视觉 regression — 这也是为什么把 sprint 拆成 5 个 phase, 每个 phase 都跑完整截图。

---

## 7. 测试矩阵

| 层       | 工具       | 数量  | 覆盖                                              |
|----------|------------|-------|---------------------------------------------------|
| Reducer  | vitest     | 12    | 全部 5 种 action + 上限 + 不变量                  |
| Hook     | vitest     | 5     | useDebugLog (push / cap / clear / console)        |
| 引擎     | vitest     | 114   | subtitleKaraoke / Visualizer / WebSocketClient /  |
|          |            |       | samplePlayer / PerfMonitor / Accessibility /      |
|          |            |       | KeyboardShortcuts / ThemeSwitcher / HelpOverlay    |
| 服务端   | pytest     | 17    | vosk_engine + vosk_worker + metrics 单元          |
| **合计** |            | **148** | vitest 131 + pytest 17                            |

端到端 (Playwright): `capture_arch.py` 校验 h1 + 按钮数, 截图保存到
`changes/2026-06-20-sprint-5-arch.png`。

---

## 8. 未来扩展点

| 需求               | 改动点                                                       |
|--------------------|--------------------------------------------------------------|
| i18n               | 抽 `STATUS_LABELS` 到 `i18n.ts`, AppShell 包一层 `<I18nProvider>` |
| 标注 (annotation)  | 在 reducer 加 `ANNOTATION_ADD` action, results 存 `annotations?: Annotation[]` |
| 持久化会话         | AppShell 加 `useSessionPersist` hook, 写 localStorage        |
| 多会话并行         | reducer 加 `sessionId` 字段, App 用 `useReducer` 持 reducer map |
| Web Worker 减主线程 | 把 `transcriptionReducer` 移入 worker, 用 `useSyncExternalStore` |

---

## 9. 总结

- 5 个 hook + 1 个 reducer + 4 个 layout 组件 = 完整的"业务编排层"
- App.tsx 只剩 98 行, 5 个 hook 串联 + 1 个 JSX
- 148 个测试, 纯函数 / hook / engine / server 全覆盖
- 无 server 改动, 无 Phase 1-4 组件改动
- 改动日志: `changes/2026-06-20-sprint-5-arch.md`
- 回归截图: `changes/2026-06-20-sprint-5-arch.png`

—— Claude Opus 4.8, 2026-06-20 17:09