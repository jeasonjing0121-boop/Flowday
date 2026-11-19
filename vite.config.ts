import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // 测试/缓存产物不参与 watch，避免大量浏览器 profile 文件拖慢 dev server
    watch: { ignored: ['**/.tmp/**', '**/.npm-cache/**', '**/dist/**', '**/.git/**'] },
  },
});
