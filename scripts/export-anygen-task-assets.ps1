param(
  [Parameter(Mandatory = $true)]
  [string]$TaskUrl,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BaseName,

  [int]$OpenWaitSeconds = 25
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$BrowserCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$AttachmentPattern = '\.(zip|md|markdown|png|jpg|jpeg|webp|gif|bmp|doc|docx|ppt|pptx)$'

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$SavedFiles = New-Object System.Collections.Generic.List[string]

function Get-BrowserPath {
  foreach ($candidate in $BrowserCandidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Browser not found."
}

function Get-MainWindow {
  $edge = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*AnyGen*" } | Select-Object -First 1
  if ($edge) {
    return $edge
  }

  return Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*AnyGen*" } | Select-Object -First 1
}

function Wait-MainWindow {
  param([int]$TimeoutSeconds = 25)

  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt += 1) {
    $window = Get-MainWindow
    if ($window) {
      return $window
    }
    Start-Sleep -Seconds 1
  }

  throw "AnyGen browser window not found."
}

function Get-RootElement {
  param([object]$Window)

  return [System.Windows.Automation.AutomationElement]::FromHandle($Window.MainWindowHandle)
}

function Get-DocumentElement {
  param([object]$Root)

  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )

  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Wait-DocumentReady {
  param(
    [object]$Root,
    [int]$TimeoutSeconds = 25
  )

  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt += 1) {
    $document = Get-DocumentElement -Root $Root
    if ($document) {
      try {
        $textPattern = $document.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $raw = $textPattern.DocumentRange.GetText(-1)
        if ($raw -and $raw.Length -gt 200) {
          return $document
        }
      } catch {
        # Keep waiting until the page is ready.
      }
    }
    Start-Sleep -Seconds 1
  }

  throw "AnyGen task page did not finish loading."
}

function Get-ControlElements {
  param([object]$Root)

  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsControlElementProperty,
    $true
  )

  return $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Invoke-Element {
  param([object]$Element)

  $invoke = $Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
}

function Find-ClickableAncestor {
  param([object]$Element)

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $current = $Element

  for ($depth = 0; $depth -lt 6 -and $current; $depth += 1) {
    try {
      $current.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) | Out-Null
      return $current
    } catch {
      $current = $walker.GetParent($current)
    }
  }

  return $null
}

function Find-AttachmentEntries {
  param([object]$Root)

  $all = Get-ControlElements -Root $Root
  $entries = New-Object System.Collections.Generic.List[object]
  $seen = New-Object System.Collections.Generic.HashSet[string]

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)
    if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Text) {
      continue
    }

    $name = ([string]$element.Current.Name).Trim()
    if (-not $name -or $name -notmatch $AttachmentPattern) {
      continue
    }

    $rect = $element.Current.BoundingRectangle
    if ($rect.Top -lt 320 -or $rect.Left -gt 800) {
      continue
    }

    if ($seen.Contains($name)) {
      continue
    }

    $clickable = Find-ClickableAncestor -Element $element
    if (-not $clickable) {
      continue
    }

    $entries.Add([PSCustomObject]@{
      Name = $name
      Element = $clickable
    })
    $seen.Add($name) | Out-Null
  }

  return $entries.ToArray()
}

function Find-TopDownloadButton {
  param([object]$Root)

  $all = Get-ControlElements -Root $Root
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)
    if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) {
      continue
    }

    $rect = $element.Current.BoundingRectangle
    if ($rect.Top -lt 140 -or $rect.Top -gt 300 -or $rect.Left -lt 1200 -or $rect.Width -gt 90 -or $rect.Height -gt 90) {
      continue
    }

    $candidates += $element
  }

  $ordered = @($candidates | Sort-Object { $_.Current.BoundingRectangle.Left })
  if ($ordered.Count -ge 3) {
    return $ordered[1]
  }
  if ($ordered.Count -ge 1) {
    return $ordered[-1]
  }

  return $null
}

function Get-FileNameRegex {
  param([string]$FileName)

  $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
  $extension = [System.IO.Path]::GetExtension($FileName)
  return '^' + [Regex]::Escape($base) + '( \(\d+\))?' + [Regex]::Escape($extension) + '$'
}

function Wait-DownloadedFile {
  param(
    [string]$DownloadDirectory,
    [string]$FileName,
    [string[]]$ExistingFullNames,
    [datetime]$StartedAt,
    [int]$TimeoutSeconds = 90
  )

  $pattern = Get-FileNameRegex -FileName $FileName
  $existing = New-Object System.Collections.Generic.HashSet[string]
  foreach ($fullName in $ExistingFullNames) {
    $existing.Add($fullName) | Out-Null
  }

  for ($attempt = 0; $attempt -lt $TimeoutSeconds * 2; $attempt += 1) {
    $items = Get-ChildItem -Path $DownloadDirectory -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match $pattern
    }

    foreach ($item in ($items | Sort-Object LastWriteTime -Descending)) {
      if ($existing.Contains($item.FullName)) {
        continue
      }
      if ($item.LastWriteTime -lt $StartedAt) {
        continue
      }

      try {
        $stream = [System.IO.File]::Open($item.FullName, "Open", "Read", "None")
        $stream.Close()
        return $item.FullName
      } catch {
        # Keep waiting until the browser releases the file handle.
      }
    }

    Start-Sleep -Milliseconds 500
  }

  return $null
}

function Get-UniqueOutputPath {
  param(
    [string]$Directory,
    [string]$FileName
  )

  $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
  $extension = [System.IO.Path]::GetExtension($FileName)
  $candidate = Join-Path $Directory $FileName
  $counter = 1

  while (Test-Path $candidate) {
    $candidate = Join-Path $Directory ("{0}-{1}{2}" -f $base, $counter, $extension)
    $counter += 1
  }

  return $candidate
}

function Move-DownloadedFile {
  param(
    [string]$SourcePath,
    [string]$OutputDirectory
  )

  $extension = [System.IO.Path]::GetExtension($SourcePath).ToLowerInvariant()
  $sequence = $SavedFiles.Count + 1
  $targetName = "{0}-attachment-{1:00}{2}" -f $BaseName, $sequence, $extension
  $targetPath = Get-UniqueOutputPath -Directory $OutputDirectory -FileName $targetName

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      Move-Item -LiteralPath $SourcePath -Destination $targetPath -Force
      $SavedFiles.Add($targetPath)
      return $targetPath
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "Downloaded file is still locked: $SourcePath"
}

function Download-Attachment {
  param(
    [object]$Root,
    [string]$DownloadDirectory,
    [pscustomobject]$Entry
  )

  Invoke-Element -Element $Entry.Element
  Start-Sleep -Milliseconds 600

  $downloadButton = Find-TopDownloadButton -Root $Root
  if (-not $downloadButton) {
    return $null
  }

  $before = @(Get-ChildItem -Path $DownloadDirectory -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $startedAt = Get-Date
  Invoke-Element -Element $downloadButton

  $downloadedPath = Wait-DownloadedFile -DownloadDirectory $DownloadDirectory -FileName $Entry.Name -ExistingFullNames $before -StartedAt $startedAt -TimeoutSeconds 90
  if (-not $downloadedPath) {
    return $null
  }

  return Move-DownloadedFile -SourcePath $downloadedPath -OutputDirectory $OutputDirectory
}

function Close-Window {
  param([object]$Window)

  try {
    $null = $Window.CloseMainWindow()
  } catch {
    # Ignore cleanup errors.
  }
}

$window = $null
$result = @{
  savedFiles = @()
  error = $null
}

try {
  $browserPath = Get-BrowserPath
  & $browserPath "--app=$TaskUrl" | Out-Null

  $window = Wait-MainWindow -TimeoutSeconds $OpenWaitSeconds
  $shell = New-Object -ComObject WScript.Shell
  $shell.AppActivate($window.Id) | Out-Null
  Start-Sleep -Milliseconds 800

  $root = Get-RootElement -Window $window
  $null = Wait-DocumentReady -Root $root -TimeoutSeconds $OpenWaitSeconds
  $downloadDirectory = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
  $attachments = Find-AttachmentEntries -Root $root

  if ($attachments.Count -gt 0) {
    $preferredAttachments = @($attachments | Where-Object { $_.Name -match '\.zip$' })
    if ($preferredAttachments.Count -eq 0) {
      $preferredAttachments = $attachments
    }

    foreach ($entry in $preferredAttachments) {
      $downloaded = Download-Attachment -Root $root -DownloadDirectory $downloadDirectory -Entry $entry
      if ($downloaded -and $entry.Name -match '\.zip$') {
        break
      }
    }
  }
} catch {
  $result.error = $_.Exception.Message
} finally {
  if ($window) {
    Close-Window -Window $window
  }
}

$result.savedFiles = @($SavedFiles)
$result | ConvertTo-Json -Depth 4
