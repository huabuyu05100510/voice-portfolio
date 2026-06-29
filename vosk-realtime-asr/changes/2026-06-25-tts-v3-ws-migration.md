# 改动记录: TTS 从 HTTP V1 迁移到 V3 WebSocket 双向流式

**日期:** 2026-06-25
**模型:** glm-5.2
**类型:** Bugfix / Architecture Migration
**关联文档:** `docs/2026-06-25-tts-v3-ws-migration.md`

---

## 变更摘要

TTS 服务从 HTTP V1 API (`https://.../v1/tts`) 全量迁移到 V3 WebSocket 双向流式 (`wss://.../v3/tts/bidirection`, doc 1329505).

**根因:** HTTP V1 API 报 `code=3001 "load grant not found"` — 用户 ASR 应用 `5109034773` 未绑定 V1 TTS 服务授权. 通过 3 个矩阵实验 (`probe-tts-voices` / `probe-v3-tts` / `probe-v3-newauth`) 定位到:
- 新版控制台鉴权用 **`X-Api-Key`** header (旧版 X-Api-Access-Key 已弃用)
- **同一个 `VOLC_API_KEY`** (ASR 用的 UUID) 在 V3 TTS 端点也具备权限, 无需单独申请 TTS key
- Resource-Id 改为 `volc.service_type.10029` (V3 双向流式)

---

## 新增 (Added)

### 协议层 + 测试
- `src/tts/tts-v3-protocol.ts` — V3 二进制帧编解码 (纯函数)
  - `encodeFrameNoSession` / `encodeFrameWithSession` / `parseFrame` / `buildV3WsHeaders`
  - 事件常量 `V3_TTS_EVENT` (建连/会话/任务/TTS 响应)
- `src/tts/tts-v3-protocol.test.ts` — **10 个单元测试** 全绿

### 诊断 / 冒烟脚本
- `scripts/probe-v3-tts.ts` — V3 协议探测 (8 speaker 全握手)
- `scripts/probe-v3-auth.ts` — V3 鉴权矩阵 (5 resource × 5 combo)
- `scripts/probe-v3-newauth.ts` — X-Api-Key 矩阵 (定位根因)
- `scripts/smoke-v3-tts.ts` — 生产端到端冒烟 (实例化真实 TtsService, 调火山引擎)

---

## 修改 (Changed)

### 业务代码
- `src/tts/tts.service.ts` — **全量重写**
  - 端点: HTTP V1 → V3 WS bidirection
  - 鉴权: `Bearer; {token}` + Resource-Id → `X-Api-*` headers
  - 单次 synthesize 现在跑完整 V3 握手: START_CONNECTION → START_SESSION → TASK_REQUEST → 收 TTS_RESPONSE → SESSION_FINISHED
  - 构造器新增可选 `wsFactory` 参数 (测试注入 mock)
  - 保留 `synthesize(text, opts)` 签名, 上层 `TtsPipelineService` 无感
- `src/tts/tts.service.test.ts` — **重写契约**
  - 旧契约: Authorization header / cluster 注入 / code=3000 解析
  - 新契约: X-Api-Key header / 完整握手状态机 / SESSION_FAILED 降级 / 超时降级
- `src/config/config.service.ts` — 配置字段更新
  - 删除: `ttsAppId` / `ttsAccessToken` / `ttsSecretKey` / `ttsCluster` / `ttsVoiceType`
  - 新增: `ttsApiKey` (默认回退到 `volcApiKey`) / `ttsSpeaker`
  - 默认值: `ttsResourceId=volc.service_type.10029` / `ttsEndpoint=wss://...v3/tts/bidirection`
  - `ttsUsable` 简化: `ttsEnabled && !!ttsApiKey && !!volcAppKey`

### 配置文档
- `.env.example` — V3 字段 + 注释 (X-Api-Key 共用 ASR key)

---

## 测试结果 (DoD)

| 套件 | 数量 | 状态 |
|------|------|------|
| NestJS protocol (现有) | 19 | ✅ |
| NestJS extract (现有) | 8 | ✅ |
| NestJS ASR session (现有) | 9 | ✅ |
| **NestJS V3 TTS protocol (新)** | **10** | ✅ |
| **NestJS TtsService V3 WS (重写)** | **6** | ✅ |
| NestJS TTS pipeline (现有, 未触动) | 9 | ✅ |
| **NestJS 合计** | **60** | ✅ (原 50 + 10 新) |

- ✅ `npx jest` 全绿 60/60
- ✅ `npx tsc --noEmit` 零报错
- ✅ `npx nest build` 成功
- ✅ **生产环境冒烟** (`scripts/smoke-v3-tts.ts`): 43629 bytes mp3, 2460ms 延迟, MP3 头 `49 44 33 04` (ID3v2.4 有效)

---

## 移除 (Removed)

- `.env.example` 里的 `VOLC_TTS_APP_ID` / `VOLC_TTS_ACCESS_TOKEN` / `VOLC_TTS_SECRET_KEY` / `VOLC_TTS_CLUSTER` / `VOLC_TTS_VOICE_TYPE` 字段
- 用户 `.env` 里的对应旧值 (仍向后兼容: 服务读不到 `VOLC_TTS_API_KEY` 时回退到 `VOLC_API_KEY`)

---

## 关键发现 (供后续维护)

1. **新版控制台鉴权: X-Api-Key** — 火山引擎文档 1329505 + 2277844 明确说明, 但旧版 demo 代码普遍还用 X-Api-Access-Key. 矩阵实验确认 X-Api-Key 才是新版控制台的正确 header.
2. **同一 API Key 跨服务** — ASR 用的 `VOLC_API_KEY` UUID 在 V3 TTS 也通, 不需要单独申请.
3. **连接级事件无 session_id** — parseFrame 不能仅靠 msg_type 判断 session_id 是否存在, 还需检查 event id 是否在 `START_CONNECTION/FINISH_CONNECTION/CONNECTION_STARTED/CONNECTION_FAILED` 范围内.
4. **未通过的 speaker 需在控制台开通** — `zh_female_wanwan_moon_bigtts` / `BV700_streaming` 等在当前账号下 timeout, 需在「语音合成大模型 → 音色管理」里开通试用.
