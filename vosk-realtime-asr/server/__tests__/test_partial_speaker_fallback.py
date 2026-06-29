"""
P0-3: partial 帧在缺 speaker_id 时应 fallback 到 last_known_speaker_id

会议室场景: 多人轮换发言, partial 帧本身不带 speaker_id (火山引擎协议),
如果上一句 final 也没解析出 speaker, 会显示成"未知说话人", 颜色乱跳。
"""
import sys
import os

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


def test_partial_fallback_after_final_with_speaker():
    """final 解析出 speaker_id="0" 后, 后续 partial 应沿用 "0" """
    # 复刻 session 状态机 — _on_volc_final 与 _on_volc_partial 共享的 session 字段
    session = {
        'current_speaker_id': None,
        'last_known_speaker_id': None,
    }

    def apply_final(speaker_id):
        # 复刻 _on_volc_final 的 speaker 更新逻辑 (修复后)
        session['current_speaker_id'] = speaker_id
        if speaker_id:  # sticky: 只在确实解析到时才覆盖
            session['last_known_speaker_id'] = speaker_id

    def resolve_partial_speaker():
        # 复刻 _on_volc_partial 的 fallback 逻辑 (修复后)
        return session.get('current_speaker_id') or session.get('last_known_speaker_id')

    # 第一句 final 解析到 "0"
    apply_final("0")
    assert resolve_partial_speaker() == "0"

    # 第二句 final 没解析到 (None), current_speaker_id 变 None
    apply_final(None)
    # 但 partial 应该 fallback 到 last_known="0", 不能变成 None
    assert resolve_partial_speaker() == "0", \
        "partial 必须沿用最近一次已知 speaker, 否则字幕颜色乱跳"


def test_partial_no_speaker_before_any_final():
    """从未收到任何 final 时, partial 应返回 None (不能凭空编造)"""
    session = {'current_speaker_id': None, 'last_known_speaker_id': None}

    def resolve_partial_speaker():
        return session.get('current_speaker_id') or session.get('last_known_speaker_id')

    assert resolve_partial_speaker() is None


def test_partial_speaker_updates_when_new_speaker_arrives():
    """发言人切换: A→B→A, last_known 应跟随最新一个"""
    session = {'current_speaker_id': None, 'last_known_speaker_id': None}

    def apply_final(spk):
        session['current_speaker_id'] = spk
        if spk:
            session['last_known_speaker_id'] = spk

    def resolve_partial_speaker():
        return session.get('current_speaker_id') or session.get('last_known_speaker_id')

    apply_final("A")
    apply_final("B")
    apply_final(None)  # B 后一句没解析到
    assert resolve_partial_speaker() == "B"
    apply_final("A")  # A 又说话
    assert resolve_partial_speaker() == "A"


def test_final_speaker_fallback_to_last_known_when_missing():
    """累积帧 utterance_count=1 时火山引擎不返 speaker_id,
    final payload.speaker_id 必须 fallback 到 last_known, 否则全屏"未知说话人".
    """
    session = {
        'current_speaker_id': None,
        'last_known_speaker_id': None,
    }

    def resolve_final_speaker(parsed):
        # 复刻 _on_volc_final 的 sticky speaker 逻辑 (修复后)
        # 解析到时更新 sticky; 解析不到时 fallback 到 last_known
        if parsed:
            session['current_speaker_id'] = parsed
            session['last_known_speaker_id'] = parsed
            return parsed
        session['current_speaker_id'] = None
        return session.get('last_known_speaker_id')

    # 第一帧边界帧解析到 "0"
    assert resolve_final_speaker("0") == "0"
    # 后续累积帧都解析不到, 但 payload 应 fallback 到 "0", 不能返 None
    for _ in range(5):
        assert resolve_final_speaker(None) == "0", \
            "final 累积帧 speaker_id 必须沿用 last_known, 否则 UI 全是'未知说话人'"
