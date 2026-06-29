**模型:** MiniMax-M3

# 2026-06-27 端到端实时语音交互 (Realtime Voice Interaction) 接入

## 概述

接入火山引擎**端到端实时语音大模型** (`Doubao_scene_SLM_Doubao_realtime_voice_model`),
实现**语音 ↔ LLM 全双工对话** (用户说话 → ASR → LLM 推理 → TTS 合成 → 用户听).
对标 ChatGPT Voice Mode / Pi.ai 的沉浸式对话体验, 支持打断 (barge-in).

实例凭证已迁出至 `~/.voice-portfolio-secrets/` (不写入 git), 通过环境变量注入.

## 改动文件清单

### 新增
- `vosk-realtime-asr/server/realtime_voice.py` — 后端协议封装 + Flask 路由挂载
- `vosk-realtime-asr/server/__tests__/test_realtime_voice.py` — 服务端 TDD 测试 (20 个用例)
- `vosk-realtime-asr/client/src/state/conversationReducer.ts` — 纯函数 reducer
- `vosk-realtime-asr/client/src/state/__tests__/conversationReducer.test.ts` — reducer TDD (19 个用例)
- `vosk-realtime-asr/client/src/hooks/useRealtimeConversation.ts` — WS + 麦克风采集 + 音频播放 hook
- `vosk-realtime-asr/client/src/__tests__/useRealtimeConversation.test.ts` — hook TDD (14 个用例)
- `vosk-realtime-asr/client/src/components/RealtimeChat.tsx` — 沉浸式对话 UI
- `vosk-realtime-asr/client/src/__tests__/realtimeChat.test.tsx` — UI TDD (16 个用例)
- `docs/2026-06-27-realtime-voice-design.md` — 完整技术方案

### 修改
- `vosk-realtime-asr/server/config.py` — 加 `VOLC_REALTIME_*` 环境变量
- `vosk-realtime-asr/server/app.py` — 挂载 `/api/realtime/health` 端点
- `vosk-realtime-asr/client/src/types.ts` — 加 `Role` / `ConversationMessage` 类型 (扩展, 不动现有)
- `vosk-realtime-asr/client/src/App.tsx` — 加"对话模式"入口 + 模式切换
- `vosk-realtime-asr/client/src/styles.css` — 加 `.realtime-chat-*` 与 `.rt-mode-switch` 样式

### 未修改
- `transcriptionReducer.ts` (现有 ASR 流程)
- `useTtsPlayback.ts` / `TtsPlayer.tsx` (现有 TTS 流程)
- 任何 ASR/TTS 业务逻辑

## TDD 覆盖 (红→绿→重构)

| 模块 | 测试数 | 覆盖场景 |
|---|---|---|
| `test_realtime_voice.py` | 20 | 鉴权 header (Bearer; / X-Api-App-Id / Resource-Id), session.update payload, audio chunk 编码, server event 解析 (audio.delta / transcript.delta / speech_started / speech_stopped / done / error / unknown), 端点 200/503 行为, OTel span |
| `conversationReducer.test.ts` | 19 | 连接生命周期, 状态切换, user/ai 消息 append, AI 文本流式累加, 切换 response_id 自动 commit, audio chunk 累计, BARGE_IN (打断 + interrupted=true + 计数), TURN_DONE (latency 累计), AI_MESSAGE_REPLACE, CLEAR |
| `useRealtimeConversation.test.ts` | 14 | dispatch 路径, WS 连接 + session.update 发送, sendAudio, speech_started 触发 BARGE_IN, user transcript 完成触发 USER_MESSAGE, response.done 触发 TURN_DONE, disconnect 关闭 ws, audio delta 入队 + 累计 audioBytes, stopPlayback 不抛 |
| `realtimeChat.test.tsx` | 16 | 状态渲染 (idle/connecting/listening/speaking/error), 按钮交互 (开始/结束/清空), PTT 鼠标按下, 消息气泡 (user/AI/interrupted/streaming typewriter), 指标展示 (轮次/打断/延迟), 无障碍 (role=region, aria-live=polite) |

**总计:** 69 个新增测试, 全部通过.

## 协议 (Doubao Realtime Voice, OpenAI Realtime API 兼容)

### Client → Server
- `session.update` — VAD / 音频格式 / LLM 指令
- `input_audio_buffer.append` — PCM 16kHz mono int16 → base64
- `input_audio_buffer.commit` — 强制结束一段 (server_vad 自动模式可省)
- `response.cancel` — 主动打断 AI 回复

### Server → Client
- `input_audio_buffer.speech_started` — **打断 (barge-in) 信号**
- `input_audio_buffer.speech_stopped` — 轮次结束
- `conversation.item.input_audio_transcription.completed` — 用户 ASR 结果
- `response.audio_transcript.delta` — **AI 文字流 (打字机)**
- `response.audio.delta` — **AI 音频流 (16kHz PCM)**
- `response.done` — 整轮完成 (含 usage)

## 鉴权

服务端代理注入, 浏览器不持有 token:

```
Authorization: Bearer; <VOLC_REALTIME_TOKEN>
X-Api-App-Id: <VOLC_REALTIME_APP_ID>
X-Api-Resource-Id: volc.speech.realtime_voice
```

启动期 fail-fast: `RealtimeConfig` 构造时凭证缺失 → `ConfigError` → `/api/realtime/health` 返回 503, 不阻塞其他模块启动.

## 可观测

- **服务端日志 (StructuredLogger):** `[Realtime] session_open / user_input / ai_output / barge_in`
- **OTel spans:** `realtime.session_open` / `realtime.user_input` / `realtime.ai_output`
- **Metrics (reducer 内统计):** 对话轮次 / 平均响应延迟 (`latency.totalMs / turns`) / 打断次数 (`bargeIn.count`)

## UI 设计

参考 ChatGPT Voice Mode / Pi.ai:
- **全屏沉浸** (`position: fixed; inset: 0`)
- **大圆形 PTT 按钮** (120px, 渐变色, 呼吸光晕)
- **用户/AI 消息左右分栏** (max-width: 70%, 圆角气泡, 用户紫色渐变 / AI 深色)
- **AI 文字打字机** (`.rt-cursor` 闪烁光标, `streamingText` 实时渲染)
- **AI 音频播放动画** (5 根波形条交错动画, 仅在 `speaking` 状态)
- **状态 pill** (顶部彩色圆点 + 文字, idle/listening/thinking/speaking/error 不同颜色 + 脉冲)
- **响应式** (768px 以下 PTT 缩到 96px, 消息气泡 max-width 88%)
- **prefers-reduced-motion** (全部动画降级)

## 改动量统计

- 新增代码: ~1100 行 (realtime_voice.py + hook + reducer + UI + 测试)
- 修改代码: ~80 行 (config.py + app.py + App.tsx + styles.css + types.ts)
- 测试代码: ~900 行 (覆盖 69 个用例)

## 未来拓展 (留作 Sprint 14+)

- function calling: `tools` 字段透传 + 工具执行回路
- 对话持久化 (localStorage)
- 多语言切换 (instructions + audio_format)
- 多模态输入 (图片 + 语音) — 火山引擎部分模型支持