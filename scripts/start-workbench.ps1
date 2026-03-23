param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 4318
$HealthUrl = "http://127.0.0.1:$Port/api/system/health"
$HomeUrl = "http://127.0.0.1:$Port/"
$RuntimeDir = Join-Path $ProjectRoot "data\runtime"
$StdOutLog = Join-Path $RuntimeDir "server.stdout.log"
$StdErrLog = Join-Path $RuntimeDir "server.stderr.log"

function Test-Workbench {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $HealthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Write-Step {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  Write-Host $Message -ForegroundColor $Color
}

function Stop-WorkbenchProcess {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -like "*server.js*"
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Resolve-NodeRuntime {
  $candidates = @(
    (Join-Path $ProjectRoot "runtime\node\node.exe"),
    (Join-Path $ProjectRoot "data\runtime\node\node.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return @{
        NodePath = $candidate
        NodeDir = (Split-Path -Parent $candidate)
        Source = "bundled"
      }
    }
  }

  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    return @{
      NodePath = $systemNode.Source
      NodeDir = (Split-Path -Parent $systemNode.Source)
      Source = "system"
    }
  }

  return $null
}

function Get-NpmCommandPath {
  param(
    [hashtable]$Runtime
  )

  $candidates = @(
    (Join-Path $Runtime.NodeDir "npm.cmd"),
    (Join-Path $Runtime.NodeDir "npm")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $systemNpm = Get-Command npm -ErrorAction SilentlyContinue
  if ($systemNpm) {
    return $systemNpm.Source
  }

  return $null
}

function Test-NodeVersion {
  param(
    [string]$NodePath
  )

  & $NodePath -e "const major = Number(process.versions.node.split('.')[0]); process.exit(major >= 20 ? 0 : 1)"
  return $LASTEXITCODE -eq 0
}

function Show-LauncherFailure {
  param(
    [string]$Message
  )

  Write-Step $Message Red
  Write-Host ""
  Write-Host "排查建议：" -ForegroundColor Yellow
  Write-Host "1. 如果你拿到的是便携版，请先把压缩包完整解压后再双击启动。" -ForegroundColor Yellow
  Write-Host "2. 如果你拿到的是源码版，请先安装 Node.js 20 以上版本。" -ForegroundColor Yellow
  Write-Host "3. 把 data\runtime 目录里的日志发给我，我就能继续排查。" -ForegroundColor Yellow
}

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

$runtime = Resolve-NodeRuntime
if (-not $runtime) {
  Show-LauncherFailure "没有检测到可用的 Node.js 运行时。"
  exit 1
}

if (-not (Test-NodeVersion -NodePath $runtime.NodePath)) {
  Show-LauncherFailure "当前 Node.js 版本过低，需要 20 以上版本。"
  exit 1
}

$npmPath = Get-NpmCommandPath -Runtime $runtime
if (-not $npmPath) {
  Show-LauncherFailure "没有检测到 npm，无法自动安装依赖。"
  exit 1
}

if ($runtime.Source -eq "bundled") {
  Write-Step "检测到内置运行时，正在以便携模式启动..." Green
} else {
  Write-Step "未发现内置运行时，正在使用系统里的 Node.js 启动..." Yellow
}

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Step "首次启动，正在自动安装依赖，请稍等..."
  & $npmPath install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    Show-LauncherFailure "依赖安装失败。"
    exit $LASTEXITCODE
  }
}

Write-Step "正在准备本地配置..."
& $runtime.NodePath "scripts\prepare-config.mjs"
if ($LASTEXITCODE -ne 0) {
  Show-LauncherFailure "本地配置初始化失败。"
  exit $LASTEXITCODE
}

if (-not (Test-Workbench)) {
  Write-Step "正在启动工作台服务..."
  Stop-WorkbenchProcess

  foreach ($logFile in @($StdOutLog, $StdErrLog)) {
    if (Test-Path $logFile) {
      Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    }
  }

  $serverProcess = Start-Process -FilePath $runtime.NodePath -ArgumentList "server.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $StdOutLog -RedirectStandardError $StdErrLog -PassThru

  $started = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($serverProcess.HasExited) {
      break
    }
    if (Test-Workbench) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Show-LauncherFailure "服务启动失败，浏览器没有检测到可访问的界面。"
    if (Test-Path $StdErrLog) {
      Write-Host ""
      Write-Host "最近的错误日志：" -ForegroundColor Yellow
      Get-Content $StdErrLog -Tail 30
    } elseif (Test-Path $StdOutLog) {
      Write-Host ""
      Write-Host "最近的输出日志：" -ForegroundColor Yellow
      Get-Content $StdOutLog -Tail 30
    }
    exit 1
  }
} else {
  Write-Step "检测到工作台已经在运行，直接打开界面。" Green
}

if (-not $NoBrowser) {
  Start-Process $HomeUrl
}

Write-Step "AnyGen 本地工作台已启动：$HomeUrl" Green
Write-Host "日志目录：$RuntimeDir" -ForegroundColor DarkGray

