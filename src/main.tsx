import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerPwa } from './lib/pwa/register';
import { installLiquidGlass } from './lib/liquidGlass';
import { installInsets } from './lib/insets';
import './styles.css';
import './styles.liquid-glass.css';
import './styles.liquid-glass.v3.css';

// Phase 5.0-a D4：仅生产构建注册 Service Worker（dev 下不注册，避免干扰既有 E2E）
registerPwa();
// B2：安全区/视口度量单一真源（原生可拉取 + 重载/回前台重发；Web 回退 env()）
installInsets();
// Liquid Glass 运行时：环境采样 / 光学标尺 / 主题外观同步
installLiquidGlass();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
