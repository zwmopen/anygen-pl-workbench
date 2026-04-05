param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $ProjectRoot "assets"
}

$pngPath = Join-Path $OutputDirectory "AnyGen-Workbench.png"
$icoPath = Join-Path $OutputDirectory "AnyGen-Workbench.ico"

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Write-PngIconToIco {
  param(
    [string]$PngPath,
    [string]$IcoPath
  )

  $pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
  $stream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
  try {
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngBytes.Length)
    $writer.Write([UInt32]22)
    $writer.Write($pngBytes)
    $writer.Flush()
  } finally {
    $stream.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

try {
  $shadowPath = New-RoundedRectPath -X 28 -Y 30 -Width 200 -Height 200 -Radius 52
  $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 123, 61, 36))
  $graphics.FillPath($shadowBrush, $shadowPath)

  $bgPath = New-RoundedRectPath -X 28 -Y 24 -Width 200 -Height 200 -Radius 52
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    [System.Drawing.Point]::new(36, 28),
    [System.Drawing.Point]::new(220, 224),
    [System.Drawing.ColorTranslator]::FromHtml("#FF9A62"),
    [System.Drawing.ColorTranslator]::FromHtml("#D66357")
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Positions = [single[]](0.0, 0.55, 1.0)
  $blend.Colors = [System.Drawing.Color[]]@(
    [System.Drawing.ColorTranslator]::FromHtml("#FF9A62"),
    [System.Drawing.ColorTranslator]::FromHtml("#EF835D"),
    [System.Drawing.ColorTranslator]::FromHtml("#D66357")
  )
  $bgBrush.InterpolationColors = $blend
  $graphics.FillPath($bgBrush, $bgPath)

  $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(56, 46, 107, 120))
  $graphics.FillEllipse($accentBrush, 142, 142, 92, 92)

  $softBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 255, 255, 255))
  $graphics.FillEllipse($softBrush, 54, 44, 36, 36)

  $bubblePath = New-RoundedRectPath -X 78 -Y 66 -Width 100 -Height 92 -Radius 18
  $bubbleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    [System.Drawing.Point]::new(78, 66),
    [System.Drawing.Point]::new(178, 158),
    [System.Drawing.Color]::White,
    [System.Drawing.ColorTranslator]::FromHtml("#FFF3EC")
  )
  $graphics.FillPath($bubbleBrush, $bubblePath)

  $tailPoints = [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(110, 158),
    [System.Drawing.Point]::new(110, 178),
    [System.Drawing.Point]::new(132, 158)
  )
  $graphics.FillPolygon($bubbleBrush, $tailPoints)

  $lineBrushA = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    [System.Drawing.Point]::new(92, 104),
    [System.Drawing.Point]::new(162, 118),
    [System.Drawing.ColorTranslator]::FromHtml("#EF835D"),
    [System.Drawing.ColorTranslator]::FromHtml("#FFB47C")
  )
  $lineBrushB = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    [System.Drawing.Point]::new(92, 132),
    [System.Drawing.Point]::new(146, 144),
    [System.Drawing.ColorTranslator]::FromHtml("#4A8B99"),
    [System.Drawing.ColorTranslator]::FromHtml("#71B4B3")
  )
  $graphics.FillPath($lineBrushA, (New-RoundedRectPath -X 92 -Y 104 -Width 70 -Height 14 -Radius 7))
  $graphics.FillPath($lineBrushB, (New-RoundedRectPath -X 92 -Y 132 -Width 54 -Height 12 -Radius 6))

  $sparkleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#FFF8EC"))
  $sparkle = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(188, 76),
    [System.Drawing.PointF]::new(193.6, 89.4),
    [System.Drawing.PointF]::new(207, 95),
    [System.Drawing.PointF]::new(193.6, 100.6),
    [System.Drawing.PointF]::new(188, 114),
    [System.Drawing.PointF]::new(182.4, 100.6),
    [System.Drawing.PointF]::new(169, 95),
    [System.Drawing.PointF]::new(182.4, 89.4)
  )
  $graphics.FillPolygon($sparkleBrush, $sparkle)

  $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-PngIconToIco -PngPath $pngPath -IcoPath $icoPath
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Host "Generated icon assets:" -ForegroundColor Green
Write-Host $pngPath -ForegroundColor Green
Write-Host $icoPath -ForegroundColor Green
