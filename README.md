# 语音 · 实时转写作品集

> 个人前端代表作：Vosk 实时语音转写系统 —— 从文件上传、任务列表、在线预览到端到端可观测性。
>
> 涵盖 TDD、E2E 测试、UI 回归、性能调优、可观测性、架构演进完整闭环。

## 📂 仓库结构

```
.
├── vosk-realtime-asr/      # 核心项目：实时语音转写 Demo（前后端 + 可观测性）
│   ├── client/             # 前端 React + Vite
│   ├── server/             # 后端 Python (Flask + SocketIO)
│   ├── monitoring/         # Prometheus 监控配置
│   └── tests/              # 单测 + E2E
│
├── docs/                   # 技术方案 / 架构文档（含模型声明）
├── changes/                # Sprint 变更日志（带截图、demo 视频）
├── work.md                 # 个人履历
└── claude.md               # 项目说明
```

## 🚀 核心项目

**`vosk-realtime-asr/`** —— 基于开源 Vosk 引擎的实时语音转写系统，延迟 < 200ms，含：

- 🎤 实时语音流式识别（Web Audio + WebSocket）
- 📊 Canvas 实时波形可视化
- 📈 Prometheus 指标 + Grafana 面板
- 🧪 148 测试用例（单测 + E2E + UI 回归）
- 🎬 7 个 Sprint 的渐进式交付记录

详细见 [vosk-realtime-asr/README.md](./vosk-realtime-asr/README.md)

## 🛠️ 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18 + Vite + TypeScript + Web Audio + Canvas + WebSocket |
| 后端 | Python 3 + Flask + Flask-SocketIO + Vosk |
| 可观测性 | Prometheus + 自研指标埋点 + 结构化日志 |
| 测试 | pytest + Playwright + a11y 自动化 |
| 监控 | Prometheus + Grafana + Alertmanager |

## 📜 文档

- 技术方案：[docs/](./docs/) —— 每份文档均标注生成所用模型
- 变更日志：[changes/](./changes/) —— 7 个 Sprint + 性能调优 + Bugfix 记录
- 架构演进：见 `changes/2026-06-20-sprint-5-arch.md`

## ⚖️ 许可证

MIT
