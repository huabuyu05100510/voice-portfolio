/**
 * AudioWorklet 处理器 (模块 C 加固)
 *
 * 增强:
 *   - 软重采样兜底 (sourceSampleRate != 16k 时线性插值降频)
 *   - underrun 检测 (currentTime 跳变 > 50ms 累计计数)
 *   - postMessage 协议升级: { type, pcm, underrunCount, needsResampling }
 *
 * 模型: MiniMax-M3
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // 配置参数
    this.bufferSize = (options && options.processorOptions && options.processorOptions.bufferSize) || 2048;
    this.targetSampleRate = 16000;
    // AudioWorkletProcessor 全局: sampleRate (实际硬件采样率) + currentTime (秒)
    this.sourceSampleRate = sampleRate;
    this.needsResampling = this.sourceSampleRate !== this.targetSampleRate;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;

    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isRecording = false;

    // underrun 检测
    this.underrunCount = 0;
    this.lastTickTime = currentTime;

    // 监听来自主线程的消息
    this.port.onmessage = (event) => {
      const { type } = event.data;

      if (type === 'start') {
        this.isRecording = true;
        this.bufferIndex = 0;
        this.underrunCount = 0;
        this.lastTickTime = currentTime;
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
   * 处理音频数据 — AudioWorklet 核心方法, 每音频采样周期被调一次
   */
  process(inputs, outputs, parameters) {
    // 1. underrun 检测: 两次 process 间隔 > 50ms 视为 audio buffer 饥饿
    const dt = currentTime - this.lastTickTime;
    if (dt > 0.05) {
      this.underrunCount += 1;
    }
    this.lastTickTime = currentTime;

    // 2. 取输入通道
    const input = inputs[0];
    if (!input || !input[0]) {
      return true; // 继续运行
    }
    const inputChannel = input[0];

    if (!this.isRecording) {
      return true;
    }

    // 3. 软重采样 (兜底)
    const samples = this.needsResampling
      ? this.resampleLinear(inputChannel)
      : inputChannel;

    // 4. 写入环形 buffer
    for (let i = 0; i < samples.length && this.bufferIndex < this.bufferSize; i++) {
      this.buffer[this.bufferIndex++] = samples[i];
    }

    // 5. buffer 满则 flush
    if (this.bufferIndex >= this.bufferSize) {
      this.flushBuffer();
    }

    return true;
  }

  /**
   * 线性插值软重采样 (兜底用, 仅在 native 协商失败时启用)
   * input: 源采样率音频
   * output: 目标采样率音频 (长度 = floor(inputLen / ratio))
   */
  resampleLinear(input) {
    const ratio = this.resampleRatio;
    const outputLen = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, input.length - 1);
      const frac = srcIdx - idx0;
      output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
    }
    return output;
  }

  /**
   * Float32 -> Int16 PCM 编码, transferable 发到主线程
   */
  flushBuffer() {
    if (this.bufferIndex === 0) return;

    const pcmData = new Int16Array(this.bufferIndex);
    for (let i = 0; i < this.bufferIndex; i++) {
      const sample = Math.max(-1, Math.min(1, this.buffer[i]));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    this.port.postMessage(
      {
        type: 'audio',
        pcm: pcmData.buffer,
        underrunCount: this.underrunCount,
        needsResampling: this.needsResampling,
      },
      [pcmData.buffer]
    );

    this.bufferIndex = 0;
  }
}

registerProcessor('audio-processor', AudioProcessor);
