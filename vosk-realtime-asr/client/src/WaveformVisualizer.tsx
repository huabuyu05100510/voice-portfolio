/**
 * 波形可视化组件
 * 使用 Canvas 实时绘制音频波形
 */

import React, { useEffect, useRef } from 'react';

export class WaveformVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;
  private dataBuffer: Float32Array;
  private isRunning: boolean = false;

  // 配置
  private static readonly CONFIG = {
    bufferLength: 2048,
    smoothing: 0.8,
    lineWidth: 2,
    lineColor: '#00d4ff',
    backgroundColor: '#1a1a2e',
    centerLineColor: '#3a3a5e',
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.dataBuffer = new Float32Array(WaveformVisualizer.CONFIG.bufferLength);

    // 初始化画布尺寸
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * 调整画布尺寸
   */
  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.scale(dpr, dpr);

    // 清空并绘制背景
    this.drawBackground();
  }

  /**
   * 绘制背景
   */
  private drawBackground(): void {
    const { width, height } = this.canvas.getBoundingClientRect();

    // 背景
    this.ctx.fillStyle = WaveformVisualizer.CONFIG.backgroundColor;
    this.ctx.fillRect(0, 0, width, height);

    // 中心线
    this.ctx.strokeStyle = WaveformVisualizer.CONFIG.centerLineColor;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
  }

  /**
   * 更新音频数据
   */
  update(audioData: Int16Array | Float32Array): void {
    // 将音频数据转换为 Float32 并添加到缓冲区
    const floatData = audioData instanceof Int16Array
      ? this.int16ToFloat32(audioData)
      : audioData;

    // 简单的平滑处理
    for (let i = 0; i < floatData.length && i < this.dataBuffer.length; i++) {
      this.dataBuffer[i] = this.dataBuffer[i] * WaveformVisualizer.CONFIG.smoothing +
        floatData[i] * (1 - WaveformVisualizer.CONFIG.smoothing);
    }
  }

  /**
   * Int16 转 Float32
   */
  private int16ToFloat32(int16Data: Int16Array): Float32Array {
    const floatData = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      floatData[i] = int16Data[i] / 32768.0;
    }
    return floatData;
  }

  /**
   * 开始渲染
   */
  start(): void {
    this.isRunning = true;
    this.render();
  }

  /**
   * 停止渲染
   */
  stop(): void {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 渲染循环
   */
  private render(): void {
    if (!this.isRunning) return;

    const { width, height } = this.canvas.getBoundingClientRect();
    const centerY = height / 2;

    // 绘制背景
    this.drawBackground();

    // 绘制波形
    this.ctx.strokeStyle = WaveformVisualizer.CONFIG.lineColor;
    this.ctx.lineWidth = WaveformVisualizer.CONFIG.lineWidth;
    this.ctx.beginPath();

    const sliceWidth = width / this.dataBuffer.length;
    let x = 0;

    for (let i = 0; i < this.dataBuffer.length; i++) {
      const value = this.dataBuffer[i];
      const y = centerY + value * centerY * 0.9; // 90% 高度

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    this.ctx.stroke();

    // 绘制发光效果
    this.drawGlow();

    // 继续渲染
    this.animationId = requestAnimationFrame(() => this.render());
  }

  /**
   * 绘制发光效果
   */
  private drawGlow(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const centerY = height / 2;

    // 外层光晕
    this.ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();

    const sliceWidth = width / this.dataBuffer.length;
    let x = 0;

    for (let i = 0; i < this.dataBuffer.length; i++) {
      const value = this.dataBuffer[i];
      const y = centerY + value * centerY * 0.85;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    this.ctx.stroke();
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stop();
    window.removeEventListener('resize', () => this.resize());
  }
}

// ============================================================================
// React 组件包装
// ============================================================================
interface WaveformCanvasProps {
  className?: string;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerRef = useRef<WaveformVisualizer | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      visualizerRef.current = new WaveformVisualizer(canvasRef.current);
    }

    return () => {
      visualizerRef.current?.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className || 'waveform-canvas'}
      style={{
        width: '100%',
        height: '150px',
        backgroundColor: '#1a1a2e',
      }}
    />
  );
};