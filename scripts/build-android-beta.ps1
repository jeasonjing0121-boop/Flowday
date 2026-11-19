# FlowDay Android Beta build orchestration (Phase 5.0-a)
# Usage: powershell -File scripts\build-android-beta.ps1
$ErrorActionPreference = 'Stop'
$ROOT = 'F:\DeepSeekHarness\FlowDay'
Set-Location $ROOT

$env:JAVA_HOME = 'F:\AndroidSdk-jdk21\jdk-21.0.13+9'
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  $env:JAVA_HOME = (Get-ChildItem 'F:\AndroidSdk-jdk21' -Directory | Select-Object -First 1).FullName
}
$env:ANDROID_HOME = 'F:\DeepSeekHarness\FlowDay\.tmp\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-home'
$env:FLOWDAY_SIGNING_PROPS = 'F:\AndroidSdk-keystore\signing.properties'
if (-not (Test-Path 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-tmp')) {
  New-Item -ItemType Directory -Path 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-tmp' -Force | Out-Null
}
$env:TMP = 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-tmp'
$env:TEMP = 'F:\DeepSeekHarness\FlowDay\.tmp\gradle-tmp'

function Step([string]$name) { Write-Output "" ; Write-Output "===== $name =====" }

Step '0. build metadata'
$env:FLOWDAY_VERSION_NAME = '5.0-a-beta.2'
$env:FLOWDAY_VERSION_CODE = '2'
$env:FLOWDAY_CHANNEL = 'beta'
node scripts/gen-build-info.mjs
if ($LASTEXITCODE -ne 0) { throw 'gen-build-info failed' }

Step '1. web production build'
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }

Step '2. capacitor sync'
npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }

Step '3. gradle assembleRelease'
cmd /c "cd /d $ROOT\android && gradlew.bat assembleRelease --no-daemon --console=plain -Dorg.gradle.internal.repository.max.retries=12 -Dorg.gradle.internal.repository.initial.retry.wait=3000 -Dorg.gradle.internal.http.connectionTimeout=120000 -Dorg.gradle.internal.http.socketTimeout=120000 > $ROOT\.tmp\gradle-build.log 2>&1"
if ($LASTEXITCODE -ne 0) {
  Get-Content "$ROOT\.tmp\gradle-build.log" -Tail 40
  throw 'gradle assembleRelease failed'
}
Get-Content "$ROOT\.tmp\gradle-build.log" -Tail 12

Step '4. collect artifact'
$apkSrc = Join-Path $ROOT 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apkSrc)) { throw "APK not found: $apkSrc" }
New-Item -ItemType Directory -Force -Path (Join-Path $ROOT 'release\android') | Out-Null
$apkDst = Join-Path $ROOT 'release\android\FlowDay-5.0-a-Beta.2.apk'
Copy-Item $apkSrc $apkDst -Force
"APK: $apkDst"
"{0:N2} MB" -f ((Get-Item $apkDst).Length / 1MB)
"SHA256: $((Get-FileHash $apkDst -Algorithm SHA256).Hash.ToLower())"
Write-Output 'BUILD-ANDROID-BETA DONE'