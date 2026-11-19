# B4 真机验收 · 证据位与当前状态

> 目录：`docs/phase5.0/phase-b4-device-acceptance/`
> 状态图例：`⏳ 待采集（需设备）` · `✅ 已就绪（模拟参考）`

## 已就绪（模拟参考，非真机）

| 文件 | 说明 |
|---|---|
| ✅ `DEVICE-ACCEPTANCE-CHECKLIST.md` | **9 项**观感判据 + 打勾表 + 记录模板 |
| ✅ `CAPTURE-PROCEDURE.md` | 采集流程（脚本/手工/亮度/录屏/帧率/字体） |
| ✅ `reference-size-matrix.png` | 320/360/390/412 四档尺寸 × 浅/深 拼图（headless 模拟，DPR=1） |
| ✅ `reference-sizes/*.png` | 上述 8 张原图 |
| ✅ `../../../scripts/device-acceptance.ps1` | 真机采集助手（info/open/capture/record/frames/brightness/restore） |

## 待采集（设备接入后执行）

| 文件 | 对应验收项 | 采集命令 |
|---|---|---|
| ⏳ `device-facts.json` | 设备事实 | `device-acceptance.ps1 -Action info` |
| ⏳ `light-01-today.png` | ① | `-Action capture -Name light-01-today` |
| ⏳ `light-02-tabbar-closeup.png` | ①④ | 截图后裁切放大 2× |
| ⏳ `light-03-header-closeup.png` | ① | 同上 |
| ⏳ `dark-01-today.png` | ② | `-Action capture -Name dark-01-today` |
| ⏳ `dark-02-tabbar-closeup.png` | ②④ | 裁切 |
| ⏳ `dark-03-modal.png` | ②⑤ | 打开弹窗后截图 |
| ⏳ `scroll-01-recording.mp4` | ③ | `-Action record -Name scroll-01-recording -Seconds 15` |
| ⏳ `scroll-02-frame-a.png` / `scroll-03-frame-b.png` | ③ | 录屏首尾帧导出 |
| ⏳ `frames-chrome.txt` | ③ 帧率 | `-Action frames` |
| ⏳ `material-01-modal.png` / `material-02-card.png` / `material-03-buttons.png` | ⑤ | 逐项截图 |
| ⏳ `press-01-active.png` / `press-02-released.png` | ⑥ | 按住/松开截图 |
| ⏳ `brightness-{20,60,100}-{light,dark}.png` | ⑧ | `-Action brightness -Percent N` + 截图 |
| ⏳ `size-*.png`（含横屏、字体 130/150%） | ⑨ | 逐项截图 |
| ⏳ `system-01..04-*.png` | ⑦ | **需 B5 构建 APK 后** |

## 采集完成后

1. 按 `DEVICE-ACCEPTANCE-CHECKLIST.md` §3 逐项打勾；
2. 把结果与 `docs/phase5.0/phase-b4-evidence/` 里的模拟参考并排比对；
3. 若出现与模拟不一致之处，**只记录不修改代码**，作为 B5 调参依据。

## 采集纪律

- 不改动应用数据（脚本不触碰 IndexedDB），不安装/卸载任何应用；
- 采集结束执行 `-Action restore` 恢复自动亮度；
- 字体缩放测试后务必恢复 `font_scale 1.0`；
- 所有操作只读设备，不涉及代码仓库。


---

## 采集结果（2026-11-19 18:24–18:36 · vivo X200s）

- 设备事实：✅ `device-facts.json`（API 37 / WebView 157.0.8103.38 / 手势导航 / 360dp / Insets 42dp·18dp·35.7dp）
- 浅色：✅ `light-00/01/02/03/05/06-*.png` + 近景
- 深色：✅ `dark-00/01/02/03-*.png` + 近景
- 滚动：✅ `scroll-01-recording.mp4`（13.86MB）+ `scroll-frame-0..4.png` + `frames-chrome.txt`
- 按压：⚠️ 合成触摸无效 → `press-01-recording.mp4`（人工逐帧看）
- 亮度：⚠️ screencap 不含背光 → 三张字节相同，需人工目视
- 尺寸：✅ 320/360/390/412dp + 横屏；字体缩放 ⏳ 待 APK
- 系统栏：⏳ 待 B5 APK（真实 Insets 已记录）
