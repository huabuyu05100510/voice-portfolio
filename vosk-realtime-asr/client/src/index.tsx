/**
 * 入口文件
 */

// Module B: OpenTelemetry 初始化 (副作用 import — 在 React 挂载前完成 SDK 注册)
// dev 默认开启, prod 默认关闭, TraceToggle UI 可运行时切换.
import './observability/otel';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);