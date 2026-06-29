# 长独白卡片内分行 — 改动记录

**模型:** glm-5.2
**日期:** 2026-06-25
**性质:** 纯客户端显示层改动 (卡片身份不变, 仅渲染分行)
**测试:** client 224/224 全绿 (新增 9 tests), tsc 改动文件零报错

---

## 背景

utterance 驱动合并 (definite + start_time) 修复后, 卡片分段正确:
每一轮发言 = 一张卡 (start_time 身份). 但实测截图显示, 一张卡内可能
是一段 30+ 秒的连贯独白 — 单行显示阅读体验差, 用户反馈 **"这一段没有分开"**.

**关键边界:** 卡片分段已正确 (一轮发言一卡), 不能为了"分行"去拆卡 — 那会破坏
start_time 身份合并. 要的是**同一张卡内按句末标点分行渲染**.

---

## 改动

**新增 `client/src/utils/splitSentences.ts`:**
- `splitSentences(text)` 按句末标点 `[。！？… . ! ?]` 切分文本
- 标点保留在句尾; 连续标点不产生空句; 无标点短句返回单元素数组
- 纯函数, 无副作用, 易测

**`client/src/components/TranscriptHero.tsx`:**
- `<p className="transcript-item-text">` 内调用 `splitSentences(r.text)`
- 单元素 → 渲染原样 (`<span>{text}</span>`, 视觉零变化)
- 多元素 → 每句独占一行 (`display:block` + 句间 margin)
- 卡片身份 (start_time / speaker / TranscriptionResult) 完全不变

**`client/src/styles.css`:**
- 新增 `.transcript-sentence + .transcript-sentence { margin-top: var(--space-2) }`
- 句间留呼吸空间, 不破坏卡片整体感

---

## TDD

`client/src/__tests__/splitSentences.test.ts` (9 tests, 新建):
- 空字符串 / 短文本 / 中文句号 / 全角感叹号问号 / 半角标点
- 省略号切分 / 连续标点不产生空句
- 真实长独白样例 → 3 行
- 拼接还原验证 (无丢失/无重复)

**Red→Green 记录:** 第一版正则 `[^。！？!?…]+` 没排除 ASCII `.` `!` `?`,
导致 `"Hello. World! Right?"` 切不出半角句号. 修复: 把半角标点同时加入
"切分字符类"和"非切分字符类的排除集".

---

## 验证

- `npx vitest run` — **224 passed** (含 9 新测试)
- `npx tsc --noEmit` — splitSentences / TranscriptHero 改动文件零报错
- E2E utterance 管道测试 (`e2eUtterancePipeline.test.ts`) 仍 4/4 绿 —
  证明卡片分段 (start_time 身份) 完全未受影响, 仅渲染层变化

---

## 设计原则

> **卡片 = 一轮发言 (utterance, start_time 身份); 行 = 一个句子 (句末标点).**
> 卡片由服务端协议 (definite) 决定, 行由客户端标点决定.
> 两层正交, 互不污染.
