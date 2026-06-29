# 改动记录: NestJS 全栈重写 + 火山引擎 TTS 朗读

**日期:** 2026-06-25
**模型:** glm-5.2
**类型:** Architecture Rewrite + Feature (TTS)
**关联文档:** `docs/2026-06-25-nestjs-rewrite-tts.md`

---

## 变更摘要

将原有 Python Flask + SocketIO 后端**全栈重写为 NestJS (TypeScript)**, 完整移植火山引擎 v3 `sauc bigmodel_async` 二进制 WSS 协议, 并新增**火山引擎 TTS 语音合成**: 把识别出的中文 final 句合成 mp3 推送到前端自动顺序朗读 (对标同传耳机)。

Python Flask server (5000 端口) 暂保留作协议参考, NestJS 跑在 5001, 互不影响。

---

## 新增 (Added)

### NestJS server-nest/ (全新目录)
- `package.json` / `tsconfig.json` / `tsconfig.build.json` / `nest-cli.json` / `jest.config.js`
- `.env.example` / `.gitignore`
- `src/main.ts` — 启动入口, 加载 dotenv, 把 SocketIO server 注入 TtsPipelineService
- `src/app.module.ts` — 根模块, 聚合 config / logger / metrics / asr / tts / gateway
- `src/config/config.module.ts` + `config.service.ts` — 环境变量校验, 暴露 volc/tts 配置 getter + `ttsUsable`
- `src/logger/logger.module.ts` + `logger.service.ts` — StructuredLogger, JSON 单行 stdout
- `src/metrics/metrics.module.ts` + `metrics.service.ts` + `metrics.controller.ts` — prom-client Counter/Histogram, `GET /metrics`
- `src/volcengine-proto/protocol.ts` — 二进制帧 codec (encode full/audio-only/last, parse server v3 响应, buildPayload, buildWsHeaders)
- `src/volcengine-proto/extract.ts` — utterances + speakers 抽取 (v3 additions.speaker_id 兼容 legacy)
- `src/asr/asr.module.ts` — 装配 AsrSessionFactory + SessionManager (Global)
- `src/asr/asr-session.class.ts` — VolcengineAsrSession (ws 客户端, 握手门控, 分发 partial/final/error)
- `src/asr/asr-session.factory.ts` — 从 ConfigService 构造会话
- `src/asr/session-manager.service.ts` — per-sid ClientSession 容器 (textBuffer / speakersSeen / currentSpeakerId / lastKnownSpeakerId / metrics)
- `src/asr/text-buffer.ts` — smartAppend / getLastSpeaker / extractTextFromUtterances
- `src/tts/tts.module.ts` — 装配 TtsService + TtsPipelineService
- `src/tts/tts.service.ts` — 火山引擎 TTS HTTP API 调用 (3s timeout, base64 mp3 解码)
- `src/tts/tts-pipeline.service.ts` — per-sid 队列 + LRU 缓存 + 失败降级 + onModuleDestroy
- `src/gateway/gateway.module.ts` + `asr.gateway.ts` — SocketIO Gateway: connected / start_recording / audio_data / stop_recording / 错误处理 + ASR 回调 emit `transcription_result` + onFinal 触发 TtsPipeline
- `scripts/smoke-asr.ts` — SocketIO 端到端冒烟 (start/audio/stop, 断言 recording_started + recording_stopped)
- `scripts/smoke-tts.ts` — 直接调火山引擎 TTS API 验证凭证

### 测试 (50 个新服务端测试, 全绿)
- `src/volcengine-proto/protocol.test.ts` — 19 个 (帧编解码 roundtrip, 边界条件)
- `src/volcengine-proto/extract.test.ts` — 8 个 (utterances / speakers 抽取)
- `src/asr/asr-session.class.test.ts` — 9 个 (mock ws 模块, 握手 / partial / final / error / close)
- `src/tts/tts.service.test.ts` — 6 个 (鉴权契约: Authorization 格式 / Resource-Id / cluster 注入 / 成功解析 / 失败降级 / 开关)
- `src/tts/tts-pipeline.service.test.ts` — 9 个 (per-sid 队列, LRU 命中, 失败降级, shutdown, FakeSocketIO)

### 客户端新增
- `src/hooks/useTtsPlayback.ts` — 单 `Audio` 元素 + `onended` 链式播放队列, toggle/skip/clear, 静音立刻丢弃
- `src/components/TtsPlayer.tsx` — 右下浮窗控件 (🔊/🔇 + 队列徽章 + 跳过)
- `src/styles.css` 追加 `.tts-player / .tts-btn / .tts-icon / .tts-queue-badge / .tts-skip-btn` 样式

---

## 修改 (Changed)

### 客户端
- `src/WebSocketClient.ts`
  - 新增 `TtsAudioPayload` 类型 + `onTtsAudioCallback` 字段
  - `socket.on('tts_audio')` 订阅 + `onTtsAudio(cb)` 注册 API
  - `startRecording(options?: { enable_tts?: boolean })` — 携带 TTS 开关 (默认 true)
- `src/hooks/useWebSocket.ts`
  - 新增 `ttsAudioCbRef` + 桥接 `onTtsAudio`
  - 返回 `onTtsAudio` setter
- `src/App.tsx`
  - WebSocket 端口 `5000 → 5001` (NestJS)
  - `useTtsPlayback(true)` 默认开启 TTS
  - 注册 `ws.onTtsAudio((p) => tts.enqueue(p))`
  - `startRecording({ enable_tts: tts.enabled })` 传入开关
  - 挂载 `<TtsPlayer />` 浮窗
- `src/__tests__/WebSocketClient.test.ts`
  - 适配新契约: `expect(mockSocket.emit).toHaveBeenCalledWith('start_recording', { enable_tts: true })`
  - 新增 `enable_tts: false` 路径测试

---

## 移除 (Removed)

无 (Python Flask server 保留作协议参考, 未删除)。

---

## 测试结果 (DoD)

| 套件 | 数量 | 状态 |
|------|------|------|
| NestJS protocol | 19 | ✅ |
| NestJS extract | 8 | ✅ |
| NestJS ASR session | 9 | ✅ |
| NestJS TTS service (鉴权契约) | 6 | ✅ |
| NestJS TTS pipeline | 9 | ✅ |
| **NestJS 合计** | **50** | ✅ 全绿 |
| Client 现有 | 236 | ✅ 全绿 |

- ✅ `npx jest` (NestJS) 全绿 50/50
- ✅ `npx vitest run` (client) 全绿 236/236
- ✅ `npx tsc --noEmit` NestJS 零报错
- ✅ `npx nest build` 成功
- ✅ NestJS 服务在 5001 启动, env 加载, 路由注册
- ✅ `/metrics` 端点暴露 Prometheus 格式
- ✅ ASR 端到端冒烟: `connected → recording_started → recording_stopped` 全通

---

## 待用户配合 (TTS 凭证)

**代码层已按官方文档实现鉴权 (docs/6561/1257584 + 1105162):**
- `Authorization: Bearer; {token}` (分号 + 空格 + token)
- `Resource-Id: volc.service_type.10054` (可配置)
- `body.app.cluster` 从 `VOLC_TTS_CLUSTER` 读取 (不再硬编码)

**实测脚本 (`scripts/probe-tts-modes.ts`) 反证鉴权正确:**
- `Bearer; {token}` → 通过 auth, 到 grant 检查才失败
- `Bearer {token}` (空格) → "invalid auth token" (不同错误码)
- 无 cluster → "Missing required: app.cluster"
- HMAC256 + Secret Key → 与 Bearer Token 等价, 同样到 grant 失败

**最终错误:** `code=3001 "load grant: requested grant not found in SaaS storage"`

**根因:** 用户 `APP_ID=5109034773` 实际是 **ASR 应用** (与 `VOLC_APP_KEY` 同一个), 在火山引擎 SaaS 后台**没有绑定 TTS 服务授权**。

**用户需要 (任选其一):**
1. **方案 A:** 控制台 → 语音合成 → 应用管理 → 编辑 AppID 5109034773 → **添加「语音合成」能力**
2. **方案 B:** 创建新的含 TTS 能力的应用, 把对应 AppID/Token/Secret 填到 `.env`
3. 同时在控制台确认 **cluster** 名 (应用空间详情页), 写到 `.env` 的 `VOLC_TTS_CLUSTER`
4. 重启 NestJS, 录音验证

`TtsService` 失败降级: TTS 异常不影响 ASR 主链路, 仅 warn 日志。

---

## 风险

| 风险 | 缓解 |
|------|------|
| Python ASR 二进制协议移植有遗漏 | 26 个协议单元测试 + ASR session mock ws 测试覆盖关键路径; 端到端冒烟通过 |
| NestJS ws 客户端事件回调线程模型与 Python 不同 | ws 库单线程事件循环, 比 Python 多线程读循环更简单, 无需锁 |
| TTS 凭证不匹配用户实际订阅 | TTS 失败已 isolated, 不影响 ASR; 待用户确认 cluster/授权 |
| 客户端自动播放策略可能拦截第一句 | `useTtsPlayback` 捕获 `play() reject`, 失败继续下一句; TtsPlayer 引导用户点击 |
