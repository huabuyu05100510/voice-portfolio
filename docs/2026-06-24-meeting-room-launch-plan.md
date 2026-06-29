# 会议室录音可用 — 实施方案

**模型:** glm-5.2
**日期:** 2026-06-24
**目标:** 会议室场景可用 — 长时间稳定录制 + 多人清晰区分 + 会后导出纪要

---

## Context (背景)

继 2026-06-24 上线前 review 发现的 F1-F7 bug 后, 实测仍「几乎不可用」, 进一步定位:

1. **音频流中断 (回归)**: F7 把 final 后的 status 改成 `transcribing`, F1 把 audio 门控收紧到只认 `recording`, 撞车导致第一句之后音频全丢。`App.tsx` 已 hotfix 放行 `recording | transcribing`。
2. **`spk?` 污染说话人池**: volcengine_engine fallback 字符串 `"spk?"` 被当真实 speaker 入库, UI 出现「未知说话人 spk?」。
3. **partial 颜色乱跳**: partial 帧无 speaker_id, final 间 current_speaker_id 可能被 None 覆盖。
4. **F7 停止后丢字**: 服务端 `recording_stopped` 在 `finalize()` 后立即 emit, 客户端一收就 completed, 最后一句 final 可能在 completed 后才到。
5. **会议室场景缺核心能力**: 无法重命名说话人 (把"发言人 1"改"主持人"), 无法导出会议纪要。

---

## 改动清单 (P0 → P1)

### P0 可靠性

| ID | 改动 | 文件 |
|----|------|------|
| HOT | 音频门控放行 `transcribing` 状态 | `client/src/App.tsx` |
| P0-2 | `extract_utterances` fallback `None` (不再 `"spk?"`); speaker_pool 跳过 None | `server/volcengine_engine.py` |
| P0-3 | `session['last_known_speaker_id']` sticky; partial fallback 用它 | `server/app.py` |
| P0-4 | F7 grace window: `recording_stopped` 后等 1500ms 接收最后一句 final 才 completed; 3s 兜底保留; timer useRef + cleanup | `client/src/App.tsx` |

### P1 工程基础

| ID | 改动 | 文件 |
|----|------|------|
| P1-7 | 三处本地 PALETTE (CaptionBar/TranscriptHero/SpeakerCard) 统一到 `getSpeakerColor(id)` (12 色 hash, 支持任意人数) | 同左 |
| P1-8 | Error banner 加 `onDismissError`, App 维护 dismissedError | `AppLayout.tsx` / `App.tsx` |
| P1-9 | 删除 ControlPanel/ObservabilityPanel/Subtitle render; DebugPanel lastTs unused 清理 | 删 2 文件 + AppLayout |
| P1-10 | startRecording catch 加 `recorder.stop()` 回收麦克风 | `App.tsx` |
| P1-11 | DebugPanel `lastTs` 删除 | `DebugPanel.tsx` |

### 会议室场景

| ID | 改动 | 文件 |
|----|------|------|
| M-1 | `RENAME_SPEAKER` action; sticky label (`userEdited` 标记, 服务端推送同 id 不能覆盖); SpeakerCard 双击 inline 改名; SpeakerList/Sidebar/AppLayout/App 接线 | `types.ts` / `transcriptionReducer.ts` / `useTranscription.ts` / `SpeakerCard.tsx` / `SpeakerList.tsx` / `Sidebar.tsx` / `AppLayout.tsx` / `App.tsx` |
| M-2 | `formatMinutes` 纯函数 — TXT/MD 双格式, 按说话人分段合并连续句, 带时间戳; `downloadText` 触发浏览器下载; Sidebar 加导出菜单按钮 | `utils/exportMinutes.ts` / `Sidebar.tsx` |
| M-3 | TranscriptHero 升会议室主视图 (历史流 + 说话人色), 移除已弃用的 Subtitle render | `AppLayout.tsx` |

---

## TDD 测试覆盖

新增测试文件 (全部 Green):
- `server/__tests__/test_speaker_extraction.py` (4 tests) — spk? 不入库
- `server/__tests__/test_partial_speaker_fallback.py` (3 tests) — sticky speaker
- `client/src/__tests__/f7StopGraceWindow.test.ts` (4 tests) — 1.5s grace 行为
- `client/src/__tests__/speakerColor.test.ts` (5 tests) — 任意人数稳定着色
- `client/src/__tests__/speakerRename.test.ts` (4 tests) — rename + sticky
- `client/src/__tests__/exportMinutes.test.ts` (8 tests) — TXT/MD 导出

```
client: 203 passed (22 files)
server: 11 passed
```

---

## 可观测性 (CLAUDE.md 强制)

- Server `_on_volc_final` log metadata 增加 `is_unknown_speaker` 字段
- Client `dbg.push` 事件覆盖 SUBTITLE_MODE / SPEAKER_RESOLVE 关键路径
- SpeakerCard `data-user-edited` 属性可视化用户改过的说话人

---

## 验证 (Definition of Done)

- [x] `npx vitest run` 全绿 (203 tests)
- [x] `pytest server/__tests__/` 全绿 (11 tests)
- [x] `npx tsc --noEmit` 我的改动零报错 (剩 4 个预存 test-file node:fs 报错, 非本次引入)
- [ ] 端到端: 连续录音 5min 不中断, 延迟 < 2s
- [ ] 端到端: 多人对话 speaker 切换正确, 无 spk? 残留
- [ ] 端到端: 停止录音后 1.5s 内最后一句出现
- [ ] 端到端: 双击 SpeakerCard 改名, 后续句仍用新名
- [ ] 端到端: 点击"导出纪要"→ TXT/MD 文件下载, 内容含说话人分段

---

## 不做 (后续 Sprint)

- 时间轴 / 字幕可编辑 / 音频回放同步
- 发布会同传 UX (presenter mode, 大字幕)
- Zustand 全局 store 重构 (A1)
- 公司级 SDK 封装 / 多引擎适配层
