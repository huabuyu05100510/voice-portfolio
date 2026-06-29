"""
VolcengineSession 握手参数透传测试

之前 bug: build_full_request_payload 支持 enable_nonstream / end_window_size /
force_to_speech_time 参数, 但 VolcengineSession._handshake_and_send_config
根本没传 → definite 边界没真正生效 → 多说话人合并.

本测试用 mock 验证握手时生成的 payload 包含这三个参数 + result_type=full.
"""
import os
import sys
from unittest.mock import MagicMock, patch

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


def _make_session():
    from volcengine_session import VolcengineSession
    cfg = {
        "endpoint": "wss://example/test",
        "app_key": "k",
        "access_token": "t",
        "resource_id": "r",
        "model_name": "bigmodel",
    }
    return VolcengineSession(
        sid="test-sid-1234567890ab",
        config=cfg,
        on_partial=lambda *a, **k: None,
        on_final=lambda *a, **k: None,
        on_error=lambda *a, **k: None,
    )


def test_handshake_payload_includes_vad_and_twopass_params():
    """握手 payload 必须含 enable_nonstream / end_window_size / force_to_speech_time.

    这些参数让 volcengine 服务端:
    - enable_nonstream: 二遍识别, definite 边界更干净
    - end_window_size: 静音 N ms 后强制切句 (说话人切换检测的关键)
    - force_to_speech_time: 强制作为语音的最大静音时长

    没这些, 多说话人快速交替时会被并进同一 utterance.
    """
    sess = _make_session()

    captured = {}

    def fake_encode(payload):
        captured['payload'] = payload
        return b"\x11\x00\x00\x00" + b"\x00\x00\x00\x00" + b"fake"

    mock_ws = MagicMock()
    mock_ws.send_binary = MagicMock()

    with patch('volcengine_session.create_connection', return_value=mock_ws):
        with patch('volcengine_session.encode_full_client_request', side_effect=fake_encode):
            sess._handshake_and_send_config()

    assert 'payload' in captured, "encode_full_client_request 必须被调用"
    req = captured['payload']['request']

    # 核心: 三个 VAD/二遍识别参数必须真的传到 wire 上
    assert req.get('enable_nonstream') is True, (
        "enable_nonstream=True 必须传 — 让 definite 边界更干净"
    )
    assert 'end_window_size' in req, (
        "end_window_size 必须显式传 (默认 800 太保守, 多说话人合并的根因)"
    )
    assert req['end_window_size'] <= 600, (
        f"end_window_size 必须 ≤600ms 让说话人切换及时切句, 实际 {req.get('end_window_size')}"
    )
    assert 'force_to_speech_time' in req, (
        "force_to_speech_time 必须显式传"
    )
    # full 协议必须保持
    assert req.get('result_type') == 'full'
    # 自动检测任意说话人数
    assert req.get('diarization_speaker_count') == -1


def test_handshake_payload_enable_nonstream_true_by_default():
    """默认就要开二遍识别 — 不依赖调用方记得传."""
    sess = _make_session()
    captured = {}

    def fake_encode(payload):
        captured['payload'] = payload
        return b"\x11\x00\x00\x00" + b"\x00\x00\x00\x00" + b"fake"

    mock_ws = MagicMock()
    with patch('volcengine_session.create_connection', return_value=mock_ws):
        with patch('volcengine_session.encode_full_client_request', side_effect=fake_encode):
            sess._handshake_and_send_config()

    req = captured['payload']['request']
    assert req.get('enable_nonstream') is True
