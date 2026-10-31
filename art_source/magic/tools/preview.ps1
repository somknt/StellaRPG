# 切り出した画像を暗い背景に並べた確認用の1枚（art_source/magic/preview.png）。赤い十字＝基準点
$root = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
$fx = Resolve-Path (Join-Path $root '..\..\js_version\assets\effects')
$meta = Get-Content (Join-Path $root 'meta.txt') -Encoding UTF8
$rows = @()
foreach ($m in $meta) {
    if ($m -match '^(\w+): \{ n: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+)') {
        $rows += [pscustomobject]@{ name = $matches[1]; n = [int]$matches[2]; w = [int]$matches[3]; h = [int]$matches[4]; ax = [int]$matches[5]; ay = [int]$matches[6] }
    }
}
$scale = 0.75
$W = 1500; $H = 0
foreach ($r in $rows) { $H += [int]($r.h * $scale) + 26 }
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 40, 44, 52))
$g.InterpolationMode = 'NearestNeighbor'
$font = New-Object System.Drawing.Font 'Consolas', 11
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Red), 1
$box = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), 1
$y = 0
foreach ($r in $rows) {
    $g.DrawString("$($r.name)  $($r.w)x$($r.h)", $font, [System.Drawing.Brushes]::White, 4, $y + 2)
    $x = 4; $yy = $y + 22
    for ($k = 1; $k -le $r.n; $k++) {
        $p = if ($r.name -eq 'circle') { Join-Path $fx ("magic_circle_" + @('fire','water','wind','earth','thunder')[$k-1] + ".png") }
             elseif ($r.name -like 'circle_*') { Join-Path $fx ("magic_circle_" + $r.name.Substring(7) + ".png") }  # circle_heal → magic_circle_heal.png
             else { Join-Path $fx "magic\$($r.name)_$k.png" }
        $img = [System.Drawing.Image]::FromFile($p)
        $dw = [int]($img.Width * $scale); $dh = [int]($img.Height * $scale)
        $g.DrawRectangle($box, $x, $yy, $dw, $dh)
        $g.DrawImage($img, $x, $yy, $dw, $dh)
        $cx = $x + $r.ax * $scale; $cy = $yy + $r.ay * $scale
        $g.DrawLine($pen, $cx - 6, $cy, $cx + 6, $cy); $g.DrawLine($pen, $cx, $cy - 6, $cx, $cy + 6)
        $img.Dispose()
        $x += $dw + 14
    }
    $y = $yy + [int]($r.h * $scale) + 4
}
$bmp.Save((Join-Path $root 'preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"preview $W x $H"
