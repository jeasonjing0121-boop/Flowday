import type { CapacitorConfig } from '@capacitor/cli';

/**
 * FlowDay Beta（Android）Capacitor 配置。
 *
 * 关键约束（Phase 5.0-a Android Beta）：
 * - Web 资源随 APK 打包（webDir=dist），不依赖任何远程网页服务器
 * - 独立 Beta 应用身份，与未来正式版隔离
 * - 不引入额外 Capacitor 插件（最小集成）
 */
const config: CapacitorConfig = {
  appId: 'app.flowday.beta',
  appName: 'FlowDay Beta',
  webDir: 'dist',
  // 资源从本地 asset 服务器加载（https://localhost），禁止远程 URL
  server: {
    androidScheme: 'https',
    allowNavigation: [],
  },
  android: {
    allowMixedContent: false,
    // 保持 WebView 内 IndexedDB / localStorage 持久化（默认即持久）
    preferences: {
      // 深色模式跟随系统由应用内 CSS 处理，不强制 WebView 暗色
      preferredContentMode: 'mobile',
    },
  },
  backgroundColor: '#FAF7F2',
};

export default config;
