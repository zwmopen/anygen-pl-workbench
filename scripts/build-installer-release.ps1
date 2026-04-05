param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $ProjectRoot "release"
}

$portableBuilder = Join-Path $PSScriptRoot "build-portable-release.ps1"
$installerScript = Join-Path $PSScriptRoot "install-anygen-from-package.ps1"
$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$portableZipName = "AnyGen-Workbench-Portable-v{0}.zip" -f $version
$portableZipPath = Join-Path $OutputRoot $portableZipName
$installerName = "AnyGen-Workbench-Installer-v{0}.exe" -f $version
$installerPath = Join-Path $OutputRoot $installerName
$iexpressStage = Join-Path $OutputRoot "_iexpress"
$sedPath = Join-Path $iexpressStage "anygen-installer.sed"

function Write-Step {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Cyan
}

Write-Step "Building portable package..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $portableBuilder -OutputRoot $OutputRoot
if ($LASTEXITCODE -ne 0) {
  throw "Portable package build failed."
}

if (-not (Test-Path $portableZipPath)) {
  throw "Portable zip not found: $portableZipPath"
}

if (-not (Get-Command iexpress.exe -ErrorAction SilentlyContinue)) {
  throw "iexpress.exe was not found on this machine."
}

Write-Step "Preparing installer files..."
if (Test-Path $iexpressStage) {
  Remove-Item -LiteralPath $iexpressStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $iexpressStage | Out-Null
Copy-Item -LiteralPath $portableZipPath -Destination (Join-Path $iexpressStage $portableZipName) -Force
Copy-Item -LiteralPath $installerScript -Destination (Join-Path $iexpressStage "install-anygen-from-package.ps1") -Force

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=AnyGen Workbench installed successfully.
TargetName=$installerPath
FriendlyName=AnyGen Workbench Installer
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-anygen-from-package.ps1 -PackageZip "$portableZipName"
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="install-anygen-from-package.ps1"
FILE1="$portableZipName"
[SourceFiles]
SourceFiles0=$iexpressStage\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@

Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

Write-Step "Packaging Windows installer..."
& iexpress.exe /N $sedPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Installer build failed."
}

if (-not (Test-Path $installerPath)) {
  throw "Installer was not generated: $installerPath"
}

Write-Step "Installer build completed."
Write-Host "Installer: $installerPath" -ForegroundColor Green
