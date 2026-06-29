**模型:** MiniMax-M3

# 语音播客大模型接入 — 技术方案

> Date: 2026-06-27
> Author: voice-portfolio agent
> Status: 已完成调研, 进入 TDD 实现

## 1. 目标

将 voice-portfolio 现有"实时转写 + 多说话人"管线延伸一个终态：**长会议转写 → LLM 生成播客式摘要（两位 AI 主持对话）→ TTS 播放**。

## 2. 火山引擎语音播客大模型 API 调研结果

### 2.1 调研受限说明

受沙箱网络限制，WebSearch / WebFetch 在本会话内无法直接拉取火山引擎控制台文档。基于项目历史接入经验（`volcengine_engine.py` 已实测 v3 流式协议），以及公开资料对豆包系列 API 的家族结构描述，本设计采用以下**事实型假设**，并在 `server/podcast.py` 中将其封装为可替换的 transport 接口。

### 2.2 接口假设（与既有火山协议族一致）

| 维度 | 假设 |
| --- | --- |
| 端点 | `https://openspeech.bytedance.com/api/v3/podcast/generate` (HTTP POST) |
| 鉴权 | `X-Api-Key` (新控制台) 或 `X-Api-App-Key` + `X-Api-Access-Key` (旧控制台) + `X-Api-Resource-Id: volc.podcast.llm.duration` |
| 输入 | `{"text": <string or speaker-tagged segments>, "style": "tech\|business\|entertainment\|academic", "duration": "short\|medium\|long", "include_audio_clip": bool, "speakers": 2}` |
| 输出 | `{"script": [{"role": "host_a\|host_b", "text": "...", "audio_url": "https://...", "duration_ms": 1234}, ...], "chapters": [{"title": "...", "start_ms": 0, "end_ms": 1234}], "total_duration_ms": 5678}` |
| 异步 | 长会议建议用 `poll` 端点, 返回 `task_id` + 进度百分比 |
| 风格枚举 | `tech`, `business`, `entertainment`, `academic` (4 种) |
| 长度 | `short` (~1min), `medium` (~3min), `long` (~6min) |

### 2.3 凭证

- `VOLC_PODCAST_APP_ID`
- `VOLC_PODCAST_TOKEN` (旧控制台)
- 或 `VOLC_PODCAST_API_KEY` (新控制台, 单一 header)

明文凭证不进代码、不进 git。从 `~/.voice-portfolio-secrets/` 截图凭证通过 `.env` 注入。

### 2.4 与现有 ASR 的关系

- 不复用 `VolcengineSession` / `volcengine_engine.py` (那是实时语音 WS 协议栈)
- 新建独立 `server/podcast.py`, 走 HTTPS REST + 可选 polling
- metrics / logger / OTel 共用

## 3. 后端设计 (server/podcast.py)

### 3.1 模块拆分

| 函数 | 职责 |
| --- | --- |
| `STYLES` | 风格枚举 + 描述 (dict) |
| `DURATIONS` | 长度枚举 (dict) |
| `parse_script(raw_script) -> list[HostTurn]` | 解析主持人 A/B 分流 |
| `validate_request(payload) -> (bool, str)` | 输入校验 |
| `build_request_payload(...)` | 构造 HTTPS body |
| `call_podcast_api(payload, config) -> dict` | HTTPS 同步调用 (mockable) |
| `poll_podcast_task(task_id, config) -> dict` | 异步轮询 (mockable) |
| `generate_podcast(transcript, opts, config) -> PodcastResult` | 顶层编排 |

### 3.2 REST 端点

```
POST /api/podcast/generate
  Body: { "transcript": "...", "style": "tech", "duration": "medium", "include_audio_clip": false }
  → 202 Accepted: { "task_id": "...", "status": "pending" }
  或同步模式 (duration=short) → 200 OK: { "script": [...], "chapters": [...], "total_duration_ms": ... }

GET  /api/podcast/styles
  → 200 OK: { "styles": [{"id":"tech", "label":"科技", "description":"..."}, ...] }

GET  /api/podcast/task/<task_id>
  → 200 OK: { "status": "running|done|failed", "progress": 0.0..1.0, "script"?, "chapters"? }
```

### 3.3 可观测性

- 结构化日志: `[Podcast] generate { meeting_chars, style, duration, task_id, latency_ms }`
- OTel span: `podcast.generate`, `podcast.poll`
- Prometheus: `podcast_generate_total{style}`, `podcast_generate_latency_seconds`, `podcast_generate_errors_total{error_type}`

### 3.4 错误处理

| 场景 | 行为 |
| --- | --- |
| 凭证缺失 | 503 + `podcast_not_configured` |
| transcript 为空 | 400 + `empty_transcript` |
| transcript 超长 (>50k chars) | 400 + `transcript_too_long` |
| 风格 / 长度不合法 | 400 + `invalid_option` |
| 上游 5xx | 502 + `upstream_error`, 自动重试 1 次 |
| 轮询超时 | 504 + `podcast_timeout` |

## 4. 前端设计

### 4.1 新增文件

- `client/src/hooks/usePodcastGeneration.ts` — 状态机 `idle → submitting → running → success | error`，支持重试、轮询进度
- `client/src/components/PodcastGenerator.tsx` — 输入面板：转写来源（自动从 transcription state 取）、风格下拉、长度 radio、是否含原声片段 checkbox、"生成播客"按钮
- `client/src/components/PodcastPlayer.tsx` — 大封面（gradient 占位 + 时长 + 标题）、两位主持人头像对话气泡（从 script 数组渲染）、右侧章节列表（点击跳转）、底部播放控制（播/暂/前 15s/后 15s/倍速 0.5x-2x）、波形进度条

### 4.2 状态机 (usePodcastGeneration)

```
idle
  → submit() → submitting
submitting → success(resume task_id) | sync_success(result) | error(err, retryable)
  → poll() → running(progress) → success | error
running → cancel() → idle
error   → retry() → submitting
```

### 4.3 CSS 设计语言 (参考 Apple Podcasts / Spotify)

- **大封面**: 220px 圆角方形, 内嵌双主持人头像 80px 圆形, gradient 背景 (avatar-driven)
- **气泡**: 主持人 A 左对齐 (#1E88E5 主色), 主持人 B 右对齐 (#E91E63 强调色), 圆角 18px, 段间距 12px
- **章节列表**: 右侧 280px 抽屉, 行高 56px, hover 高亮 + active 蓝条左侧
- **播放控制**: 64px 圆形主按钮 (中心三角), 前/后 15s 圆形次按钮, 倍速 chip (0.75/1/1.25/1.5/2x)
- **波形**: 底部贴底, 240px 高度, 进度色与主色一致

### 4.4 性能与可访问性

- 脚本气泡虚拟化（>50 条时分段渲染）— 防止长播客脚本卡顿
- 键盘: Space 播放/暂停, ← → 跳章节, ↑↓ 调音量, [ ] 调倍速
- ARIA: `role="region" aria-label="播客播放器"`、气泡 `role="listitem"`、进度条 `role="progressbar"`
- prefers-reduced-motion 关闭波形动画

## 5. TDD 计划 (红 → 绿 → 重构)

### 5.1 后端测试

`server/__tests__/test_podcast.py`:
1. `test_parse_script_host_a_or_b` — 主持人分流纯函数
2. `test_parse_script_handles_unknown_speaker` — 容错
3. `test_validate_request_empty_transcript` — 拒绝空输入
4. `test_validate_request_too_long` — 长度上限
5. `test_validate_request_invalid_style` — 风格枚举
6. `test_styles_endpoint_returns_all_four` — 4 种风格
7. `test_generate_endpoint_dispatches_to_api` — mock HTTPS 调用, 验证 payload
8. `test_generate_endpoint_returns_202_for_long` — 异步路径
9. `test_generate_endpoint_returns_200_for_short` — 同步路径
10. `test_poll_task_endpoint` — 任务进度轮询
11. `test_credentials_missing_returns_503` — 凭证缺失
12. `test_upstream_5xx_returns_502` — 上游错误

### 5.2 前端测试

`client/src/__tests__/podcastGeneration.test.ts`:
1. `usePodcastGeneration` 初始状态 idle
2. submit() → submitting → success
3. submit() → error → retry() → submitting
4. cancel() 在 running 中 → idle
5. progress 字段在 polling 中更新
6. mock fetch 验证请求 body + headers

`client/src/__tests__/podcastPlayer.test.tsx`:
1. 渲染封面 + 标题 + 时长
2. 渲染气泡 (host_a 左 / host_b 右)
3. 章节列表点击跳转
4. 播放/暂停按钮交互
5. 倍速切换 (0.75/1/1.25/1.5/2x)
6. 键盘: Space 暂停, → 下一章

## 6. 范围约束 (明确不做)

- 不改动 `transcriptionReducer` / `useTranscription` / 现有 ASR 组件
- 不写明文 API Key
- 不 git commit / push
- 不使用 emoji (含 UI 文案)

## 7. 改动文件清单

| 文件 | 操作 |
| --- | --- |
| `server/podcast.py` | 新建 |
| `server/__tests__/test_podcast.py` | 新建 |
| `server/app.py` | 挂载 `/api/podcast/*` (最小改动, 仅 1 个 blueprint import + register) |
| `server/config.py` | 增加 3 个 env 配置项 |
| `client/src/hooks/usePodcastGeneration.ts` | 新建 |
| `client/src/components/PodcastGenerator.tsx` | 新建 |
| `client/src/components/PodcastPlayer.tsx` | 新建 |
| `client/src/__tests__/podcastGeneration.test.ts` | 新建 |
| `client/src/__tests__/podcastPlayer.test.tsx` | 新建 |
| `client/src/AppLayout.tsx` | 在主视图 `<main>` 末尾新增 PodcastGenerator + PodcastPlayer 挂载 (仅渲染入口) |
| `client/src/styles.css` | 新增 `.podcast-*` 样式 |
| `changes/2026-06-27-podcast-llm.md` | 新建 |