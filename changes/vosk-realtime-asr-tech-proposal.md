# Vosk 实时语音转写 Demo 技术方案

> **生成模型**: Claude Opus 4.8 | **日期**: 2026-06-20

---

## 一、项目概述

### 1.1 目标
基于 Vosk 开源语音识别引擎，构建一个完整可运行的实时语音转写 Demo，具备完善的可观测性能力。

### 1.2 核心特性
- ✅ 实时语音转写（延迟 < 200ms）
- ✅ 音频波形可视化
- ✅ 实时文本渲染（增量更新）
- ✅ **可观测性**：日志追踪、状态监控、性能指标
- ✅ 多端支持：PC Web、H5

### 1.3 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React 18 + TypeScript | SPA 应用 |
| **音频采集** | Web Audio API + AudioWorklet | 低延迟音频处理 |
| **通信** | WebSocket | 实时双向通信 |
| **后端** | Python + Flask-SocketIO | WebSocket 服务端 |
| **ASR引擎** | Vosk (中文模型) | 开源语音识别 |
| **可观测性** | Prometheus + Grafana | 监控仪表盘 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面层                                │
├─────────────────────────────────────────────────────────────────┤
│  React App                                                       │
│  ├── AudioCapture (WebAudio + AudioWorklet)                      │
│  ├── WaveformVisualizer (Canvas 波形绘制)                        │
│  ├── TranscriptionRenderer (实时文本)                            │
│  └── ObservabilityDashboard (状态监控面板)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                        服务端层                                  │
├─────────────────────────────────────────────────────────────────┤
│  Flask + SocketIO                                                │
│  ├── WebSocket Handler (连接管理)                                │
│  ├── AudioProcessor (音频处理)                                   │
│  ├── VoskEngine (语音识别引擎)                                   │
│  ├── MetricsCollector (指标收集)                                 │
│  └── Logger (结构化日志)                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                        可观测层                                  │
├─────────────────────────────────────────────────────────────────┤
│  Prometheus (指标存储)                                           │
│  ├── 连接数指标                                                   │
│  ├── 转写延迟指标                                                 │
│  ├── 音频吞吐量指标                                               │
│  ├── 错误率指标                                                   │
│  Grafana (可视化仪表盘)                                          │
│  ├── 实时监控面板                                                 │
│  ├── 性能分析图表                                                 │
│  └── 告警规则                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、可观测性设计

### 3.1 监控指标体系

| 类别 | 指标名称 | 说明 | 类型 |
|------|----------|------|------|
| **连接** | `ws_connections_total` | WebSocket 连接总数 | Counter |
| **连接** | `ws_connections_active` | 当前活跃连接数 | Gauge |
| **连接** | `ws_connection_duration` | 连接持续时间 | Histogram |
| **转写** | `transcription_latency_ms` | 转写延迟 | Histogram |
| **转写** | `transcription_chars_total` | 转写字符数 | Counter |
| **转写** | `transcription_errors_total` | 转写错误数 | Counter |
| **音频** | `audio_bytes_received` | 接收音频字节 | Counter |
| **音频** | `audio_chunks_processed` | 处理音频块数 | Counter |
| **系统** | `cpu_usage_percent` | CPU 使用率 | Gauge |
| **系统** | `memory_usage_mb` | 内存使用 | Gauge |

### 3.2 日志规范

```json
// 日志格式 (JSON结构化)
{
  "timestamp": "2026-06-20T10:30:00Z",
  "level": "INFO",
  "trace_id": "abc123",
  "span_id": "span456",
  "user_id": "user001",
  "session_id": "session001",
  "event_type": "transcription_result",
  "message": "Transcription completed",
  "metadata": {
    "text_length": 50,
    "latency_ms": 150,
    "is_final": true
  }
}
```

### 3.3 状态追踪

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| `idle` | 等待连接 | 服务启动 |
| `connecting` | 正在连接 | WebSocket握手 |
| `ready` | 等待录音 | 连接成功 |
| `recording` | 正在录音 | 用户点击开始 |
| `transcribing` | 正在转写 | 音频数据到达 |
| `paused` | 已暂停 | 用户点击暂停 |
| `error` | 错误状态 | 异常发生 |
| `completed` | 完成 | 用户点击停止 |

---

## 四、目录结构

```
vosk-realtime-asr/
├── server/                     # 后端服务
│   ├── app.py                  # Flask主入口
│   ├── vosk_engine.py          # Vosk引擎封装
│   ├── metrics.py              # Prometheus指标
│   ├── logger.py               # 结构化日志
│   ├── config.py               # 配置文件
│   └── requirements.txt        # Python依赖
│   └── models/                 # Vosk模型目录
│       └── vosk-model-cn-0.22/ # 中文模型(需下载)
│
├── client/                     # 前端应用
│   ├── src/
│   │   ├── App.tsx             # 主应用组件
│   │   ├── AudioCapture.ts     # 音频采集模块
│   │   ├── WebSocketClient.ts  # WebSocket客户端
│   │   ├── WaveformVisualizer.tsx # 波形可视化
│   │   ├── TranscriptionRenderer.tsx # 文本渲染
│   │   ├── ObservabilityPanel.tsx # 监控面板
│   │   ├── types.ts            # 类型定义
│   │   └── index.tsx           # 入口文件
│   ├── public/
│   │   ├── audio-processor.js  # AudioWorklet处理器
│   │   └── index.html          # HTML模板
│   ├── package.json            # 前端依赖
│   ├── tsconfig.json           # TS配置
│   └── vite.config.ts          # Vite配置
│
├── monitoring/                  # 监控配置
│   ├── prometheus.yml          # Prometheus配置
│   ├── grafana-dashboard.json  # Grafana仪表盘
│   └── docker-compose.yml      # 监控服务编排
│
├── tests/                       # 测试文件
│   ├── test_vosk_engine.py     # Vosk引擎测试
│   ├── test_websocket.py       # WebSocket测试
│   └── test_metrics.py         # 指标测试
│
├── docs/                        # 文档
│   ├── API.md                  # API文档
│   ├── SETUP.md                # 安装指南
│   └── MONITORING.md           # 监控说明
│
└── README.md                    # 项目说明
```

---

## 五、核心实现要点

### 5.1 Vosk 实时转写核心

```python
# 关键：流式识别，实时返回部分结果
while True:
    data = stream.read(4000)  # 250ms 音频块

    if recognizer.AcceptWaveform(data):
        # 完整句子
        result = json.loads(recognizer.Result())
        yield {"text": result['text'], "is_final": True}
    else:
        # 部分结果（实时显示）
        partial = json.loads(recognizer.PartialResult())
        if partial['partial']:
            yield {"text": partial['partial'], "is_final": False}
```

### 5.2 音频采集关键参数

```typescript
// 音频配置
const AUDIO_CONFIG = {
  sampleRate: 16000,      // Vosk要求16kHz
  channelCount: 1,        // 单声道
  latencyHint: 'interactive', // 最小延迟
  echoCancellation: true, // 回声消除
  noiseSuppression: true, // 降噪
};
```

### 5.3 可观测性关键

```python
# 指标收集
@socketio.on('audio_data')
def handle_audio(data):
    start_time = time.time()

    # 处理音频
    result = vosk_engine.transcribe(data)

    # 记录指标
    latency = (time.time() - start_time) * 1000
    TRANSCRIPTION_LATENCY.observe(latency)
    TRANSCRIPTION_CHARS.inc(len(result['text']))

    emit('transcription_result', result)
```

---

## 六、部署运行

### 6.1 环境准备

```bash
# 1. 安装Python依赖
cd server
pip install -r requirements.txt

# 2. 下载Vosk中文模型
wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip
unzip vosk-model-cn-0.22.zip -d models/

# 3. 启动后端
python app.py

# 4. 安装前端依赖
cd client
npm install

# 5. 启动前端
npm run dev
```

### 6.2 启动监控（可选）

```bash
cd monitoring
docker-compose up -d

# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000
```

---

## 七、测试计划

### 7.1 单元测试
- Vosk引擎转写准确率测试
- 音频处理模块测试
- WebSocket消息格式测试

### 7.2 集成测试
- 完整转写流程测试
- 断线重连测试
- 并发连接测试

### 7.3 性能测试
- 转写延迟测试（目标 < 200ms）
- 长时间运行稳定性测试
- 内存占用测试（目标 < 100MB）

---

## 八、后续扩展

1. **切换到 FunASR** - 提升中文准确率
2. **添加说话人分离** - 区分不同说话人
3. **添加标点恢复** - 自动添加标点符号
4. **添加导出功能** - 导出转写文本
5. **添加标注功能** - 对转写结果进行标注修正

---

**方案状态**: 已完成 | **下一步**: 创建完整代码实现