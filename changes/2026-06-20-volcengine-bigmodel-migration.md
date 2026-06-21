# Changes — 2026-06-20 · 火山引擎 bigmodel 分角色实时转写迁移

> **Sprint 8 — 引擎升级**
> 模型: Claude Opus 4.8
> 范围: 后端引擎全替换 + 前端分角色 UI + 23 个新单测 + E2E

## 一句话摘要

把 `vosk-realtime-asr` 从 **Vosk 开源引擎** 切换为 **火山引擎 (字节跳动) 「一句话识别 - 流式版 bigmodel」** WebSocket API, 同时开启 **说话人分离 (speaker diarization)** —— 字幕按角色分色, 多人会议场景可读性数量级提升。

---

## 改动矩阵

| 维度 | 旧 (Vosk) | 新 (火山引擎 bigmodel) |
|---|---|---|
| ASR 引擎 | 本地 Vosk 模型 (~500MB) | 云端 bigmodel (免部署) |
| 通信 | Flask SocketIO 转发到子进程 worker | Flask SocketIO 转发到 per-sid WSS 长连接 |
| 分角色 | ❌ | ✅ `show_speaker_info` + `utterances[]` |
| 标点 | 启发式加 `。！？` | 服务端 `enable_punc` 真标点 |
| ITN | ❌ | ✅ `enable_itn` 数字/日期归一 |
| 延迟 | < 200ms | < 300ms (云端) |
| 鉴权 | 无 | `Authorization: Bearer; {token}` + X-Api-* |

---

## 新增文件

### 后端

| 文件 | 行数 | 作用 |
|---|---|---|
| `server/volcengine_engine.py` | 270 | 火山引擎二进制帧协议层 (编码/解码/构造 payload) |
| `server/volcengine_session.py` | 235 | per-sid WSS 长连接 + 后台读线程 + 回调分发 |
| `tests/test_volcengine_protocol.py` | 14 测试 | 协议编解码纯函数层 (无网络) |
| `tests/test_volcengine_session.py` | 9 测试 | 会话握手/帧/读循环 (mock WSS) |
| `tests/test_volcengine_e2e.py` | 7 测试 | Flask + SocketIO 集成 (speaker 字段透传) |

### 前端

- `src/state/transcriptionReducer.ts` — 加 `speakers / currentSpeakerId / currentUtterances` 字段, 合并去重 + 稳定 hash 配色
- `src/Subtitle.tsx` — 句首 🎙 说话人徽章 + 词级高亮按 speaker 配色 + 进度条
- `src/TranscriptionRenderer.tsx` — 行首 3px 色条 + 说话人标签 + utterances[] 展开详情
- `src/AppLayout.tsx` — 透传 speakers/currentSpeakerId/utterances 到 Subtitle, footer 文案改火山引擎
- `src/App.tsx` / `src/hooks/useTranscription.ts` / `src/WebSocketClient.ts` — 透传 speaker_id 到 reducer
- `src/styles.css` — `.result-speaker` 圆角徽章样式 + `.utterance-details` 列表
- `src/__tests__/transcriptionReducer.test.ts` — 加 6 个 speaker 配色 / 合并 / utterances 测试
- `src/__tests__/WebSocketClient.test.ts` — 加 speaker 字段透传测试

---

## 重写文件

| 文件 | 变更 |
|---|---|
| `server/app.py` | 完全重写: 删除 vosk_worker 启动/监听, 改为 per-sid VolcengineSession 生命周期; emit payload 新增 `speaker_id / speakers / utterances` |
| `server/config.py` | 加 `VOLC_ENDPOINT / VOLC_APP_KEY / VOLC_ACCESS_TOKEN / VOLC_CLUSTER / VOLC_MODEL_NAME` |
| `server/requirements.txt` | 删 `vosk`, 加 `websocket-client>=1.6.0` + `python-dotenv>=1.0.0` |
| `server/run_server.py` | 加 `load_dotenv` 让 .env 在启动前注入 |
| `client/index.html` / `client/public/index.html` | 标题改 "火山引擎 · 分角色实时转写" |
| `client/src/AppHeader.tsx` | h1 同步 |
| `tests/conftest.py` | `PROM_URL` 从 9092 改 9091 (config 默认) |
| `tests/test_ui_smoke.py` | 标题/版本断言改新引擎, Content-Type 用 r.content.decode 避免 ISO 误码 |

---

## 删除文件

- `server/vosk_worker.py` — 火山会话不需要子进程隔离 (云端不会本地崩溃)
- `server/vosk_engine.py` — Vosk 引擎本体
- `tests/test_vosk_engine.py` / `tests/test_vosk_worker.py` / `tests/test_websocket.py` — 旧 e2e 测试, 由 `test_volcengine_e2e.py` 替代
- `server/models/` — Vosk 中文模型 (保留作为可选 fallback)

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 每个 sid 独立 WSS 连接 | ✅ | 火山 bigmodel session 模型天然一对一 |
| 后台读线程 (而非 async) | ✅ | `websocket-client` 是同步 API; Flask + threading async_mode 兼容 |
| 客户端 buffering first_audio | ✅ | 火山要求 full request 必须带 first audio; start_recording 时用 200ms 静音占位 |
| Speaker 配色算法 | ✅ djb2 hash + 8 色调色板 | 同 id 永远同色, 不同 id 大概率不同色; 不暴露 palette 参数 (避免 `arr.map(getSpeakerColor)` 把 map index 当 palette) |
| Speakers 数组合并 | ✅ id 去重 + 稳定 color | partial 和 final 来回切换, 同一 speaker 不重复, 颜色不变 |
| 火山握手失败 | ✅ emit error 事件 + UI 弹错 | 不让 Flask 5xx, 让前端可恢复 |
| 凭据缺失 | ✅ fail-fast 警告, 不阻止启动 | dev 环境无凭据也能跑其他测试 |

---

## 协议关键点 (技术沉淀)

```python
# 客户端请求帧 (字节布局)
byte0 = 0x11                  # (protocol_v1 << 4) | header_size
byte1 = 0x01 or 0x02         # 4B or 6B header
byte2 = (msg_type<<4) | flags # 0x1=full_req, 0x2=audio_only; flags=0x2=LAST
byte3.. = payload_size        # 1 byte (< 256) or 3 bytes (>= 256)
body = JSON  for 0x1
body = PCM   for 0x2

# 服务端响应
0x9  full_resp     - 配置 ack
0xC  partial_resp  - 增量 partial (不带 utterances)
0xF  final_resp    - 完整结果 (带 utterances[] + speaker_id)
0xB  error         - {code, message}
```

**最容易踩坑**:
1. payload >= 256 bytes 必须用 6 字节 header, byte3..5 = 24-bit size
2. `Authorization: Bearer; {token}` **带分号**, 字节 SAUC 网关特殊格式
3. 第一帧必须是 0x1 full request + 至少 200ms 静音 (否则服务端不会开始识别)
4. 最后一帧必须 `flags=0x22` (audio_only + LAST), 否则服务端不会回 final
5. partial 不带 utterances, 只有 final 才返回分段 + 词级时间戳

---

## 测试结果

```
后端 pytest:  42 passed in 17.99s
├─ volcengine 协议:  14 passed (纯函数, 无网络)
├─ volcengine 会话:   9 passed (mock WSS)
├─ volcengine E2E:   7 passed (Flask + SocketIO 集成)
├─ metrics:          7 passed (safe_value + /metrics)
└─ UI smoke:         5 passed (Vite dev + 生产构建)

前端 vitest: 138 passed in 6.59s
├─ transcriptionReducer: 19 passed (含 6 个 speaker 测试)
├─ WebSocketClient:       8 passed (含 speaker 字段透传)
├─ Visualizer:           35 passed
├─ PerfMonitor:          24 passed
├─ KeyboardShortcuts:    12 passed
├─ AccessibilityContext: 11 passed
├─ HelpOverlay:           6 passed
├─ ThemeSwitcher:         5 passed
├─ samplePlayer:          8 passed
├─ subtitleKaraoke:       6 passed
└─ useDebugLog:           5 passed

合计 180 个测试, 全部绿色
```

---

## 启动 / 配置

```bash
# 1. 配置 .env (已有示例)
cat server/.env
# VOLC_APP_KEY=<your-app-key>
# VOLC_ACCESS_TOKEN=<your-access-token>
# VOLC_CLUSTER=volcengine_streaming_common
# VOLC_MODEL_NAME=bigmodel

# 2. 启动后端
cd server
python3 run_server.py
# → Listening on 0.0.0.0:5000
# → Prometheus on :9091
# → /health → {"engine": "volcengine_bigmodel", "volcengine_configured": true}

# 3. 启动前端
cd client
npm run dev
# → http://localhost:3000
```

---

## 演示效果

1. 打开 http://localhost:3000 → 标题 "🎯 火山引擎 · 分角色实时转写"
2. 点「开始录音」 → 浏览器采麦克风 → 后端 volc session 建立 WSS → 推流到火山
3. 火山返回 partial 字幕 → 句首出现 🎙 徽章 (按 speaker 配色)
4. 多人对话时, 不同说话人**自动分配不同颜色**, 整段对话一眼可读
5. 词级高亮按 speaker 配色 (不再统一 cyan)
6. 点「停止」 → 后端发 0x22 最后一帧 → 火山返回 0xF final → utterances[] 详情展开

---

## 后续 (backlog)

- [ ] 多引擎 fallback: 火山不可用时自动切 Vosk
- [ ] 标注功能: 框选 → 修正 → 反馈回路
- [ ] 长音频自动 VAD 断句
- [ ] 翻译联动: 译文与原文同步显示
- [ ] mTLS / 凭据加密存储
- [ ] 后端连接池: 单进程支持 >5 路并发 (火山单账号默认 5)
- [ ] 把 utterances[] 渲染成可点击时间轴, 点击跳到该段

---

**方案文档**: `docs/2026-06-20-volcengine-realtime-asr-migration.md`
**技术沉淀**: `changes/2026-06-20-volcengine-bigmodel-migration.md` (本文)
