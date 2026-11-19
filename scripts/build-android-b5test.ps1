# FlowDay B5.1 test APK build (isolated: app.flowday.beta.b5test, debug signing)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-android-b5test.ps1
$ErrorActionPreference = 'Stop'
$ROOT = 'F:\DeepSeekHarness\FlowDay'
Set-Location $ROOT
$LOG = Join-Path $ROOT '.tmp\b5test-build.log'

function Log([string]$m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Write-Output $line; Add-Content -Path $LOG -Value $line -Encoding utf8 }
function Fail([string]$m) { Log "FAILED: $m"; exit 1 }

if (Test-Path $LOG) { Remove-Item $LOG -Force }

Log 'B5.1 test build start'
$env:JAVA_HOME = 'F:\AndroidSdk-jdk21\jdk-21.0.13+9'
$env:ANDROID_HOME = 'F:\DeepSeekHarness\FlowDay\.tmp\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-home'
$env:TMP = 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-tmp'
$env:TEMP = $env:TMP
if (-not (Test-Path $env:TMP)) { New-Item -ItemType Directory -Force -Path $env:TMP | Out-Null }

$env:FLOWDAY_B5TEST = '1'
$env:FLOWDAY_VERSION_NAME = '5.0-a-b5test.1'
$env:FLOWDAY_VERSION_CODE = '101'
$env:FLOWDAY_CHANNEL = 'beta'
# 明确不使用发布签名
Remove-Item Env:\FLOWDAY_SIGNING_PROPS -ErrorAction SilentlyContinue

Log "JAVA_HOME=$env:JAVA_HOME"
Log "ANDROID_HOME=$env:ANDROID_HOME"
Log "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
Log "FLOWDAY_B5TEST=$env:FLOWDAY_B5TEST FLOWDAY_VERSION_NAME=$env:FLOWDAY_VERSION_NAME"

# 0) Gradle wrapper 离线启动验证
Push-Location (Join-Path $ROOT 'android')
$gv = (& .\gradlew.bat --version --offline --no-daemon 2>&1 | Out-String)
Pop-Location
if ($gv -notmatch 'Gradle 8\.14\.3') { Log $gv; Fail 'gradle wrapper offline startup failed' }
Log 'gradle wrapper offline startup OK (8.14.3)'

# 1) build metadata
node scripts/gen-build-info.mjs 2>&1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) { Fail 'gen-build-info failed' }

# 2) web production build
Log 'npm run build'
npm.cmd run build 2>&1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) { Fail 'web build failed' }

# 3) capacitor sync
Log 'npx cap sync android'
npx.cmd cap sync android 2>&1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) { Fail 'cap sync failed' }

# 4) gradle assembleDebug (offline first)
Log 'gradlew assembleDebug --offline'
$gradleLog = Join-Path $ROOT '.tmp\b5test-gradle.log'
cmd /c "cd /d $ROOT\android && gradlew.bat assembleDebug --offline --no-daemon --console=plain > `"$gradleLog`" 2>&1"
$gcode = $LASTEXITCODE
Get-Content $gradleLog -Tail 25 | ForEach-Object { Log "  $_" }
if ($gcode -ne 0) {
  Log 'offline build failed; collecting missing-dependency evidence (no network download attempted)'
  Copy-Item $gradleLog (Join-Path $ROOT '.tmp\b5test-gradle-offline-failure.log') -Force
  Select-String -Path $gradleLog -Pattern 'Could not resolve|No cached version|offline mode|FAILURE' | Select-Object -First 20 | ForEach-Object { Log ("  MISSING? " + $_.Line.Trim()) }
  Fail 'gradle offline assembleDebug failed'
}
Log 'gradle assembleDebug OK'

# 5) collect artifact
$apkSrc = Join-Path $ROOT 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apkSrc)) { Fail "APK not found: $apkSrc" }
$outDir = Join-Path $ROOT 'release\android\b5test'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$apkDst = Join-Path $outDir 'FlowDay-5.0-a-B5test.1.apk'
Copy-Item $apkSrc $apkDst -Force
$hash = (Get-FileHash $apkDst -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $apkDst).Length
Log "APK: $apkDst"
Log ("size: {0:N2} MB ({1} bytes)" -f ($size/1MB), $size)
Log "sha256: $hash"

# 6) static audit
$bt = Join-Path $ROOT '.tmp\android-sdk\build-tools\36.0.0'
$aapt = Join-Path $bt 'aapt2.exe'
$badging = (& $aapt dump badging $apkDst 2>&1 | Out-String)
$badging | Set-Content (Join-Path $ROOT '.tmp\b5test-badging.txt') -Encoding utf8
$pkgLine = ($badging -split "`n" | Select-String '^package:').Line
$verLine = ($badging -split "`n" | Select-String '^versionCode') -join ''
Log "badging: $pkgLine"
$signer = (& (Join-Path $bt 'apksigner.bat') verify --print-certs $apkDst 2>&1 | Out-String)
$signer | Set-Content (Join-Path $ROOT '.tmp\b5test-certs.txt') -Encoding utf8
($signer -split "`n" | Select-String 'certificate DN|certificate SHA-256') | ForEach-Object { Log ("  " + $_.Line.Trim()) }
Log 'B5.1 TEST BUILD DONE'