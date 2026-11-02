# 星の酒場のマップの部品を作る（tavern_parts_sheet.png ＝ ChatGPT「星降る酒場のタイルセット」から切り出す）
#   全体図（tavern_overview.png）は、置き方の参考にするだけで、ゲームには使わない
#   主人公（絵の高さ 約 82px）に合うように、部品はみんな同じ倍率（$S）で縮める（床・魔法陣・旗などは別の倍率）
# 使い方：art_source/tavern で  powershell -ExecutionPolicy Bypass -File tools/parts.ps1
# 出力：js_version/assets/tiles/tavern/tp_*.png、tools/parts_contact.png（確認用の一覧）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bfTools = Join-Path $PSScriptRoot '..\..\battlefield\tools'
Add-Type -Path (Join-Path $bfTools 'Img.cs'), (Join-Path $PSScriptRoot 'Tavern.cs') -ReferencedAssemblies System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root '..\..\js_version\assets\tiles\tavern'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$out = (Resolve-Path $out).Path
$sheet = [Img]::Load((Join-Path $root 'tavern_parts_sheet.png'))

$S = 0.7   # 家具・壁・扉の倍率（主人公に合わせる）
# 名前, x, y, 幅, 高さ（シートの上の場所）, 倍率, いちばん大きい固まりだけ残すか
$parts = @(
    # 床（タイル。ふちを少し切って、56px の正方形にする）
    @('tp_floor_a', 16, 14, 81, 84, 'tile'), @('tp_floor_b', 201, 14, 83, 84, 'tile'), @('tp_floor_c', 16, 107, 81, 86, 'tile'),
    @('tp_floor_d', 201, 107, 83, 86, 'tile'), @('tp_floor_lit', 108, 14, 81, 84, 'tile'), @('tp_floor_glow', 391, 14, 82, 84, 'tile'),
    @('tp_carpet', 297, 107, 80, 86, 'tile'), @('tp_carpet_b', 391, 107, 81, 86, 'tile'), @('tp_carpet_c', 297, 14, 80, 84, 'tile'),
    # 床に描く物
    @('tp_circle', 486, 10, 189, 191, 1.2, $true), @('tp_rug', 807, 570, 117, 134, $S, $true), @('tp_star', 672, 136, 71, 71, $S, $true),
    @('tp_runner', 762, 136, 113, 66, $S, $false),
    # 壁
    @('tp_wall_a', 16, 210, 149, 171, $S, $true), @('tp_wall_win', 179, 210, 125, 168, $S, $true), @('tp_wall_b', 332, 211, 106, 163, $S, $true),
    @('tp_wall_banner', 461, 210, 113, 168, $S, $true), @('tp_wall_c', 600, 210, 80, 168, $S, $true), @('tp_wall_low', 693, 302, 151, 80, $S, $true),
    @('tp_wall_door', 874, 279, 104, 143, $S, $true),
    @('tp_sign', 55, 391, 313, 134, $S, $true), @('tp_banners', 397, 405, 155, 129, $S, $true), @('tp_plate_master', 586, 419, 102, 43, $S, $true),
    @('tp_curtain', 1240, 737, 170, 106, $S, $true),
    @('tp_shelf_a', 17, 533, 134, 149, $S, $true), @('tp_shelf_b', 163, 563, 131, 133, $S, $true),
    # 扉・カウンター・掲示板
    @('tp_door_coop', 994, 259, 116, 170, $S, $true), @('tp_door_pvp', 1120, 259, 111, 171, $S, $true), @('tp_door_lock', 1240, 259, 114, 171, $S, $true),
    @('tp_counter', 879, 453, 400, 141, $S, $true), @('tp_board', 711, 400, 138, 152, $S, $true),
    # 家具
    @('tp_fireplace', 1420, 555, 104, 163, $S, $true), @('tp_sofa', 1294, 457, 132, 98, $S, $true), @('tp_armchair', 1446, 454, 78, 87, $S, $true),
    @('tp_lowtable', 1317, 552, 93, 59, $S, $true), @('tp_table', 630, 583, 123, 107, $S, $true), @('tp_stool', 585, 593, 39, 48, $S, $true),
    @('tp_stool_b', 607, 649, 41, 47, $S, $true), @('tp_orrery', 1277, 624, 127, 99, 0.5, $true),
    @('tp_barrels', 303, 620, 91, 68, $S, $true), @('tp_barrel_pile', 403, 619, 99, 80, $S, $true), @('tp_barrel', 352, 706, 52, 72, $S, $true),
    @('tp_barrel_b', 875, 779, 47, 67, $S, $true), @('tp_crates', 775, 712, 59, 65, $S, $true), @('tp_crate', 844, 716, 49, 51, $S, $true),
    @('tp_books', 690, 717, 71, 51, $S, $true), @('tp_bookstack', 619, 723, 55, 43, $S, $true),
    @('tp_plant_a', 315, 529, 65, 81, $S, $true), @('tp_plant_b', 396, 544, 50, 66, $S, $true), @('tp_plant_c', 512, 603, 62, 87, $S, $true),
    @('tp_plant_d', 174, 706, 57, 80, $S, $true), @('tp_plant_box', 244, 708, 97, 62, $S, $true), @('tp_plant_hang', 9, 703, 83, 92, $S, $true),
    @('tp_flowers', 561, 489, 127, 81, $S, $true),
    # 明かり・柱
    @('tp_lamp_post', 1214, 594, 59, 120, $S, $true), @('tp_lamp', 1099, 607, 39, 105, $S, $true), @('tp_lamp_b', 1174, 738, 40, 108, $S, $true),
    @('tp_lantern', 1150, 621, 49, 81, $S, $true), @('tp_chandelier', 1011, 592, 71, 119, $S, $true), @('tp_torch', 937, 744, 43, 105, $S, $true),
    @('tp_crystal_blue', 999, 732, 47, 112, $S, $true), @('tp_crystal_b', 1061, 732, 47, 112, $S, $true), @('tp_crystal_pink', 1121, 747, 39, 96, $S, $true),
    @('tp_pillar', 936, 605, 58, 126, $S, $true),
    # 手すり・階段
    @('tp_rail_a', 1056, 7, 110, 73, $S, $true), @('tp_rail_b', 1183, 7, 130, 74, $S, $true), @('tp_rail_c', 1332, 7, 142, 79, $S, $true),
    @('tp_rail_post', 1489, 20, 33, 64, $S, $true), @('tp_rail_long', 1366, 265, 153, 60, $S, $true), @('tp_stairs', 880, 191, 158, 60, $S, $true),
    @('tp_stairs_b', 698, 219, 157, 68, $S, $true),
    # 旗
    @('tp_flag_a', 15, 812, 78, 108, 0.6, $true), @('tp_flag_b', 241, 792, 76, 117, 0.6, $true), @('tp_flag_c', 331, 792, 86, 123, 0.6, $true),
    @('tp_flag_d', 1420, 742, 48, 101, 0.6, $true)
)
$files = @()
foreach ($p in $parts) {
    $name, $x, $y, $w, $h, $k = $p[0], $p[1], $p[2], $p[3], $p[4], $p[5]
    if ($k -eq 'tile') {
        $im = $sheet.Crop($x + 3, $y + 3, $w - 6, $h - 6, 0, 1, $false)
        $im = [Tavern]::Resize($im, 56, 56)
        for ($i = 3; $i -lt $im.D.Length; $i += 4) { $im.D[$i] = 255 }
    } else {
        $im = $sheet.Crop($x - 2, $y - 2, $w + 4, $h + 4, 8, 120, $false)
        if ($p[6]) { [Tavern]::KeepMain($im, 60) }
        $im = $im.Crop(0, 0, $im.W, $im.H, 0, 1, $true)
        $im = [Tavern]::Resize($im, [Math]::Max(1, [int][Math]::Round($im.W * $k)), [Math]::Max(1, [int][Math]::Round($im.H * $k)))
    }
    $f = Join-Path $out "$name.png"
    $im.Save($f)
    $files += $f
    Write-Host ("{0} {1}x{2}" -f $name, $im.W, $im.H)
}
[Contact]::Make($files, (Join-Path $PSScriptRoot 'parts_contact.png'), 10, 140)
