# 星の酒場（マルチプレイのロビー）の素材を作る
#   tavern_overview.png   ：ChatGPT「星灯りのマルチプレイヤー酒場」（全体図。ゲームの背景にそのまま使う）
#   tavern_parts_sheet.png：ChatGPT「星降る酒場のタイルセット」（光の粒・魔法陣の光など）
#   bartender_sheet.png   ：ChatGPT「熟練バーテンダーのドリンク調製スプライトシート」（酒場のマスター。市松模様の背景は消す）
# 使い方：art_source/tavern で  powershell -ExecutionPolicy Bypass -File tools/cut.ps1
# 出力：js_version/assets/tiles/tavern/tv_*.png（全体図だけ tv_overview.jpg）、tools/boxes.txt（マスターのコマの場所）、tools/preview.png（確認用）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bfTools = Join-Path $PSScriptRoot '..\..\battlefield\tools'
Add-Type -Path (Join-Path $bfTools 'Img.cs'), (Join-Path $PSScriptRoot 'Tavern.cs') -ReferencedAssemblies System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root '..\..\js_version\assets\tiles\tavern'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$out = (Resolve-Path $out).Path

# ---------- 全体図：前のマスター（白い髪の子）を消す。左どなりの棚の絵で上から塗る（新しいマスターはゲームが描く）----------
$ov = [Img]::Load((Join-Path $root 'tavern_overview.png'))
[Tavern]::CopyRect($ov, 582, 246, 643, 246, 64, 66)
$jpgEnc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]92)
$tmp = Join-Path $env:TEMP 'tv_overview_tmp.png'
$ov.Save($tmp)
$bmp = [System.Drawing.Image]::FromFile($tmp)
$bmp.Save((Join-Path $out 'tv_overview.jpg'), $jpgEnc, $ep)
$bmp.Dispose()
Remove-Item $tmp

# ---------- マスター：市松模様を消して、コマごとに切り出す ----------
$bt = [Img]::Load((Join-Path $root 'bartender_sheet.png'))
[Tavern]::KeyChecker($bt, 200, 30)
$boxes = $bt.Boxes(128, 4, 6000) | Sort-Object { [Math]::Floor($_[1] / 300) }, { $_[0] }
$lines = @()
$n = 0
foreach ($b in $boxes) {
    $x, $y, $w, $h = $b
    # 名前の札（左はしの紺色の四角）はマスターではないので、tv_plate として1つだけ残す
    if ($x -lt 270) {
        if (-not (Test-Path (Join-Path $out 'tv_plate.png'))) { $bt.Crop($x, $y, $w, $h, 1, 2, $true).Save((Join-Path $out 'tv_plate.png')) }
        $lines += "plate $x $y $w $h"
        continue
    }
    $n++
    $img = $bt.Crop($x, $y, $w, $h, 1, 2, $true)
    $img.Save((Join-Path $out "tv_master_$n.png"))
    $lines += "tv_master_$n $x $y $w $h -> $($img.W)x$($img.H)"
}
$lines -join "`n" | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'boxes.txt')
Write-Host "マスターのコマ $n 枚"

# ---------- 素材シートの部品（光の粒・魔法陣の光） ----------
$sheet = [Img]::Load((Join-Path $root 'tavern_parts_sheet.png'))
$parts = @(
    @('tv_spark_gold',  598, 905, 68, 80),
    @('tv_spark_blue',  528, 925, 50, 60),
    @('tv_spark_pink',  690, 925, 70, 60),
    @('tv_ring',        785, 905, 130, 90),
    @('tv_glow_purple', 1395, 875, 140, 130),
    @('tv_beam_gold',   1325, 875, 30, 120)
)
foreach ($p in $parts) {
    $name, $x, $y, $w, $h = $p
    $sheet.Crop($x, $y, $w, $h, 8, 120, $true).Save((Join-Path $out "$name.png"))
}

# ---------- 確認用：全体図（マスターを消した物）の上に、マスターの1コマ目をゲームと同じ大きさで重ねる ----------
$m1 = [Img]::Load((Join-Path $out 'tv_master_1.png'))
$k = 0.2667   # ゲームの拡大率（ワールド 0.5333）÷ 全体図の拡大率 2
[Tavern]::Paste($ov, $m1, [int](675 - $m1.W * $k / 2), [int](318 - $m1.H * $k), $k)
$ov.Crop(540, 180, 300, 200, 0, 1, $false).Save((Join-Path $PSScriptRoot 'preview.png'))
Get-Content (Join-Path $PSScriptRoot 'boxes.txt')
