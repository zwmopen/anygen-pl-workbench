param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 4318
$HealthUrl = "http://127.0.0.1:$Port/api/system/health"
$HomeUrl = "http://127.0.0.1:$Port/"
$RuntimeDir = Join-Path $ProjectRoot "data\runtime"
$LogFile = Join-Path $RuntimeDir "server.log"

function Test-Workbench {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $HealthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-WorkbenchProcess {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -like "*server.js*"
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 Node.js，请先安装 Node.js 20+。" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 npm，请先安装 Node.js 自带的 npm。" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "首次启动，正在自动安装依赖..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败，请把报错截图给我。" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

if (-not (Test-Workbench)) {
  Stop-WorkbenchProcess
  if (Test-Path $LogFile) {
    Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
  }
  $NodePath = (Get-Command node).Source
  $ServerProcess = Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile -PassThru

  $started = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($ServerProcess.HasExited) {
      break
    }
    if (Test-Workbench) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Write-Host "服务启动失败，浏览器没有检测到界面。" -ForegroundColor Red
    if (Test-Path $LogFile) {
      Get-Content $LogFile -Tail 30
    }
    exit 1
  }
}

if (-not $NoBrowser) {
  Start-Process $HomeUrl
}

Write-Host "AnyGen 本地工作台已启动：$HomeUrl" -ForegroundColor Green
