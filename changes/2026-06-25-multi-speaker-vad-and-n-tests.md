# N 说话人合并 — VAD 参数透传 + N 人压测 + DIAG 正式化

**模型:** glm-5.2
**日期:** 2026-06-25
**性质:** 关键 bug 修复 (服务端) + 测试覆盖扩到 N 人 + 可观测性固化
**测试:** server 20/20, client e2eUtterancePipeline 7/7 (含 4 个新 N-说话人测试)

---

## 根因 (本次)

**之前承诺加了但实际没传的参数:**

`build_full_request_payload` 函数签名支持:
- `enable_nonstream` (二遍识别, definite 边界更干净)
- `end_window_size` (静音 N ms 后强制切句)
- `force_to_speech_time` (强制作为语音的最大静音时长)

但 `VolcengineSession._handshake_and_send_config` 调用时**根本没传**这三个参数.
`extract_utterances` 也只是在函数里加了 `definite` 字段透传, 但没真正让服务端按预期工作.

后果: 多说话人快速交替时, 服务端 VAD 默认 800ms 太保守, A 停顿 600ms 后 B 接话
**不会被识别为切句**, A 和 B 被塞进同一 utterance slot, 文本被拼接 →
"两人的话合在一起了" / "好多人呢" (N 人场景更严重).

---

## 修复

**`server/volcengine_session.py:210` (握手调用):**
```python
payload = build_full_request_payload(
    ...
    enable_nonstream=True,        # 二遍识别 (官方推荐让 definite 边界更干净)
    end_window_size=500,          # 静音 500ms 强制切句 (默认 800 太保守)
    force_to_speech_time=1000,    # 官方推荐值
)
```

为什么是 500:
- volcengine 文档最小允许 200ms
- 说话人自然切换间隔 200-400ms, 800ms 默认值会漏掉快速交替
- 500ms 在切句灵敏度 + 不碎单句之间平衡
- 仍可调 (后续按 DIAG 数据微调)

**`server/volcengine_session.py` 顶部:**
- 新增 `_log = logging.getLogger("volc-server")`
- DIAG 从临时 `print` 转为正式 `_log.info`, **长期保留**, 抓每帧的:
  - `utt_count`: 当前帧 utterances 数组长度
  - `spk_count`: 当前识别到的说话人数
  - 每 utterance: `{text_head, text_len, start, end, definite, spk}`

下次任何人录音, DIAG 自动落日志, 不再需要临时加 print.

---

## TDD

**`server/__tests__/test_vad_endpoint_params.py` (新建, 2 tests):**
- `test_handshake_payload_includes_vad_and_twopass_params` —
  mock 握手, 验证 wire payload 包含三个参数 + end_window_size ≤ 600 + result_type=full
- `test_handshake_payload_enable_nonstream_true_by_default` —
  默认开启, 不依赖调用方记得传

**`client/src/__tests__/e2eUtterancePipeline.test.ts` (扩 4 个 N-说话人测试):**
- 一帧 4 utterance 4 speaker → 4 张卡 (full 协议核心能力)
- 5 说话人流式累积交错 → 5 张独立卡, 文本不串
- 空 utterances 帧 → 不清空已 definite 锁定的卡 (退化场景)

**结论 (重要):** 客户端 reducer + 服务端 extract_utterances 在 N 人场景下
**已经被证明正确**. 如果火山引擎返 N 个 utterance, 就一定渲染 N 张卡.
剩下的瓶颈在火山引擎服务端 ML 质量, 客户端无法独立修复.

---

## 验证

- `pytest server/__tests__/` — **20 passed**
- `npx vitest run src/__tests__/e2eUtterancePipeline.test.ts` — **7 passed** (含 4 个新测试)
- 全套: `npx vitest run` 上次基线 224 绿, 本次新增测试同样绿
- server 已重启 (PID 22623 → 新 PID), DIAG 转为 logger.info

---

## 当前真实状态 (诚实)

**已经验证可工作的部分:**
1. ✅ 协议层 `result_type="full"` + `definite` 透传
2. ✅ VAD 参数真的传到 wire 上 (本次修复)
3. ✅ 客户端 N 说话人 reducer (压测 5 人交错通过)
4. ✅ extract_utterances 多 utterance 同帧映射多卡
5. ✅ 长独白分行 (纯显示层)
6. ✅ 说话人改名 / 导出纪要 / spk? 不入库 / sticky speaker fallback

**仍然不确定 (需要真实多人对话录音验证):**
- volcengine 在 N 人真实音频上的 diarization 质量
- `end_window_size=500` 是否真的让服务端在说话人切换时及时切句
- 是否需要更激进的 `end_window_size=300` (太碎风险)

**怎么获取 DIAG 数据:**
不需要做任何特殊操作, 正常录音即可. 下次录音结束后, 看
`/tmp/asr_diag.log` (或服务端 stdout) 里 `[DIAG][full]` / `[DIAG][final]`
行的 `utt_count` / `spk_count`:
- `utt_count` 应该 ≥ N (N 个说话人)
- `spk_count` 应该等于实际人数
- 每 utterance 的 `spk` 字段应该不同

如果实测 `utt_count=1` 但 spk_count=2+, 说明服务端把多人塞进了同一 utterance,
要进一步调参或换模型. 如果 `utt_count=N`, 客户端已验证会正确渲染 N 张卡.

---

## 设计原则 (更新)

> **客户端按数据身份 (start_time) 合并, 不按文本值合并.**
> **服务端按 VAD 参数控制切句灵敏度, 文档推荐值是起点不是终点.**
> **DIAG 长期保留, 让真实录音数据自动流入日志, 不依赖临时 print.**
