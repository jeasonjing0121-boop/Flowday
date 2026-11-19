# Phase 5.0-B · 真机参数与 Insets 探测（只读，不构建、不修改）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\device-probe.ps1 [-Serial <serial>]
# 说明：本脚本只通过 adb 读取设备事实（API Level / WebView 版本 / 导航模式 / 字体缩放 /
#       Insets / 屏幕参数），并可选抓取一张截图。不安装、不卸载、不构建任何 APK。
$ErrorActionPreference = 'Continue'
$adb = 'C:\WINDOWS\system32\adb.exe'
if (-not (Test-Path $adb)) { $adb = 'adb' }

$serialArg = @()
if ($args -contains '-Serial') {
  $idx = [Array]::IndexOf($args, '-Serial')
  if ($idx -ge 0 -and $args.Count -gt $idx + 1) { $serialArg = @('-s', $args[$idx + 1]) }
}

function Sh([string]$cmd) {
  $out = & $adb @serialArg shell $cmd 2>&1 | Out-String
  return $out.Trim()
}

$devices = (& $adb devices 2>&1 | Select-String -Pattern 'device$') -join ''
if (-not $devices) {
  Write-Output 'NO_DEVICE: 未检测到已授权的 adb 设备。'
  Write-Output '请确认：USB 调试已开启、已在手机上点“允许”、`adb devices` 显示 device。'
  Write-Output '（本机 B2 阶段即处于该状态，故真机参数全部标注为“未读取”，未做任何推断。）'
  exit 2
}

$report = [ordered]@{}
$report.serial = (Sh 'getprop ro.serialno')
$report.model = (Sh 'getprop ro.product.model')            # 例：V2458A
$report.manufacturer = (Sh 'getprop ro.product.manufacturer')
$report.brand = (Sh 'getprop ro.product.brand')
$report.androidRelease = (Sh 'getprop ro.build.version.release')
$report.apiLevel = (Sh 'getprop ro.build.version.sdk')      # 真实 API Level（不按系统版本字符串推断）
$report.buildId = (Sh 'getprop ro.build.display.id')
$report.softwareVersion = (Sh 'getprop ro.vivo.os.version'); if (-not $report.softwareVersion) { $report.softwareVersion = (Sh 'getprop ro.build.version.incremental') }
$report.kernel = (Sh 'uname -r')
$report.securityPatch = (Sh 'getprop ro.build.version.security_patch')
$report.webviewPackage = (Sh 'dumpsys webviewupdate | Select-String -Pattern "Current WebView package"')
$report.navigationMode = (Sh 'settings get secure navigation_mode')   # 0=三键 1/2=手势
$report.fontScale = (Sh 'settings get system font_scale')
$report.displaySize = (Sh 'settings get system display_size')
$report.wmSize = (Sh 'wm size')
$report.wmDensity = (Sh 'wm density')
$report.packageInstalled = (Sh 'pm list packages app.flowday.beta')
$report.insetsDump = (& $adb @serialArg shell dumpsys window 2>&1 | Select-String -Pattern 'Insets|insets|statusBars|navigationBars|displayCutout' | Select-Object -First 40 | Out-String)

$outDir = Join-Path (Get-Location) 'docs\phase5.0\phase-b2-evidence\device'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$jsonPath = Join-Path $outDir 'device-probe.json'
$report | ConvertTo-Json -Depth 3 | Set-Content -Path $jsonPath -Encoding utf8
Write-Output ("设备参数已写入: {0}" -f $jsonPath)
$report | ConvertTo-Json -Depth 3

$shot = Join-Path $outDir 'device-screenshot.png'
$serialText = ($serialArg -join ' ')
$cmdLine = ('"{0}" {1} exec-out screencap -p > "{2}"' -f $adb, $serialText, $shot).Trim()
& cmd /c $cmdLine 2>$null
if (Test-Path $shot) { Write-Output ("Screenshot: {0} ({1} bytes)" -f $shot, (Get-Item $shot).Length) }
