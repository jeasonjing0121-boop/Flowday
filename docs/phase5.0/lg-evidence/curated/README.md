# Curated Evidence · Beta.2

本目录是 \docs/phase5.0/lg-evidence/\ 的**精选压缩版**（JPEG q86 / GIF），用于入库与评审。
完整原始证据（200 个文件 / 67.4 MB，含全部 9 视口 × 深浅 × 6 页面）保留在本地同一目录的
\efore/\、\fter/\、\contrast/\ 下，可随时重新生成：

\\\powershell
npm run dev                                   # 另开一个终端
node scripts/lg-capture.mjs after             # 截图 + 溢出 + 滚动帧
node scripts/lg-anim-capture.mjs after        # 交互帧 → Pillow 合成 GIF
node scripts/lg-contrast-capture.mjs          # 对比度探针截图
node scripts/perf-5a.mjs                      # 10k 数据性能
\\\

| 文件 | 内容 |
|---|---|
| before-*.jpg | 修复前（Glassmorphism）桌面/移动/菜单 |
| after-*.jpg | 修复后（Liquid Glass v2）桌面/移动/320/412/菜单/弹窗/设置/项目 |
| nav-to-tasks.gif / menu-open.gif / modal-open.gif / seg-switch.gif | 流体交互动画 |
| ../contrast/contrast-report.json | 42 个文字对比度探针（0 失败，最低 5.03:1） |
| ../after/perf.json | 滚动帧统计（avg 16.52ms / p95 16.7ms / 长帧 0） |
| ../lg-capture-report.json / ../after/lg-capture-report.json | 溢出与材质断言记录 |
