$ErrorActionPreference = "SilentlyContinue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$HealthUrl = "http://127.0.0.1:4318/api/system/health"
$HomeUrl = "http://127.0.0.1:4318/"
$LogFile = Join-Path $ProjectRoot "data\runtime\server.log"

for ($i = 0; $i -lt 60; $i++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $HealthUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Start-Process $HomeUrl
      Write-Host "界面已打开：" $HomeUrl
      exit 0
    }
  } catch {
  }
  Start-Sleep -Seconds 1
}

Write-Host "等待界面启动超时。" -ForegroundColor Red
if (Test-Path $LogFile) {
  Write-Host "下面是最近日志：" -ForegroundColor Yellow
  Get-Content $LogFile -Tail 40
} else {
  Write-Host "没有找到日志文件：" $LogFile -ForegroundColor Yellow
}

exit 1
