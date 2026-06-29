# 前端专家能力放大重构方案（总纲）

**模型:** MiniMax-M3 (Claude Code · Opus 4.6 同级)
**日期:** 2026-06-27
**作者:** MiniMax-M3
**关联 plan:** `/Users/didi/.claude/plans/cozy-whistling-lamport.md`

---

## 0. 目标定位

把 voice-portfolio 从"全栈能跑通"提升为 **"前端能力行业天花板"**，服务用户作为 10 年前端专家的面试展示。

### 当前评估（6.5 / 10）
- ✅ 全栈骨架完整（Flask + SocketIO / React 18 + Vite + TS）
- ✅ 火山引擎 v3 协议 + 多说话人 VAD + 同说话人合并
- ✅ 完整 TDD（22 个 vitest 文件 + 4 个 pytest 文件）
- ✅ 自研 AudioWorklet + 自研 Canvas 2D 可视化
- ⚠️ word-level timing 数据**没人消费**（旧 Subtitle 写完未集成）
- ⚠️ 可观测性**半成品**（无 trace、无结构化日志、无 error 捕获）
- ⚠️ 音频工程纵深不足（AudioContext 状态机未监听、采样率无兜底）

### 目标评估（9.0 / 10）
补齐上述 3 个缺口后，达成"前端能力天花板"。

---

## 1. 三大模块

| # | 模块 | 杀手锏标签 | 工作量 | 优先级 | 关联 doc |
|---|------|-----------|--------|--------|----------|
| A | **卡拉OK 逐字高亮字幕** | "产品+工程"双爆点 | 3d | P0 | [karaoke-caption-design.md](./2026-06-27-karaoke-caption-design.md) |
| B | **前端 OpenTelemetry 全链路 trace** | "可观测性"行业天花板 | 5d | P0 | [frontend-otel-design.md](./2026-06-27-frontend-otel-design.md) |
| C | **AudioWorklet + 录音性能加固** | "基础功底"分层清晰 | 4d | P1 | [audio-worklet-hardening.md](./2026-06-27-audio-worklet-hardening.md) |

**总工作量 ≈ 12 人天**（单人 3 周）。

---

## 2. 执行顺序（依赖关系）

```
C (Audio 独立) ──┐
                 ├──→ B (OTel 跨进程) ──→ A (Karaoke 消费延迟补偿)
A (Karaoke 自含)┘
```

**推荐顺序**:
1. **C 先**（独立 + 为 B 提供 audio.* metric 埋点）
2. **B 接着**（打通 trace 全链路，A 可借机做延迟补偿）
3. **A 最后**（最终展示亮点）

> 紧急出 demo 可 A → B → C 并行；A 数据通道自包含，不依赖 B。

---

## 3. 工作流约定（项目硬性要求）

每个模块严格按以下节奏：

```
1. 写失败测试（红）       — TDD 强约束
2. 跑测试 → 确认红
3. 写最小实现（绿）       — 仅做必要改动，避免过度工程化
4. 跑测试 → 确认绿
5. 重构（不破坏绿）      — DRY / 性能 / 可读性
6. 跑全量回归             — 现有 22 个 vitest + 4 个 pytest 必须绿
7. UI 视觉回归            — 截图对比（如涉及 UI）
8. 落盘文档               — docs/<模块>.md（首行声明模型）+ changes/<模块>.md
9. commit（用户授权后）
```

每个模块结束前必须产出：
- ✅ 全部测试绿（含新增）
- ✅ 新增 e2e 通过
- ✅ Trace 在 Jaeger 中可视化（仅 B）
- ✅ Demo 截图归档
- ✅ docs/ + changes/ 文件落盘

---

## 4. 面试演示剧本（5 分钟）

详细 step-by-step 见 `docs/2026-06-27-demo-script.md`，核心 5 步：

1. **打开双窗口**：`localhost:5173`（前端）+ `localhost:16686`（Jaeger）并排
2. **点录制说话 5s** → 触发完整链路
3. **切 Jaeger** → 展示 `user.click → ws.send_audio → server → volcengine → transcription_result → reducer → render` 完整 trace
4. **切 Karaoke 字幕** → 演示逐字高亮 + 进度条
5. **切 Sidebar profile toggle** → 讲解 NS/AEC/AGC 决策权衡

---

## 5. 风险与回退

| 风险 | 回退方案 |
|------|---------|
| OTel bundle size 爆炸 | 动态 import + TraceToggle 默认关闭 |
| 服务端 traceparent 改造破坏现有 session | 新增 trace_id 字段，旧字段兼容 |
| Karaoke 渲染掉帧 | rAF 节流 + `useTransition` + 长句分行 |
| AudioWorklet 软重采样 CPU 高 | 仅在 native 协商失败时启用 |

---

## 6. 后续 Roadmap（不在本轮范围）

- React Forget 编译器适配（reducer 已纯函数化）
- Yjs/CRDT 多人协作标注
- OPFS 本地缓存 + 离线回放
- LLM 流式摘要（30s 滚动摘要窗口）
- PWA + 移动端手势

---

## 7. 验收清单（per 模块）

每个模块完成后对照：

```markdown
## 模块 X 验收
- [ ] 所有测试绿（含新增）
  - vitest: _______ passed / _______ failed
  - pytest: _______ passed / _______ failed
- [ ] e2e 通过
- [ ] Trace 在 Jaeger 中可视化
- [ ] Demo 截图 / 视频归档到 _______
- [ ] docs/ 技术方案首行声明模型
- [ ] changes/ 改动记录含完整改动列表
- [ ] commit 信息符合项目规范
```

---

## 8. 详细方案

- **A. 卡拉OK 逐字高亮字幕** → [karaoke-caption-design.md](./2026-06-27-karaoke-caption-design.md)
- **B. 前端 OpenTelemetry 全链路 trace** → [frontend-otel-design.md](./2026-06-27-frontend-otel-design.md)
- **C. AudioWorklet + 录音性能加固** → [audio-worklet-hardening.md](./2026-06-27-audio-worklet-hardening.md)

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 初版重构总纲 |