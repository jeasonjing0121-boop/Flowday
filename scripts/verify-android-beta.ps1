# FlowDay Android Beta：APK 构建后验证（签名 / 包信息 / 资源完整性 / 无远程依赖）
# 用法：powershell -File scripts\verify-android-beta.ps1
$ErrorActionPreference = 'Stop'
$ROOT = 'F:\DeepSeekHarness\FlowDay'
$SDK = Join-Path $ROOT '.tmp\android-sdk'
$BT = Join-Path $SDK 'build-tools\36.0.0'
$APK = Join-Path $ROOT 'release\android\FlowDay-5.0-a-Beta.2.apk'
$env:JAVA_HOME = 'F:\AndroidSdk-jdk21\jdk-21.0.13+9'
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  $env:JAVA_HOME = (Get-ChildItem 'F:\AndroidSdk-jdk21' -Directory | Select-Object -First 1).FullName
}
$env:TMP = Join-Path $ROOT '.tmp\gradle-tmp'
$env:TEMP = $env:TMP

if (-not (Test-Path $APK)) { throw "APK 不存在: $APK" }

Write-Output "===== 1. 文件与哈希 ====="
$fi = Get-Item $APK
"路径: $($fi.FullName)"
"大小: {0:N2} MB ({1} bytes)" -f ($fi.Length / 1MB), $fi.Length
$sha = (Get-FileHash $APK -Algorithm SHA256).Hash.ToLower()
"SHA-256: $sha"

Write-Output "`n===== 2. 签名验证（apksigner） ====="
& cmd /c "`"$BT\apksigner.bat`" verify --print-certs --verbose `"$APK`" 2>&1" | Out-String -Width 200

Write-Output "`n===== 3. 包信息（aapt2 badging） ====="
$badging = & cmd /c "`"$BT\aapt2.exe`" dump badging `"$APK`" 2>&1"
$badging | Select-String 'package:|sdkVersion|targetSdkVersion|application-label:|launchable-activity|uses-permission' | ForEach-Object { $_.Line }

Write-Output "`n===== 4. APK 内 Web 资源完整性 ====="
$listing = & cmd /c "`"$BT\aapt2.exe`" dump resources `"$APK`" 2>&1" | Out-String -Width 200
# 用 zip 列表核对关键资产
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($APK)
$names = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()
$required = @(
  'assets/public/index.html',
  'assets/capacitor.config.json',
  'assets/public/manifest.webmanifest'
)
foreach ($r in $required) { "present[$r] = $($names -contains $r)" }
$assetCount = ($names | Where-Object { $_ -like 'assets/public/*' }).Count
"assets/public 文件数: $assetCount"
$jsAssets = $names | Where-Object { $_ -like 'assets/public/assets/*.js' }
$cssAssets = $names | Where-Object { $_ -like 'assets/public/assets/*.css' }
"js assets: $($jsAssets -join ', ')"
"css assets: $($cssAssets -join ', ')"

Write-Output "`n===== 5. 远程依赖抽查（index.html 不得引用远程资源） ====="
$entry = $zip = $null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z2 = [System.IO.Compression.ZipFile]::OpenRead($APK)
$e = $z2.GetEntry('assets/public/index.html')
$sr = New-Object System.IO.StreamReader($e.Open())
$html = $sr.ReadToEnd(); $sr.Close(); $z2.Dispose()
$remote = [regex]::Matches($html, '(src|href)="https?://[^"]+"') | ForEach-Object { $_.Value }
if ($remote) { "发现远程引用: $($remote -join ', ')" } else { "index.html 无远程 src/href 引用" }

Write-Output "`n===== 6. 权限清单 ====="
$badging | Select-String 'uses-permission' | ForEach-Object { $_.Line }

Write-Output "`nVERIFY DONE"
