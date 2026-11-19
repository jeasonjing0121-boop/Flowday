import { defineConfig } from 'vite';

/** 仅用于打包逻辑冒烟测试（不引入测试框架、不产生网络请求）。 */
export default defineConfig({
  logLevel: 'silent',
  build: {
    ssr: 'src/tests/smoke.test.ts',
    outDir: '.tmp/smoke',
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: 'esm', entryFileNames: 'smoke.mjs' } },
  },
});
