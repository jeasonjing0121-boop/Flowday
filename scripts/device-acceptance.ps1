# FlowDay · B4 真机验收采集助手（只读；不安装/不卸载/不改应用数据）
# 用法示例：
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action info
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action open
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action capture -Name light-01-today
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action record -Name scroll-01-recording -Seconds 15
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action frames
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action brightness -Percent 60
#   powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action restore
param(
  [ValidateSet('info','open','capture','record','frames','brightness','theme','restore','status')]
  [string]$Action = 'status',
  [string]$Name = 'capture',
  [int]$Percent = 60,
  [int]$Seconds = 15,
  [string]$Theme = 'light',
  [string]$Url = 'http://127.0.0.1:5173/today',
  [string]$OutDir = 'docs\phase5.0\phase-b4-device-acceptance'
)

$ErrorActionPreference = 'Continue'
$adb = 'C:\WINDOWS\system32\adb.exe'
if (-not (Test-Path $adb)) { $adb = 'adb' }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Sh([string]$cmd) { (& $adb shell $cmd 2>&1 | Out-String).Trim() }
function DevicePresent {
  $out = (& $adb devices 2>&1 | Out-String)
  return ($out -match "\sdevice\s*$" -or $out -match "\sdevice$")
}

if (-not (DevicePresent)) {
  Write-Output 'NO_DEVICE: 未检测到已授权的 adb 设备。'
  Write-Output '请连接 vivo X200s（V2458A），开启 USB 调试并在手机上允许本机调试。'
  Write-Output ('证据目录（空）: ' + (Resolve-Path $OutDir).Path)
  exit 2
}

switch ($Action) {
  'status' {
    Write-Output '===== 设备 ====='
    & $adb devices -l
  }

  'info' {
    $facts = [ordered]@{
      model          = Sh 'getprop ro.product.model'
      manufacturer   = Sh 'getprop ro.product.manufacturer'
      androidRelease = Sh 'getprop ro.build.version.release'
      apiLevel       = Sh 'getprop ro.build.version.sdk'
      buildId        = Sh 'getprop ro.build.display.id'
      osVersion      = Sh 'getprop ro.vivo.os.version'
      kernel         = Sh 'uname -r'
      securityPatch  = Sh 'getprop ro.build.version.security_patch'
      webview        = Sh 'dumpsys webviewupdate | grep -i "Current WebView package"'
      navigationMode = Sh 'settings get secure navigation_mode'
      fontScale      = Sh 'settings get system font_scale'
      wmSize         = Sh 'wm size'
      wmDensity      = Sh 'wm density'
      brightness     = Sh 'settings get system screen_brightness'
      brightnessMode = Sh 'settings get system screen_brightness_mode'
      installed      = Sh 'pm list packages app.flowday.beta'
      insetsDump     = Sh 'dumpsys window | grep -iE "statusBars|navigationBars|displayCutout|Insets" | head -40'
    }
    $path = Join-Path $OutDir 'device-facts.json'
    $facts | ConvertTo-Json -Depth 4 | Set-Content -Path $path -Encoding utf8
    Write-Output ("设备事实已写入: " + (Resolve-Path $path).Path)
    $facts | ConvertTo-Json -Depth 4
  }

  'open' {
    & $adb reverse tcp:5173 tcp:5173 | Out-Null
    Write-Output ('adb reverse: ' + ((& $adb reverse --list 2>&1 | Out-String).Trim()))
    & $adb shell am start -a android.intent.action.VIEW -d $Url com.android.chrome | Out-Null
    Write-Output ('已在设备 Chrome 打开: ' + $Url)
    Write-Output '提示：浏览器自身 UI 会占位，系统栏适配需 B5 APK 复核。'
  }

  'capture' {
    $file = Join-Path $OutDir ($Name + '.png')
    $tmp = '/sdcard/' + $Name + '.png'
    & $adb shell screencap -p $tmp | Out-Null
    & $adb pull $tmp $file | Out-Null
    & $adb shell rm $tmp | Out-Null
    if (Test-Path $file) { Write-Output ('截图: ' + (Resolve-Path $file).Path + '  ' + (Get-Item $file).Length + ' bytes') }
    else { Write-Output '截图失败（检查设备是否解锁）' }
  }

  'record' {
    $tmp = '/sdcard/' + $Name + '.mp4'
    $file = Join-Path $OutDir ($Name + '.mp4')
    Write-Output ('开始录制 ' + $Seconds + ' 秒，请现在在手机上缓慢上下滚动首页 3 次…')
    & $adb shell screenrecord --bit-rate 8M --time-limit $Seconds $tmp | Out-Null
    & $adb pull $tmp $file | Out-Null
    & $adb shell rm $tmp | Out-Null
    if (Test-Path $file) { Write-Output ('录屏: ' + (Resolve-Path $file).Path + '  ' + [math]::Round((Get-Item $file).Length / 1MB, 2) + ' MB') }
    else { Write-Output '录屏失败（部分机型 screenrecord 不可用，可改用系统录屏）' }
  }

  'frames' {
    $file = Join-Path $OutDir 'frames-chrome.txt'
    & $adb shell dumpsys gfxinfo com.android.chrome framestats 2>&1 | Out-File -FilePath $file -Encoding utf8
    $jank = Select-String -Path $file -Pattern 'Janky frames' | Select-Object -First 3
    Write-Output ('帧统计: ' + (Resolve-Path $file).Path)
    if ($jank) { $jank | ForEach-Object { Write-Output $_.Line.Trim() } } else { Write-Output '未找到 Janky frames 行（Chrome 版本差异）' }
  }

  'brightness' {
    $val = [int]([math]::Round(255 * ($Percent / 100.0)))
    & $adb shell settings put system screen_brightness_mode 0 | Out-Null
    & $adb shell settings put system screen_brightness $val | Out-Null
    Write-Output ('亮度已设为 ' + $Percent + '% (' + $val + '/255)，自动亮度已关闭。采集后请执行 -Action restore')
  }

  'theme' {
    if ($Theme -eq 'dark') {
      Write-Output '请在应用内切换：设置 → 外观 → 深色（或右上角账户菜单 → 切换到深色），等待 1s 后截图。'
    } else {
      Write-Output '请在应用内切换：设置 → 外观 → 浅色（或右上角账户菜单 → 切换到浅色），等待 1s 后截图。'
    }
  }

  'restore' {
    & $adb shell settings put system screen_brightness_mode 1 | Out-Null
    Write-Output '自动亮度已恢复。'
  }
}