param(
  [string]$OutputRoot = "",
  [switch]$SkipRuntimeDownload,
  [switch]$SkipZip
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $ProjectRoot "release"
}

function Write-Step {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  Write-Host $Message -ForegroundColor $Color
}

function Resolve-NodeCommand {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "打包前需要本机安装 Node.js 20 以上版本。"
  }

  return $command.Source
}

function Test-NodeVersion {
  param(
    [string]$NodePath
  )

  & $NodePath -e "const major = Number(process.versions.node.split('.')[0]); process.exit(major >= 20 ? 0 : 1)"
  return $LASTEXITCODE -eq 0
}

function Copy-PathIfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path $Source) {
    Copy-Item -Path $Source -Destination $Destination -Recurse -Force
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$TargetPath
  )

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source --fail --location --silent --show-error --output $TargetPath $Url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $TargetPath)) {
      return
    }
  }

  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $TargetPath
      if (Test-Path $TargetPath) {
        return
      }
    } catch {
      if ($attempt -eq 3) {
        throw
      }
      Start-Sleep -Seconds 2
    }
  }
}

$nodePath = Resolve-NodeCommand
if (-not (Test-NodeVersion -NodePath $nodePath)) {
  throw "当前 Node.js 版本过低，打包便携版需要 20 以上版本。"
}

Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Step "当前项目还没有 node_modules，先安装依赖..."
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    throw "依赖安装失败，无法继续打包。"
  }
}

$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$stageDir = Join-Path $OutputRoot "AnyGen-Workbench-Portable"
$zipPath = Join-Path $OutputRoot ("AnyGen-Workbench-Portable-v{0}.zip" -f $version)

Write-Step "正在准备发布目录..."
New-Item -ItemType Directory -Force $OutputRoot | Out-Null
if (Test-Path $stageDir) {
  Remove-Item $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Force $stageDir | Out-Null

$pathsToCopy = @(
  "public",
  "scripts",
  "src",
  "作品",
  "node_modules",
  "package.json",
  "package-lock.json",
  "README.md",
  "server.js",
  "Start-AnyGen.bat",
  "Start-AnyGen.vbs",
  "一键启动.bat",
  "一键启动.vbs",
  "便携版使用说明.txt"
)

foreach ($relativePath in $pathsToCopy) {
  Copy-PathIfExists -Source (Join-Path $ProjectRoot $relativePath) -Destination (Join-Path $stageDir $relativePath)
}

$stageDataDir = Join-Path $stageDir "data"
New-Item -ItemType Directory -Force $stageDataDir | Out-Null
New-Item -ItemType Directory -Force (Join-Path $stageDataDir "history") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $stageDataDir "runtime") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $stageDataDir "uploads") | Out-Null

if (-not $SkipRuntimeDownload) {
  $nodeVersion = (& $nodePath --version).Trim()
  $nodeArchiveName = "node-$($nodeVersion)-win-x64.zip"
  $runtimeUrl = "https://nodejs.org/dist/$($nodeVersion)/$nodeArchiveName"
  $downloadDir = Join-Path $OutputRoot "_downloads"
  $archivePath = Join-Path $downloadDir $nodeArchiveName
  $runtimeStage = Join-Path $stageDir "runtime"
  $extractRoot = Join-Path $downloadDir ("node-extract-" + [Guid]::NewGuid().ToString("N"))

  Write-Step "正在下载便携运行时：$nodeVersion"
  New-Item -ItemType Directory -Force $downloadDir | Out-Null
  Download-File -Url $runtimeUrl -TargetPath $archivePath

  Write-Step "正在整理便携运行时..."
  New-Item -ItemType Directory -Force $runtimeStage | Out-Null
  New-Item -ItemType Directory -Force $extractRoot | Out-Null
  Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force

  $expandedRoot = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
  if (-not $expandedRoot) {
    throw "Node.js 运行时解压失败。"
  }

  New-Item -ItemType Directory -Force (Join-Path $runtimeStage "node") | Out-Null
  Copy-Item -Path (Join-Path $expandedRoot.FullName "*") -Destination (Join-Path $runtimeStage "node") -Recurse -Force
  Remove-Item $extractRoot -Recurse -Force
} else {
  Write-Step "已跳过运行时下载，发布目录将依赖目标机器已有的 Node.js。" Yellow
}

if (-not $SkipZip) {
  Write-Step "正在生成便携版压缩包..."
  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force
}

if (Test-Path $downloadDir) {
  Remove-Item $downloadDir -Recurse -Force
}

Write-Step "便携版打包完成。" Green
Write-Host "目录：$stageDir" -ForegroundColor Green
if (-not $SkipZip) {
  Write-Host "压缩包：$zipPath" -ForegroundColor Green
}

