# 模块 A — 卡拉OK 逐字高亮字幕 技术方案

**模型:** MiniMax-M3 (Claude Code · Opus 4.6 同级)
**日期:** 2026-06-27
**作者:** MiniMax-M3
**关联重构方案:** [refactor-plan-frontend-expert.md](./2026-06-27-refactor-plan-frontend-expert.md)

---

## 1. 目标

`CaptionBar`（底部 sticky 浮动字幕）实时显示当前句子的**逐字高亮**：
- **过去词**：半透（`opacity: 0.45`）
- **当前词**：speaker 色 + glow 阴影
- **未来词**：基础色（不显眼）
- **进度条**：沿当前词底部从左到右滑动

复用现有 word-level timing 数据，**零服务端改动**。

---

## 2. 调研结论（直接复用，不重新造轮子）

### 2.1 数据通道已通

服务端 → 客户端的 words 字段链路：

```
volcengine_engine.py:480   # utterances[].words[] 提取
  ↓
volcengine_session.py:294  # on_final() 透传
  ↓
app.py:279                 # SocketIO emit 'transcription_result'
  ↓
WebSocketClient.ts:110     # 解析 utterances[]
  ↓
transcriptionReducer.ts:242-243  # 写入 state.words
  ↓
CaptionBar.tsx             # ← 本方案消费点
```

### 2.2 纯函数工具已实现（已带单测）

`src/subtitleKaraoke.ts` 暴露三个纯函数：
- `findActiveWordIndex(words, currentTime)` — 二分查找当前激活词
- `computeWordProgress(word, currentTime)` — 算 0..1 进度
- `chunkWordsIntoLines(words, maxPerLine)` — 长句分行

`src/__tests__/subtitleKaraoke.test.ts` 已有完整单元测试覆盖。

### 2.3 rAF 平滑种子已写

`src/Subtitle.tsx:50-77` 的 `tick()` + `useRef` + `requestAnimationFrame` 实现了 60fps 平滑更新。直接迁移到 `CaptionBar` 即可。

### 2.4 现状

- ✅ 数据通道：完整
- ✅ 类型契约：`WordInfo { word, start, end, confidence, speaker_id? }`
- ✅ 纯函数工具：已有 + 单测
- ⚠️ rAF 平滑：仅在旧 Subtitle，旧组件**未集成**
- ❌ 词级 CSS：完全缺失
- ❌ 性能观测：partial 频率 / render 耗时 无埋点

---

## 3. 改造范围（最小集）

### 3.1 文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `src/components/CaptionBar.tsx` | 修改 | 引入 rAF tick + `findActiveWordIndex`；words 拆成 `<span class="transcript-word">`；当前词 `.is-active` 进度条 |
| `src/styles.css` | 修改 | 新增 `.transcript-word` / `.transcript-word.is-active` / `.is-past` 基础类；引入 `--word-glow` / `--word-past-opacity` token |
| `src/KeyboardShortcuts.tsx` | 修改 | 注册 `K` 键开关卡拉OK 高亮 |
| `src/PerfMonitor.tsx` | 修改 | 新增 `partialHz`（partial 接收频率，滑动窗口）+ `captionRenderMs`（React Profiler） |
| `src/hooks/useTranscription.ts` | 修改 | partial 路径加 16ms 节流（与 rAF 对齐） |
| `src/state/transcriptionReducer.ts` | **不改** | 纯函数，span 在 dispatch 调用点注入 |
| `src/types.ts` | **不改** | WordInfo 已定义 |

### 3.2 新增测试

- `__tests__/CaptionBar.karaoke.test.tsx` — 组件级 DOM 断言
- `__tests__/useThrottledPartial.test.ts` — 节流 hook 单测
- `__tests__/e2eKaraokeCaption.test.tsx` — MSW mock WS + DOM 截图

### 3.3 性能预算

- CaptionBar render：≤ **4ms / 帧**（60fps 下预算 16.67ms）
- partial 接收频率：≤ **10 Hz**（服务端 ~200-300ms / 帧）
- 长句 100 词的二分查找：≤ **0.05ms**

---

## 4. TDD 拆分（红 → 绿 → 回归）

### 4.1 Step 1: 失败测试（红）

#### `__tests__/CaptionBar.karaoke.test.tsx`

```tsx
import { render, act } from '@testing-library/react';
import { CaptionBar } from '../components/CaptionBar';

describe('CaptionBar karaoke highlighting', () => {
  it('renders words as span sequence', () => {
    const words = [
      { word: 'hello', start: 0, end: 0.5, confidence: 1 },
      { word: 'world', start: 0.5, end: 1.0, confidence: 1 },
    ];
    const { container } = render(
      <CaptionBar words={words} finalStartTime={0} speakerColor="#f00" />
    );
    const spans = container.querySelectorAll('.transcript-word');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('hello');
  });

  it('marks active word at currentTime', () => {
    const words = [
      { word: 'hello', start: 0, end: 1, confidence: 1 },
      { word: 'world', start: 1, end: 2, confidence: 1 },
    ];
    const { container } = render(
      <CaptionBar words={words} finalStartTime={0} speakerColor="#f00" />
    );
    act(() => {
      // rAF 推进 → currentTime = 0.5
    });
    const active = container.querySelector('.transcript-word.is-active');
    expect(active?.textContent).toBe('hello');
  });

  it('respects K toggle', () => {
    // 按 K → DOM 移除 is-active class
  });
});
```

#### `__tests__/useThrottledPartial.test.ts`

```ts
import { renderHook, act } from '@testing-library/react';
import { useThrottledPartial } from '../hooks/useThrottledPartial';

describe('useThrottledPartial', () => {
  it('throttles partial dispatches to 16ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useThrottledPartial());
    act(() => result.current('text-1'));
    act(() => result.current('text-2'));
    act(() => result.current('text-3'));
    vi.advanceTimersByTime(20);
    // 只有最后一次 text-3 被调用
  });
});
```

### 4.2 Step 2: 实施（绿）

#### CaptionBar.tsx 关键代码

```tsx
import { useEffect, useRef, useState, memo } from 'react';
import { findActiveWordIndex, computeWordProgress } from '../subtitleKaraoke';
import type { WordInfo } from '../types';

interface CaptionBarProps {
  text: string;
  words?: WordInfo[];
  finalStartTime?: number;
  speakerColor?: string;
  karaokeEnabled?: boolean;
}

const CaptionBarInner = ({
  text, words, finalStartTime, speakerColor = '#fff', karaokeEnabled = true,
}: CaptionBarProps) => {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!karaokeEnabled || !words?.length || finalStartTime == null) return;
    const tick = () => {
      const currentTime = (performance.now() - finalStartTime) / 1000;
      const idx = findActiveWordIndex(words, currentTime);
      setActiveIdx(idx);
      if (idx >= 0 && words[idx]) {
        setProgress(computeWordProgress(words[idx], currentTime));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [words, finalStartTime, karaokeEnabled]);

  if (!words?.length || !karaokeEnabled) {
    return <span className="caption-text">{text}</span>;
  }

  return (
    <span className="caption-text karaoke">
      {words.map((w, i) => {
        const cls = i === activeIdx ? 'transcript-word is-active'
                  : i < activeIdx ? 'transcript-word is-past'
                  : 'transcript-word';
        return (
          <span
            key={`${i}-${w.word}`}
            className={cls}
            style={{
              color: i === activeIdx ? speakerColor
                   : i < activeIdx ? 'rgba(255,255,255,0.45)'
                   : 'rgba(255,255,255,0.85)',
              textShadow: i === activeIdx ? `0 0 12px ${speakerColor}cc` : undefined,
              transition: 'color 80ms linear',
              position: 'relative',
              display: 'inline-block',
              marginRight: 1,
            }}
          >
            {w.word}
            {i === activeIdx && (
              <span
                className="word-progress"
                style={{
                  position: 'absolute',
                  left: 0, bottom: -2,
                  width: `${progress * 100}%`,
                  height: 2,
                  background: speakerColor,
                  transition: 'width 80ms linear',
                }}
              />
            )}
          </span>
        );
      })}
    </span>
  );
};

export const CaptionBar = memo(CaptionBarInner);
```

#### styles.css 新增（追加在 2082 行后）

```css
.transcript-word {
  position: relative;
  display: inline-block;
  margin-right: 1px;
}

.transcript-word.is-past {
  color: var(--word-past-color, rgba(255, 255, 255, 0.45));
}

.transcript-word.is-active {
  color: var(--word-active-color, currentColor);
  text-shadow: var(--word-glow, 0 0 12px currentColor);
}

.word-progress {
  position: absolute;
  left: 0; bottom: -2px;
  height: 2px;
  background: var(--word-active-color, currentColor);
  border-radius: 1px;
}
```

### 4.3 Step 3: 回归

```bash
npm test -- --run                  # 全部 22+ 个 vitest 文件
npm test -- CaptionBar.karaoke     # 新增
npm test -- e2eKaraokeCaption      # 新增
```

---

## 5. 关键风险与对策

| 风险 | 对策 |
|------|------|
| **Partial 阶段无 words**（服务端 partial 不带词级） | 卡拉OK 仅在 final 段生效；partial 阶段降级为普通文本流（`if (!words?.length) return text;`） |
| **多说话人合并后 words 时间戳不连续** | 二分查找 `findActiveWordIndex` 仍正确；进度条跳变可接受；UI 上加"组合段"标识 |
| **`finalStartTime = performance.now()` 与服务端延迟未对齐** | 短期接受跳变；后续模块 B 完成后做端到端延迟补偿（用服务端返回的 `latency_ms`） |
| **长句 rAF 60fps × 万字渲染掉帧** | `chunkWordsIntoLines` 限行（每行 6 词）；每行 `React.memo` + 词 span 复用 stable key |
| **rAF 循环内存泄漏** | useEffect cleanup `cancelAnimationFrame` |

---

## 6. 验证（端到端）

### 6.1 自动化

```bash
cd vosk-realtime-asr/client
npm test -- CaptionBar.karaoke --run
npm test -- useThrottledPartial --run
npm test -- e2eKaraokeCaption --run
```

### 6.2 手动

```bash
npm run dev
# 浏览器开 http://localhost:5173
# 点录制 → 说话 5s → 看到 CaptionBar 逐字高亮
# 按 K → 关闭高亮 → 文本变静态
```

### 6.3 验收标准

- [ ] `__tests__/CaptionBar.karaoke.test.tsx` 3 个测试全绿
- [ ] `__tests__/useThrottledPartial.test.ts` 测试绿
- [ ] `__tests__/e2eKaraokeCaption.test.tsx` 绿 + 截图归档
- [ ] 现有 22 个 vitest 文件无回归
- [ ] 手动验证：录制 5s 看到逐字高亮 + K 键切换生效
- [ ] PerfMonitor 显示 `partialHz` 和 `captionRenderMs`

---

## 7. 后续可扩展（不在本轮范围）

- 长句点击"回听"（定位音频时间轴）
- 卡拉OK 字号 3 档（大/中/小）
- 字幕位置（上/中/下）用户可调（WCAG CLP）

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 初版卡拉OK 字幕技术方案 |