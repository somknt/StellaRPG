# 歴戦の跡地（怨嗟の鎧のステージ）の素材を作る
#   battlefield_overview.png   ：ChatGPT「浮遊する廃城の魔法闘技場」（全体図。ゲームの背景にそのまま使う）
#   battlefield_parts_sheet.png：ChatGPT「暗黒城塞の廃墟ピクセルアート素材集」（炎・焚き火・霧・攻城兵器・枯れ木など）
# 使い方：art_source/battlefield で  powershell -ExecutionPolicy Bypass -File tools/cut.ps1
# 出力：js_version/assets/tiles/battlefield/bf_*.png（全体図だけ bf_overview.jpg）、tools/sizes.txt（battlefield_map.js の BF_PART_SIZE に写す値）、tools/contact.png（確認用）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'Img.cs'), (Join-Path $PSScriptRoot 'Bf.cs') -ReferencedAssemblies System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root '..\..\js_version\assets\tiles\battlefield'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$out = (Resolve-Path $out).Path

# ---------- 全体図：描きこまれた松明の炎を消す ----------
# 炎の真ん中（全体図の px。tools の外で自動で探した位置）。ゲームの FIRE の位置と同じ
$flames = @(
    @(663, 171), @(877, 172), @(1241, 378), @(1270, 541), @(981, 764), @(879, 817), @(662, 817), @(563, 764), @(266, 541),
    @(97, 180), @(1439, 180), @(93, 461), @(1449, 511), @(137, 754), @(1400, 757)
)
$ov = [Img]::Load((Join-Path $root 'battlefield_overview.png'))
$n = 0; $seed = 1
foreach ($f in $flames) { $n += [Bf]::Extinguish($ov, $f[0], $f[1], 30, 38, 24, $seed); $seed++ }
# 全体図は透明な所がないので JPEG（画質 92）にする（PNG だと 4MB。ゲームを開く時に毎回読み込むので小さく）
$tmp = Join-Path $env:TEMP 'bf_overview_tmp.png'
$ov.Save($tmp)
$bmp = [System.Drawing.Image]::FromFile($tmp)
$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]92)
$bmp.Save((Join-Path $out 'bf_overview.jpg'), $jpg, $ep)
$bmp.Dispose()
Remove-Item $tmp
Remove-Item (Join-Path $out 'bf_overview.png') -ErrorAction SilentlyContinue
Write-Host "全体図：炎を消した画素 $n"

# ---------- 素材シートの部品 ----------
# 名前, x, y, 幅, 高さ, 種類（solid：ふつう / glow：うすい光や煙も残す）
$sheet = [Img]::Load((Join-Path $root 'battlefield_parts_sheet.png'))
$parts = @(
    # 炎：大きい順に8つ（1〜3 は燃えている間のコマ送り。4〜8 は消える時・灯る時の小さな炎）
    @('bf_fire_1',        1122, 878, 36, 49, 'glow'),
    @('bf_fire_2',        1193, 878, 40, 49, 'glow'),
    @('bf_fire_3',        1262, 883, 35, 45, 'glow'),
    @('bf_fire_4',        1322, 879, 28, 48, 'glow'),
    @('bf_fire_5',        1371, 886, 29, 41, 'glow'),
    @('bf_fire_6',        1422, 887, 25, 40, 'glow'),
    @('bf_fire_7',        1466, 890, 21, 36, 'glow'),
    @('bf_fire_8',        1502, 903, 17, 22, 'glow'),
    @('bf_campfire_lit',  230, 794, 85, 109, 'glow'),
    @('bf_brazier_lit',   392, 795, 85, 108, 'glow'),
    @('bf_smoke_1',       15, 922, 51, 90, 'glow'),
    @('bf_smoke_2',       83, 919, 61, 93, 'glow'),
    @('bf_smoke_3',       160, 926, 71, 85, 'glow'),
    @('bf_smoke_4',       259, 919, 55, 93, 'glow'),
    @('bf_mist_1',        654, 927, 51, 82, 'glow'),
    @('bf_mist_2',        734, 928, 66, 81, 'glow'),
    @('bf_mist_3',        826, 932, 76, 78, 'glow'),
    @('bf_mist_4',        922, 932, 96, 78, 'glow'),
    @('bf_mist_5',        1430, 942, 90, 67, 'glow'),
    @('bf_magic_circle',  486, 242, 166, 152, 'glow'),
    @('bf_catapult',      570, 402, 184, 204, 'solid'),
    @('bf_spear_a',       12, 599, 30, 126, 'solid'),
    @('bf_spear_b',       44, 594, 18, 111, 'solid'),
    @('bf_stakes',        462, 546, 164, 140, 'solid'),
    @('bf_tree_a',        1122, 706, 120, 160, 'solid'),
    @('bf_tree_b',        1290, 710, 100, 156, 'solid'),
    @('bf_tree_c',        1455, 734, 67, 130, 'solid'),
    @('bf_tree_d',        1030, 694, 92, 152, 'solid'),
    @('bf_rubble_wall',   1146, 622, 134, 83, 'solid'),
    @('bf_wheel',         170, 665, 64, 68, 'solid'),
    @('bf_planks',        350, 634, 100, 71, 'solid'),
    @('bf_rubble',        902, 722, 140, 90, 'solid'),
    @('bf_pillar_broken', 897, 559, 82, 103, 'solid')
)
$sizes = @()
$made = @{}
foreach ($p in $parts) {
    $name, $x, $y, $w, $h, $kind = $p
    if ($kind -eq 'glow') { $img = $sheet.Crop($x, $y, $w, $h, 12, 120, $true) }
    else { $img = [Bf]::KeepMain($sheet.Crop($x, $y, $w, $h, 120, 220, $true), 160, 3) }  # となりの部品のはみ出しを消す
    $img.Save((Join-Path $out "$name.png"))
    $made[$name] = $img
    $sizes += "    ${name}: [$($img.W), $($img.H)],"
}
# 火を消した焚き火・火鉢（器より上の炎を消して、器の中は燃えかすにする）。bowl：器のふちの高さ（切り出した絵の上から px）
foreach ($q in @(@('bf_campfire', 'bf_campfire_lit', 74), @('bf_brazier', 'bf_brazier_lit', 52))) {
    $img = [Bf]::ExtinguishSprite($made[$q[1]], $q[2], 7)
    $img.Save((Join-Path $out "$($q[0]).png"))
    $sizes += "    $($q[0]): [$($img.W), $($img.H)],"
}
$sizes -join "`n" | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'sizes.txt')
Write-Host "部品 $($parts.Count + 2) 個"
$files = (Get-ChildItem (Join-Path $out 'bf_*.png') | Where-Object { $_.Name -ne 'bf_overview.png' } | Sort-Object Name).FullName
[Contact]::Make($files, (Join-Path $PSScriptRoot 'contact.png'), 8, 150)
Get-Content (Join-Path $PSScriptRoot 'sizes.txt')
