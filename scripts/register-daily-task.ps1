param(
  [string]$TaskName = "AnyGen Workbench Daily",
  [string]$Time = "09:00"
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodePath = (Get-Command node).Source
$Command = "cmd /c cd /d `"$ProjectRoot`" && `"$NodePath`" server.js --run-scheduled"

schtasks.exe /Create /TN $TaskName /SC DAILY /ST $Time /TR $Command /F
