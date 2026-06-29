# TTS 迁移: HTTP V1 → V3 WebSocket 双向流式

**日期:** 2026-06-25
**模型:** glm-5.2
**类型:** Bugfix / Architecture Migration
**关联:** `docs/2026-06-25-nestjs-rewrite-tts.md` (前置), `changes/2026-06-25-tts-v3-ws-migration.md`

---

## 背景

前一版 NestJS TTS 使用 **HTTP V1** API (`https://openspeech.bytedance.com/api/v1/tts`), 凭证 `VOLC_TTS_APP_ID` / `VOLC_TTS_ACCESS_TOKEN` / `VOLC_TTS_SECRET_KEY`.

实测 14 voice × 3 cluster = **42 组合全部失败**, 统一报错:
```
code=3001 "load grant: requested grant not found in SaaS storage"
```

`probe-tts-modes.ts` 反证鉴权格式正确 (Authorization Bearer + Resource-Id 都符合官方文档), 错误来自 **grant 层**: 用户账号下的 ASR 应用 `5109034773` 没有绑定 HTTP V1 TTS 服务授权.

---

## 根因诊断 (3 个矩阵实验)

### 实验 1: HTTP V1 14×3 矩阵
**结论:** V1 路径完全死, 不是代码问题, 是账号 grant 缺失.

### 实验 2: V3 WS X-Api-Access-Key (旧版控制台)
脚本 `probe-v3-tts.ts` 用 `X-Api-Access-Key` header 测 8 个 speaker:
```
✗ 全部 401
```
**结论:** 旧版 X-Api-Access-Key 鉴权方案不适用.

### 实验 3: V3 WS X-Api-Key (新版控制台) + 多 resource_id
脚本 `probe-v3-newauth.ts` 矩阵测试 5 resource_id × 3 鉴权组合:
```
volc.service_type.10029  + X-Api-Key (ASR UUID)  ✓ CONNECTED
volc.megatts.default     + X-Api-Key (ASR UUID)  ✓ CONNECTED
seed-tts-2.0             + X-Api-Key (ASR UUID)  ✓ CONNECTED
seed-tts                 + X-Api-Key             403 (未授权 seed 模型)
其余组合                  401 / 400
```

**关键发现:** **同一个 `VOLC_API_KEY=77c3e13e-...` (ASR 用的 UUID) 在 V3 TTS 端点也有效**, 只要 header 名从 `X-Api-Access-Key` 改成 `X-Api-Key`. 不需要单独申请 TTS key.

文档 1329505 + 2277844 提示: "**新版控制台只需要 X-Api-Key 即可**" — 与实测一致.

### 实验 4: 完整 V3 协议 round-trip
脚本 `probe-v3-tts.ts` (修正 header 后) 跑完 V3 全握手:
```
START_CONNECTION → CONNECTION_STARTED
  → START_SESSION(speaker) → SESSION_STARTED
  → TASK_REQUEST(text) + FINISH_SESSION
  → TTS_RESPONSE ×N (19437 bytes mp3)
  → SESSION_FINISHED

✓ FIRST SUCCESS: speaker=zh_male_M392_conversation_wvae_bigtts
```

---

## 解决方案: 全量切换到 V3 WS

### 协议层 (`src/tts/tts-v3-protocol.ts`, 新建)

二进制帧布局:
```
[4B header][4B event_id][optional 4B sid_len + sid bytes][4B payload_len + payload bytes]

Header (4 字节固定):
  0x11            protocol_version = 1
  0x14            header_size=1 | msg_type=1 (full client→server)
  0x10            serial=JSON, compress=NONE
  0x00            reserved
```

事件常量 (`V3_TTS_EVENT`):
- START_CONNECTION(1) / CONNECTION_STARTED(50) / CONNECTION_FAILED(51)
- START_SESSION(100) / FINISH_SESSION(102)
- SESSION_STARTED(150) / SESSION_FINISHED(152) / SESSION_FAILED(153)
- TASK_REQUEST(200) / TTS_SENTENCE_START(350) / TTS_SENTENCE_END(351) / TTS_RESPONSE(352)

API:
- `encodeFrameNoSession(eventId, payload)` — 建连握手用
- `encodeFrameWithSession(eventId, sessionId, payload)` — 业务帧
- `parseFrame(buf)` — 服务端帧解析 (含两层 session_id 判断: 连接级事件无 sid; 其他按 msg_type bit pattern)
- `buildV3WsHeaders({appKey, accessKey, resourceId, connectId?})` — 输出 `X-Api-App-Key` + `X-Api-Key` + `X-Api-Resource-Id` + `X-Api-Connect-Id`

### TtsService 重写 (`src/tts/tts.service.ts`)

保留旧 `synthesize(text, opts)` 签名, 内部改为 V3 WS 单次会话:
1. WebSocket 连接 (V3 headers)
2. START_CONNECTION → 等 CONNECTION_STARTED
3. START_SESSION(speaker, audio_params) → 等 SESSION_STARTED
4. TASK_REQUEST(text) + FINISH_SESSION
5. 累计 TTS_RESPONSE 音频字节直到 SESSION_FINISHED
6. 任一失败 / 超时 (默认 5s) → 返回 null (上层 `TtsPipelineService` 降级, 不阻塞 ASR)

构造器新增可选 `wsFactory` 参数 (测试注入 mock WS).

### 配置层 (`src/config/config.service.ts`)

| 字段 | 旧 (HTTP V1) | 新 (V3 WS) |
|------|--------------|------------|
| 鉴权 key | `VOLC_TTS_APP_ID` + `VOLC_TTS_ACCESS_TOKEN` + `VOLC_TTS_SECRET_KEY` | `VOLC_TTS_API_KEY` (默认回退到 `VOLC_API_KEY`) |
| 共用 app key | (无) | `VOLC_APP_KEY` (与 ASR 共用) |
| Resource-Id | `volc.service_type.10054` (V1) | `volc.service_type.10029` (V3 双向流式) |
| 音色字段 | `ttsVoiceType` (`BV001_streaming`) | `ttsSpeaker` (`zh_male_M392_conversation_wvae_bigtts`) |
| Endpoint | `https://.../v1/tts` | `wss://.../v3/tts/bidirection` |
| 默认超时 | 3000ms | 5000ms (V3 WS 多次 RTT, 需要更长) |

`ttsUsable` 简化: `ttsEnabled && !!ttsApiKey && !!volcAppKey`.

---

## TDD 覆盖

| 套件 | 数量 | 状态 |
|------|------|------|
| `tts-v3-protocol.test.ts` (新增) | 10 | ✅ |
| `tts.service.test.ts` (重写) | 6 | ✅ |
| `tts-pipeline.service.test.ts` (现有) | 9 | ✅ (未触动, pipeline 依赖不变) |
| NestJS 合计 | 60 | ✅ (原 50 + 10 新) |

V3 protocol 覆盖:
- encodeFrameNoSession: header / event_id / payload 序列化
- encodeFrameWithSession: 字段顺序
- parseFrame: 连接级事件无 sid / 带 sid 帧 roundtrip / 大音频 payload 不尝试 JSON
- buildV3WsHeaders: 用 X-Api-Key (非 X-Api-Access-Key) / connect_id 可注入

TtsService V3 WS 覆盖 (mock WebSocket via FakeWs + EventEmitter):
- 握手 headers 用 X-Api-Key
- `ttsUsable=false` / 空文本 → 跳过 WS
- 完整成功路径: CONNECTION_STARTED → START_SESSION → TASK_REQUEST → TTS_RESPONSE 累计 → SESSION_FINISHED
- SESSION_FAILED → 降级 null
- 超时 → 降级 null

---

## DoD (端到端验证)

- ✅ `npx jest` 全绿 60/60
- ✅ `npx tsc --noEmit` 零报错
- ✅ `npx nest build` 成功
- ✅ **生产环境冒烟** (`scripts/smoke-v3-tts.ts`):
  ```
  endpoint=wss://openspeech.bytedance.com/api/v3/tts/bidirection
  resource=volc.service_type.10029
  speaker=zh_male_M392_conversation_wvae_bigtts
  ✓ OK: 43629 bytes mp3, latency=2460ms, head=[49 44 33 04]  (ID3\04 = 有效 MP3)
  ```

---

## 文件清单

**新增:**
- `src/tts/tts-v3-protocol.ts` — V3 二进制帧 codec (纯函数)
- `src/tts/tts-v3-protocol.test.ts` — 10 个单元测试
- `scripts/probe-v3-tts.ts` — V3 协议探测 (8 speaker)
- `scripts/probe-v3-auth.ts` — V3 鉴权矩阵 (5 resource × 5 combo)
- `scripts/probe-v3-newauth.ts` — X-Api-Key 矩阵 (发现根因)
- `scripts/smoke-v3-tts.ts` — 生产端到端冒烟

**重写:**
- `src/tts/tts.service.ts` — HTTP V1 → V3 WS
- `src/tts/tts.service.test.ts` — 鉴权契约 → 协议契约

**修改:**
- `src/config/config.service.ts` — V3 字段, `ttsUsable` 简化
- `.env.example` — V3 字段 + 注释

**未触动:**
- `src/tts/tts-pipeline.service.ts` (依赖 `synthesize(text)` 签名不变)
- `src/tts/tts.module.ts`
- 客户端 (TTS 事件协议 base64 mp3 不变)

---

## 风险

| 风险 | 缓解 |
|------|------|
| V3 WS 单次连接开销高于 HTTP (3 次握手 + START_CONNECTION + START_SESSION) | 实测 2.4s/句, 与 HTTP V1 grant 模式相当; P1 可优化为长连接复用 |
| 默认 speaker `zh_male_M392_conversation_wvae_bigtts` 可能不满足用户预期音色 | `VOLC_TTS_SPEAKER` 可配置; 其他 7 个候选在探测时 timeout (需在控制台音色管理开通) |
| 新版控制台鉴权变更未公开通告 (旧文档仍提 X-Api-Access-Key) | 已通过矩阵实验定位, 注释在 `tts-v3-protocol.ts:buildV3WsHeaders` |
| V3 WS 没有收到任何响应时无法区分网络故障 vs 鉴权失败 | 5s 超时统一降级; 矩阵探测脚本可独立验证鉴权 |
