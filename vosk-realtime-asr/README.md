# Vosk 实时语音转写 Demo

> 🎯 基于 Vosk 开源语音识别引擎的实时转写系统，具备完善的可观测性能力
>
> 📖 **前端细节: 见 [client/README.md](./client/README.md)** — 6 大模块 / 148 测试 / 性能调优
>
> 🏛️ **架构: 见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**

## ✨ 功能特性

- 🎤 **实时语音转写** - 延迟 < 200ms
- 📊 **波形可视化** - Canvas 实时绘制音频波形
- 📝 **增量文本渲染** - 实时显示部分结果，动画效果
- 📈 **可观测性面板** - 连接状态、音频指标、转写指标、性能图表
- 🔗 **Prometheus 监控** - 完整的指标收集和可视化
- 🆓 **完全免费** - 使用开源 Vosk 中文模型

## 📦 项目结构

```
vosk-realtime-asr/
├── server/                 # 后端服务 (Python)
│   ├── app.py              # Flask + SocketIO 主服务
│   ├── vosk_engine.py      # Vosk引擎封装
│   ├── metrics.py          # Prometheus指标
│   ├── logger.py           # 结构化日志
│   └── requirements.txt    # Python依赖
│   └── models/             # Vosk模型目录(需下载)
│
├── client/                 # 前端应用 (React)
│   ├── src/
│   │   ├── App.tsx         # 主应用
│   │   ├── AudioCapture.ts # 音频采集
│   │   ├── WebSocketClient.ts # WebSocket通信
│   │   ├── WaveformVisualizer.tsx # 波形可视化
│   │   ├── TranscriptionRenderer.tsx # 文本渲染
│   │   ├── ObservabilityPanel.tsx # 监控面板
│   │   └── styles.css      # 样式文件
│   ├── public/
│   │   ├── audio-processor.js # AudioWorklet处理器
│   │   └── index.html      # HTML模板
│   └── package.json        # 前端依赖
│
├── monitoring/             # 监控配置
│   ├── prometheus.yml      # Prometheus配置
│   ├── grafana-dashboard.json # Grafana仪表盘
│   └── docker-compose.yml  # 监控服务编排
│
└── README.md               # 本文件
```

## 🚀 快速开始

### 1. 安装后端依赖

```bash
cd server
pip install -r requirements.txt
```

### 2. 下载 Vosk 中文模型

```bash
cd server

# 下载中文模型 (~50MB)
wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip

# 解压到 models 目录
mkdir -p models
unzip vosk-model-cn-0.22.zip -d models/

# 确认目录结构正确
ls models/vosk-model-cn-0.22/
```

### 3. 启动后端服务

```bash
cd server
python app.py
```

服务启动后：
- WebSocket 服务: `ws://localhost:5000`
- Prometheus 指标: `http://localhost:9091`
- 健康检查: `http://localhost:5000/health`

### 4. 安装前端依赖

```bash
cd client
npm install
```

### 5. 启动前端服务

```bash
cd client
npm run dev
```

访问: `http://localhost:3000`

### 6. 启动监控服务（可选）

```bash
cd monitoring
docker-compose up -d

# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (admin/admin)
```

## 📊 可观测性指标

### 监控面板显示

| 类别 | 指标 | 说明 |
|------|------|------|
| **连接** | WebSocket状态 | 已连接/未连接 |
| **连接** | 会话ID | 当前会话标识 |
| **连接** | 运行时间 | 录音持续时间 |
| **音频** | 接收字节 | 音频数据总量 |
| **音频** | 处理块数 | 音频块处理次数 |
| **转写** | 转写字数 | 已转写字符数 |
| **转写** | 平均延迟 | 转写响应延迟 |
| **转写** | 实时率 | 字数/秒 |

### Prometheus 指标

```bash
# 查看指标
curl http://localhost:9091/metrics

# 主要指标
ws_connections_total          # 总连接数
ws_connections_active        # 活跃连接数
transcription_latency_ms     # 转写延迟
transcription_chars_total    # 转写字数
audio_bytes_received_total   # 音频字节
transcription_errors_total   # 错误数
```

## 🔧 技术栈

### 后端
- **Python 3.8+**
- **Flask** + **Flask-SocketIO** - WebSocket 服务
- **Vosk** - 开源语音识别引擎
- **Prometheus Client** - 指标收集

### 前端
- **React 18** + **TypeScript**
- **Web Audio API** + **AudioWorklet** - 低延迟音频采集
- **Canvas** - 波形可视化
- **Framer Motion** - 动画效果
- **Vite** - 构建工具

### 监控
- **Prometheus** - 指标存储
- **Grafana** - 可视化仪表盘

## 📋 API 说明

### WebSocket 消息格式

#### 客户端 → 服务端

```typescript
// 开始录音
{ event: 'start_recording' }

// 发送音频数据 (二进制 PCM)
ArrayBuffer (Int16Array, 16kHz, 单声道)

// 停止录音
{ event: 'stop_recording' }
```

#### 服务端 → 客户端

```typescript
// 连接成功
{
  event: 'connected',
  session_id: 'xxx',
  timestamp: '2026-06-20T10:00:00Z'
}

// 转写结果
{
  event: 'transcription_result',
  text: '你好世界',
  is_final: true/false,
  full_text: '你好世界...',
  latency_ms: 150
}

// 会话状态
{
  event: 'session_status',
  metrics: {
    audio_bytes: 10000,
    transcription_chars: 50,
    avg_latency: 150
  }
}
```

### REST API

```bash
# 健康检查
GET /health

# 指标汇总
GET /metrics/summary
```

## 🧪 测试

### 单元测试

```bash
cd server
pytest tests/
```

### 性能测试

- 转写延迟: 目标 < 200ms
- 内存占用: 目标 < 100MB
- 连接支持: 目标 100+ 并发

## 🔍 常见问题

### Q: 麦克风权限被拒绝？
A: 确保浏览器允许麦克风访问，检查 HTTPS 或 localhost 环境。

### Q: WebSocket 连接失败？
A: 确认后端服务已启动，检查端口 5000 是否被占用。

### Q: 转写结果不显示？
A: 确认 Vosk 模型已正确下载并放置在 models 目录。

### Q: 波形不显示？
A: 确认 AudioWorklet 文件路径正确，检查浏览器支持。

## 📝 更新日志

### v1.0.0 (2026-06-20)
- ✅ 完成 Vosk 实时转写核心功能
- ✅ 实现音频波形可视化
- ✅ 添加可观测性监控面板
- ✅ 支持 Prometheus 指标收集

## 📚 Sprint 文档

| Sprint | 主题 | 改动日志 | docs |
|--------|------|----------|------|
| 1 | 词级卡拉 OK | [changes/2026-06-20-sprint-1-karaoke.md](./changes/2026-06-20-sprint-1-karaoke.md) | [docs/2026-06-20-sprint-1-karaoke.md](./docs/2026-06-20-sprint-1-karaoke.md) |
| 2 | 性能监控 | [changes/2026-06-20-sprint-2-perf.md](./changes/2026-06-20-sprint-2-perf.md) | [docs/2026-06-20-sprint-2-perf.md](./docs/2026-06-20-sprint-2-perf.md) |
| 3 | 多模态可视化 | [changes/2026-06-20-sprint-3-viz.md](./changes/2026-06-20-sprint-3-viz.md) | [docs/2026-06-20-sprint-3-viz.md](./docs/2026-06-20-sprint-3-viz.md) |
| 4 | 可访问性 | [changes/2026-06-20-sprint-4-a11y.md](./changes/2026-06-20-sprint-4-a11y.md) | [docs/2026-06-20-sprint-4-a11y.md](./docs/2026-06-20-sprint-4-a11y.md) |
| 5 | 架构重构 | [changes/2026-06-20-sprint-5-arch.md](./changes/2026-06-20-sprint-5-arch.md) | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| 7 | 性能调优 + 文档 | [changes/2026-06-20-sprint-7-final.md](./changes/2026-06-20-sprint-7-final.md) | [client/README.md](./client/README.md) |

## 🔄 后续扩展

1. **切换 FunASR** - 提升中文准确率
2. **说话人分离** - 区分不同说话人
3. **标点恢复** - 自动添加标点
4. **导出功能** - 导出转写文本
5. **标注功能** - 修正转写结果

## 📄 License

MIT License - 完全开源免费

---

**技术方案**: Claude Opus 4.8 | **日期**: 2026-06-20