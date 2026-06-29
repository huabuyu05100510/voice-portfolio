/**
 * AppShell — AccessibilityProvider 装配
 * 从 App.tsx 抽出来, 让 App 只剩 hooks 编排 + 渲染
 *
 * Task 13.1: ErrorBoundary 在最外层包裹, 捕获整棵 React 树的渲染错误
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import { AccessibilityProvider } from './AccessibilityContext';
import { App } from './App';
import ErrorBoundary from './observability/ErrorBoundary';

const AppShell: React.FC = () => {
  return (
    <ErrorBoundary>
      <AccessibilityProvider>
        <App />
      </AccessibilityProvider>
    </ErrorBoundary>
  );
};

export default AppShell;
