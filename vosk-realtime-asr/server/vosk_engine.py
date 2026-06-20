"""
Vosk 语音识别引擎封装
提供流式实时转写能力
"""

import json
import time
from typing import Optional, Dict, Any, Generator
from vosk import Model, KaldiRecognizer, SetLogLevel


class VoskEngine:
    """Vosk 语音识别引擎"""

    def __init__(self, model_path: str, sample_rate: int = 16000):
        """
        初始化 Vosk 引擎

        Args:
            model_path: Vosk 模型路径
            sample_rate: 采样率，默认 16kHz
        """
        # 设置日志级别（可选）
        SetLogLevel(0)  # 0 = 静默，-1 = 调试

        self.model = Model(model_path)
        self.sample_rate = sample_rate

        print(f"[VoskEngine] Model loaded: {model_path}")

    def transcribe_stream(
        self,
        audio_stream: Generator[bytes, None, None]
    ) -> Generator[Dict[str, Any], None, None]:
        """
        流式转写音频数据

        Args:
            audio_stream: 音频数据流生成器

        Yields:
            转写结果字典
        """
        recognizer = KaldiRecognizer(self.model, self.sample_rate)

        for audio_chunk in audio_stream:
            start_time = time.time()

            if recognizer.AcceptWaveform(audio_chunk):
                # 完整句子
                result = json.loads(recognizer.Result())
                latency = (time.time() - start_time) * 1000

                yield {
                    'text': result.get('text', ''),
                    'is_final': True,
                    'latency_ms': latency,
                    'words': result.get('result', [])  # 词级别详情
                }
            else:
                # 部分结果
                partial = json.loads(recognizer.PartialResult())
                if partial.get('partial'):
                    latency = (time.time() - start_time) * 1000

                    yield {
                        'text': partial['partial'],
                        'is_final': False,
                        'latency_ms': latency
                    }

        # 最终结果
        final_result = json.loads(recognizer.FinalResult())
        if final_result.get('text'):
            yield {
                'text': final_result['text'],
                'is_final': True,
                'is_final_end': True
            }

    def transcribe_file(self, audio_file_path: str) -> Dict[str, Any]:
        """
        转写音频文件

        Args:
            audio_file_path: 音频文件路径

        Returns:
            转写结果
        """
        import wave

        wf = wave.open(audio_file_path, "rb")

        # 检查格式
        if wf.getnchannels() != 1:
            raise ValueError("Audio file must be mono")
        if wf.getsampwidth() != 2:
            raise ValueError("Audio file must be 16-bit")
        if wf.getframerate() != self.sample_rate:
            raise ValueError(f"Audio file must be {self.sample_rate}Hz")

        recognizer = KaldiRecognizer(self.model, self.sample_rate)

        full_text = []

        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break

            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                if result['text']:
                    full_text.append(result['text'])

        # 最终结果
        final_result = json.loads(recognizer.FinalResult())
        if final_result['text']:
            full_text.append(final_result['text'])

        wf.close()

        return {
            'text': ' '.join(full_text),
            'is_final': True
        }


class VoskSessionManager:
    """Vosk 会话管理器"""

    def __init__(self, model_path: str, sample_rate: int = 16000):
        self.model = Model(model_path)
        self.sample_rate = sample_rate
        self.sessions: Dict[str, KaldiRecognizer] = {}

    def create_session(self, session_id: str) -> KaldiRecognizer:
        """创建识别会话"""
        recognizer = KaldiRecognizer(self.model, self.sample_rate)
        self.sessions[session_id] = recognizer
        return recognizer

    def get_session(self, session_id: str) -> Optional[KaldiRecognizer]:
        """获取会话"""
        return self.sessions.get(session_id)

    def end_session(self, session_id: str) -> Optional[str]:
        """结束会话，获取最终结果"""
        recognizer = self.sessions.pop(session_id, None)
        if recognizer:
            final_result = json.loads(recognizer.FinalResult())
            return final_result.get('text', '')
        return None

    def process_audio(
        self,
        session_id: str,
        audio_data: bytes
    ) -> Dict[str, Any]:
        """处理音频数据"""
        recognizer = self.sessions.get(session_id)
        if not recognizer:
            raise ValueError(f"Session {session_id} not found")

        start_time = time.time()

        if recognizer.AcceptWaveform(audio_data):
            result = json.loads(recognizer.Result())
            latency = (time.time() - start_time) * 1000

            return {
                'text': result.get('text', ''),
                'is_final': True,
                'latency_ms': latency,
                'words': result.get('result', [])
            }
        else:
            partial = json.loads(recognizer.PartialResult())
            latency = (time.time() - start_time) * 1000

            return {
                'text': partial.get('partial', ''),
                'is_final': False,
                'latency_ms': latency
            }


# ============================================================================
# 测试示例
# ============================================================================
if __name__ == '__main__':
    import os

    MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-cn-0.22')

    if not os.path.exists(MODEL_PATH):
        print(f"Please download model to: {MODEL_PATH}")
        print("wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip")
    else:
        engine = VoskEngine(MODEL_PATH)

        # 测试会话管理器
        manager = VoskSessionManager(MODEL_PATH)

        session_id = 'test-session'
        manager.create_session(session_id)

        # 模拟音频数据
        audio_data = bytes(4000)  # 模拟空白音频

        result = manager.process_audio(session_id, audio_data)
        print(f"Result: {result}")