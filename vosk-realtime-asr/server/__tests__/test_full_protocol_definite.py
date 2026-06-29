"""
火山引擎 v3 sauc full 协议契约测试 (definite 字段)

背景: 火山引擎每帧重写标点 + 数字↔中文数字 ("24,000"↔"2万四千"),
任何文本前缀匹配都会失败. 官方文档方案: 用 utterances[] + definite 标志.

本测试锁定:
1. build_full_request_payload 默认 result_type 必须是 "full" (不是 "single")
2. extract_utterances 必须保留每个 utterance 的 definite 字段
3. 支持 enable_nonstream / end_window_size / force_to_speech_time 参数
"""
import os
import sys

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

from volcengine_engine import (  # noqa: E402
    build_full_request_payload,
    extract_utterances,
)


def test_default_result_type_is_full():
    """full 协议每帧返回全部 utterances[]; single 只返当前一句.
    会议室多角色场景必须 full, 否则无法用 start_time 做稳定身份.
    """
    payload = build_full_request_payload(
        app_key="test-app-key",
        access_token="test-token",
    )
    req = payload["request"]
    assert req.get("result_type") == "full", (
        "result_type 必须 'full' — 火山引擎 v3 sauc full 协议每帧返全部 "
        "utterances[] (带 definite + 稳定 start_time), 客户端据此分段. "
        "'single' 模式只返当前一句, 数字↔中文数字重写会让所有文本合并失败."
    )


def test_extract_utterances_preserves_definite():
    """extract_utterances 必须透传 definite 字段给客户端 reducer."""
    fake_payload = {
        "utterances": [
            {
                "text": "你好",
                "start_time": 1000,
                "end_time": 1500,
                "definite": True,
                "additions": {"speaker_id": "0"},
            },
            {
                "text": "我是",
                "start_time": 1600,
                "end_time": 2000,
                "definite": False,
                "additions": {"speaker_id": "1"},
            },
        ]
    }
    utterances, speakers = extract_utterances(fake_payload)
    assert len(utterances) == 2
    assert utterances[0]["definite"] is True, "definite=True 必须透传"
    assert utterances[1]["definite"] is False, "definite=False 必须透传"
    assert utterances[0]["start_time"] == 1000
    assert utterances[0]["speaker_id"] == "0"


def test_supports_two_pass_and_vad_params():
    """enable_nonstream (二遍识别) + end_window_size + force_to_speech_time
    让 definite 边界更干净. 参数必须能透传到 request.
    """
    payload = build_full_request_payload(
        app_key="test-app-key",
        access_token="test-token",
        enable_nonstream=True,
        end_window_size=800,
        force_to_speech_time=1000,
    )
    req = payload["request"]
    assert req.get("enable_nonstream") is True
    assert req.get("end_window_size") == 800
    assert req.get("force_to_speech_time") == 1000
