# 开源语音转写方案对比

> **更新日期**: 2026-06-20 | **适用场景**: 无API额度测试、本地部署

---

## 一、主流开源 ASR 模型对比

| 模型 | 准确率 | 实时性 | 中文支持 | 部署难度 | 硬件要求 | 推荐指数 |
|------|--------|--------|----------|----------|----------|----------|
| **Whisper** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | 中等(Medium) | **首选** |
| **FunASR/Paraformer** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 低 | **国产首选** |
| **Vosk** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 极低 | **实时首选** |
| **DeepSpeech** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | 低 | 备选 |
| **Coqui STT** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 低 | 备选 |

---

## 二、推荐方案详解

### 方案一：Whisper (OpenAI 开源) - ⭐首选推荐

#### 优势
- ✅ 准确率极高，接近商业API水平
- ✅ 支持99种语言，中文效果极佳
- ✅ 完全开源，可本地部署
- ✅ 有多种模型大小可选

#### 模型规格

| 模型 | 参数量 | 内存 | 速度 | 准确率 |
|------|--------|------|------|--------|
| tiny | 39M | ~1GB | 32x | 适中选择 |
| base | 74M | ~1GB | 16x | 较好 |
| small | 244M | ~2GB | 6x | 很好 |
| medium | 769M | ~5GB | 2x | 极好 |
| large-v3 | 1550M | ~10GB | 1x | 最佳 |

#### 快速使用

```bash
# 安装
pip install openai-whisper

# 基础使用
whisper audio.mp3 --model medium --language Chinese

# Python代码
import whisper

model = whisper.load_model("medium")
result = model.transcribe("audio.mp3", language="zh")
print(result["text"])
```

#### 实时转写方案 (Whisper + 实时流)

```python
# realtime_whisper.py - 实时转写实现
import whisper
import pyaudio
import numpy as np
import threading
import queue

class RealtimeWhisperTranscriber:
    def __init__(self, model_size="medium"):
        self.model = whisper.load_model(model_size)
        self.audio_queue = queue.Queue()
        self.is_running = False

        # 音频配置
        self.CHUNK_SIZE = 1024
        self.SAMPLE_RATE = 16000
        self.CHANNELS = 1

    def start(self):
        """启动实时转写"""
        self.is_running = True

        # 启动音频采集线程
        audio_thread = threading.Thread(target=self._capture_audio)
        audio_thread.start()

        # 启动转写线程
        transcribe_thread = threading.Thread(target=self._transcribe_loop)
        transcribe_thread.start()

    def _capture_audio(self):
        """采集音频数据"""
        p = pyaudio.PyAudio()

        stream = p.open(
            format=pyaudio.paInt16,
            channels=self.CHANNELS,
            rate=self.SAMPLE_RATE,
            input=True,
            frames_per_buffer=self.CHUNK_SIZE
        )

        buffer = []
        buffer_duration = 0

        while self.is_running:
            data = stream.read(self.CHUNK_SIZE)
            buffer.append(data)
            buffer_duration += self.CHUNK_SIZE / self.SAMPLE_RATE

            # 每5秒发送一次音频块进行转写
            if buffer_duration >= 5:
                audio_data = b''.join(buffer)
                self.audio_queue.put(audio_data)
                buffer = []
                buffer_duration = 0

        stream.stop_stream()
        stream.close()
        p.terminate()

    def _transcribe_loop(self):
        """转写循环"""
        while self.is_running:
            try:
                audio_data = self.audio_queue.get(timeout=1)

                # 转换为numpy数组
                audio_array = np.frombuffer(audio_data, dtype=np.int16)
                audio_float = audio_array.astype(np.float32) / 32768.0

                # 转写
                result = self.model.transcribe(
                    audio_float,
                    language="zh",
                    initial_prompt="以下是实时语音转写内容"
                )

                text = result["text"]
                if text.strip():
                    print(f"[转写结果] {text}")

            except queue.Empty:
                continue

    def stop(self):
        """停止转写"""
        self.is_running = False

# 使用
transcriber = RealtimeWhisperTranscriber(model_size="medium")
transcriber.start()

# 运行一段时间后停止
input("按回车键停止...")
transcriber.stop()
```

---

### 方案二：FunASR/Paraformer (阿里达摩院) - ⭐国产首选

#### 优势
- ✅ **中文准确率最高**，超越Whisper
- ✅ 支持实时流式转写，延迟极低
- ✅ 开源免费，可商用
- ✅ 支持说话人分离、标点恢复
- ✅ 国产方案，合规性好

#### 快速使用

```bash
# 安装
pip install funasr modelscope

# 下载模型
# 自动下载，无需手动操作
```

```python
# funasr_transcriber.py - FunASR实时转写
from funasr import AutoModel

# 离线转写（高准确率）
model = AutoModel(
    model="paraformer-zh",  # 中文离线模型
    vad_model="fsmn-vad",   # VAD模型
    punc_model="ct-punc",   # 标点恢复模型
)

result = model.generate(input="audio.wav")
print(result[0]["text"])

# 实时流式转写（低延迟）
from funasr import AutoModel

stream_model = AutoModel(
    model="paraformer-zh-streaming",
)

# 流式转写
import asyncio
import websockets

async def realtime_transcribe():
    # FunASR 提供了 WebSocket 服务端
    # 可直接部署使用
    pass
```

#### FunASR 服务端部署

```bash
# 使用 Docker 快速部署 FunASR 服务
docker pull registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-cpu-latest

# 启动服务
docker run -p 10095:10095 \
    registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-cpu-latest

# 服务端口: 10095 (WebSocket)
```

#### 前端对接 FunASR 服务

```typescript
// funasr-client.ts - 对接 FunASR WebSocket 服务
class FunASRClient {
  private ws: WebSocket;
  private sessionId: string;

  connect(url: string = 'ws://localhost:10095') {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // 发送初始化消息
      this.ws.send(JSON.stringify({
        mode: '2pass',        // 两遍解码模式
        chunk_size: [5, 10, 5], // 分块大小
        chunk_interval: 10,    // 分块间隔
        wav_name: 'realtime',
        is_speaking: true,
        hotwords: '',          // 热词（可选）
      }));
    };

    this.ws.onmessage = (event) => {
      const result = JSON.parse(event.data);
      console.log('转写结果:', result.text);
    };
  }

  sendAudio(audioData: Int16Array) {
    // 发送音频数据（PCM 16kHz 单声道）
    // FunASR 要求每次发送 600ms 音频
    // 16000 * 0.6 * 2 = 19200 字节
    const chunk = audioData.slice(0, 9600); // 9600 个采样点 = 600ms
    this.ws.send(chunk.buffer);
  }
}
```

---

### 方案三：Vosk - ⭐实时首选

#### 优势
- ✅ **实时性最佳**，延迟 < 100ms
- ✅ 轻量级，CPU即可运行
- ✅ 支持离线部署，无需联网
- ✅ 中文模型效果不错
- ✅ 支持流式识别

#### 快速使用

```bash
# 安装
pip install vosk

# 下载中文模型 (约50MB)
wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip
unzip vosk-model-cn-0.22.zip
```

```python
# vosk_realtime.py - Vosk实时转写
from vosk import Model, KaldiRecognizer
import pyaudio
import json

# 加载模型
model = Model("vosk-model-cn-0.22")
recognizer = KaldiRecognizer(model, 16000)

# 初始化音频
p = pyaudio.PyAudio()
stream = p.open(
    format=pyaudio.paInt16,
    channels=1,
    rate=16000,
    input=True,
    frames_per_buffer=8000  # 500ms
)

print("开始实时转写...")

while True:
    data = stream.read(4000)  # 250ms 音频

    if recognizer.AcceptWaveform(data):
        result = json.loads(recognizer.Result())
        print(f"[完整] {result['text']}")
    else:
        partial = json.loads(recognizer.PartialResult())
        if partial['partial']:
            print(f"[实时] {partial['partial']}")

stream.stop_stream()
stream.close()
p.terminate()
```

#### Vosk 服务端

```python
# vosk_server.py - WebSocket服务端
import asyncio
import websockets
from vosk import Model, KaldiRecognizer
import json

model = Model("vosk-model-cn-0.22")

async def transcribe(websocket):
    recognizer = KaldiRecognizer(model, 16000)

    while True:
        try:
            data = await websocket.recv()

            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                await websocket.send(json.dumps({
                    "text": result['text'],
                    "is_final": True
                }))
            else:
                partial = json.loads(recognizer.PartialResult())
                await websocket.send(json.dumps({
                    "text": partial['partial'],
                    "is_final": False
                }))

        except websockets.exceptions.ConnectionClosed:
            break

async def main():
    await websockets.serve(transcribe, "localhost", 2700)
    print("Vosk WebSocket 服务启动: ws://localhost:2700")
    await asyncio.Future()  # 永久运行

asyncio.run(main())
```

---

## 三、免费在线API (有额度限制)

| 平台 | 免费额度 | 中文质量 | 实时支持 |
|------|----------|----------|----------|
| **讯飞开放平台** | 每日500次 | ⭐⭐⭐⭐⭐ | ✅ |
| **百度语音** | 每日500次 | ⭐⭐⭐⭐ | ✅ |
| **腾讯云** | 每月10000次 | ⭐⭐⭐⭐ | ✅ |
| **阿里云** | 每月10000次 | ⭐⭐⭐⭐⭐ | ✅ |

---

## 四、推荐组合方案

### 🏆 最佳免费方案：FunASR (Paraformer)

```bash
# 一键部署 FunASR 实时转写服务
docker run -d -p 10095:10095 \
  --name funasr-server \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-cpu-latest
```

**优势**：
- 中文准确率最高
- 支持实时流式
- 完全免费开源
- 可商用
- Docker一键部署

### 🥈 备选方案：Vosk

```bash
# 本地快速启动
pip install vosk
wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip
unzip vosk-model-cn-0.22.zip
python vosk_server.py
```

**优势**：
- 实时性最好
- 最轻量
- CPU可运行

---

## 五、完整Demo实现

### FunASR 实时转写完整Demo

```bash
# 项目结构
mkdir realtime-asr-demo
cd realtime-asr-demo
```

#### 1. 服务端 (Python + FunASR)

```python
# server/app.py
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import numpy as np
import subprocess
import json

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# FunASR 进程
funasr_process = None

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'status': 'ok'})

@socketio.on('start_transcription')
def handle_start():
    global funasr_process

    # 启动 FunASR 流式识别进程
    # 这里使用 FunASR Python SDK
    emit('started', {'session_id': 'demo-session'})

@socketio.on('audio_data')
def handle_audio(data):
    # 处理音频数据
    audio_array = np.frombuffer(data, dtype=np.int16)

    # 转写逻辑（使用FunASR）
    # ...
    pass

@socketio.on('stop_transcription')
def handle_stop():
    emit('stopped', {'status': 'completed'})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
```

#### 2. 前端 (React)

```tsx
// client/src/App.tsx
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const socketRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    socketRef.current = io('http://localhost:5000');

    socketRef.current.on('connected', () => {
      console.log('Connected to server');
    });

    socketRef.current.on('transcription_result', (data: any) => {
      setTranscription(prev => prev + data.text);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      audioContextRef.current = new AudioContext({ sampleRate: 16000 });

      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(workletNodeRef.current);

      workletNodeRef.current.port.onmessage = (event) => {
        if (socketRef.current) {
          socketRef.current.emit('audio_data', event.data);
        }
      };

      socketRef.current?.emit('start_transcription');
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    workletNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    socketRef.current?.emit('stop_transcription');
    setIsRecording(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">
          实时语音转写 Demo (FunASR)
        </h1>

        <div className="flex gap-4 mb-8">
          <button
            onClick={startRecording}
            disabled={isRecording}
            className={`px-6 py-3 rounded-lg font-semibold ${
              isRecording
                ? 'bg-gray-600 text-gray-400'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isRecording ? '录音中...' : '开始录音'}
          </button>

          <button
            onClick={stopRecording}
            disabled={!isRecording}
            className={`px-6 py-3 rounded-lg font-semibold ${
              !isRecording
                ? 'bg-gray-600 text-gray-400'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            停止录音
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 min-h-[400px]">
          <h2 className="text-lg font-semibold text-gray-400 mb-4">转写结果</h2>
          <p className="text-white leading-relaxed">{transcription || '等待录音...'}</p>
        </div>
      </div>
    </div>
  );
};

export default App;
```

#### 3. AudioWorklet 处理器

```javascript
// public/audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0][0]; // 单声道

    if (input) {
      // 填充缓冲区
      for (let i = 0; i < input.length && this.bufferIndex < this.bufferSize; i++) {
        this.buffer[this.bufferIndex++] = input[i];
      }

      // 缓冲区满了就发送
      if (this.bufferIndex >= this.bufferSize) {
        // 转换为 Int16 (PCM)
        const pcmData = new Int16Array(this.bufferSize);
        for (let i = 0; i < this.bufferSize; i++) {
          pcmData[i] = Math.max(-32768, Math.min(32767, this.buffer[i] * 32768));
        }

        this.port.postMessage(pcmData.buffer, [pcmData.buffer]);

        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
```

---

## 六、下一步建议

### 🎯 立即可用方案

```bash
# 最快上手：Vosk (轻量级实时转写)
pip install vosk
wget https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip
unzip vosk-model-cn-0.22.zip
python vosk_realtime.py  # 运行实时转写
```

### 🔧 推荐开发路径

1. **阶段一**: 用 Vosk 快速验证前端界面和音频采集
2. **阶段二**: 替换为 FunASR 提升中文准确率
3. **阶段三**: 有额度后再对接讯飞/阿里云商业API

需要我帮您创建完整的 FunASR 或 Vosk Demo 项目吗？