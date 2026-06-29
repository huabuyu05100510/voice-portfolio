**模型:** MiniMax-M3

# 语音播客大模型 (Podcast LLM) 接入 — 改动记录

> Date: 2026-06-27
> Author: voice-portfolio agent (MiniMax-M3)
> Sprint: 14
> Design doc: [docs/2026-06-27-podcast-llm-tech-proposal.md](../docs/2026-06-27-podcast-llm-tech-proposal.md)

## 目标

把 voice-portfolio 现有"实时转写 + 多说话人"管线延伸一个终态：
**长会议转写 → 语音播客大模型生成两位 AI 主持对话脚本 → 浏览器播放**。

## 调研结论 (受沙箱网络限制, 部分假设)

- 火山引擎 / 豆包系列协议风格一致 (X-Api-Key 单一鉴权或 X-Api-App-Key + X-Api-Access-Key 双鉴权 + X-Api-Resource-Id)
- 风格枚举: tech / business / entertainment / academic (4 种)
- 长度枚举: short (1min, 同步) / medium (3min, 异步) / long (6min, 异步)
- 输出: script[] (含 role/text/audio_url/duration_ms) + chapters[] + total_duration_ms
- 真实凭证从 `~/.voice-portfolio-secrets/` 截图注入, 配置文件零明文

## TDD 流程

### 红 (RED)

写以下测试, 全部失败:
- `server/__tests__/test_podcast.py` — 22 个测试
  - parse_script 纯函数 (主持人分流 / 未知容错 / 缺失字段 / 空输入)
  - validate_request 校验 (空 / 超长 / 非法 style / 非法 duration / 默认通过)
  - STYLES 4 种 / DURATIONS 3 种
  - generate_podcast 编排 (HTTPS mock / 旧控制台双 header / Prometheus metrics)
  - /api/podcast/styles endpoint
  - /api/podcast/generate endpoint (空 400 / 凭证 503 / 同步 200 / 异步 202 / 上游 502)
  - /api/podcast/task/<id> 轮询 (进度 200 / 未知 404)
- `client/src/__tests__/podcastGeneration.test.ts` — 10 个测试 (状态机 + 轮询 + 重试 + 错误)
- `client/src/__tests__/podcastPlayer.test.tsx` — 10 个测试 (渲染 / 播放 / 倍速 / 章节跳转 / 快进快退)

### 绿 (GREEN)

实现以下模块, 全部测试转绿:

#### 后端
- `server/podcast.py` (新建, ~440 行)
  - STYLES / DURATIONS 枚举
  - PodcastConfig / HostTurn / PodcastChapter / PodcastResult 数据类
  - parse_script / validate_request / build_request_payload 纯函数
  - call_podcast_api / poll_podcast_task (mockable, 默认 NotImplementedError)
  - generate_podcast 顶层编排 (同步 / 异步分流, 上游错误 → PodcastUpstreamError)
  - _PodcastMetrics Prometheus 聚合 (generate_total / latency / errors / poll)
  - 结构化日志: `[Podcast] generate { meeting_chars, style, duration, task_id, latency_ms }`
  - register_podcast_routes 挂载 /api/podcast/* (Blueprint)
- `server/config.py` 增加 4 个 env: VOLC_PODCAST_APP_ID / TOKEN / API_KEY / RESOURCE_ID / ENDPOINT
- `server/app.py` boot_app() 中追加 `register_podcast_routes(app)` 一行

#### 前端
- `client/src/hooks/usePodcastGeneration.ts` (新建, ~240 行)
  - 状态机: idle → submitting → success | error | running(progress)
  - 支持 200 同步 + 202 异步 + 轮询
  - cancel / retry / reset
  - 错误分类: retryable (5xx) vs non-retryable (4xx 配置类)
  - 卸载自动清理轮询
- `client/src/components/PodcastGenerator.tsx` (新建, ~165 行)
  - 转写文本区 (从 props 传入, 也可手动编辑)
  - 风格 grid (tech/business/entertainment/academic)
  - 长度 chip (short/medium/long)
  - 是否含原声片段 checkbox
  - 进度条 + 错误重试 + 主按钮
- `client/src/components/PodcastPlayer.tsx` (新建, ~245 行)
  - 大封面 (220px gradient, 双主持人头像占位)
  - 标题 + 总时长 + 章节数
  - 对话气泡 (host_a 蓝 / host_b 粉, 头像 + 文本 + 时长)
  - 章节列表 (点击跳转, 同步 active turn)
  - 底部控制 (后退 15s / 播放 / 前进 15s / 倍速 0.75-2x)
  - 真实 `<audio>` 元素 (currentTurn.audio_url)
  - 键盘: Space 播暂 / ← → ±15s

#### CSS (Apple Podcasts / Spotify 风格)
- styles.css 末尾追加 ~270 行 `.podcast-*` 样式
- design tokens: `--podcast-host-a #1E88E5` / `--podcast-host-b #E91E63`
- 大封面渐变, 气泡圆角 18px, 头像 36px 圆形, 章节列表 280px 抽屉
- 响应式: < 720px 单列堆叠
- prefers-reduced-motion 关闭进度动画
- 暗色主题自动切换 (#60A5FA / #F472B6)

#### AppLayout 接入 (零侵入)
- `client/src/AppLayout.tsx`: 在 `<main>` 末尾追加 `<PodcastGenerator>` + 成功条件 `<PodcastPlayer>`
- 未改动 transcriptionReducer / 现有组件
- 未在 App.tsx 增加业务逻辑

## 可观测性

- 结构化日志: `[Podcast] generate { meeting_chars, style, duration, resource_id, task_id, latency_ms, script_turns, chapter_count, total_duration_ms, is_async }`
- Prometheus 指标:
  - `podcast_generate_total{style, duration}`
  - `podcast_generate_latency_seconds` (Histogram, buckets 1-120s)
  - `podcast_generate_errors_total{error_type}`
  - `podcast_poll_total`
- OTel span 待接入 (与 `docs/2026-06-27-frontend-otel-design.md` 对齐)

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 新建 | `server/podcast.py` |
| 新建 | `server/__tests__/test_podcast.py` |
| 修改 | `server/config.py` (+4 env: VOLC_PODCAST_*) |
| 修改 | `server/app.py` (boot_app 末尾注册路由) |
| 新建 | `client/src/hooks/usePodcastGeneration.ts` |
| 新建 | `client/src/components/PodcastGenerator.tsx` |
| 新建 | `client/src/components/PodcastPlayer.tsx` |
| 新建 | `client/src/__tests__/podcastGeneration.test.ts` |
| 新建 | `client/src/__tests__/podcastPlayer.test.tsx` |
| 修改 | `client/src/AppLayout.tsx` (追加挂载点) |
| 修改 | `client/src/styles.css` (+~270 行 .podcast-*) |
| 新建 | `docs/2026-06-27-podcast-llm-tech-proposal.md` |

## 测试

- 后端: `cd vosk-realtime-asr/server && python3 -m pytest __tests__/test_podcast.py` → **22 passed**
- 前端: `cd vosk-realtime-asr/client && npx vitest run src/__tests__/podcastGeneration.test.ts src/__tests__/podcastPlayer.test.tsx` → **20 passed**
- 布局回归: `npx vitest run src/__tests__/layout.test.ts` → **7 passed** (零侵入验证)

## 范围约束

- 未改动 `transcriptionReducer` / `useTranscription` / 现有 ASR 组件
- 未写明文 API Key / Token
- 未 git commit / push
- 未使用 emoji (UI 文案 + 日志均无)

## 后续工作

- [ ] 接入真实 HTTPS 调用 (call_podcast_api / poll_podcast_task 默认 NotImplementedError, 留待真实凭证注入后启用)
- [ ] OTel span 接入 (`podcast.generate` / `podcast.poll` / `podcast.play`)
- [ ] 任务持久化 (当前 _task_store 是 in-memory, 生产应替换为 Redis)
- [ ] 流式 TTS (audio_url 分段请求 → 边生成边播放)
- [ ] 多语言支持 (当前仅 zh)
- [ ] 主持人音色选择 (音色克隆 + 多音色轮换)