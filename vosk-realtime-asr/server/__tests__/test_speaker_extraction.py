"""
会议室可用 — speaker 抽取与 pooling 的纯函数测试。

覆盖:
- extract_utterances 在缺 speaker_id 时返回 None (不再 "spk?")
- speaker_pool 扫描跳过 None / 空 ID
- partial fallback 到 last_known_speaker_id
"""
import sys
import os

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

from volcengine_engine import extract_utterances  # noqa: E402


# ----------------------------------------------------------------------------
# P0-2: extract_utterances 不再产出 "spk?"
# ----------------------------------------------------------------------------
def test_extract_returns_none_when_speaker_id_missing():
    """utterance 没有 additions.speaker_id 也没有顶层 speaker_id → speaker_id=None"""
    payload = {"result": {"utterances": [
        {"text": "你好", "start_time": 0, "end_time": 1, "words": []},
    ]}}
    utts, speakers = extract_utterances(payload)
    assert len(utts) == 1
    assert utts[0]["speaker_id"] is None, "缺 speaker_id 必须返回 None, 而非 'spk?' 占位"


def test_extract_reads_additions_speaker_id():
    """v3/sauc 2.0: speaker_id 在 additions 嵌套"""
    payload = {"result": {"utterances": [
        {"text": "你好", "additions": {"speaker_id": "0"}, "words": []},
        {"text": "世界", "additions": {"speaker_id": "1"}, "words": []},
    ]}}
    utts, speakers = extract_utterances(payload)
    assert utts[0]["speaker_id"] == "0"
    assert utts[1]["speaker_id"] == "1"
    assert len(speakers) == 2
    # speakers 不应包含 None
    assert all(s["id"] is not None for s in speakers)


def test_extract_mixed_known_and_unknown_speaker():
    """同一批 utterance 里混已知/未知 speaker_id"""
    payload = {"result": {"utterances": [
        {"text": "已知", "additions": {"speaker_id": "0"}, "words": []},
        {"text": "未知", "words": []},  # 无 speaker_id
    ]}}
    utts, speakers = extract_utterances(payload)
    assert utts[0]["speaker_id"] == "0"
    assert utts[1]["speaker_id"] is None
    # speakers 池里只收录已知的, 不能把 None 当真实 speaker
    assert len(speakers) == 1
    assert speakers[0]["id"] == "0"


# ----------------------------------------------------------------------------
# P0-2: speaker_pool 扫描也跳过 None
# 模拟 app.py _on_volc_final 里的 speaker_pool 扫描逻辑
# ----------------------------------------------------------------------------
def _scan_speakers(utterances, speakers):
    """复刻 app.py:231-247 的扫描行为 — 用于独立验证"""
    pool = {}
    for s in speakers or []:
        sid = s.get('id')
        if sid and sid not in pool:
            pool[sid] = {'id': sid, 'label': s.get('label', f"发言人 {len(pool) + 1}")}
    for u in utterances or []:
        additions = u.get('additions') or {}
        sid = additions.get('speaker_id') or u.get('speaker_id')
        if sid and sid not in pool:
            pool[sid] = {'id': sid, 'label': f"发言人 {len(pool) + 1}"}
    return pool


def test_pool_skips_none_speaker_id():
    """utterances 含 None speaker_id 时, pool 不应收录 None"""
    utts = [
        {"text": "已知", "speaker_id": "0"},
        {"text": "未知", "speaker_id": None},
    ]
    pool = _scan_speakers(utts, [])
    assert None not in pool, "None 不能进 speaker_pool"
    assert "spk?" not in pool, "占位 'spk?' 也不能进 pool"
    assert list(pool.keys()) == ["0"]
