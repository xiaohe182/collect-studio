Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $PSScriptRoot 'app.ico'
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = 'AntiAlias'
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $shape.AddArc(8, 8, 64, 64, 180, 90)
  $shape.AddArc(184, 8, 64, 64, 270, 90)
  $shape.AddArc(184, 184, 64, 64, 0, 90)
  $shape.AddArc(8, 184, 64, 64, 90, 90)
  $shape.CloseFigure()
  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#1A73E8'))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $light = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#8AB4F8'))
  $graphics.FillPath($blue, $shape)
  $graphics.FillRectangle($white, 54, 57, 148, 22)
  $graphics.FillRectangle($light, 54, 99, 22, 22)
  $graphics.FillRectangle($white, 94, 99, 108, 22)
  $graphics.FillRectangle($light, 54, 141, 22, 22)
  $graphics.FillRectangle($white, 94, 141, 64, 22)
  $graphics.FillRectangle($white, 174, 143, 16, 43)
  $arrow = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(156,179),[System.Drawing.PointF]::new(208,179),[System.Drawing.PointF]::new(182,207))
  $graphics.FillPolygon($white, $arrow)
  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += ,@{ Size=$size; Bytes=$stream.ToArray() }
  if ($size -eq 256) { $bitmap.Save((Join-Path $PSScriptRoot 'app.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $shape.Dispose(); $blue.Dispose(); $white.Dispose(); $light.Dispose()
}
$file = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
  $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
