# 端到端实时语音交互 (Realtime Voice Interaction) — 设计方案

**模型:** MiniMax-M3
**日期:** 2026-06-27
**实例:** `Doubao_scene_SLM_Doubao_realtime_voice_model2000000676263262370` (运行中, 1,000,000 tokens)

---

## 1. 目标

接入火山引擎「端到端实时语音大模型」, 实现 **语音 ↔ LLM 全双工对话**:

```
[麦克风 PCM] → [浏览器] → [后端代理] → [火山引擎 Realtime WSS] → [LLM 推理] → [TTS 合成音频] → [后端代理] → [浏览器播放]
                                                          ↓
                                                    [流式文本 delta]
```

用户体验对标 ChatGPT Voice Mode / Pi.ai:
- 全屏沉浸式对话 UI
- 大圆形"按住说话"按钮, 呼吸光晕
- 用户/AI 消息左右气泡
- AI 回复**文字流式打字 + 音频同步播放**
- **打断 (barge-in)**: 用户开始说话立即停止 AI 播放

---

## 2. 协议调研 (Doubao Realtime Voice)

### 2.1 鉴权

火山引擎 Realtime Voice endpoint 走 `wss://` 长连接, 鉴权 header:

| Header | 说明 |
|---|---|
| `Authorization: Bearer; {token}` | 主鉴权 token |
| `X-Api-App-Id: {app_id}` | 应用 ID |
| `X-Api-Resource-Id: volc.speech.realtime_voice` | 资源 ID |

环境变量命名 (与火山引擎控制台一致):
- `VOLC_REALTIME_APP_ID`
- `VOLC_REALTIME_TOKEN`
- `VOLC_REALTIME_ENDPOINT` (默认 `wss://openspeech.bytedance.com/api/v3/realtime`)
- `VOLC_REALTIME_MODEL` (默认 `Doubao_scene_SLM_Doubao_realtime_voice_model`)

### 2.2 协议 (OpenAI Realtime 兼容事件)

Realtime Voice 采用 OpenAI Realtime API 兼容的 JSON 事件流:

**Client → Server:**

| 事件 | payload | 用途 |
|---|---|---|
| `session.update` | `{session: {...config}}` | 配置会话 (VAD, TTS voice, LLM 指令, 音频格式) |
| `input_audio_buffer.append` | `{audio: "base64"}` | 推 PCM 音频块 (16kHz mono int16) |
| `input_audio_buffer.commit` | `{}` | 标记当前 buffer 已完整 (VAD 关闭后触发) |
| `response.create` | `{response: {...}}` | 主动请求 LLM 回复 (可选, 服务端 VAD 自动模式可省略) |
| `conversation.item.truncate` | `{item_id, ...}` | 打断时截断当前 AI 回复 |

**Server → Client:**

| 事件 | payload | 用途 |
|---|---|---|
| `session.created` / `session.updated` | `{session}` | 会话握手 ack |
| `input_audio_buffer.speech_started` | `{audio_start_ms}` | **VAD 检测到用户开始说话** (barge-in 信号) |
| `input_audio_buffer.speech_stopped` | `{audio_end_ms}` | VAD 检测到用户停止说话 |
| `conversation.item.input_audio_transcription.delta` | `{delta, item_id}` | 用户语音识别文本流 |
| `conversation.item.input_audio_transcription.completed` | `{transcript}` | 用户语音识别完成 |
| `response.audio.delta` | `{delta, item_id, response_id}` | **AI 回复音频 PCM 流** (核心, base64) |
| `response.audio.done` | `{item_id, response_id}` | 单条音频回复完成 |
| `response.audio_transcript.delta` | `{delta, item_id, response_id}` | **AI 回复文字流** (打字机效果) |
| `response.audio_transcript.done` | `{transcript}` | AI 回复文字完成 |
| `response.done` | `{response}` | 整轮回复完成 (含 usage) |
| `error` | `{code, message}` | 错误 |

### 2.3 打断 (Barge-in) 语义

服务端内置 VAD (默认 `silence_duration_ms=400`, `threshold=0.5`).
当服务端检测到用户在 AI 说话时开始发声, 会:
1. 推送 `input_audio_buffer.speech_started` 事件
2. **自动截断当前 AI 响应** (audio + transcript 都不会继续)
3. 推送 `conversation.item.truncated` 事件

客户端实现:
- 监听 `speech_started` → 立即 `audioContext.currentTime` 暂停播放 + 清空 buffer
- 监听 `item.truncated` → UI 把当前 AI 气泡标记为「被打断」, 显示 ⋯⋯

### 2.4 函数调用 (Function Calling)

服务端支持 `response.create` 时声明 `tools=[...]`, 服务端会在 LLM 决定调用工具时推送:
- `response.function_call_arguments.delta` / `.done`
- 客户端执行后通过 `conversation.item.create` 注入结果, 再 `response.create` 让 LLM 继续

> 本期不实现 (留作 Sprint 13 拓展, 文档预留 `tools` 字段透传).

### 2.5 支持的 LLM 模型

实例 ID 锁定了底层 LLM, 当前是 Doubao 场景化端到端实时语音大模型 (内部为 Doubao-1.5-pro + 自研流式 TTS 集成). 服务端配置 `model` 字段可选, 但通常与实例配套.

---

## 3. 架构

```
┌──────────────────────────────────────────────────────┐
│  Browser (RealtimeChat.tsx)                          │
│  ├─ useRealtimeConversation hook                     │
│  │   ├─ WS 连接 (/api/realtime 代理)                  │
│  │   ├─ AudioContext 16kHz → base64 PCM chunks        │
│  │   ├─ 接收 audio delta → AudioBufferSource 队列播放  │
│  │   └─ 接收 text delta → conversationReducer 打字机   │
│  └─ <RealtimeChat> 全屏 UI                            │
│      ├─ 大圆形 PTT 按钮 (breathing glow)              │
│      ├─ 用户/AI 气泡 (左右分栏)                       │
│      ├─ AI 音频波形动画                               │
│      └─ 状态 pill: idle / listening / thinking /      │
│                    speaking / interrupted            │
└──────────────────────────────────────────────────────┘
                       ↕ WSS (JSON events)
┌──────────────────────────────────────────────────────┐
│  Flask-SocketIO / WSS bridge (server/realtime_voice.py)│
│  ├─ 接收 client audio_frame → 转 base64 → forward     │
│  ├─ 接收 server audio delta → broadcast to client     │
│  ├─ 注入 auth headers + session config (首帧)         │
│  ├─ OTel spans: realtime.user_input / realtime.ai_output│
│  └─ Metrics: dialog.turns, dialog.latency_ms,         │
│              dialog.barge_in_total                    │
└──────────────────────────────────────────────────────┘
                       ↕ WSS (JSON events, auth)
┌──────────────────────────────────────────────────────┐
│  Volcano Engine Realtime Voice API                   │
│  (Doubao_scene_SLM_..._model)                        │
└──────────────────────────────────────────────────────┘
```

### 3.1 后端代理 vs 浏览器直连

火山引擎鉴权用 App ID + Token, **不建议前端直接持有 token** (泄露风险). 因此:
- 浏览器 ↔ Flask 是 WSS (`/api/realtime`)
- Flask ↔ 火山引擎是 WSS (注入 auth headers)
- Flask 做协议透传 + 鉴权注入 + 观测

### 3.2 WSS 与 Socket.IO 共存

Flask-SocketIO 当前监听 `/socket.io` (默认 namespace). Realtime Voice 用**原生 Flask WSS** (`flask[async]` + websockets), 路径 `/api/realtime`, 不与 SocketIO 冲突.

---

## 4. 状态机

```
idle ──[点击按钮/按住]──→ connecting ──[WSS open]──→ listening
                                                          │
                                                          ↓ VAD end
                                                       thinking ──[first audio delta]──→ speaking
                                                          ↑                                  │
                                                          └─[speech_started (barge-in)]────┘
                                                          │
                                                          ↓ turn end
                                                       listening (next user turn)
                                                          │
                                                          ↓ [user stop]
                                                       completed (清空对话)
```

`conversationReducer` 是纯函数, 管理 messages / streaming text / playback state.

---

## 5. 文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/realtime_voice.py` | 新建 | Realtime Voice 后端代理 + 协议解析 |
| `server/__tests__/test_realtime_voice.py` | 新建 | TDD: 协议帧解析 + 鉴权头 + 鉴权缺失 fail-fast |
| `client/src/state/conversationReducer.ts` | 新建 | 纯函数 reducer |
| `client/src/state/__tests__/conversationReducer.test.ts` | 新建 | TDD: 所有 action |
| `client/src/hooks/useRealtimeConversation.ts` | 新建 | WS 生命周期 + audio 采集 |
| `client/src/hooks/__tests__/useRealtimeConversation.test.ts` | 新建 | TDD: hook 行为 |
| `client/src/components/RealtimeChat.tsx` | 新建 | 沉浸式对话 UI |
| `client/src/__tests__/realtimeChat.test.tsx` | 新建 | TDD: UI 渲染 + 交互 |
| `client/src/styles.css` | 修改 | 加 `.realtime-chat-*` 样式 |
| `client/src/AppLayout.tsx` | 修改 | 加"对话模式"入口 |
| `client/src/App.tsx` | 修改 | 路由 state + 切换 RealtimeChat |
| `server/app.py` | 修改 | 注册 `/api/realtime` WSS endpoint |
| `server/config.py` | 修改 | 加 `VOLC_REALTIME_*` env |
| `changes/2026-06-27-realtime-voice.md` | 新建 | 改动记录 |

---

## 6. 可观测

**服务端日志 (StructuredLogger):**
```
[Realtime] session_open { session_id, app_id_set }
[Realtime] user_input { text_len, latency_ms }   # ASR 完成时
[Realtime] ai_output { text_len, audio_bytes, latency_ms }  # AI 回复完成时
[Realtime] barge_in { session_id, response_id }  # 打断时
[Realtime] error { code, message }
```

**OTel spans:**
- `realtime.session_open` (握手)
- `realtime.user_input` (用户一句转写完成)
- `realtime.ai_output` (AI 一条回复完成)

**Prom 指标:**
- `realtime_dialog_turns_total`
- `realtime_dialog_latency_seconds` (Histogram)
- `realtime_barge_in_total`
- `realtime_errors_total{error_type}`

---

## 7. 安全

- Token 仅在服务端, 浏览器经 Flask WSS 桥接
- `.env` 中存 `VOLC_REALTIME_TOKEN`, 不入 git
- 启动时 fail-fast: 凭证缺失时 `/api/realtime` 返回 503, 不静默用空 token 调线上

---

## 8. 局限与未来

- 本期不实现 function calling (留 `tools` 字段透传)
- 不实现对话持久化 (刷新页面即清空, 留 `localStorage` 拓展)
- 不实现多语言切换 (默认 zh, session 配置可改 `input_language`/`output_language`)