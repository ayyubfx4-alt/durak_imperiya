param(
  [string]$VersionName = "",
  [int]$VersionCode = 0,
  [switch]$StrictStoreRelease
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ToolRoot = Join-Path $Root "tools\android-release"
$JdkHome = Join-Path $ToolRoot "jdk-21"
$SdkRoot = Join-Path $ToolRoot "sdk"
$CmdlineRoot = Join-Path $SdkRoot "cmdline-tools\latest"
$AndroidRoot = Join-Path $Root "capacitor\android"
$SigningFile = Join-Path $AndroidRoot "release-signing.properties"
$KeystoreFile = Join-Path $AndroidRoot "release.keystore"
$StrictReleaseRequested = $StrictStoreRelease -or $env:STRICT_STORE_RELEASE -eq "1"

$EnvSigningProvided = @(
  $env:ANDROID_KEYSTORE_BASE64,
  $env:ANDROID_KEYSTORE_PASSWORD,
  $env:ANDROID_KEY_ALIAS,
  $env:ANDROID_KEY_PASSWORD
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

if ($EnvSigningProvided.Count -gt 0) {
  if ($EnvSigningProvided.Count -ne 4) {
    throw "Android signing env is incomplete. Set ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD together."
  }
  try {
    [IO.File]::WriteAllBytes($KeystoreFile, [Convert]::FromBase64String($env:ANDROID_KEYSTORE_BASE64))
  } catch {
    throw "ANDROID_KEYSTORE_BASE64 is not valid base64."
  }
  @(
    "storeFile=release.keystore",
    "storePassword=$env:ANDROID_KEYSTORE_PASSWORD",
    "keyAlias=$env:ANDROID_KEY_ALIAS",
    "keyPassword=$env:ANDROID_KEY_PASSWORD"
  ) | Set-Content -LiteralPath $SigningFile -Encoding ASCII
  Write-Host "[android-build] release signing loaded from ANDROID_* environment variables."
}

if (($StrictReleaseRequested) -and (-not (Test-Path $SigningFile) -or -not (Test-Path $KeystoreFile))) {
  throw "Strict store release requires a real release keystore. Provide capacitor/android/release.keystore + release-signing.properties, or set ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD."
}

if (-not (Test-Path (Join-Path $JdkHome "bin\java.exe")) -or -not (Test-Path (Join-Path $CmdlineRoot "bin\sdkmanager.bat"))) {
  & (Join-Path $PSScriptRoot "setup-android-release-tools.ps1")
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$JdkHome\bin;$CmdlineRoot\bin;$SdkRoot\platform-tools;$env:Path"

if (-not (Test-Path $SigningFile) -or -not (Test-Path $KeystoreFile)) {
  $bytes = New-Object byte[] 24
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
  $keytool = Join-Path $JdkHome "bin\keytool.exe"
  & $keytool -genkeypair `
    -v `
    -storetype PKCS12 `
    -keystore $KeystoreFile `
    -alias durak `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $password `
    -keypass $password `
    -dname "CN=Durak Imperia, OU=Game, O=Durak Imperia, L=Tashkent, ST=Tashkent, C=UZ"
  if ($LASTEXITCODE -ne 0) { throw "keytool failed to create release keystore." }

  @(
    "storeFile=release.keystore",
    "storePassword=$password",
    "keyAlias=durak",
    "keyPassword=$password"
  ) | Set-Content -LiteralPath $SigningFile -Encoding ASCII
  Write-Host "[android-build] created release keystore and signing properties."
}

if ($VersionCode -gt 0) { $env:ANDROID_VERSION_CODE = [string]$VersionCode }
if ($VersionName) { $env:ANDROID_VERSION_NAME = $VersionName }
if ($StrictReleaseRequested) { $env:STRICT_STORE_RELEASE = "1" }

$ApiBase = $env:DURAK_API_BASE
if (-not $ApiBase) { $ApiBase = $env:PUBLIC_APP_URL }
if (-not $ApiBase) { $ApiBase = "" }
$ApiBase = ([string]$ApiBase).Trim().TrimEnd("/")
if ($StrictReleaseRequested) {
  if (-not $ApiBase.StartsWith("https://")) {
    throw "Strict store release requires DURAK_API_BASE or PUBLIC_APP_URL to be a real HTTPS production URL."
  }
  if (-not $env:ADMOB_ANDROID_APP_ID -or $env:ADMOB_ANDROID_APP_ID.Contains("3940256099942544")) {
    throw "Strict store release requires a real ADMOB_ANDROID_APP_ID."
  }
  if (-not $env:ADMOB_REWARDED_ANDROID_ID -or $env:ADMOB_REWARDED_ANDROID_ID.Contains("3940256099942544")) {
    throw "Strict store release requires a real ADMOB_REWARDED_ANDROID_ID."
  }
}

$NativeConfig = Join-Path $Root "web-client\public\native-config.js"
$RuntimeConfig = Join-Path $Root "web-client\public\runtime-config.js"
$ApiBaseJson = ConvertTo-Json $ApiBase -Compress
$NodeEnv = $env:NODE_ENV
if (-not $NodeEnv) { $NodeEnv = "production" }
$AdmobAndroidAppId = $env:ADMOB_ANDROID_APP_ID
if (-not $AdmobAndroidAppId) { $AdmobAndroidAppId = "" }
$AdmobRewardedAndroidId = $env:ADMOB_REWARDED_ANDROID_ID
if (-not $AdmobRewardedAndroidId) { $AdmobRewardedAndroidId = "" }
$AdmobIosAppId = $env:ADMOB_IOS_APP_ID
if (-not $AdmobIosAppId) { $AdmobIosAppId = "" }
$AdmobRewardedIosId = $env:ADMOB_REWARDED_IOS_ID
if (-not $AdmobRewardedIosId) { $AdmobRewardedIosId = "" }
$AppEnvJson = ConvertTo-Json $NodeEnv -Compress
$AdmobAndroidAppIdJson = ConvertTo-Json $AdmobAndroidAppId -Compress
$AdmobRewardedAndroidIdJson = ConvertTo-Json $AdmobRewardedAndroidId -Compress
$AdmobIosAppIdJson = ConvertTo-Json $AdmobIosAppId -Compress
$AdmobRewardedIosIdJson = ConvertTo-Json $AdmobRewardedIosId -Compress
@(
  "// Auto-generated by scripts/build-android-release.ps1.",
  "// Set DURAK_API_BASE or PUBLIC_APP_URL before building a store release.",
  "window.__DURAK_API_BASE__ = $ApiBaseJson;"
) | Set-Content -LiteralPath $NativeConfig -Encoding ASCII
@(
  "// Auto-generated by scripts/build-android-release.ps1.",
  "window.__APP_ENV__ = $AppEnvJson;",
  "window.__PUBLIC_APP_URL__ = $ApiBaseJson;",
  "window.__ADMOB_ANDROID_APP_ID__ = $AdmobAndroidAppIdJson;",
  "window.__ADMOB_REWARDED_ANDROID_ID__ = $AdmobRewardedAndroidIdJson;",
  "window.__ADMOB_IOS_APP_ID__ = $AdmobIosAppIdJson;",
  "window.__ADMOB_REWARDED_IOS_ID__ = $AdmobRewardedIosIdJson;",
  "window.__ADMOB_REWARDED_ID__ = window.__ADMOB_REWARDED_ANDROID_ID__ || '';",
  "window.__ADMOB_SSV_CALLBACK_URL__ = (window.__PUBLIC_APP_URL__ || '') + '/api/admob/ssv';"
) | Set-Content -LiteralPath $RuntimeConfig -Encoding ASCII

Push-Location (Join-Path $Root "capacitor")
try {
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }
} finally {
  Pop-Location
}

Push-Location $AndroidRoot
try {
  & .\gradlew.bat --stop | Out-Host
  & .\gradlew.bat bundleRelease
  if ($LASTEXITCODE -ne 0) { throw "Gradle bundleRelease failed." }
} finally {
  Pop-Location
}

$aab = Join-Path $AndroidRoot "app\build\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $aab)) { throw "AAB file was not created." }
Write-Host "[android-build] AAB ready: $aab"
