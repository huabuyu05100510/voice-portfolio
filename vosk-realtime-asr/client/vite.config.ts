import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Socket.IO 代理 (必须在 /api 前, 否则被 /api 截走)
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
      },
      // API 代理
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Module B: OTel OTLP HTTP 导出器代理 (浏览器端走 /otel/v1/traces, 透传到后端 ingest)
      // 后端未启动时此代理会 502, 浏览器 OTel BatchSpanProcessor 内部有重试/退避, 不影响主流程.
      '/otel': {
        target: 'http://localhost:4318',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/otel/, '/otel'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'framer-motion', 'socket.io-client'],
  },
});