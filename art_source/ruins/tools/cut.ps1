Add-Type -AssemblyName System.Drawing
Add-Type -Path "$PSScriptRoot/Img.cs" -ReferencedAssemblies System.Drawing
$root = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$sheet = [Img]::Load("$root/art_source/ruins/ruins_parts_sheet.png")
$out = "$root/js_version/assets/tiles/ruins"
New-Item -ItemType Directory -Force $out | Out-Null

$parts = @(
  @('ruins_floor',              14, 22, 187, 204, 'tile'),
  @('ruins_floor_crack',        227, 22, 181, 203, 'tile'),
  @('ruins_floor_moss',         437, 22, 183, 201, 'tile'),
  @('ruins_floor_rune',         649, 22, 179, 195, 'tile'),
  @('ruins_magic_circle',       852, 20, 296, 210, 'tile'),
  @('ruins_floor_diamond',      1172, 22, 155, 191, 'tile'),
  @('ruins_wall_tower',         1362, 10, 152, 210, 'solid'),
  @('ruins_wall',               0, 256, 178, 210, 'solid'),
  @('ruins_wall_b',             189, 260, 147, 202, 'solid'),
  @('ruins_arch',               353, 256, 103, 210, 'solid'),
  @('ruins_arch_vines',         478, 246, 147, 218, 'solid'),
  @('ruins_arch_broken',        643, 244, 150, 219, 'solid'),
  @('ruins_pillar',             814, 248, 88, 218, 'solid'),
  @('ruins_pillar_rune',        930, 246, 85, 215, 'solid'),
  @('ruins_pillar_rune_b',      1032, 246, 85, 224, 'solid'),
  @('ruins_pillar_rune_c',      1150, 246, 88, 224, 'solid'),
  @('ruins_gate',               1260, 226, 274, 244, 'solid'),
  @('ruins_stairs',             6, 488, 166, 170, 'solid'),
  @('ruins_stairs_broken',      178, 488, 138, 170, 'solid'),
  @('ruins_platform',           328, 488, 148, 166, 'solid'),
  @('ruins_block',              478, 510, 120, 132, 'solid'),
  @('ruins_pillar_broken',      603, 490, 98, 152, 'solid'),
  @('ruins_pillar_broken_vines',703, 476, 108, 170, 'solid'),
  @('ruins_pillar_short',       830, 479, 70, 167, 'solid'),
  @('ruins_crystal',            920, 481, 84, 152, 'glow'),
  @('ruins_crystal_small',      1012, 526, 84, 114, 'glow'),
  @('ruins_brazier',            1120, 490, 85, 152, 'glow'),
  @('ruins_brazier_b',          1230, 498, 79, 140, 'glow'),
  @('ruins_pedestal',           1330, 494, 79, 146, 'solid'),
  @('ruins_pedestal_rune',      1437, 479, 86, 161, 'solid'),
  @('ruins_banner',             14, 686, 117, 176, 'solid'),
  @('ruins_banner_b',           143, 676, 100, 178, 'solid'),
  @('ruins_rubble',             247, 689, 132, 98, 'solid'),
  @('ruins_rubble_b',           383, 693, 135, 110, 'solid'),
  @('ruins_block_small',        520, 696, 72, 106, 'solid'),
  @('ruins_wall_vines',         601, 671, 163, 147, 'solid'),
  @('ruins_wall_low_vines',     777, 678, 134, 150, 'solid'),
  @('ruins_wall_low_vines_b',   1001, 679, 169, 157, 'solid'),
  @('ruins_waterfall',          1182, 670, 132, 336, 'glow'),
  @('ruins_waterfall_small',    1316, 670, 108, 170, 'glow'),
  @('ruins_sparkles',           1426, 670, 106, 172, 'glow'),
  @('ruins_water_pool',         1326, 862, 198, 117, 'tile'),
  @('ruins_rubble_c',           256, 798, 148, 78, 'solid'),
  @('ruins_wall_stub_vines',    18, 885, 113, 125, 'solid'),
  @('ruins_wall_stub',          150, 884, 119, 102, 'solid'),
  @('ruins_wall_stub_b',        283, 883, 119, 104, 'solid'),
  @('ruins_wall_arch_vines',    409, 833, 179, 166, 'solid'),
  @('ruins_wall_stairs',        606, 847, 132, 151, 'solid'),
  @('ruins_stairs_side',        759, 846, 137, 150, 'solid'),
  @('ruins_stairs_wide',        910, 848, 139, 149, 'solid'),
  @('ruins_wall_corner',        1053, 843, 119, 159, 'solid')
)
$sizes = @()
foreach ($p in $parts) {
  $name, $x, $y, $w, $h, $kind = $p
  switch ($kind) {
    'tile'  { $img = $sheet.Crop($x, $y, $w, $h, 200, 235, $true) }
    'glow'  { $img = $sheet.Crop($x, $y, $w, $h, 40, 150, $true) }
    default { $img = $sheet.Crop($x, $y, $w, $h, 150, 225, $true) }
  }
  $img.Save("$out/$name.png")
  $sizes += "    ${name}: [$($img.W), $($img.H)],"
}
$sizes -join "`n" | Set-Content "$PSScriptRoot/sizes.txt" -Encoding utf8
"done $($parts.Count)"
$f = (Get-ChildItem "$out/*.png" | Sort-Object Name).FullName; [Contact]::Make($f, "$PSScriptRoot/contact.png", 9, 170)
