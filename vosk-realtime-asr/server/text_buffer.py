"""
Sprint 10 — text_buffer 智能拼接
处理火山引擎 final 返回的两种模式:
1. 累积模式: result.text 包含整个会话的所有内容, 每次 final 都返回更长的全文
2. 一句一返模式: result.text 只有最新一句

不管哪种模式, 我们的 full_text 都应保持单调递增且去重。
"""
from __future__ import annotations
from typing import Tuple


def smart_append(buffer: str, new_text: str) -> Tuple[str, bool]:
    """
    智能拼接 buffer 与 new_text.

    Returns:
        (new_buffer, changed): 新的 buffer + 是否真的有变化

    算法:
    1. 空 buffer: 直接初始化
    2. new_text 是 buffer 的扩展 (累积模式): 替换
    3. new_text 是 buffer 末尾的子串 (重复推送): 跳过
    4. new_text 包含 buffer: 计算新增部分
    5. 完全独立: 追加 + 加分隔符
    """
    if not new_text:
        return buffer, False

    if not buffer:
        return new_text + " ", True

    buf_stripped = buffer.rstrip()

    # 累积模式: new_text 是 buffer 的扩展 (new_text 比 buffer 长, 且 buffer 是 new_text 前缀)
    if len(new_text) > len(buf_stripped) and new_text.startswith(buf_stripped):
        return new_text + " ", True

    # 重复推送: new_text 完全是 buffer 的子串 (任意位置)
    if new_text in buf_stripped:
        return buffer, False

    # 部分重叠: new_text 以 buffer 的某个后缀开头 (滚动的累积)
    if len(new_text) > 0 and len(buf_stripped) > 0:
        # 找最长公共前缀
        common = 0
        max_check = min(len(new_text), len(buf_stripped))
        while common < max_check and new_text[common] == buf_stripped[common]:
            common += 1
        # 如果公共前缀 > 10 字符, 说明是累积模式
        if common >= 10:
            return new_text + " ", True
        # 否则, 找 buffer 末尾是否在 new_text 中
        # 取 buffer 最后 N 字符在 new_text 中查找
        tail = buf_stripped[-30:]
        if tail and tail in new_text:
            return new_text + " ", True

    # 完全独立, 追加
    sep = "" if (not buf_stripped or buf_stripped[-1] in "。？！\n") else " "
    return buffer + sep + new_text + " ", True


def get_last_speaker(utterances: list) -> str | None:
    """从 utterances 列表取最后一个说话人 (当前正在说话的人)"""
    if not utterances:
        return None
    for u in reversed(utterances):
        sid = u.get("speaker_id") or (u.get("additions") or {}).get("speaker_id")
        if sid:
            return sid
    return None


def extract_text_from_utterances(utterances: list) -> str:
    """
    从 utterances[] 拼接全文, 用空格分隔
    比火山引擎 result.text 更可靠 (result.text 在多说话人场景可能合并)
    """
    parts = []
    for u in utterances or []:
        t = (u.get("text") or "").strip()
        if t:
            parts.append(t)
    return " ".join(parts)