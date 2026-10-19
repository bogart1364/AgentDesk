# Generates the colored folder icons (.icons/*.ico) and per-folder desktop.ini,
# then flags the folders so Explorer picks them up. Windows-only cosmetic helper;
# .icons/ and desktop.ini are gitignored (Explorer folder colors do not travel in git).
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools/setup/folder-icons.ps1
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$icons = Join-Path $Root '.icons'
New-Item -ItemType Directory -Force -Path $icons | Out-Null

# folder -> @(letter, hex color)
$map = [ordered]@{
  ''          = @('A', '#0F172A')   # repo root
  'api'       = @('A', '#EA580C')
  'contracts' = @('C', '#2563EB')
  'server'    = @('S', '#059669')
  'web'       = @('W', '#7C3AED')
  'docs'      = @('D', '#0891B2')
  'examples'  = @('E', '#CA8A04')
  'tools'     = @('T', '#475569')
}

function New-IcoFile {
  param([string]$Letter, [string]$Hex, [string]$Out)

  $size = 64
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  $col = [System.Drawing.ColorTranslator]::FromHtml($Hex)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 14
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
  $path.AddArc(0, $size - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($col)), $path)

  $font = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $g.DrawString($Letter, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $fmt)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $bmp.Dispose(); $ms.Dispose()

  # ICO container with one PNG-compressed 64x64 entry (Vista+)
  $fs = [System.IO.File]::Create($Out)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
  $bw.Write([Byte]64); $bw.Write([Byte]64); $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
  $bw.Write($png)
  $bw.Close(); $fs.Close()
}

foreach ($folder in $map.Keys) {
  $letter = $map[$folder][0]
  $hex = $map[$folder][1]
  $name = if ($folder) { $folder } else { 'root' }
  $ico = Join-Path $icons "$name.ico"
  New-IcoFile -Letter $letter -Hex $hex -Out $ico

  $dir = if ($folder) { Join-Path $Root $folder } else { $Root }
  $ini = Join-Path $dir 'desktop.ini'
  $rel = if ($folder) { '..\.icons\' + $name + '.ico' } else { '.icons\' + $name + '.ico' }
  [System.IO.File]::WriteAllText($ini, "[.ShellClassInfo]`r`nIconResource=$rel,0`r`n", (New-Object System.Text.UTF8Encoding($false)))

  & attrib +h +s $ini
  & attrib +r $dir
  Write-Output "icon set: $name ($letter $hex) -> $dir"
}
Write-Output 'done - reopen Explorer (F5) to see the colored folders'
