# 火山引擎 bigmodel · 分角色实时转写 Demo

> 🎯 基于字节跳动开放平台「一句话识别 - 流式版 (bigmodel)」的实时转写系统, 支持**说话人分离**
>
> 📖 **前端细节: 见 [client/README.md](./client/README.md)**
>
> 🏛️ **架构: 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)**

## ✨ 功能特性

- 🎤 **流式一句话识别** — 端到端延迟 < 300ms
- 🗣️ **说话人分离 (diarization)** — `show_speaker_info=True`, 多人对话自动分配颜色
- 🎨 **分角色字幕** — 句首 🎙 徽章 + 词级高亮按 speaker 配色
- 📊 Canvas 实时波形可视化
- 📝 增量文本渲染 + 卡拉 OK 进度条
- 📈 Prometheus 指标 + Grafana 仪表盘

## 🛠️ 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Python 3.9+ / Flask / Flask-SocketIO |
| ASR | **火山引擎 bigmodel** (WSS 二进制协议) |
| 前端 | React 18 + TypeScript + Vite |
| 音频 | Web Audio API + AudioWorklet (16kHz mono PCM) |
| 监控 | Prometheus + 自研结构化日志 |

## 📦 项目结构

```
vosk-realtime-asr/
├── server/
│   ├── app.py                 # Flask + SocketIO 主服务
│   ├── volcengine_engine.py   # 火山引擎二进制帧协议 (编码/解码)
│   ├── volcengine_session.py  # per-sid WSS 长连接 + 后台读线程
│   ├── metrics.py             # Prometheus 指标
│   ├── logger.py              # 结构化日志
│   ├── config.py              # 配置 (含 VOLC_* 项)
│   └── requirements.txt
│
├── client/src/
│   ├── App.tsx                # 主应用
│   ├── Subtitle.tsx           # 分角色字幕 (句首徽章 + 词级高亮)
│   ├── TranscriptionRenderer.tsx # 行首色条 + utterances[] 详情
│   ├── AudioCapture.ts        # 16kHz mono PCM 采集
│   ├── WebSocketClient.ts     # Socket.IO 客户端 (含 speaker 字段透传)
│   ├── state/transcriptionReducer.ts # reducer (含 speakers 合并)
│   └── styles.css
│
├── monitoring/
│   ├── prometheus.yml
│   └── docker-compose.yml
│
└── tests/                     # 42 个后端 + 138 个前端 = 180 测试
```

## 🚀 快速开始

### 1. 配置火山引擎凭据

```bash
cd server
cat .env
# VOLC_APP_KEY=<your-app-key>
# VOLC_ACCESS_TOKEN=<your-access-token>
# VOLC_CLUSTER=volcengine_streaming_common
# VOLC_MODEL_NAME=bigmodel
```

在 [火山引擎控制台](https://console.volcengine.com/) 创建应用, 开通「语音技术 → 一句话识别 - 流式版」后获取 `AppID` / `Access Token`。

### 2. 启动后端

```bash
cd server
pip install -r requirements.txt
python3 run_server.py
```

服务启动后:
- WebSocket: `ws://localhost:5000`
- Prometheus: `http://localhost:9091/metrics`
- 健康检查: `http://localhost:5000/health` → `{"engine": "volcengine_bigmodel", ...}`

### 3. 启动前端

```bash
cd client
npm install
npm run dev
```

访问 `http://localhost:3000`

## 📊 可观测性

### Prometheus 指标

```bash
curl http://localhost:9091/metrics
```

| 指标 | 类型 | 说明 |
|---|---|---|
| `ws_connections_total{client_type}` | Counter | WebSocket 连接总数 |
| `ws_connections_active` | Gauge | 当前活跃连接 |
| `transcription_chars_total{language}` | Counter | 转写字数 |
| `transcription_latency_ms` | Histogram | 转写延迟分布 |
| `audio_bytes_received_total` | Counter | 接收音频字节 |
| `transcription_errors_total{error_type}` | Counter | 错误数 (含 volc_10001 等火山错误码) |

### 健康检查

```bash
curl http://localhost:5000/health
# {
#   "status": "healthy",
#   "engine": "volcengine_bigmodel",
#   "volcengine_configured": true,
#   "volcengine_endpoint": "wss://openspeech.bytedance.com/api/v2/sauc/bigmodel",
#   "volcengine_connections_active": 2,
#   "active_sessions": 2
# }
```

## 🔌 WebSocket 协议

### 客户端 → 服务端

```typescript
// 开始录音
{ event: 'start_recording' }

// 发送音频 (二进制 ArrayBuffer, Int16 PCM 16kHz mono)
emit('audio_data', arrayBuffer)

// 停止
{ event: 'stop_recording' }

// 拉指标
{ event: 'get_metrics' }
```

### 服务端 → 客户端 `transcription_result`

```typescript
{
  event: 'transcription_result',
  text: string,
  is_final: boolean,
  full_text: string,
  latency_ms: number,
  timestamp: string,
  // ===== 火山引擎分角色 =====
  speaker_id?: string,                  // 当前句说话人 'spk0'
  speakers?: Array<{ id, label }>,      // 已出现说话人池
  utterances?: Array<{                  // final 才有完整分段
    text: string,
    start_time: number,                 // ms
    end_time: number,
    speaker_id: string,
    words?: Array<{ text, start_time, end_time, speaker_id }>
  }>
}
```

## 🧪 测试

```bash
# 后端 42 测试
cd tests
python3 -m pytest -v

# 前端 138 测试
cd client
./node_modules/.bin/vitest run
```

合计 **180 个测试全绿**, 覆盖:
- 二进制帧编解码 (14 个, 纯函数无网络)
- VolcengineSession 状态机 (9 个, mock WSS)
- Flask + SocketIO 集成 (7 个, 真实握手)
- Vite dev + 生产构建 + Speaker 配色 (5 个)
- transcriptionReducer 状态转换 (19 个)
- WebSocketClient 透传 (8 个)
- 等等

## 📚 Sprint 文档

| Sprint | 主题 | 改动日志 |
|--------|------|----------|
| 1 | 词级卡拉 OK | [changes/2026-06-20-sprint-1-karaoke.md](../changes/2026-06-20-sprint-1-karaoke.md) |
| 2 | 性能监控 | [changes/2026-06-20-sprint-2-perf.md](../changes/2026-06-20-sprint-2-perf.md) |
| 3 | 多模态可视化 | [changes/2026-06-20-sprint-3-viz.md](../changes/2026-06-20-sprint-3-viz.md) |
| 4 | 可访问性 | [changes/2026-06-20-sprint-4-a11y.md](../changes/2026-06-20-sprint-4-a11y.md) |
| 5 | 架构重构 | [changes/2026-06-20-sprint-5-arch.md](../changes/2026-06-20-sprint-5-arch.md) |
| 6 | E2E | [changes/2026-06-20-sprint-6-e2e.md](../changes/2026-06-20-sprint-6-e2e.md) |
| 7 | 性能调优 + 文档 | [changes/2026-06-20-sprint-7-final.md](../changes/2026-06-20-sprint-7-final.md) |
| **8** | **火山引擎分角色迁移** | **[changes/2026-06-20-volcengine-bigmodel-migration.md](../changes/2026-06-20-volcengine-bigmodel-migration.md)** |

## 🔄 后续 (backlog)

1. 多引擎 fallback: 火山不可用时自动切 Vosk
2. 标注功能: 框选文字 → 修正 → 反馈回路
3. 长音频自动 VAD 断句
4. 翻译联动: 译文与原文同步显示
5. mTLS / 凭据加密存储

## 📄 License

MIT

---

**技术方案**: Claude Opus 4.8 | **最后更新**: 2026-06-20
