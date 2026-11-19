# FlowDay B5.1 test APK device verification (9 checks)
# Installs ONLY app.flowday.beta.b5test; never uninstalls or overwrites app.flowday.beta (Beta.2).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-b5test-apk.ps1
param(
  [string]$Apk = 'release\android\b5test\FlowDay-5.0-a-B5test.1.apk',
  [string]$OutDir = 'docs\phase5.0\phase-b5-evidence\b5.1\device'
)
$ErrorActionPreference = 'Continue'
$ROOT = 'F:\DeepSeekHarness\FlowDay'
Set-Location $ROOT
$adb = 'C:\WINDOWS\system32\adb.exe'
$pkgBeta = 'app.flowday.beta'
$pkgTest = 'app.flowday.beta.b5test'
$activity = 'app.flowday.beta.MainActivity'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$logPath = Join-Path $OutDir 'device-verify.log'
if (Test-Path $logPath) { Remove-Item $logPath -Force }

function Log([string]$m) {
  $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m
  Write-Output $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}
function Sh([string]$cmd) { ((& $adb shell $cmd 2>&1) | Out-String).Trim() }
function OneLine([string]$s) { return (($s -replace '\s+', ' ').Trim()) }
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/b5v.png 2>&1 | Out-Null
  & $adb pull /sdcard/b5v.png (Join-Path $OutDir $name) 2>&1 | Out-Null
  & $adb shell rm /sdcard/b5v.png 2>&1 | Out-Null
  Log ('screenshot: ' + $name)
}

# ---------- 0. device ----------
$dev = ((& $adb devices 2>&1) | Out-String)
if ($dev -notmatch '\sdevice\s*$') { Log 'NO_DEVICE: 未检测到已授权设备。APK 已构建，真机未验证。'; exit 2 }
Log ('device: ' + (OneLine $dev))

# ---------- 1. hash ----------
$apkPath = Join-Path $ROOT $Apk
if (-not (Test-Path $apkPath)) { Log ('APK missing: ' + $apkPath); exit 1 }
$hash = (Get-FileHash $apkPath -Algorithm SHA256).Hash.ToLower()
$shaTxt = Get-Content (Join-Path (Split-Path $apkPath -Parent) 'SHA256.txt') -Raw
$hashOk = $shaTxt -match [regex]::Escape($hash)
Log ('CHECK1 sha256=' + $hash + ' matchManifest=' + $hashOk)
if (-not $hashOk) { Log 'CHECK1 FAIL - hash mismatch'; exit 1 }

# ---------- 2. Beta.2 baseline (read only) ----------
$betaPathBefore = Sh ('pm path ' + $pkgBeta)
$betaVerBefore = Sh ('dumpsys package ' + $pkgBeta + ' | grep -E "versionCode|versionName|dataDir"')
Log ('CHECK3 beta.2 before path=' + (OneLine $betaPathBefore))
Log ('CHECK3 beta.2 before ver=' + (OneLine $betaVerBefore))

# ---------- 3. install test package ----------
Log 'installing test package (install -r; different package from Beta.2)'
$install = ((& $adb install -r $apkPath 2>&1) | Out-String).Trim()
Log ('CHECK2 install=' + (OneLine $install))
$installOk = $install -match 'Success'
Log ('CHECK2 install-success=' + $installOk)
if (-not $installOk) { Log 'CHECK2 FAIL'; exit 1 }

# ---------- 4. Beta.2 unchanged + coexistence ----------
$betaPathAfter = Sh ('pm path ' + $pkgBeta)
$betaVerAfter = Sh ('dumpsys package ' + $pkgBeta + ' | grep -E "versionCode|versionName|dataDir"')
$betaSame = ($betaPathBefore -eq $betaPathAfter) -and ($betaVerBefore -eq $betaVerAfter)
Log ('CHECK3 beta.2 unchanged=' + $betaSame)
Log ('CHECK3 beta.2 after ver=' + (OneLine $betaVerAfter))
$pkgs = Sh 'pm list packages'
$hasBeta = $pkgs -match ('package:' + [regex]::Escape($pkgBeta) + '(\s|$|' + [char]13 + ')')
$hasTest = $pkgs -match ('package:' + [regex]::Escape($pkgTest))
Log ('CHECK4 coexistence beta=' + $hasBeta + ' test=' + $hasTest)
$testInfo = Sh ('dumpsys package ' + $pkgTest + ' | grep -E "versionCode|versionName|dataDir|debuggable"')
Log ('CHECK4 test package=' + (OneLine $testInfo))

# ---------- 5. launch ----------
Log 'launching test app'
& $adb shell am start -W -n ($pkgTest + '/' + $activity) 2>&1 | Out-Null
Start-Sleep -Seconds 6
$fg = Sh 'dumpsys activity activities | grep -m1 topResumedActivity'
Log ('CHECK5 foreground=' + (OneLine $fg))
Shot 'b5test-01-launch.png'

# ---------- 6. Capacitor bridge / file access ----------
$logcat = ((& $adb logcat -d -v brief 2>&1) | Out-String)
$capLines = ($logcat -split "[`r`n]+") | Select-String -Pattern 'Capacitor|FlowDayNative' | Select-Object -Last 12
foreach ($l in $capLines) { Log ('CHECK6 logcat: ' + $l.Line.Trim()) }
$runAs = Sh ('run-as ' + $pkgTest + ' ls -R . | head -60')
Log ('CHECK6 app-data=' + (OneLine $runAs))
$providers = Sh ('dumpsys package ' + $pkgTest + ' | grep -A1 -E "authorities" | head -12')
Log ('CHECK6 providers=' + (OneLine $providers))
Shot 'b5test-02-main.png'

# ---------- 7. light / dark ----------
$nightBefore = Sh 'cmd uimode night'
Log ('CHECK7 night-before=' + (OneLine $nightBefore))
Sh 'cmd uimode night no' | Out-Null
& $adb shell am force-stop $pkgTest 2>&1 | Out-Null
Start-Sleep -Milliseconds 800
& $adb shell am start -W -n ($pkgTest + '/' + $activity) 2>&1 | Out-Null
Start-Sleep -Seconds 5
Shot 'b5test-03-light.png'
Sh 'cmd uimode night yes' | Out-Null
& $adb shell am force-stop $pkgTest 2>&1 | Out-Null
Start-Sleep -Milliseconds 800
& $adb shell am start -W -n ($pkgTest + '/' + $activity) 2>&1 | Out-Null
Start-Sleep -Seconds 5
Shot 'b5test-04-dark.png'
if ($nightBefore -match 'yes') { Sh 'cmd uimode night yes' | Out-Null } else { Sh 'cmd uimode night no' | Out-Null }
Log ('CHECK7 night-restored=' + (OneLine (Sh 'cmd uimode night')))

# ---------- 8. layout / nav evidence ----------
$refLight = Join-Path $ROOT 'docs\phase5.0\phase-b4-device-acceptance\light-01-today.png'
if ((Test-Path $refLight) -and (Test-Path (Join-Path $OutDir 'b5test-03-light.png'))) {
  Log 'CHECK8 reference light found; compare with B4 device screenshot (informational only)'
}
Shot 'b5test-05-nav-region.png'

# ---------- 9. crash / abnormal ----------
$crash = ((& $adb logcat -d -b crash -v brief 2>&1) | Out-String)
$crashHits = ($crash -split "[`r`n]+") | Select-String -Pattern 'app\.flowday\.beta\.b5test|FATAL EXCEPTION' | Select-Object -First 10
if ($crashHits) { foreach ($l in $crashHits) { Log ('CHECK9 crash: ' + $l.Line.Trim()) } } else { Log 'CHECK9 crash: none in crash buffer' }
$anr = Sh 'dumpsys activity activities | grep -iE "ANR|not responding" | head -5'
Log ('CHECK9 anr=' + (OneLine $anr))
$proc = Sh ('pidof ' + $pkgTest)
Log ('CHECK9 test-pid=' + (OneLine $proc))

Log 'B5.1 DEVICE VERIFY DONE'