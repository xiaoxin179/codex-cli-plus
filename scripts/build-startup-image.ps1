$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskBitmap = New-Object System.Drawing.Bitmap(440, 280)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#171d27'))
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$taskIcon = [System.Drawing.Image]::FromFile((Join-Path $taskRoot 'assets\icon.png'))
$taskGraphics.DrawImage($taskIcon, 188, 33, 64, 64)
$taskFormat = New-Object System.Drawing.StringFormat
$taskFormat.Alignment = [System.Drawing.StringAlignment]::Center
$taskFonts = @()
$taskBrushes = @()
function Draw-StartupText($text, $size, $color, $y) {
  $taskFont = New-Object System.Drawing.Font('Microsoft YaHei UI', $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $taskBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color))
  $taskGraphics.DrawString($text, $taskFont, $taskBrush, [System.Drawing.RectangleF]::new(0, $y, 440, 36), $taskFormat)
  $taskFont.Dispose(); $taskBrush.Dispose()
}
Draw-StartupText 'Codex CLI Plus' 23 '#edf1f8' 112
Draw-StartupText '正在准备你的工作台' 13 '#a1afc2' 151
$taskTrack = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#303846'))
$taskAccent = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#a4eed3'))
$taskGraphics.FillRectangle($taskTrack, 116, 194, 208, 4)
$taskGraphics.FillRectangle($taskAccent, 116, 194, 64, 4)
Draw-StartupText '正在启动…' 11 '#8090a5' 209
$taskBitmap.Save((Join-Path $taskRoot 'assets\startup.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$taskTrack.Dispose(); $taskAccent.Dispose(); $taskFormat.Dispose(); $taskIcon.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
