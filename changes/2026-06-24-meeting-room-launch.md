# 会议室录音可用 — 改动记录

**模型:** glm-5.2
**日期:** 2026-06-24
**性质:** 全栈可靠性修复 + 会议室核心功能 (说话人重命名 / 导出纪要)
**测试:** 客户端 203/203, 服务端 11/11, tsc (本次改动) 零报错

---

## 改动概览

| 类别 | 文件数 | 说明 |
|------|--------|------|
| 服务端 | 2 | spk? 不入库 + partial sticky speaker |
| 客户端 reducer/state | 3 | RENAME_SPEAKER action + userEdited sticky |
| 客户端 UI | 6 | SpeakerCard inline 改名, Sidebar 导出菜单, AppLayout 清理 |
| 客户端 util | 1 | formatMinutes / downloadText (新建) |
| 测试 | 6 个新文件 | 28 个新测试 |
| 删除 | 2 | ControlPanel.tsx, ObservabilityPanel.tsx |

---

## 修复明细

### 服务端

**`server/volcengine_engine.py`** — `extract_utterances`:
- fallback 从 `"spk?"` 改为 `None` (不再污染 speaker_pool)
- speaker 入池时增加 `if sid` 守卫

**`server/app.py`**:
- `create_session`: 新增 `last_known_speaker_id: None` 字段
- `_on_volc_final`: `current_speaker_id` 解析到时同步更新 `last_known_speaker_id` (sticky)
- `_on_volc_partial`: speaker_id fallback 链 `current_speaker_id → last_known_speaker_id`
- `_on_volc_final` log: 新增 `is_unknown_speaker` 字段

### 客户端

**`client/src/App.tsx`**:
- 音频门控 (HOT FIX): 放行 `recording | transcribing` 状态, 防止 F7 后音频中断
- F7 grace window: `recording_stopped` 后启动 1500ms 窗口, 期间继续接收 final, 然后才 completed
- `graceTimerRef` / `forceStopTimerRef` useRef + 卸载 cleanup
- `startRecording` catch 加 `recorder.stop()` 回收麦克风
- 新增 `dismissedError` state + `onDismissError` 接线

**`client/src/state/transcriptionReducer.ts`**:
- 新增 `RENAME_SPEAKER` action
- speaker 合并时仅在 `!prev.userEdited` 时接受服务端 label (sticky)
- `RENAME_SPEAKER` 设 `userEdited: true`, 空名/不存在 id no-op

**`client/src/types.ts`**:
- `Speaker` 新增 `userEdited?: boolean`

**`client/src/hooks/useTranscription.ts`**:
- 新增 `renameSpeaker(speakerId, label)` API

**`client/src/components/SpeakerCard.tsx`**:
- 删除本地 PALETTE, 改用 `getSpeakerColor(id)`
- inline rename: 双击触发 `<input>`, Enter 提交 / Esc 取消 / blur 自动提交
- `data-user-edited` 可视化标记 + hover 显示 ✎ hint

**`client/src/components/SpeakerList.tsx`**: 透传 `onRenameSpeaker`

**`client/src/components/Sidebar.tsx`**:
- 透传 `onRenameSpeaker`
- 新增「导出纪要」按钮 + 弹出菜单 (TXT / Markdown)
- 录音中禁用导出 (避免数据不完整)

**`client/src/components/CaptionBar.tsx`** / **`TranscriptHero.tsx`**:
- 删除本地 PALETTE, 改用 `getSpeakerColor(id)`, 支持任意人数

**`client/src/AppLayout.tsx`**:
- 移除已弃用的 `<Subtitle>` render
- 新增 `onDismissError` / `resultsForExport` / `onRenameSpeaker` props
- Error banner 加可关闭按钮 + aria-label
- `areAppLayoutPropsEqual` 同步新 props

**`client/src/utils/exportMinutes.ts`** (新建):
- `formatMinutes(results, speakers, { format: 'txt' | 'md' })` 纯函数
- 按说话人分段合并连续句, 带时间戳, 用 `userEdited` 后的 label
- `downloadText(filename, content, mime)` 浏览器下载
- `defaultFilename(format)` 时间戳文件名 `会议纪要_YYYYMMDD_HHMM.{txt|md}`

**`client/src/DebugPanel.tsx`**: 删除 unused `lastTs`

**`client/src/styles.css`**:
- `.speaker-name-input` / `.speaker-name-edit-hint`
- `.export-group` / `.export-menu` / `.export-menu-item` / `.action-btn-primary`
- `.error-banner-close` 替代原 `.error-banner button`

### 删除

- `client/src/ControlPanel.tsx` — 零引用死代码
- `client/src/ObservabilityPanel.tsx` — 零引用死代码

---

## 测试新增

```
server/__tests__/test_speaker_extraction.py        4 tests
server/__tests__/test_partial_speaker_fallback.py  3 tests
client/src/__tests__/f7StopGraceWindow.test.ts     4 tests
client/src/__tests__/speakerColor.test.ts          5 tests
client/src/__tests__/speakerRename.test.ts         4 tests
client/src/__tests__/exportMinutes.test.ts         8 tests
                                                  ------
                                                  28 new tests
```

全套:
```
client: Test Files 22 passed | Tests 203 passed
server: 11 passed
```

---

## 追加修复 (2026-06-24) — 同一角色不分句

**根因:** F2 fix 曾错误假设火山引擎 v3 sauc 是 "single 模式" (每帧 only 最新一句),
把 `server/app.py:229` 的 `is_cumulative` 硬编码为 `False`。实测日志证明协议是**累积模式**
— 同一轮发言内 text 单调增长 (3→8→...→74), 轮次切换才重置。

`is_cumulative=False` 让 reducer 跳过前缀合并 (path A), 把每一帧都当新句追加 →
"一句话分成好几句 一个人分成好几段 一个角色在一个角色后面追加"。

**修复:**
- `server/app.py:229` — `is_cumulative = True`, 注释更新为累积协议说明
- 新增 `server/__tests__/test_cumulative_protocol.py` (2 tests) —
  锁定 payload.is_cumulative=True + speaker_id 解析

**验证:** `pytest server/__tests__/` 13 passed, `npx vitest run` 203 passed.

---

## 二次追加修复 (2026-06-24 21:20) — 标点漂移 + 全屏"未知说话人"

实测截图显示累积合并仍未生效, 4 帧拆成 4 张卡, 且全是"未知说话人"。

**根因 1 — 标点漂移破坏前缀匹配:** 火山引擎每帧重新加标点,
`"ABC."` → `"ABCDEF."` (句号没了) → `"ABCDEF 我的首选永远是 d"` → `"ABCDEF，我的首选永远是 d 座..."` (逗号又出现).
reducer path A 用严格 `startsWith`, 每帧都因标点不同而失败 → 仍当新句追加.

**根因 2 — final 累积中间帧无 speaker_id:** 火山引擎在 utterance_count=1 的累积中间帧不返
`utterance.additions.speaker_id`, 只有边界帧才有. `_on_volc_final` 把 payload.speaker_id 直接设为
解析结果 (None), partial 帧的 sticky fallback 没应用到 final → UI 全是"未知说话人".

**修复 1 — reducer 标点归一化 (`client/src/state/transcriptionReducer.ts`):**
- 新增 `normalizeForCompare(s)` 用 `\p{P}\p{S}\s` 移除标点/符号/空白, 仅比较字母数字 CJK
- path A / B / C / C2 全部改用归一化后的 `normNew` / `normLast` 做前缀/子串比较
- 显示仍用原文 (保留句号/逗号等可读性)

**修复 2 — server final speaker sticky (`server/app.py`):**
- 新增 `resolved_speaker = current_speaker or session.get('last_known_speaker_id')`
- payload.speaker_id / log metadata.speaker_id / is_unknown_speaker 全部改用 `resolved_speaker`

**TDD:**
- `client/src/__tests__/transcriptionReducer.test.ts` 新增 4 tests (标点漂移容错 + 真独立句仍追加)
- `server/__tests__/test_cumulative_protocol.py::test_final_speaker_fallback_to_last_known` 新增
- `server/__tests__/test_partial_speaker_fallback.py::test_final_speaker_fallback_to_last_known_when_missing` 新增

**验证:** `pytest server/__tests__/` 15 passed · `npx vitest run` 207 passed · server 已重启 (13:27)

---

## 三次追加修复 (2026-06-24 23:30) — 官方文档方案: utterance 驱动合并

前两次追加修复后实测仍失败. 截图显示火山引擎每帧**重写文本**: "王楚然 24,000" →
"王楚然 2万四千" → "24,000千块". 数字 ↔ 中文数字互转 + 标点漂移, **任何文本前缀
匹配 (path A/B/C/C2) 在数学上都不可能命中**. 用户明确指示 "你要不看看文档这么解决".

查阅火山引擎 v3 sauc 官方文档 ([1354869](https://www.volcengine.com/docs/1354869)) 后,
定位到正确架构:

- `result_type="full"` (官方默认, 但本项目硬编码成了 `"single"`) — 每帧返回**全部**
  `utterances[]` 数组, 不是单句
- 每个 utterance 带 **`definite: bool`** 字段 — 官方句子边界信号, `true` = 该句已锁定
- utterance 在数组里有**稳定 `start_time`** 身份, 跨帧不变
- `enable_nonstream` (二遍识别) + `end_window_size` + `force_to_speech_time` 让 `definite`
  边界更干净

**根因**: 客户端把"顶层 `text` 的前缀匹配"当作合并真相, 但 `text` 每帧被火山引擎重写.
正确做法是把 `utterances[]` (带 `start_time` + `definite`) 当作分段真相, 完全放弃
文本比较.

### 修复

**服务端 `server/volcengine_engine.py`:**
- `build_full_request_payload`: `result_type` 默认 `"single"` → **`"full"`** (核心改动)
- 新增参数 `enable_nonstream` / `end_window_size` / `force_to_speech_time` 透传到 request
- `extract_utterances`: 透传 `definite` 字段到每个 utterance (之前被丢弃)

**服务端 `server/app.py`:**
- 无改动 (`_on_volc_final` 已 emit `utterances`, 现在带 `definite` 自然流转到客户端)

**客户端 `client/src/types.ts`:**
- `Utterance` 新增 `definite?: boolean`
- `TranscriptionResult` 新增 `start_time?` / `end_time?` / `definite?`

**客户端 `client/src/state/transcriptionReducer.ts`:**
- `TRANSCRIPT_FINAL` 新增**优先路径**: 当 `result.utterances` 任一带 `definite` 字段时,
  切换到 utterance 驱动模式:
  1. 现有卡片按 `start_time` 索引; 本帧未覆盖的旧卡 (尤其 definite 锁定的) 保留在前
  2. 本帧每个 utterance 按 `start_time` 就地更新或新增
  3. `definite:true` 的旧卡**锁定**, 后续帧文本变化不再覆盖
  4. `transcriptionChars` 改为当前全部卡片总字数 (不再增量累加被重写文本污染)
- 老路径 (A/B/C/C2 文本前缀匹配) 保留为 fallback, 供不带 definite 的旧帧使用

### TDD

- `server/__tests__/test_full_protocol_definite.py` (3 tests, 新建):
  - `test_default_result_type_is_full` — 锁定 result_type="full"
  - `test_extract_utterances_preserves_definite` — 锁定 definite 透传
  - `test_supports_two_pass_and_vad_params` — 锁定二遍识别参数透传
- `client/src/__tests__/transcriptionReducer.test.ts` 新增 describe block
  "utterance 驱动合并 (definite)" (4 tests):
  - 同 start_time 即使数字↔中文数字重写也只更新不新增
  - definite:true 锁定后后续帧不覆盖
  - full 协议多 utterance 映射多卡, 按 start_time 稳定
  - 不同 start_time 视为不同句, 不做文本合并

### 验证

- `pytest server/__tests__/` — **18 passed** (含 3 新测试)
- `npx vitest run` — **211 passed** (含 4 新测试)
- `npx tsc --noEmit` — 改动文件零报错 (预存 node:fs/__dirname 测试文件报错与本次无关)
- server 已重启 (port 5000)

### 设计原则 (供后续)

> **分段真相 = `utterances[]` 的 `start_time` 身份 + `definite` 标志, 永远不是文本比较.**
> 火山引擎会重写标点 / 数字 / 中英文混排, 任何 `startsWith` / `includes` 都会被破坏.
> reducer 按数据身份 (identity) 合并, 不按值 (value) 合并.

---

## 未完成 / 后续

- 端到端人工验证 (录音 5min, 多人对话, 停止 grace, 改名, 导出) — 待用户实测
- 时间轴 / 字幕编辑 / 音频回放 (会后)
- 发布会同传 presenter mode (会后)
- Zustand store 重构 (A1 22-prop drilling) — 单独 PR
- 公司级 SDK 封装 — 用户决定优先级
