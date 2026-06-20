/**
 * AudioWorklet 处理器
 * 在独立线程中处理音频数据，避免阻塞主线程
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // 配置参数
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isRecording = false;

    // 监听来自主线程的消息
    this.port.onmessage = (event) => {
      const { type } = event.data;

      if (type === 'start') {
        this.isRecording = true;
        this.bufferIndex = 0;
      } else if (type === 'stop') {
        this.isRecording = false;
        this.flushBuffer();
      } else if (type === 'config') {
        if (event.data.bufferSize) {
          this.bufferSize = event.data.bufferSize;
          this.buffer = new Float32Array(this.bufferSize);
        }
      }
    };
  }

  /**
   * 处理音频数据
   * 这是 AudioWorklet 的核心方法，在每个音频采样周期被调用
   */
  process(inputs, outputs, parameters) {
    // 获取输入音频数据（单声道）
    const input = inputs[0];
    if (!input || !input[0]) {
      return true; // 继续运行
    }

    const inputChannel = input[0];

    // 如果正在录音，则收集音频数据
    if (this.isRecording) {
      // 将 Float32 音频数据添加到缓冲区
      for (let i = 0; i < inputChannel.length && this.bufferIndex < this.bufferSize; i++) {
        this.buffer[this.bufferIndex++] = inputChannel[i];
      }

      // 当缓冲区满了，发送数据到主线程
      if (this.bufferIndex >= this.bufferSize) {
        this.flushBuffer();
      }
    }

    // 可选：将输入复制到输出（用于音频监听）
    // const output = outputs[0];
    // if (output && output[0]) {
    //   output[0].set(inputChannel);
    // }

    return true; // 保持处理器活跃
  }

  /**
   * 发送缓冲区数据到主线程
   */
  flushBuffer() {
    if (this.bufferIndex === 0) return;

    // 将 Float32 转换为 Int16 (PCM 16-bit)
    const pcmData = new Int16Array(this.bufferIndex);

    for (let i = 0; i < this.bufferIndex; i++) {
      // Float32 范围 [-1, 1] -> Int16 范围 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, this.buffer[i]));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    // 发送 PCM 数据到主线程
    // 使用 transferable 对象提高性能
    this.port.postMessage(pcmData.buffer, [pcmData.buffer]);

    // 重置缓冲区
    this.bufferIndex = 0;
    this.buffer = new Float32Array(this.bufferSize);
  }
}

// 注册 AudioWorklet 处理器
registerProcessor('audio-processor', AudioProcessor);