# アプリのアイコンを作る：icon_source.png（ChatGPT「星降る王国への旅」）から
#   js_version/favicon.ico                    ：ブラウザのタブ・ブックマーク（16・32・48・256px。角丸の外は透明）
#   js_version/assets/icon/icon-192.png, 512  ：manifest.webmanifest のアイコン（角丸の外は透明）
#   js_version/assets/icon/icon-maskable-512.png：Android のホーム画面（透明な所なし。角は端末が丸める）
#   js_version/assets/icon/apple-touch-icon.png：iPhone・iPad のホーム画面（180px。透明な所なし）
# 使い方：art_source/icon で  powershell -ExecutionPolicy Bypass -File tools/make_icons.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'Icon.cs') -ReferencedAssemblies System.Drawing
$src = Join-Path $root 'icon_source.png'
$game = Resolve-Path (Join-Path $root '..\..\js_version')
$out = Join-Path $game 'assets\icon'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# 角丸の四角：ふちの白い線の外側が x 61〜1191, y 55〜1189（icon_source.png で測った値）。背景の紺は (18, 32, 78)
# 色のちがい 420 以上を白い線とみなし、140〜420 の所をなめらかなふちにする
# 角の丸みは半径 270px くらいなので、四隅は 300px 四方までたどる
$bg = [System.Drawing.Color]::FromArgb(18, 32, 78)
$outside = 0
$round = [IconMaker]::Rounded($src, $bg, 61, 55, 1191, 1189, 420, 140, 300, [ref]$outside)
Write-Host "角丸の外（透明にした画素）: $outside"
# 線にすき間があって絵の中までたどってしまうと、この数が大きくなる（ふつうは 35 万くらい）
if ($outside -gt 380000) { throw "角丸の外が多すぎます（白い線にすき間があるかもしれません）: $outside" }

[IconMaker]::SaveIco($round, @(16, 32, 48, 256), (Join-Path $game 'favicon.ico'))
foreach ($s in 192, 512) {
    $b = [IconMaker]::Resize($round, $s); [IconMaker]::SavePng($b, (Join-Path $out "icon-$s.png")); $b.Dispose()
}

# iPhone・Android 用：角丸の外を紺でうめる（端末の角丸と、絵の角丸の大きさがほぼ同じなので、ふちの線が四角のはしに来る）
$sq = [IconMaker]::Flatten($round, $bg)
$b = [IconMaker]::Resize($sq, 512); [IconMaker]::SavePng($b, (Join-Path $out 'icon-maskable-512.png')); $b.Dispose()
$b = [IconMaker]::Resize($sq, 180); [IconMaker]::SavePng($b, (Join-Path $out 'apple-touch-icon.png')); $b.Dispose()
$sq.Dispose()
$round.Dispose()

Get-Item (Join-Path $game 'favicon.ico'), (Join-Path $out '*.png') | ForEach-Object { "{0}  {1:N0} bytes" -f $_.Name, $_.Length }
