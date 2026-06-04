param(
  [string]$ToolRoot = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
if (-not $ToolRoot) {
  $ToolRoot = Join-Path $Root "tools\android-release"
}

$JdkHome = Join-Path $ToolRoot "jdk-21"
$SdkRoot = Join-Path $ToolRoot "sdk"
$CmdlineRoot = Join-Path $SdkRoot "cmdline-tools\latest"
$Tmp = Join-Path $ToolRoot "tmp"

New-Item -ItemType Directory -Force -Path $ToolRoot, $Tmp | Out-Null

function Download-File($Url, $OutFile) {
  if (Test-Path $OutFile) { return }
  Write-Host "[android-tools] downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Expand-Clean($Zip, $Destination) {
  $extract = Join-Path $Tmp ([IO.Path]::GetFileNameWithoutExtension($Zip))
  if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  Expand-Archive -LiteralPath $Zip -DestinationPath $extract -Force
  if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  $children = Get-ChildItem -LiteralPath $extract
  $source = if ($children.Count -eq 1 -and $children[0].PSIsContainer) { $children[0].FullName } else { $extract }
  Move-Item -LiteralPath $source -Destination $Destination
}

if (-not (Test-Path (Join-Path $JdkHome "bin\java.exe"))) {
  $jdkZip = Join-Path $Tmp "temurin-jdk21.zip"
  Download-File "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" $jdkZip
  Expand-Clean $jdkZip $JdkHome
}

if (-not (Test-Path (Join-Path $CmdlineRoot "bin\sdkmanager.bat"))) {
  $repoXml = (Invoke-WebRequest -Uri "https://dl.google.com/android/repository/repository2-1.xml" -UseBasicParsing).Content
  $packageMatch = [regex]::Match(
    $repoXml,
    '<remotePackage path="cmdline-tools;latest">.*?</remotePackage>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $packageMatch.Success) { throw "Could not resolve Android command-line tools package." }
  $match = [regex]::Match(
    $packageMatch.Value,
    '<url>(commandlinetools-win-[^<]+_latest\.zip)</url>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $match.Success) { throw "Could not resolve latest Android command-line tools URL." }
  $cmdlineZip = Join-Path $Tmp $match.Groups[1].Value
  Download-File ("https://dl.google.com/android/repository/" + $match.Groups[1].Value) $cmdlineZip
  $cmdlineTemp = Join-Path $Tmp "cmdline-tools-expanded"
  if (Test-Path $cmdlineTemp) { Remove-Item -LiteralPath $cmdlineTemp -Recurse -Force }
  Expand-Archive -LiteralPath $cmdlineZip -DestinationPath $cmdlineTemp -Force
  if (Test-Path $CmdlineRoot) { Remove-Item -LiteralPath $CmdlineRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CmdlineRoot) | Out-Null
  Move-Item -LiteralPath (Join-Path $cmdlineTemp "cmdline-tools") -Destination $CmdlineRoot
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$JdkHome\bin;$CmdlineRoot\bin;$SdkRoot\platform-tools;$env:Path"

$sdkManager = Join-Path $CmdlineRoot "bin\sdkmanager.bat"
$yes = ("y`n" * 120)
$yes | & $sdkManager --sdk_root=$SdkRoot --licenses | Out-Host
if ($LASTEXITCODE -ne 0) { throw "sdkmanager license acceptance failed." }

& $sdkManager --sdk_root=$SdkRoot "platform-tools" "platforms;android-36" "build-tools;36.0.0"
if ($LASTEXITCODE -ne 0) { throw "sdkmanager package install failed." }

$localProps = Join-Path $Root "capacitor\android\local.properties"
$sdkForGradle = $SdkRoot.Replace("\", "\\")
"sdk.dir=$sdkForGradle" | Set-Content -LiteralPath $localProps -Encoding ASCII

Write-Host "[android-tools] JAVA_HOME=$JdkHome"
Write-Host "[android-tools] ANDROID_HOME=$SdkRoot"
