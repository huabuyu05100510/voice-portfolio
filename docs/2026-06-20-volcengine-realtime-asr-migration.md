# 火山引擎「一句话识别 - 流式版 bigmodel」实时分角色转写 — 迁移技术方案

> 技术方案文档
> 模型: Claude Opus 4.8
> 日期: 2026-06-20
> 范围: `vosk-realtime-asr/` 整套前后端 + 可观测性 + 测试

---

## 0. 一句话摘要

把当前基于 **Vosk 开源引擎** 的实时转写 Demo, 替换为 **火山引擎 (字节跳动开放平台)「一句话识别 - 流式版 (bigmodel)」** WebSocket API, 同时开启 **说话人分离 (speaker diarization)** —— 让字幕按角色分色, 在会议 / 访谈 / 双人对话场景下可读性数量级提升。

---

## 1. 背景

### 1.1 现状

| 维度 | 当前实现 |
|---|---|
| ASR 引擎 | Vosk 中文模型 (离线本地, CPU) |
| 模型加载 | ~500 MB, 启动慢, 模型权重打进 `server/models/` |
| 准确率 | 中文 WER 较高, 标点缺失 |
| 多说话人 | **不支持** (所有声音都并成一段, 无法分清"谁在说") |
| 长尾词 | 行业术语 / 人名 / 数字识别差 |
| 网络依赖 | 零 (可离线运行) |

### 1.2 目标

| 维度 | 目标实现 |
|---|---|
| ASR 引擎 | 火山引擎 `bigmodel` 流式一句话 |
| 通信协议 | 自研二进制帧 (v2/sauc) over WSS |
| 模型 | 云端, 免本地部署 |
| **分角色** | `show_speaker_info=True` 开启, 每条 utterance 带 `speaker_id` |
| 标点 | `enable_punc=True` 自动加标点 |
| ITN | `enable_itn=True` 数字/日期格式归一化 |
| 网络依赖 | 必须联网 (WSS) |

### 1.3 关键非功能性目标 (沿用 CLAUDE.md)

- 极致体验 + 性能 (延迟 < 300ms)
- 顶尖技术对标 (生产可用)
- **TDD**: 所有功能 + bugfix 配套单测 + E2E + UI 回归
- 可观测性: Prometheus + 结构化日志
- 改动日志落到 `changes/`

---

## 2. 火山引擎 API 协议 (基于 `test_volc.py` 已跑通的实测)

### 2.1 端点

```
wss://openspeech.bytedance.com/api/v2/sauc/bigmodel
```

`bigmodel` 是 cluster 名, 也可作为 URL 段; 鉴权时 cluster 也通过 JSON `app.cluster` 字段下发 (双轨一致即可)。

### 2.2 握手 Header

| Header | 取值 | 备注 |
|---|---|---|
| `Authorization` | `Bearer; {ACCESS_TOKEN}` | **带分号**, 字节 SAUC 网关特殊格式 |
| `X-Api-Resource-Id` | `bigmodel` | 资源 ID, 决定能力 |
| `X-Api-App-Key` | `{APP_KEY}` (UUID 串) | 等价于控制台 AppID |
| `X-Api-Access-Key` | `{ACCESS_TOKEN}` | 与 Authorization 相同 |

> **.env 字段**: `VOLC_APP_KEY` / `VOLC_ACCESS_TOKEN` / `VOLC_CLUSTER` / `VOLC_MODEL_NAME`

### 2.3 请求二进制帧

```
┌──────────┬──────────┬──────────┬────────────┬────────────────┐
│ byte 0   │ byte 1   │ byte 2   │ byte 3     │ bytes 4..      │
│ 0x11     │ header   │ msg_type │ payload    │ payload        │
│ (v1 +    │ size     │  + flags │ size high  │ size low +     │
│  hdr=4B) │ (1=4B)   │          │ byte       │ payload body   │
└──────────┴──────────┴──────────┴────────────┴────────────────┘
```

`byte2`:
- 高 4 bits: message type — `0x1` client full request / `0x2` client audio only
- 低 4 bits: flags — `0x2` 表示最后一帧 (LAST)

payload size:
- payload < 0xFFFF (65535): header 4 字节 (byte0..3), byte3 是 size 的高 8 位
- payload >= 0xFFFF: header 6 字节 (byte0..5), byte3..5 是 size 的 24 位

### 2.4 客户端请求 JSON (0x1 full request)

```json
{
  "user":     { "uid": "client_001" },
  "namespace": "Bidirectional",
  "model_name": "bigmodel",
  "input": {
    "format": "pcm_s16le",
    "sample_rate": 16000,
    "channels": 1
  },
  "parameters": {
    "app": {
      "appid":   "<from APP_KEY>",
      "token":   "<ACCESS_TOKEN>",
      "cluster": "volcengine_streaming_common"
    },
    "show_utterances":   true,
    "show_speaker_info": true,
    "enable_punc":       true,
    "enable_itn":        true
  },
  "audio": "<hex_string_of_first_chunk>"
}
```

> 第一段音频 (建议 200ms, 6400 bytes) 放在 `audio` 字段, 后续 audio-only 帧只带原始 PCM bytes (header `0x11 0x01 0x20 <size>`).

### 2.5 服务端响应 JSON (0x9 / 0xC / 0xF)

```json
{
  "result": {
    "text": "你好世界。",
    "utterances": [
      {
        "text":       "你好世界。",
        "start_time":  120,
        "end_time":   1850,
        "speaker_id": "spk0",
        "words": [
          { "text": "你好",  "start_time": 120, "end_time": 380, "speaker_id": "spk0" },
          { "text": "世界",  "start_time": 400, "end_time": 780, "speaker_id": "spk0" }
        ]
      },
      {
        "text":       "我是字节跳动。",
        "start_time": 2000,
        "end_time":   3500,
        "speaker_id": "spk1",
        "words": [...]
      }
    ]
  },
  "audio_info": { "duration": 3500 }
}
```

| 帧 type | 含义 | utterances 是否带 |
|---|---|---|
| `0x9` full_resp | 配置确认 / ack | 否 |
| `0xC` partial_resp | 增量 partial | **否**, 只有 `result.text` |
| `0xF` final_resp | 结束 / 整段结果 | **是**, 完整分段 + speaker |
| `0xB` error | 错误 | payload 是 `{code, message}` |

### 2.6 关键约束

| 约束 | 值 |
|---|---|
| 音频格式 | PCM s16le, 16 kHz, mono |
| 单帧音频 | 推荐 200ms (6400 bytes) |
| 连接时长 | 长语音 bigmodel_async: ≤ 30 分钟; 流式一句话: ≤ 60 秒 |
| 并发 | 默认 5 路 / 账号 |
| 鉴权 | 必须 WSS, 证书链默认 certifi 即可 |

---

## 3. 系统架构

### 3.1 进程拓扑 (迁移后)

```
┌─────────────────────────────────────────┐    ┌──────────────────────────────┐
│  Flask + SocketIO 主进程                │    │ 火山引擎 WSS                 │
│  ┌─────────────────────────────────┐    │    │ wss://openspeech.bytedance..│
│  │ Flask REST + SocketIO handlers  │    │    │        .com/api/v2/sauc/... │
│  │ (audio_data / start_recording / │    │    └─────────────┬──────────────┘
│  │  stop_recording / get_metrics)  │    │                  │
│  └──────────────┬──────────────────┘    │                  │ 二进制帧
│  ┌──────────────▼──────────────────┐    │                  │
│  │ 火山引擎会话管理器 (volc_sessions)│  │◀─────────────────┘
│  │ 每 sid 一个 VolcengineSession    │   │  WSS
│  │  - 长连接, 后台读协程            │   │
│  │  - utterance buffer              │   │
│  └──────────────┬──────────────────┘    │
│  ┌──────────────▼──────────────────┐    │
│  │ Prometheus + StructuredLogger   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

> **相比 Vosk worker 架构的关键变化**: 不再需要子进程隔离 (云端 ASR 不会让本地 C++ 崩溃), 但需要**每个会话一条独立 WSS 长连接 + 后台读协程**, 由线程池管理。

### 3.2 数据流 (一次 audio_data 事件)

```
浏览器麦克风 (16kHz, Int16)
  → AudioWorklet 切 2048 sample 块
  → SocketIO emit('audio_data', ArrayBuffer)
  → Flask-SocketIO 事件循环
  → app.handle_audio_data (本地 metrics + session_status)
  → volc_session.send_audio(chunk)
  → 火山引擎 WSS 二进制帧 (0x20 audio-only)
  → 火山引擎返回 0xC partial 或 0xF final
  → volc_session 后台 read_loop 回调
  → app.emit('transcription_result', {text, speaker_id, is_final, words, utterances})
  → 浏览器 WebSocketClient.onTranscriptionResult
  → React TranscriptionRenderer + 按 speaker_id 分色字幕
```

### 3.3 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 每个 sid 独立 WSS 连接 | ✅ | 火山引擎流式一句话 session 模型天然一对一; sid 维度天然隔离 |
| 长连接复用 | ✅ | start_recording → 多次 audio_data → stop_recording 共用一条 WSS |
| WSS 读循环放线程 | ✅ | 不阻塞 SocketIO 事件循环 |
| 说话人映射前端分色 | ✅ | 服务端只下发 `speaker_id`, 前端按 color palette 着色 |
| 离线 fallback | ❌ | 火山依赖网络; 后续可加 Vosk 双引擎 fallback |
| 标点 + ITN | ✅ 服务端开 | 比前端启发式更准 |

---

## 4. 文件改动清单

### 4.1 新增

| 文件 | 说明 |
|---|---|
| `server/volcengine_engine.py` | 火山引擎协议封装 (帧编解码 + 会话管理) |
| `server/volcengine_session.py` | 单 sid 的 WSS 会话对象 + 后台读协程 |
| `tests/test_volcengine_protocol.py` | 二进制帧编解码单测 (纯函数, 不联网) |
| `tests/test_volcengine_session.py` | 会话状态机单测 (mock WSS) |
| `tests/test_volcengine_e2e.py` | 真实 WSS 端到端 (需要有效 .env) |

### 4.2 重写

| 文件 | 变更 |
|---|---|
| `server/app.py` | 删除 vosk_worker 启动 / 监听循环, 改为 volcengine_session 生命周期 |
| `server/config.py` | 加 `VOLC_*` 配置项 |
| `server/requirements.txt` | 删除 `vosk`, 加 `websocket-client` / `aiohttp`(可选) |
| `server/.env` / `.env.example` | 已有, 不变 |
| `client/src/types.ts` | 加 `speaker_id` / `utterances[]` / `WordInfo.speaker_id` |
| `client/src/WebSocketClient.ts` | 透传 speaker_id 到回调 |
| `client/src/App.tsx` | 维护 `utterances[]` 状态, 按 speaker 着色 |
| `client/src/Subtitle.tsx` | 句首 speaker 标签 + 配色 |
| `client/src/TranscriptionRenderer.tsx` | 多说话人分行显示 |
| `client/src/AppLayout.tsx` | footer 改为 "火山引擎 bigmodel" |

### 4.3 保留

| 文件 | 理由 |
|---|---|
| `server/metrics.py` | 指标不变, 复用 `safe_value()` |
| `server/logger.py` | 结构化日志复用 |
| `client/src/AudioCapture.ts` | 16kHz/mono 采集仍适用 |
| `client/src/WaveformVisualizer.tsx` | 波形可视化无关 |
| `client/src/ObservabilityPanel.tsx` | 指标面板无关 |
| 所有测试套件 | 改名复用 (`test_websocket.py` 改 `test_volc_e2e.py`) |

---

## 5. API & 数据契约 (前后端)

### 5.1 服务端 → 客户端 `transcription_result`

```typescript
{
  event: 'transcription_result',
  text: string,                  // 当前片段累计文本
  is_final: boolean,
  full_text: string,             // 整段累计
  latency_ms: number,
  timestamp: string,
  // ===== 新增 (vs Vosk) =====
  speaker_id?: string,           // 当前说话人 id, e.g. 'spk0'
  speakers?: Array<{             // 已出现的所有说话人
    id: string,
    color: string,               // 前端按 palette 分配
    label: string                // 友好名, e.g. '发言人 1'
  }>,
  utterances?: Array<{           // 分段 (final 才有)
    text: string,
    start_time: number,          // ms
    end_time: number,
    speaker_id: string,
    words: Array<{
      text: string,
      start_time: number,
      end_time: number,
      speaker_id: string
    }>
  }>
}
```

### 5.2 前端新增 props

`Subtitle`:
```ts
interface SubtitleProps {
  ...
  currentSpeakerId?: string;     // 当前句子说话人
  speakers?: Speaker[];          // 调色板
}
```

---

## 6. 可观测性

### 6.1 新增 Prometheus 指标

| 指标 | 类型 | labels | 说明 |
|---|---|---|---|
| `volcengine_connections_active` | Gauge | — | 当前火山 WSS 活跃连接 |
| `volcengine_connection_errors_total` | Counter | error_type | WSS 握手失败 / 中断 / 超时 |
| `volcengine_session_duration_seconds` | Histogram | — | 单会话时长 |
| `volcengine_speaker_count` | Histogram | — | 每次 final 累计说话人数 |
| `transcription_latency_ms` | (复用) | — | 端到端延迟 (不变) |

### 6.2 新增 `/health` 字段

```json
{
  "status": "healthy",
  "volcengine_configured": true,
  "volcengine_endpoint": "wss://openspeech.bytedance.com/api/v2/sauc/bigmodel",
  "active_sessions": 3,
  "volcengine_connections_active": 3,
  "timestamp": "..."
}
```

### 6.3 结构化日志

每条 `transcription_result` 日志新增字段:

```json
{
  "event_type": "transcription_result",
  "session_id": "abc",
  "speaker_id": "spk1",
  "utterance_count": 2,
  "text_length": 12,
  "latency_ms": 187
}
```

每条 `volcengine_connection` 日志:

```json
{
  "event_type": "volcengine_handshake",
  "session_id": "abc",
  "endpoint": "wss://...",
  "status": "connected" | "error",
  "error_code": 10001
}
```

---

## 7. 测试计划 (TDD)

### 7.1 协议单测 (`test_volcengine_protocol.py`)

```python
def test_encode_full_client_request():
    """0x1 全量请求帧: byte0=0x11, byte1=0x01, byte2=0x10, byte3=size, body=JSON"""

def test_encode_audio_only_request():
    """0x2 音频帧: byte0=0x11, byte1=0x01, byte2=0x20, byte3=size, body=PCM"""

def test_encode_audio_last_flag():
    """最后一帧 flags=0x22 (含 LAST 位)"""

def test_encode_large_payload_uses_6byte_header():
    """payload > 0xFFFF 切 6 字节 header, size 24 位"""

def test_parse_full_response():
    """0x9 帧解析出 JSON ack"""

def test_parse_partial_response():
    """0xC 帧解析出 result.text"""

def test_parse_final_response_with_speaker():
    """0xF 帧解析出 utterances[].speaker_id"""

def test_parse_error_response():
    """0xB 帧解析出 code + message"""

def test_first_chunk_audio_as_hex_in_full_request():
    """0x1 全量请求的 audio 字段是 hex string"""

def test_round_trip_payload_size_byte_layout():
    """frame(encode(decode(frame))) == frame"""
```

### 7.2 会话单测 (`test_volcengine_session.py`)

```python
def test_session_open_creates_wss(mocker):
    """open() 后 websocket.create_connection 被调用, header 含 X-Api-Access-Key"""

def test_session_open_includes_speaker_params(mocker):
    """payload 含 show_speaker_info=True"""

def test_session_send_audio_uses_audio_only_frame():
    """send_audio(b'...') 发出 0x2 帧, 不含 JSON"""

def test_session_finalize_sends_last_frame():
    """finalize() 发出 flags=0x22 帧"""

def test_session_read_loop_emits_partial_results():
    """收到 0xC 帧时回调 on_partial(text)"""

def test_session_read_loop_emits_final_with_utterances():
    """收到 0xF 帧时回调 on_final(text, utterances)"""

def test_session_handles_error_frame(mocker):
    """收到 0xB 帧时回调 on_error(code, message)"""

def test_session_close_releases_wss():
    """close() 后 WSS 关闭, 不泄漏线程"""
```

### 7.3 端到端测试 (`test_volc_e2e.py`)

> 需要 `.env` 里 `VOLC_APP_KEY` / `VOLC_ACCESS_TOKEN` 真实可用, 否则 `pytest.skip`

```python
def test_e2e_short_audio_returns_final_with_speaker():
    """发一段 5 秒双人录音, 收到 final, 含 ≥2 个不同 speaker_id"""

def test_e2e_streaming_chunks_return_partials():
    """分块发音频, 收到 ≥3 个 partial"""

def test_e2e_handshake_invalid_token_fails_gracefully():
    """用错的 token, 握手失败被捕获, 不抛 5xx"""
```

### 7.4 UI 回归 (`test_ui_smoke.py` + vitest)

- `tsc && vite build` 通过
- Subtitle 组件 speaker 配色 props 测试
- WebSocketClient 透传 `speaker_id` 测试

---

## 8. 启动 & 配置

### 8.1 环境变量 (`server/.env`)

```bash
VOLC_APP_KEY=be7a469d-3937-40ff-882a-7d72398c44c6
VOLC_ACCESS_TOKEN=<your_access_token>
VOLC_CLUSTER=volcengine_streaming_common
VOLC_MODEL_NAME=bigmodel
```

### 8.2 启动

```bash
cd server
python3 run_server.py          # 主进程 + 火山 WSS session 池
cd ../client && npm run dev    # Vite dev
open http://localhost:3000
```

### 8.3 浏览器演示

1. 点击「开始录音」 → 麦克风采集 → 浏览器向本地 Flask 发 `audio_data`
2. 后端 volcengine_session 收到 → 转成 0x2 帧 → WSS 发火山引擎
3. 火山返回 0xC partial → 后端 emit `transcription_result` → 浏览器字幕显示
4. 多个说话人 → 字幕按角色分色 + 句首 🎙 标签
5. 停止录音 → 后端发 0x22 最后一帧 → 火山返回 0xF final → 完整 utterances

---

## 9. 风险 & 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 火山 API 鉴权失败 | 全员不可用 | `.env` 缺值时 server 启动 fail-fast, 给清晰报错 |
| WSS 握手 401/429 | 单 session 掉线 | 重连退避 + UI 提示 |
| 说话人 ID 抖动 | 字幕颜色跳变 | 前端 LRU 缓存 speaker → color 映射, 保持稳定 |
| 网络抖动导致音频丢失 | 字幕漏字 | 后端按 seq 重传 (后续); 现在先打 log |
| 火山引擎收费 | 持续成本 | 设置单会话最大时长 60s, 单账号并发 ≤ 5 |

---

## 10. 后续 (backlog)

- [ ] 标注功能: 客户端可框选文字 → 修正 → 上报到后端
- [ ] 长音频自动断句 (VAD)
- [ ] 多引擎 fallback: 火山不可用时切 Vosk
- [ ] 翻译联动: 译文与原文同步显示
- [ ] mTLS 鉴权

---

**方案状态**: 已完成, 进入 TDD 实施阶段
