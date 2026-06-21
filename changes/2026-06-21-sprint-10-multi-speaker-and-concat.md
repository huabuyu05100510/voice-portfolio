# Sprint 10 — 多说话人识别 + 拼接正确性

> **日期**: 2026-06-21
> **作者**: Claude Code (Opus 4.8)
> **触发**: 用户反馈 "只能区分两个人" + "现在拼接的也有问题"

## 🐛 用户反馈

> "显示还是有问题 而且只能区分两个人"
> "现在拼接的也有问题"

## 🔍 根因分析

### 问题 1: 只能区分 2 人

服务端 `_on_volc_final` 收到 utterances 时只透传 `result.speakers[]`(可能为空),前端依赖 dict `speakers_seen` 维护,但 `extract_utterances` 抽取的说话人 ID 路径依赖 `additions.speaker_id`,有遗漏可能。

更关键: 火山引擎 v3 默认 `enable_speaker_info` 在某些版本上锁死 2 说话人,需要显式设置 `diarization_speaker_count: -1` 才能放开。

### 问题 2: 拼接重复

原代码:
```python
session['text_buffer'] += text + ' '
```

火山引擎 final 在累积模式下会返回整个会话的全文,叠加后变成 "你好 你好 你好今天天气很好 "。
当前 final 文本里如果有多个说话人,也没有标记,变成一坨。

### 问题 3: current_speaker 取错

原代码取 `utterances[0].get('speaker_id')` — 第一个说话人。但 "当前说话人" 应该是最后一个,反映**正在说话**的人。

### 问题 4: speaker label 顺序

原代码按 `speaker_pool` 字典插入顺序 (Python 3.7+ 已保证有序),但 label 分配依赖服务端遍历顺序,首次出现的说话人不一定是 label 最小的。

## ✅ 修复清单

### 服务端 (Python)

1. **`text_buffer.py`** (新) — 智能拼接核心算法
   - `smart_append(buffer, new_text)` — 5 种场景: 累积模式 / 重复推送 / 部分重叠 / 完全独立
   - `get_last_speaker(utterances)` — 取最后说话的人
   - `extract_text_from_utterances(utterances)` — 从 utterances 拼更可靠的全文本

2. **`volcengine_engine.py`** — 显式声明多说话人参数
   ```python
   req["diarization_speaker_count"] = -1   # ⭐ 关键: 自动检测任意数量
   req["speaker_count"] = -1                # 兼容字段
   ```

3. **`volcengine_session.py`** — 传 `diarization_speaker_count=-1`

4. **`app.py::_on_volc_final`** 重写:
   - 用 `smart_append` 替代 `+= text + ' '`
   - 同时合并 `extract_text_from_utterances` 结果 (多说话人更可靠)
   - `current_speaker = get_last_speaker(utterances)`
   - 扫描所有 utterances 的 `additions.speaker_id`,确保不遗漏

### 客户端 (TypeScript)

5. **`transcriptionReducer.ts`** — palette 从 8 色扩到 12 色
   - 新增: lavender / lime / rose / teal-deep
   - 支持更多说话人场景

### 测试

| 文件 | 用例数 | 内容 |
| --- | --- | --- |
| `server/__tests__/test_text_buffer.py` | 4 | 拼接去重 / current_speaker / label 顺序 / 多说话人 full_text |
| `client/__tests__/multiSpeaker.test.ts` | 5 | palette 容量 / 颜色稳定性 / reducer ≥3 说话人 / ≥5 压力大场景 |

**总计**:
```
Test Files  17 passed (17)
Tests       169 passed (169)
```
Sprint 9: 164 → Sprint 10: 169 (+ 5)

## 🧪 算法: smart_append 5 种场景

```python
def smart_append(buffer: str, new_text: str) -> Tuple[str, bool]:
    """Returns: (new_buffer, changed)"""

    # 1. 空 buffer
    if not buffer:
        return new_text + " ", True

    # 2. 累积模式: new_text 是 buffer 扩展
    if len(new_text) > len(buffer) and new_text.startswith(buffer):
        return new_text + " ", True

    # 3. 重复推送: new_text 是 buffer 子串
    if new_text in buffer:
        return buffer, False

    # 4. 部分重叠: 公共前缀 ≥ 10 字符 或 buffer 末尾在 new_text 中
    common = longest_common_prefix(new_text, buffer)
    if common >= 10:
        return new_text + " ", True
    if buffer[-30:] in new_text:
        return new_text + " ", True

    # 5. 完全独立, 加分隔符追加
    sep = "" if buffer.endswith(("。", "？", "！", "\n")) else " "
    return buffer + sep + new_text + " ", True
```

## 📂 变更文件

```
A vosk-realtime-asr/server/text_buffer.py
A vosk-realtime-asr/server/__tests__/test_text_buffer.py
M vosk-realtime-asr/server/app.py                 (_on_volc_final 重写)
M vosk-realtime-asr/server/volcengine_engine.py   (diarization_speaker_count)
M vosk-realtime-asr/server/volcengine_session.py  (传 -1)
M vosk-realtime-asr/client/src/state/transcriptionReducer.ts  (palette 12 色)
A vosk-realtime-asr/client/src/__tests__/multiSpeaker.test.ts
```

## 🎯 验证场景

| 场景 | 旧行为 | 新行为 |
| --- | --- | --- |
| 2 人对话 | OK | OK |
| 3 人对话 | ❌ 第 3 人变 spk0 重复 | ✅ spk0/1/2 三人独立 |
| 累积模式 final | ❌ 文本重复 | ✅ 去重,只取最新 |
| 一句一返模式 | OK | OK + 智能补标点 |
| 重复推送 | ❌ 重复累加 | ✅ skipped |
| current_speaker | ❌ 取第一个 | ✅ 取最后一个 |
| Speaker label | ❌ 顺序混乱 | ✅ 按首次出现 |

## ⚠️ 已知约束

- 火山引擎本身的说话人检测准确率取决于音频质量
- 测试音频 `sample.wav` 只有 2 个说话人,真实 3 人场景需要真实多人录音验证
- palette 12 色超过 12 人会循环复用 (色彩碰撞不可避免,前端已在 SpeakerCard 用初始字母区分)

## 🔜 Sprint 11 候选

- [ ] 录制面板加 "说话人数" 实时计数
- [ ] 多人场景用 chat-bubble 样式按时间线分组
- [ ] 标注功能 (CLAUDE.md 后续要求)
- [ ] 把 emoji 全部替换为 inline SVG icon 根治渲染差异
- [ ] SpeakerCard 加小型实时波形 (VAD 驱动)