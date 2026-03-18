param(
  [string]$Url = "https://www.anygen.io/task/GcnSpH4QOaDEmrgPBtclIgRRgyc"
)

$ErrorActionPreference = "Stop"
$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$Edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$Browser = if (Test-Path $Chrome) { $Chrome } else { $Edge }
$OutDir = "D:\AICode\anygen-pL\data\runtime"
$DomFile = Join-Path $OutDir "captured-task-dom.html"
$ErrFile = Join-Path $OutDir "captured-task-err.txt"

New-Item -ItemType Directory -Force $OutDir | Out-Null
if (Test-Path $DomFile) { Remove-Item $DomFile -Force }
if (Test-Path $ErrFile) { Remove-Item $ErrFile -Force }

$proc = Start-Process -FilePath $Browser `
  -ArgumentList "--headless=new","--disable-gpu","--no-sandbox","--virtual-time-budget=15000","--dump-dom",$Url `
  -RedirectStandardOutput $DomFile `
  -RedirectStandardError $ErrFile `
  -PassThru

$proc.WaitForExit()
Write-Output "exit=$($proc.ExitCode)"
Write-Output "dom=$(Test-Path $DomFile)"
Write-Output "err=$(Test-Path $ErrFile)"
