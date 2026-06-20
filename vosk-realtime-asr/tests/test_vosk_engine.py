"""
Vosk 引擎单元测试
"""

import pytest
import json
import os
from vosk_engine import VoskEngine, VoskSessionManager

# 模型路径（测试时使用小模型）
MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'server', 'models', 'vosk-model-cn-0.22')

class TestVoskEngine:
    """VoskEngine 测试类"""

    @pytest.fixture
    def vosk_engine(self):
        """创建 VoskEngine 实例"""
        if not os.path.exists(MODEL_PATH):
            pytest.skip(f"Vosk model not found at {MODEL_PATH}")

        engine = VoskEngine(MODEL_PATH)
        return engine

    def test_model_loaded(self, vosk_engine):
        """测试模型加载"""
        assert vosk_engine.model is not None
        assert vosk_engine.sample_rate == 16000

    def test_transcribe_stream_empty(self, vosk_engine):
        """测试空音频流转写"""
        def empty_stream():
            for _ in range(10):
                yield bytes(4000)  # 空音频数据
            return

        results = []
        for result in vosk_engine.transcribe_stream(empty_stream()):
            results.append(result)

        # 空音频应该没有转写结果或结果为空字符串
        for result in results:
            if result['text']:
                assert isinstance(result['text'], str)
            assert 'is_final' in result
            assert 'latency_ms' in result

    def test_result_format(self, vosk_engine):
        """测试结果格式"""
        # 模拟部分结果格式
        partial_result = {
            'text': '你好',
            'is_final': False,
            'latency_ms': 150
        }

        assert 'text' in partial_result
        assert isinstance(partial_result['text'], str)
        assert 'is_final' in partial_result
        assert 'latency_ms' in partial_result

class TestVoskSessionManager:
    """VoskSessionManager 测试类"""

    @pytest.fixture
    def session_manager(self):
        """创建 SessionManager 实例"""
        if not os.path.exists(MODEL_PATH):
            pytest.skip(f"Vosk model not found at {MODEL_PATH}")

        manager = VoskSessionManager(MODEL_PATH)
        return manager

    def test_create_session(self, session_manager):
        """测试创建会话"""
        session_id = 'test-session-001'
        recognizer = session_manager.create_session(session_id)

        assert recognizer is not None
        assert session_id in session_manager.sessions

    def test_get_session(self, session_manager):
        """测试获取会话"""
        session_id = 'test-session-002'
        session_manager.create_session(session_id)

        recognizer = session_manager.get_session(session_id)
        assert recognizer is not None

        # 获取不存在的会话
        nonexistent = session_manager.get_session('nonexistent')
        assert nonexistent is None

    def test_end_session(self, session_manager):
        """测试结束会话"""
        session_id = 'test-session-003'
        session_manager.create_session(session_id)

        final_text = session_manager.end_session(session_id)
        assert session_id not in session_manager.sessions

        # 结束不存在的会话
        nonexistent_text = session_manager.end_session('nonexistent')
        assert nonexistent_text is None

    def test_process_audio_empty(self, session_manager):
        """测试处理空音频"""
        session_id = 'test-session-004'
        session_manager.create_session(session_id)

        # 空音频数据
        empty_audio = bytes(4000)

        result = session_manager.process_audio(session_id, empty_audio)

        assert 'text' in result
        assert 'is_final' in result
        assert 'latency_ms' in result

    def test_process_audio_nonexistent_session(self, session_manager):
        """测试处理不存在会话的音频"""
        with pytest.raises(ValueError) as excinfo:
            session_manager.process_audio('nonexistent', bytes(4000))

        assert 'not found' in str(excinfo.value)

class TestVoskResultParsing:
    """Vosk 结果解析测试"""

    def test_parse_final_result(self):
        """测试解析最终结果"""
        json_result = '{"text": "你好世界", "result": [{"word": "你好", "start": 0.0, "end": 0.5}, {"word": "世界", "start": 0.5, "end": 1.0}]}'

        result = json.loads(json_result)

        assert result['text'] == '你好世界'
        assert len(result['result']) == 2

    def test_parse_partial_result(self):
        """测试解析部分结果"""
        json_result = '{"partial": "你好"}'

        result = json.loads(json_result)

        assert result['partial'] == '你好'

    def test_parse_empty_result(self):
        """测试解析空结果"""
        json_result = '{"text": ""}'

        result = json.loads(json_result)

        assert result['text'] == ''

# 运行测试
if __name__ == '__main__':
    pytest.main([__file__, '-v'])