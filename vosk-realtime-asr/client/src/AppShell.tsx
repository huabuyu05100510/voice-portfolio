/**
 * AppShell — AccessibilityProvider 装配
 * 从 App.tsx 抽出来, 让 App 只剩 hooks 编排 + 渲染
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import { AccessibilityProvider } from './AccessibilityContext';
import { App } from './App';

const AppShell: React.FC = () => {
  return (
    <AccessibilityProvider>
      <App />
    </AccessibilityProvider>
  );
};

export default AppShell;
