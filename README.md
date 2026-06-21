# 语音 · 实时转写作品集

> 个人前端代表作: 火山引擎 (字节跳动) 「一句话识别 - 流式版 bigmodel」 实时分角色转写
>
> 涵盖 TDD、E2E 测试、UI 回归、性能调优、可观测性、架构演进完整闭环。

## 📂 仓库结构

```
.
├── vosk-realtime-asr/      # 核心项目: 火山引擎分角色实时转写 (前后端 + 可观测性)
│   ├── client/             # 前端 React + Vite + 分角色字幕
│   ├── server/             # 后端 Python (Flask + SocketIO + 火山 WSS)
│   ├── monitoring/         # Prometheus 监控配置
│   └── tests/              # 单测 + E2E (180 个测试全绿)
│
├── docs/                   # 技术方案 / 架构文档 (含模型声明)
├── changes/                # Sprint 变更日志 (8 个 Sprint + 性能调优 + Bugfix)
└── claude.md               # 项目说明
```

## 🚀 核心项目

**`vosk-realtime-asr/`** —— 基于 **火山引擎 bigmodel** 的实时分角色转写系统:

- 🎤 **流式一句话识别** — 端到端延迟 < 300ms
- 🗣️ **说话人分离 (diarization)** — `show_speaker_info=True`, 多人对话自动分配不同颜色
- 📊 Canvas 实时波形可视化
- 📈 Prometheus 指标 + 监控面板 (`:9091/metrics`)
- 🧪 **180 测试** (后端 42 + 前端 138), TDD 全绿
- 🎨 句首 🎙 徽章 + 词级高亮按 speaker 配色

详细见 [vosk-realtime-asr/README.md](./vosk-realtime-asr/README.md)

## 🛠️ 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18 + Vite + TypeScript + Web Audio + Canvas + WebSocket |
| 后端 | Python 3 + Flask + Flask-SocketIO + websocket-client |
| ASR 引擎 | **火山引擎 bigmodel** (字节跳动开放平台) |
| 可观测性 | Prometheus + 自研指标埋点 + 结构化日志 |
| 测试 | pytest + Vitest + Playwright + a11y 自动化 |

## 📜 文档

- 技术方案: [docs/](./docs/) —— 每份文档均标注生成所用模型
- 变更日志: [changes/](./changes/) —— 8 个 Sprint + 性能调优 + Bugfix + **Sprint 8 火山引擎迁移**
- 架构演进: 见 `changes/2026-06-20-sprint-5-arch.md`

## ⚖️ 许可证

MIT
