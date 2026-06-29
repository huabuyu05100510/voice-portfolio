# 面试演示脚本 — voice-portfolio 5 分钟

**模型:** MiniMax-M3
**日期:** 2026-06-27

---

## 演示前 30 分钟

```bash
# 1. 启 Jaeger
cd /Users/didi/Downloads/前端AI面试题/voice-portfolio/jaeger
docker compose up -d

# 2. 启后端 (含 OTel traceparent 解析)
cd /Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server
pip install -r requirements.txt   # 装 OTel 包（如已装可跳过）
python app.py

# 3. 启前端 (Vite dev 含 /otel 代理)
cd /Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client
npm install   # 装 OTel 包
npm run dev

# 4. 准备两个浏览器窗口
# - http://localhost:5173 (前端 demo)
# - http://localhost:16686 (Jaeger UI)
```

---

## 5 分钟演示流程

### Step 1 (30s) — 打开双窗口自我介绍

> "我做了一个对标 Otter.ai / 飞书妙记的实时语音转写作品集，重点突破了三大块：**极致 UI 性能、可观测性天花板、音频工程纵深**。"

桌面并排：
- 左：localhost:5173（前端 demo）
- 右：localhost:16686（Jaeger trace）

### Step 2 (60s) — 演示卡拉OK 字幕 + 实时转写

1. 点"开始录制"按钮 → 麦克风授权
2. 说话 5 秒："今天我们要讨论 voice-portfolio 项目的三个技术亮点"
3. 边说边指：

> "看这里 —— 顶部主区是历史流卡片，底部 sticky 字幕是 **卡拉OK 逐字高亮**：过去词半透、当前词 speaker 色 + glow 阴影、进度条沿当前词底部滑动。"
>
> "右边的实时指标板可以看到：FPS、帧时间、WS 延迟 P50/P95/P99、JS 堆内存、partial 接收频率、字幕渲染耗时 P95。"

### Step 3 (90s) — 杀手锏：完整 trace 链路

1. 切到 Jaeger 窗口
2. Service 下拉选 `voice-portfolio-client` → Find Traces
3. 指出完整 trace 树：

> "这是 W3C Trace Context 跨进程 trace —— 用户点击开始录制的那一刻起，每一个 span 都被串联起来："
>
> - `user.click` (root, 浏览器)
> - `ws.connect` (socket.io connect)
> - `ws.send_audio × N` (每 256ms 一个)
> - `server.receive_audio` (Flask 端)
> - `volcengine.sauc.send / finalize` (字节火山引擎黑盒)
> - `ws.transcription_result`
> - `reducer.merge_partial` (React 端)
> - `render` (React Profiler)

4. 点开某个 span 看 attributes：

> "看 `chunk.bytes=4096`、`session.id`、`speaker.id=spk_001`、`confidence=0.94` —— 全链路 metadata 透传，**30 秒内能从用户点击 debug 到具体某帧 PCM 数据**。"

### Step 4 (60s) — 演示音频工程加固

1. 切回前端 → Sidebar 找 "纯净模式 / 会议模式" toggle
2. 解释：

> "这是 AudioWorklet 录音的 profile 切换 —— 默认会议模式开 NS/AEC/AGC 适合远场；纯净模式关闭让原始 PCM 直达 ASR，可对比识别准确率。"
>
> "下方的 VisualizerPanel 展示 4 维度实时音频：频谱热力图、音高 ACF 曲线、能量 VU 条、VAD 指示灯。"

3. 看 PerfMonitor 的 audio 指标：

> "看 `Audio baseLatency / outputLatency / Worklet underruns` —— 这些是 AudioContext 硬件层延迟和录音卡顿的计数器。AudioContext.onstatechange 监听 + 采样率软重采样兜底都在这里。"

### Step 5 (60s) — 代码 + 架构亮点总结

切到 VSCode 展示关键文件，**不要超过 30 秒**：

> "代码层面我严格 TDD：22+ 个 reducer 测试、4 个 e2e、100+ 个新测试全绿。架构上 reducer 保持纯函数、word-level timing 数据通道自下而上贯通、可观测性是 OpenTelemetry Web SDK + 自研 ring buffer 双栈。"

---

## 常见追问预案

### Q1: "为什么不直接用 ScriptProcessorNode？"

> "项目已经在 AudioWorklet 主路径 —— 独立线程、零拷贝 transferable buffer。我做的是加固而非迁移：AudioContext 状态机监听、采样率软重采样兜底、underrun 计数器、profile 切换。"

### Q2: "WS 延迟 P99 怎么算的？"

> "自研 `SlidingWindow<number>(200)` 环形数组 + nearest-rank `percentile()` 纯函数。P99 用最近 200 个样本，保证 UI 实时反映近期波动而不是历史均值。"

### Q3: "为什么用 OpenTelemetry 而不是 Sentry？"

> "Sentry 偏错误追踪 + RUM，OpenTelemetry 是 W3C Trace Context 标准 —— 跨进程、跨语言、跨厂商。我需要的是端到端 trace 而不只是前端错误，所以选 OTel + Jaeger。生产环境用 `parentbased_traceidratio(0.05)` 采样 + error 全采样平衡成本。"

### Q4: "服务端 trace 怎么打通？"

> "Socket.IO 不走 HTTP header，所以我把 W3C `traceparent` 塞到 `auth` payload。服务端 `handle_connect` 用 `opentelemetry.propagate.extract()` 还原 trace context，挂到 session 和 logger。Flask + WebSocket 两条链路同一个 trace_id。"

### Q5: "卡拉OK 进度条为什么会有跳变？"

> "服务端 `latency_ms` 与前端 `finalStartTime = performance.now()` 未校准。短期接受跳变，长期方案是用服务端时间戳做端到端补偿。这个问题本身就是模块 A 文档里标注的'遗留风险'，技术诚实比硬吹重要。"

### Q6: "为什么关掉 NS/AEC/AGC 后准确率更高？"

> "因为远场麦克风本身已经做了硬件级信号调理，软件 NS/AEC 反而会破坏声学特征。火山引擎 v3 自带 VAD + 智能分段 + 说话人分离，前端不需要重复。Profile 切换就是 A/B 验证的 UI 入口。"

### Q7: "你怎么保证 reducer 纯函数？"

> "`transcriptionReducer.ts` 永远是 `(state, action) => state`，所有时间戳字段（如 `finalStartTime`）由 `useTranscription.ts` 的 dispatch 调用点用 `performance.now()` 注入，**绝不**在 reducer 内部调任何有副作用的 API。这是 React + Redux 时代就传承的最佳实践。"

---

## 演示后

### 收尾话术

> "这个项目我用 multi-agent 协作：调研 → 设计 → 实施三阶段并行。每个模块严格 TDD：失败测试 → 最小实现 → 重构 → 全量回归。所有改动有 docs/ 技术方案 + changes/ 改动记录可追溯。"
>
> "如果现场想看代码，可以直接打开 `docs/2026-06-27-*-design.md` 看完整方案。"

### 简历配套

LinkedIn / 简历可写：

> **Voice Portfolio (个人作品)**
> - 火山引擎 v3 实时语音转写全栈（React 18 + Flask + Web Audio）
> - 自研 AudioWorklet 录音引擎 + Canvas 2D 4 维度可视化
> - OpenTelemetry 跨进程全链路 trace（30s 内定位问题到具体 span）
> - 卡拉OK 词级高亮字幕 + reducer 纯函数架构
> - TDD 100+ 测试全绿，多 agent 协作开发

---

## 故障应急

| 现象 | 应急 |
|------|------|
| Jaeger 看不到 trace | 检查 TraceToggle 是否开启；检查 vite proxy `/otel` 是否通 |
| 卡拉OK 不高亮 | 检查 final 段是否带 words 数组（DevTools 看 WS 消息） |
| 麦克风没声音 | 检查 Sidebar profile 是否切到 meeting（默认） |
| 测试报错 | `cd client && npm test -- --run` 跑全量，看冲突文件 |

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 初版演示脚本 |