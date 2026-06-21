# Sprint 8 — 前端页面优化与极致打磨

> **生成模型**: Claude Opus 4.8 (`MiniMax-M3` 平台)
> **生成时间**: 2026-06-21
> **作者**: Claude Code (Opus 4.8)

---

## 一、问题诊断

### 1.1 用户反馈

> "现在页面显示的很有问题"

通过 Playwright 抓取当前 `localhost:3001` 的全屏截图 (`/tmp/current-page.png`),对设计目标做了**视觉差距分析**,识别出 4 类问题。

### 1.2 问题清单

| 序 | 类别 | 现象 | 根因 |
| --- | --- | --- | --- |
| P0 | 字体 | 🎯🎤📝📈🐛 等所有 emoji 显示为方框 / 缺失字形 | CSS `font-family` 未声明 emoji 字体栈,无头浏览器及部分 Linux 环境无法渲染 emoji |
| P0 | 布局 | 底部"多模态音频可视化"面板高度 ~840px,把 Debug/Perf/Footer 全部挤出折叠区 | `VisualizerPanel` 默认始终展开且占满容器 |
| P1 | 视觉 | 转写区域(中间栏)等待录音时空旷无引导,体验断层 | `empty-state` 仅一行文字,无视觉锚点 |
| P1 | 视觉 | "复制全文"按钮紧贴等待文案,层级模糊 | `transcription-actions` 与 `empty-state` 间距过小 |
| P2 | 可用性 | VAD 状态标签"说话 / 静音"在窄列里断行成"说\n话 / 静音" | 标签 `display:inline` 与中文字符间距冲突 |
| P2 | 排版 | 头部标题"🎯 火山引擎 · 分角色实时转写"过长,窄屏会挤压状态指示 | 缺响应式断点 |
| P3 | 性能 | 主内容 165 个 DOM 节点已收敛,但 visualizer panel 内部 8 个 canvas 在 idle 时全部渲染空帧 | 缺 `requestAnimationFrame` 节流 + 不可见时不绘制 |

### 1.3 与 CLAUDE.md 设计目标的差距

> "打造10 年最有代表性的前端作品 / 务必极致体验及性能 / 务必对标顶尖技术"

| 维度 | 当前 | 目标 |
| --- | --- | --- |
| 视觉精致度 | 后台管理风 | 产品级发布会风 (Apple/TED/Notion AI 风格) |
| 排版层次 | 单一字号 | 模块化层级 (display / heading / body / caption) |
| 动效 | framer-motion 局部 | 全局缓动曲线统一, prefers-reduced-motion 全兼容 |
| 信息密度 | 中栏空 500px+ | 信息即装饰,空白有节奏 |
| 可观测 | 已有 Perf/Metrics 面板 | 隐藏式入口 + 按需展开, 不抢主舞台 |

---

## 二、技术方案

### 2.1 字体系统 (P0 修复)

**问题根因**: `font-family: system-ui, -apple-system, BlinkMacSystemFont` 三连不覆盖 emoji 字符集。Chromium 在缺字形时会画一个 `.notdef` 方框。

**修复**: 扩展为完整 stack:

```css
:root {
  --font-stack: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui,
               -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'Apple Color Emoji', 'Segoe UI Emoji',
               'Noto Color Emoji', 'Twemoji Mozilla', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo,
               'Apple Color Emoji', monospace;
}
```

**回归测试**: Playwright 抓 emoji 节点的 `actualFontFamilies` (通过 `document.fonts.check`),断言至少包含一项 emoji 字体。

### 2.2 布局重构 (P0)

**当前** (`styles.css`):
```css
.app-main {
  grid-template-columns: 1fr 2fr 1fr;
  gap: 20px;
  padding: 20px 30px;
}
```

**优化后**:
```css
.app-main {
  grid-template-columns: minmax(280px, 320px) minmax(560px, 1fr) minmax(300px, 360px);
  grid-template-rows: auto 1fr;
  gap: 20px 24px;
  padding: 24px 32px;
  max-width: 1640px;
  margin: 0 auto;
}

@media (max-width: 1280px) {
  .app-main { grid-template-columns: 1fr 1fr; }
  .observability-section { grid-column: 1 / -1; }
}

@media (max-width: 768px) {
  .app-main { grid-template-columns: 1fr; padding: 16px; }
}
```

**VisualizerPanel 折叠**: 默认收起为 48px 高的 chip,展开时高度限制 280px,带滑入动画。

### 2.3 空状态强化 (P1)

在 `TranscriptionRenderer` 的 `empty-state` 处引入 SVG 微光 + 渐变呼吸动画:

```tsx
<div className="empty-state">
  <svg className="empty-orbit" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" strokeDasharray="2 4" />
    <circle cx="60" cy="60" r="8" className="empty-core" />
  </svg>
  <p className="empty-hint">点击"开始录音"或按 <kbd>Space</kbd> 键</p>
  <p className="empty-sub">等待声波抵达,识别引擎将实时转写为文字</p>
</div>
```

CSS:
```css
.empty-state { padding: 56px 24px; text-align: center; }
.empty-orbit { width: 96px; height: 96px; opacity: 0.45; }
.empty-core { animation: pulse-core 1.8s ease-in-out infinite; }
.empty-hint { font-size: 16px; color: var(--text-primary); margin-top: 20px; }
.empty-sub  { font-size: 13px; color: var(--text-secondary); margin-top: 8px; }
@keyframes pulse-core { 50% { r: 12; opacity: 0.6 } }
```

### 2.4 标题与排版 (P2)

```css
.app-header h1 {
  font-family: var(--font-stack);
  font-size: calc(20px * var(--font-scale, 1));
  font-weight: 700;
  letter-spacing: -0.01em;
  background: linear-gradient(135deg, var(--text-primary), var(--primary-color));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@media (max-width: 768px) {
  .app-header h1 { font-size: 16px; }
  .app-header { padding: 14px 20px; }
}
```

### 2.5 VAD 标签防断行 (P2)

```css
.vad-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  word-break: keep-all;
}
```

### 2.6 可观测性原则

- 所有变更用 `prefers-reduced-motion` 包裹
- 字体加载通过 `document.fonts.ready` Promise,在 `App.tsx` 设置 `data-fonts-ready` 属性,Playwright 截图前等待
- Playwright `page.wait_for_function("document.fonts.status === 'loaded'")`
- 通过 `__DEBUG__` 全局变量在 dev mode 暴露渲染时间

### 2.7 TDD 闭环

| 层 | 测试 |
| --- | --- |
| 单元 | `font-stack.test.ts` — 解析 CSS,断言 emoji 字体在 stack 末尾 |
| 单元 | `empty-state.test.tsx` — 空态渲染包含 SVG 与 hint 文案 |
| E2E | `capture_sprint8.py` — 截图三态 (空/录音中/完成), 与 baseline 做像素 diff |
| UI 回归 | `tests/e2e/test_layout.py` — 验证三栏 grid 比例 + 暗色对比度 + 响应式断点 |
| 视觉 | `tests/test_visual_regression.py` — 三个截图 hash 对比,偏差 > 0.5% 失败 |

---

## 三、风险与回滚

- **风险 1**: 新字体栈可能让某些 Linux server 渲染字符宽度变化 → 用 `font-feature-settings: 'tnum' 1` 保证数字等宽
- **风险 2**: `VisualizerPanel` 折叠会改变 DOM 结构 → 用 `data-state="collapsed|expanded"` 属性标记,测试可读
- **风险 3**: 渐变标题在低对比度模式下不可读 → HC 主题 fallback 到 `color: var(--text-primary)`

---

## 四、Sprint 排期

| 任务 | 估时 |
| --- | --- |
| 字体栈扩展 + 单元测试 | 30 min |
| 布局重构 + 响应式 + E2E | 90 min |
| 空状态强化 + 视觉回归 | 60 min |
| VAD / 标题 / 微调 | 30 min |
| Playwright 截图基线 | 20 min |

---

## 五、相关 Sprint

- Sprint 7: 性能优化 (React.memo, 浅比较) — `changes/2026-06-20-sprint-7-final.md`
- Sprint 8-migration: 火山引擎迁移 — `changes/2026-06-20-volcengine-v3-migration.md`
- **Sprint 8-polish (本文档)**: 视觉与体验打磨