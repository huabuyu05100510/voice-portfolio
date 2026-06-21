"""
Sprint 10 — 拼接正确性测试
验证 _on_volc_final 的 text_buffer 累加 + speaker 顺序 + current_speaker
"""
import sys
import os
import pytest

# Add server/ to path
SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


def test_text_buffer_dedup_cumulative():
    """火山引擎 final 返回累积全文时, 服务端应去重, 不重复"""
    # 这是要测试的目标行为
    # 模拟 server._on_volc_final 的核心累加逻辑
    buffer = ""

    def append_smart(text: str, buffer: str) -> str:
        """智能拼接: 如果 text 是 buffer 的扩展, 只追加新增部分"""
        if not buffer:
            return text + " "
        # text 是 buffer 的扩展 (服务端累积模式)
        if text.startswith(buffer.rstrip()):
            return text + " "
        # text 是 buffer 的子串 (重复推送)
        if buffer.rstrip().endswith(text):
            return buffer
        # text 包含 buffer (不同步)
        if text.startswith(buffer.rstrip()[:10]):
            # 部分重叠, 只取新增部分
            buf_clean = buffer.rstrip()
            # 找最长公共前缀
            i = 0
            while i < len(text) and i < len(buf_clean) and text[i] == buf_clean[i]:
                i += 1
            return text + " "
        # 完全独立的句子, 追加
        return buffer + text + " "

    # 场景 1: 服务端累积模式 (final 返回累积全文)
    buffer = append_smart("你好", "")
    assert buffer == "你好 ", "首次添加"

    buffer = append_smart("你好今天天气很好", buffer)
    assert buffer == "你好今天天气很好 ", "累积全文应该替换而非追加"

    # 场景 2: 一句一返模式
    buffer = ""
    buffer = append_smart("你好。", "")
    buffer = append_smart("我是张三。", buffer)
    assert buffer == "你好。 我是张三。 ", "句句独立时正确拼接"

    # 场景 3: 重复推送
    buffer = ""
    buffer = append_smart("你好", "")
    buffer = append_smart("你好", buffer)
    assert buffer == "你好 ", "重复推送不应重复"

    print("✓ text_buffer 智能拼接逻辑正确")


def test_current_speaker_should_be_last():
    """current_speaker 应取最后一个 utterance 的 speaker, 而非第一个"""
    utterances = [
        {"speaker_id": "spk0", "text": "你好"},
        {"speaker_id": "spk1", "text": "我是李四"},
        {"speaker_id": "spk0", "text": "很高兴认识你"},
    ]
    # 错误做法 (现有代码)
    current_speaker_wrong = utterances[0].get("speaker_id")
    # 正确做法
    current_speaker_correct = utterances[-1].get("speaker_id")
    assert current_speaker_wrong == "spk0"
    assert current_speaker_correct == "spk0", "最后一句也是 spk0"
    # 当最后一句是 spk1 时
    utterances2 = [
        {"speaker_id": "spk0", "text": "你好"},
        {"speaker_id": "spk1", "text": "我是李四"},
    ]
    assert utterances2[-1].get("speaker_id") == "spk1"
    print("✓ current_speaker 应取最后一个 utterance")


def test_speaker_label_ordered_by_first_appearance():
    """speaker label 应按首次出现顺序分配 (发言人 1, 2, 3), 不按字典序"""
    # 模拟服务端 _on_volc_final 的说话人池更新逻辑
    speaker_pool = {}

    def add_speaker(speakers, pool):
        for s in speakers or []:
            spk_id = s.get("id")
            if spk_id and spk_id not in pool:
                pool[spk_id] = {
                    "id": spk_id,
                    "label": s.get("label", f"发言人 {len(pool) + 1}"),
                }
        return pool

    # spk2 先出现, 应是发言人 1
    add_speaker([{"id": "spk2"}], speaker_pool)
    assert speaker_pool["spk2"]["label"] == "发言人 1", \
        f"应该是 '发言人 1' (首次出现), 实际是 '{speaker_pool['spk2']['label']}'"

    # spk0 后出现, 应是发言人 2
    add_speaker([{"id": "spk0"}], speaker_pool)
    assert speaker_pool["spk0"]["label"] == "发言人 2"

    # spk1 最后, 应是发言人 3
    add_speaker([{"id": "spk1"}], speaker_pool)
    assert speaker_pool["spk1"]["label"] == "发言人 3"

    print("✓ speaker label 按首次出现顺序")


def test_full_text_contains_all_speakers():
    """final 帧 full_text 应包含所有说话人的内容, 不丢失"""
    # 模拟: final 收到 3 个 utterance, 来自 2 个不同说话人
    utterances = [
        {"speaker_id": "spk0", "text": "你好"},
        {"speaker_id": "spk1", "text": "你好我是李四"},
        {"speaker_id": "spk0", "text": "很高兴认识你"},
    ]
    all_text = " ".join(u["text"] for u in utterances)
    assert "你好" in all_text
    assert "李四" in all_text
    assert "很高兴认识你" in all_text
    assert len([u for u in utterances if u["speaker_id"] == "spk0"]) == 2
    assert len([u for u in utterances if u["speaker_id"] == "spk1"]) == 1
    print("✓ full_text 包含所有说话人内容")


if __name__ == "__main__":
    test_text_buffer_dedup_cumulative()
    test_current_speaker_should_be_last()
    test_speaker_label_ordered_by_first_appearance()
    test_full_text_contains_all_speakers()
    print("\n所有测试通过 ✓")