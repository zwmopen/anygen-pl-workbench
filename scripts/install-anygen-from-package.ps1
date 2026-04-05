param(
  [Parameter(Mandatory = $true)]
  [string]$PackageZip,

  [string]$InstallRoot = "",

  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\AnyGen Workbench"
}

$PackageZip = (Resolve-Path $PackageZip).Path
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("anygen-install-" + [Guid]::NewGuid().ToString("N"))
$backupRoot = $null
$installParent = Split-Path -Parent $InstallRoot
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "AnyGen Workbench.lnk"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\AnyGen Workbench"
$startShortcut = Join-Path $startMenuDir "AnyGen Workbench.lnk"
$dataShortcut = Join-Path $startMenuDir "Open Data Folder.lnk"
$targetScript = Join-Path $InstallRoot "Start-AnyGen.vbs"
$dataDirectory = Join-Path $InstallRoot "data"

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$Arguments = "",
    [string]$WorkingDirectory = ""
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  if ($Arguments) {
    $shortcut.Arguments = $Arguments
  }
  if ($WorkingDirectory) {
    $shortcut.WorkingDirectory = $WorkingDirectory
  }
  $shortcut.Save()
}

try {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $installParent | Out-Null

  if (Test-Path $InstallRoot) {
    $backupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("anygen-install-backup-" + [Guid]::NewGuid().ToString("N"))
    Move-Item -LiteralPath $InstallRoot -Destination $backupRoot
  }

  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Expand-Archive -LiteralPath $PackageZip -DestinationPath $InstallRoot -Force

  if ($backupRoot -and (Test-Path (Join-Path $backupRoot "data"))) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath (Join-Path $backupRoot "data") -Destination $dataDirectory -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
  New-Shortcut -ShortcutPath $desktopShortcut -TargetPath $targetScript -WorkingDirectory $InstallRoot
  New-Shortcut -ShortcutPath $startShortcut -TargetPath $targetScript -WorkingDirectory $InstallRoot
  New-Shortcut -ShortcutPath $dataShortcut -TargetPath "explorer.exe" -Arguments ('"{0}"' -f $dataDirectory) -WorkingDirectory $InstallRoot

  if (-not $NoLaunch) {
    Start-Process -FilePath $targetScript -WorkingDirectory $InstallRoot
  }

  Write-Host "AnyGen Workbench installed successfully." -ForegroundColor Green
  Write-Host "Install location: $InstallRoot" -ForegroundColor Green
} finally {
  if ($backupRoot -and (Test-Path $backupRoot)) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
