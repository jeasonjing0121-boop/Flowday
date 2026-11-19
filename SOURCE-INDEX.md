# FlowDay 源码包索引

- 打包时间：2026-11-19 23:20:33（Asia/Shanghai）
- 代码基线（HEAD）：`1aa24f0a2e0fa83b1f12b4a602d05627f61cd212`（分支 `phase5.0-b5`）
- B4 验收冻结 SHA：`5339589f0577fa0fd0a70476fa19ead7001fe27a`（`phase5.0-a`）
- `src/` 与 B4 验收版**完全一致**；B5 分支代码类改动仅限 Android 构建隔离配置（+10 行）与构建/验证脚本。

## 快速开始
```powershell
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # 逻辑测试（369 项）
npm run build    # 类型检查 + 生产构建
```

Android（需 JDK21 + Android SDK）：
```powershell
$env:JAVA_HOME='F:\AndroidSdk-jdk21\jdk-21.0.13+9'
$env:ANDROID_HOME='<repo>\.tmp\android-sdk'
$env:GRADLE_USER_HOME='<repo>\.tmp\gradle-home'
powershell -File scripts\build-android-beta.ps1     # 正式 Beta（需签名配置）
powershell -File scripts\build-android-b5test.ps1   # B5 隔离测试包（debug 签名）
```

## 包含 / 不包含
包含：`src/`、`android/`（含 res 资源与原生 Insets 代码）、`scripts/`、`tools/`、`public/`、配置、`docs/` 文本报告。
不包含：`node_modules/`、`.tmp/`、`.git/`、`.secrets/` 与签名密钥、APK、`docs/` 证据媒体（另见文档证据包）。
