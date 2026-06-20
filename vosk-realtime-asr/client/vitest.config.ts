import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    // 必须给 jsdom 一个 URL, 否则 localStorage / matchMedia 不可用
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000/',
      },
    },
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});