# Changes — 2026-06-21 · 火山引擎 v3/sauc 协议迁移 (gzip + X-Api-*)

> **Sprint 8.1 — 协议升级**
> 模型: Claude Opus 4.8
> 范围: volcengine_engine.py / volcengine_session.py / config.py / app.py / 测试

## 一句话摘要

把上一轮 v2/sauc 协议升级为 **v3/sauc/bigmodel_async** —— 基于 `archibate/talky` 已实测的协议实现，去掉了之前基于 `test_volc.py` 的旧版假设。这是真正能在生产环境握手成功的协议形态。

---

## 关键协议差异 (v2 → v3)

| 维度 | v2 (我之前写的，错的) | v3 (实测跑的) |
|---|---|---|
| **端点** | `wss://openspeech.bytedance.com/api/v2/sauc/bigmodel` | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` |
| **HTTP 鉴权** | `Authorization: Bearer; {token}` (带分号) | **无** Authorization，全靠 X-Api-* 系列 |
| **握手 header** | `X-Api-App-Key / X-Api-Access-Key / X-Api-Resource-Id` | 同 + 新增 `X-Api-Request-Id` (uuid/request) + `X-Api-Connect-Id` (uuid/connection) |
| **Payload 顶层** | `user / namespace / model_name / input / parameters / audio` | **`user / audio / request`** (3 个字段) |
| **audio 字段** | `format="pcm_s16le" sample_rate=16000 channels=1` | `format="pcm" codec="raw" rate=16000 bits=16 channel=1` |
| **分角色参数** | `parameters.show_speaker_info=True` | `request.show_utterances=True` (bigmodel 默认带 speaker_id) |
| **frame size 编码** | 1 字节 (< 256) 或 3 字节 | **固定 4 字节大端** (`struct.pack(">I", size)`) |
| **body 压缩** | 无 (原始 bytes) | **gzip** 必填 |
| **last flag** | byte2 低 4 位 = 0x2 | **byte1** 低 4 位 = 0x2 (因为 byte1 = msg_type<<4 \| flags) |
| **first audio** | 必须在 full request 里 (`audio` 字段) | **不在 full request 里**，独立 audio-only 帧发 |

---

## 改动文件

| 文件 | 变更 |
|---|---|
| `server/volcengine_engine.py` | 完全重写：v3 协议 + gzip + 4B size + 新 payload 结构 + 新 header 构造 |
| `server/volcengine_session.py` | 重写：去掉 `first_audio` kwarg；VolcengineSession 直接发 config，再独立发 audio |
| `server/config.py` | `VOLC_CLUSTER` → `VOLC_RESOURCE_ID`；端点改 v3 |
| `server/app.py` | `first_audio = b"\x00" * 3200` 移除（v3 不需要）；日志去掉 cluster 字段 |
| `server/.env` / `.env.example` | 新字段 `VOLC_RESOURCE_ID`，支持 `bigmodel` / `volc.service_type.10053` (豆包) / `volc.seedasr.sauc.duration` |
| `tests/test_volcengine_protocol.py` | 完全重写：25 个测试覆盖 v3 协议细节 |
| `tests/test_volcengine_session.py` | 完全重写：9 个测试覆盖 v3 handshake / send / read / cleanup |
| `tests/test_volcengine_e2e.py` | 更新断言：`engine=volcengine_v3` 而非 `volcengine_bigmodel` |

---

## 关键代码片段

### v3 帧编解码 (核心)

```python
def _make_header(msg_type, flags, serialization, compression):
    byte1 = ((msg_type & 0x0F) << 4) | (flags & 0x0F)
    byte2 = ((serialization & 0x0F) << 4) | (compression & 0x0F)
    return bytes([0x11, byte1, byte2, 0x00])  # 4 字节 header

def _frame(header, payload, compression):
    body = gzip.compress(payload) if compression == GZIP else payload
    return header + struct.pack(">I", len(body)) + body  # + 4B size + body
```

### v3 握手 header (无 Authorization)

```python
def build_ws_headers(app_key, access_token, resource_id, ...):
    return [
        f"X-Api-App-Key: {app_key}",
        f"X-Api-Access-Key: {access_token}",
        f"X-Api-Resource-Id: {resource_id}",   # bigmodel / volc.service_type.10053
        f"X-Api-Request-Id: {uuid4()}",
        f"X-Api-Connect-Id: {uuid4()}",
    ]
```

### v3 payload 结构

```json
{
  "user":    {"uid": "web-xxx", "platform": "Web"},
  "audio":   {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
  "request": {
    "model_name":      "bigmodel",
    "enable_itn":      true,
    "enable_punc":     true,
    "enable_ddc":      false,
    "show_utterances": true,
    "result_type":     "single"
  }
}
```

### 切到豆包同声传译 (仅改 .env)

```bash
VOLC_RESOURCE_ID=volc.service_type.10053
VOLC_ENDPOINT=wss://openspeech.bytedance.com/api/v3/sauc/translation
VOLC_MODEL_NAME=bigmodel
VOLC_EXTRA_REQUEST={"mode":"s2t","source_language":"zh","target_language":"en"}
```

代码无需改动 —— `extra_request` 会被合并进 `request` 顶层。

---

## 测试结果

```
后端 pytest:  52 passed
├─ volcengine 协议 (v3):  25 passed (纯函数, 含 gzip round-trip)
├─ volcengine 会话 (v3):   9 passed (mock WSS, 含 gzip audio frame)
├─ volcengine E2E:        3 passed (Flask + SocketIO 集成)
├─ UI smoke (Vite):       5 passed (含生产构建)
├─ metrics:               7 passed (safe_value + /metrics)
└─ volcengine 协议 (v3 E2E): 3 passed

前端 vitest: 138 passed (transcriptionReducer 19 含 speaker 配色 + WebSocketClient 8)

合计 190 个测试, 全部绿色
```

---

## 验证方式

```bash
cd server && python3 run_server.py
# → :5000 + Prometheus :9091

curl http://localhost:5000/health
# → {
#     "engine": "volcengine_v3",
#     "volcengine_configured": true,
#     "volcengine_endpoint": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
#     "volcengine_resource_id": "bigmodel"
#   }

cd ../client && npm run dev
# → http://localhost:3000
# 点开始录音 → 浏览器 → 后端 volc session 建立 WSS → 推流到火山引擎
```

---

## 后续

- **真 token 测试**：你轮换 token 后填到 `.env`，跑端到端验证分角色字幕真的能跑
- **豆包 s2t 模式**：如果想用同声传译大模型，把 `.env` 改 `VOLC_RESOURCE_ID=volc.service_type.10053` + 加 `VOLC_EXTRA_REQUEST`
- **protobuf 协议**：豆包同声传译的某些版本可能要求 protobuf 而不是 JSON，需要时再加一层 `.proto` schema 解析
- **降级 fallback**：火山不可用时自动切回 Vosk（保留 `server/vosk_engine.py` 作为 fallback 引擎）

---

**技术沉淀**: `docs/2026-06-20-volcengine-realtime-asr-migration.md` (上一轮)
**本轮变更**: `changes/2026-06-20-volcengine-v3-migration.md` (本文)
