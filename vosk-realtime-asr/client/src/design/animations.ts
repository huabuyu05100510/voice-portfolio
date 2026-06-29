/**
 * design/animations.ts — Sprint 12 UI Redesign
 *
 * 关键帧动画统一出口:
 *  - pulseStatus: 状态指示灯呼吸
 *  - recordPulse: 录音按钮脉冲环
 *  - fadeIn: 通用淡入 (transcript item 入场)
 *  - slideUp: 错误提示从底部滑入
 *  - glowPulse: 焦点光晕呼吸
 *  - orbitSpin: 空状态轨道旋转
 *
 * Author: MiniMax-M3
 */

/* eslint-disable @typescript-eslint/no-magic-numbers */

/**
 * CSS @keyframes 字符串 — 直接注入到 styles.css
 * 避免 framer-motion 等运行时依赖
 */
export const keyframes = {
  pulseStatus: `
@keyframes pulse-status {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50%      { box-shadow: 0 0 0 6px transparent; opacity: 0.5; }
}
`.trim(),

  recordPulse: `
@keyframes record-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 12px rgba(239, 68, 68, 0);
    transform: scale(1.04);
  }
}
`.trim(),

  fadeIn: `
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
`.trim(),

  slideUp: `
@keyframes slide-up {
  from { transform: translateX(-50%) translateY(20px); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
}
`.trim(),

  glowPulse: `
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.48), 0 0 16px rgba(0, 212, 255, 0.24); }
  50%      { box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.72), 0 0 24px rgba(0, 212, 255, 0.48); }
}
`.trim(),

  orbitSpin: `
@keyframes orbit-spin {
  to { transform: rotate(360deg); }
}
`.trim(),

  pulseSoft: `
@keyframes pulse-soft {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}
`.trim(),

  shimmer: `
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`.trim(),
};

/**
 * 公开 API — 与测试契约对齐
 */
export const pulseStatus = keyframes.pulseStatus;
export const recordPulse = keyframes.recordPulse;
export const fadeIn = keyframes.fadeIn;
export const slideUp = keyframes.slideUp;
export const glowPulse = keyframes.glowPulse;
export const orbitSpin = keyframes.orbitSpin;
export const pulseSoft = keyframes.pulseSoft;
export const shimmer = keyframes.shimmer;

/**
 * 合并所有 keyframes (供 styles.css 注入)
 */
export const allKeyframes = Object.values(keyframes).join('\n\n');

export default keyframes;
