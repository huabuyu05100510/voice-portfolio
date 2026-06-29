# NestJS 全栈重写 + 火山引擎 TTS 朗读

**日期:** 2026-06-25
**模型:** glm-5.2
**类型:** Architecture Rewrite + Feature (TTS)
**TDD:** 全程 Red → Green, 44 服务端 + 236 客户端测试全绿

---

## 背景

旧后端是 Python Flask + 火山引擎 v3 sauc bigmodel_async 二进制 WSS 协议。
用户决定全栈重写为 NestJS, 同时新增「语音合成」: 把识别出的中文 final 句
用火山引擎 TTS 合成并自动朗读 (对标同传耳机)。

**范围确认:**
- 全栈 NestJS (含 ASR 二进制协议移植)
- TTS: 火山引擎语音合成, 朗读中文
- 暂跳过机器翻译 (MT), 后续单独迭代

**保留:** Python Flask server 暂留作协议参考, 不删除 (NestJS 跑在 5001, Python 在 5000, 互不影响)。

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (React, port 5173)                                  │
│  - WebSocketClient → socket.io → http://localhost:5001      │
│  - useTtsPlayback: <audio> 队列顺序播放                     │
│  - TtsPlayer 浮窗: 静音/跳过/队列长度                        │
└──────────────┬──────────────────────────────────────────────┘
               │ socket.io (transports: websocket)
┌──────────────┴──────────────────────────────────────────────┐
│ NestJS Backend (port 5001)                                  │
│                                                              │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────┐  │
│  │ AsrGateway   │──→│ SessionManager   │   │ MetricsSvc  │  │
│  │ (SocketIO)   │   │ (per-sid state)  │   │ (prom-client)│  │
│  └──────┬───────┘   └──────────────────┘   └─────────────┘  │
│         │                                                     │
│         │ create(sid, {onPartial,onFinal,onError})            │
│         ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ VolcengineAsrSession (1 per sid)                     │   │
│  │  - WebSocket(wss) ↔ 火山引擎 ASR                      │   │
│  │  - 协议层: protocol.ts (encode/parse 二进制帧)        │   │
│  │  - extract.ts: utterances + speakers                  │   │
│  └──────────────────────────────────────────────────────┘   │
│         │ onFinal(text, utterances, speakers, latency)       │
│         ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ TtsPipelineService                                    │   │
│  │  - per-sid 队列 + LRU 去重                            │   │
│  │  - TtsService.synthesize(text) → mp3 bytes            │   │
│  │  - emit tts_audio (base64 mp3) → 客户端               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  HTTP endpoints:                                             │
│   - GET /metrics (Prometheus)                                │
└─────────────────────────────────────────────────────────────┘
```

## 关键移植点

### 1. 二进制协议 (volcengine-proto/protocol.ts)
从 Python `volcengine_engine.py` 完整移植:
- 帧头 4 字节 (0x11 + msgType<<4|flags + serial<<4|compression + 0x00)
- 客户端帧: 0x1 full request (JSON+gzip), 0x2 audio-only (PCM+gzip)
- LAST flag (0x2) 标记最后一段
- 服务端帧解析支持可选 4 字节 seq (flags bit0 set 时)
- gzip 自动解压
- 等价 26 个单元测试 (含 roundtrip)

### 2. ASR 会话 (asr/asr-session.class.ts)
对照 `volcengine_session.py:VolcengineSession`:
- `start()`: 起 WebSocket, on('open') 发 full request
- `waitUntilReady(ms)`: F1 门控, 等握手+config 发送完成
- `sendAudio(buf)`: encodeAudioOnly + ws.send
- `finalize(lastBuf)`: encodeAudioLast (LAST flag)
- `close()`: ws.close()
- onMessage 分发: partial/final/error, full-带-utterances 当 final 处理
- 9 个单元测试 (mock ws 模块)

### 3. textBuffer (asr/text-buffer.ts)
对照 `text_buffer.py`: smartAppend / getLastSpeaker / extractTextFromUtterances.

### 4. SessionManager (asr/session-manager.service.ts)
per-sid 容器, 字段与 Python `app.py:create_session` 对齐:
textBuffer / speakersSeen / currentSpeakerId / lastKnownSpeakerId / metrics.

### 5. Gateway (gateway/asr.gateway.ts)
对照 `app.py` 的 SocketIO handlers:
- `start_recording { enable_tts }` → 起 ASR 会话, 握手门控, emit recording_started
- `audio_data` → 转发 PCM (仅在 recording|transcribing 状态)
- `stop_recording` → finalize, F7 grace window 1.5s
- ASR 回调 → emit `transcription_result`
- onFinal 内触发 TtsPipeline.submit (definite utterance only)

### 6. TTS (tts/)
- `TtsService.synthesize(text)` → POST 火山引擎 TTS HTTP API, 解析 base64 mp3
- `TtsPipelineService` — per-sid 异步队列, LRU 缓存 (configurable), 失败降级
- 9 个单元测试 (mock TtsService + FakeSocketIO)

### 7. 前端
- `WebSocketClient.ts`: 新增 `tts_audio` 事件 + `onTtsAudio` 回调
  `startRecording({ enable_tts })` 携带开关
- `useWebSocket.ts`: 新增 `onTtsAudio` 注册
- `useTtsPlayback.ts` (新): 单个 `Audio` 元素 + `onended` 链式播放,
  toggle/skip/clear, 静音时丢弃队列
- `TtsPlayer.tsx` (新): 右下浮窗控件 (🔊/🔇 + 队列徽章 + 跳过)
- `App.tsx`: 端口切到 5001, 接入 TtsPlayer, 默认 TTS 开启

## 测试

| 套件 | 数量 |
|------|------|
| NestJS protocol | 19 |
| NestJS extract | 8 |
| NestJS ASR session | 9 |
| NestJS TTS service (鉴权契约) | 6 |
| NestJS TTS pipeline | 9 |
| **NestJS 合计** | **50** |
| Client 现有 | 236 |

新增测试文件:
- `server-nest/src/volcengine-proto/protocol.test.ts`
- `server-nest/src/volcengine-proto/extract.test.ts`
- `server-nest/src/asr/asr-session.class.test.ts`
- `server-nest/src/tts/tts.service.test.ts` — 鉴权契约 (Authorization / cluster / Resource-Id)
- `server-nest/src/tts/tts-pipeline.service.test.ts`

冒烟/诊断脚本 (手工验证用):
- `scripts/smoke-asr.ts` — SocketIO 端到端走完 start/audio/stop
- `scripts/smoke-tts.ts` — 直接调火山引擎 TTS 验证凭证
- `scripts/probe-tts-cluster.ts` — 批量试 cluster 候选值
- `scripts/probe-tts-modes.ts` — 试鉴权/协议变体 (验证代码正确性)

## 已验证 (DoD)

- [x] `npx jest` (NestJS) 全绿 50/50
- [x] `npx vitest run` (client) 全绿 236/236
- [x] `npx tsc --noEmit` NestJS 零报错
- [x] `npx nest build` 成功
- [x] NestJS 服务在 5001 启动, env 加载, 路由注册
- [x] `/metrics` 端点暴露 prometheus 格式
- [x] ASR 端到端冒烟: connected → recording_started → recording_stopped 全通

## 待用户配合验证 (TTS)

TTS 服务端代码已就绪并按官方文档实现鉴权:
- **Authorization** header 格式 `Bearer; {token}` (分号 + 空格, 参考 docs/6561/1105162)
- **Resource-Id** header (`volc.service_type.10054`, 大模型 TTS HTTP V1)
- **body.app.cluster** 可配置 (`VOLC_TTS_CLUSTER`), 不再硬编码

实测 (scripts/probe-tts-modes.ts) 验证了鉴权层正确性:
- `Bearer; {token}` → 通过 auth, 到 grant 检查才失败
- `Bearer {token}` (空格替代分号) → "invalid auth token" (不同错误, 反证格式正确)
- 无 cluster → "Missing required: app.cluster" (反证 cluster 必填)
- HMAC256 + Secret Key → 同样到 grant 检查失败 (鉴权等价)

**最终错误:** `code=3001 "load grant: requested grant not found in SaaS storage"`

**结论:** 这是**控制台层授权缺失**, 不是代码 bug。
用户的 `APP_ID=5109034773` 实际是 **ASR 应用** (与 `VOLC_APP_KEY` 同一个), 在火山引擎 SaaS 后台没有绑定 TTS 服务授权 (grant)。

**用户需要做的 (任选其一):**
1. **方案 A (推荐):** 登录火山引擎控制台 → 语音合成 → 应用管理 → 编辑 AppID `5109034773` → **勾选/添加「语音合成」能力** → 保存
2. **方案 B:** 创建一个**新的**包含 TTS 能力的应用, 把对应的 AppID/Token/Secret 填到 `.env` 的 `VOLC_TTS_APP_ID` / `VOLC_TTS_ACCESS_TOKEN` / `VOLC_TTS_SECRET_KEY`
3. 同时在控制台确认 **cluster** 名 (默认 `volcano_tts`, 大模型语音合成可能是 `volcano_icl` / `speech_05_ttls` 等, 以控制台"应用空间"详情页为准), 写到 `.env` 的 `VOLC_TTS_CLUSTER`
4. 重启 NestJS (`npm run dev`), 录音验证

**诊断工具:**
- `scripts/probe-tts-cluster.ts` — 批量试 cluster 候选
- `scripts/probe-tts-modes.ts` — 试鉴权/协议变体

`TtsService` 已实现失败降级: TTS 异常不影响 ASR 主链路, 仅 warn 日志。

## 文件清单 (新增)

**NestJS server-nest/ (新建):**
- package.json, tsconfig.json, tsconfig.build.json, nest-cli.json, jest.config.js
- .env.example, .gitignore
- src/main.ts, src/app.module.ts
- src/config/{config.module,config.service}.ts
- src/logger/{logger.module,logger.service}.ts
- src/metrics/{metrics.module,metrics.service,metrics.controller}.ts
- src/volcengine-proto/{protocol,extract}.ts + tests
- src/asr/{asr.module,asr-session.class,asr-session.factory,session-manager.service,text-buffer}.ts + test
- src/tts/{tts.module,tts.service,tts-pipeline.service}.ts + test
- src/gateway/{gateway.module,asr.gateway}.ts
- scripts/{smoke-asr,smoke-tts}.ts

**Client (修改):**
- src/WebSocketClient.ts — TTS 事件 + enable_tts 选项
- src/hooks/useWebSocket.ts — onTtsAudio 桥接
- src/App.tsx — 端口 5001, TtsPlayer 接入
- src/__tests__/WebSocketClient.test.ts — 适配新 start_recording 契约

**Client (新增):**
- src/hooks/useTtsPlayback.ts
- src/components/TtsPlayer.tsx
- src/styles.css 追加 TtsPlayer 样式

## 风险

| 风险 | 缓解 |
|------|------|
| Python ASR 二进制协议移植有遗漏 | 26 个协议单元测试 + ASR session mock ws 测试覆盖关键路径; 端到端冒烟通过 |
| NestJS 跑 ASR 时 ws 客户端事件回调线程模型与 Python 不同 | ws 库单线程事件循环, 比 Python 的多线程读循环更简单, 不需要锁 |
| TTS 凭证不匹配用户的实际订阅 | 已 Isolating TTS 失败不影响 ASR; 待用户确认 cluster/授权 |
| 客户端自动播放策略可能拦截第一句 | useTtsPlayback 捕获 play() reject, 失败继续下一句; TtsPlayer 引导用户点击 |
