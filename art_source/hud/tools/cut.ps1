# HUD parts (run in art_source/hud):
#   powershell -ExecutionPolicy Bypass -File tools/cut.ps1
# in : hud_sheet.png (gold pixel HUD sheet), ../../js_version/assets/ui/status_frame.png etc.
# out: js_version/assets/ui/hud/*.png, magic_palette/element_heal.png, meta.txt, preview.png
# All parts are made at 2x of the size shown on screen (CSS px) and drawn at half size.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$ui = Join-Path $root '..\..\js_version\assets\ui'
$ui = [IO.Path]::GetFullPath($ui)
$out = Join-Path $ui 'hud'
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $here 'Hud.cs'))) -ReferencedAssemblies System.Drawing

$sheet = [Hud]::Load((Join-Path $root 'hud_sheet.png'))
$K = 0.6          # sheet px -> 2x image px (screen size = sheet px * 0.3)
$meta = @()

# ---- level bar (star socket + dark bar) : sheet (85,654) 676x174 ----
$lv = $sheet.Crop(85, 654, 676, 174)
$lvS = $lv.ScaleBy($K)
$lvS.Save((Join-Path $out 'level_bar.png'))
$meta += "level_bar: $($lvS.W)x$($lvS.H)  inner x $([math]::Round((265-85)*$K/2,1))..$([math]::Round((668-85)*$K/2,1))  y $([math]::Round((702-654)*$K/2,1))..$([math]::Round((780-654)*$K/2,1)) (screen px)"

# ---- magic bar (orb socket + dark bar) : sheet (80,845) 775x125. orb center (182,905) r 41 ----
$mg = $sheet.Crop(80, 845, 775, 125)
$mg.FillCircle(182 - 80, 905 - 845, 42.5, 14, 8, 18)
$mgS = $mg.ScaleBy($K)
$mgS.Save((Join-Path $out 'magic_bar.png'))
$meta += "magic_bar: $($mgS.W)x$($mgS.H)  inner x $([math]::Round((242-80)*$K/2,1))..$([math]::Round((796-80)*$K/2,1))  y $([math]::Round((866-845)*$K/2,1))..$([math]::Round((951-845)*$K/2,1))"

# ---- orbs (one per element) : square (140,863) 84x84 around the red orb ----
$ox = 140; $oy = 863; $orbSize = 84
$orb = $sheet.Crop($ox, $oy, $orbSize, $orbSize)
$orb.KeepCircle(182 - $ox, 905 - $oy, 42)
$orbs = [ordered]@{
    fire = $null; water = 212; wind = 162; earth = 32; thunder = 272; heal = 138; light = 50; ice = 196; none = 'gray'
}
# (PowerShell does not tell $k from $K, so the loop variable is $elem)
foreach ($elem in $orbs.Keys) {
    $o = $orb.Clone()
    $v = $orbs[$elem]
    if ($v -eq 'gray') { $o.Gray(0.75) }
    elseif ($null -ne $v) {
        $vMul = 1.0; $sMul = 1.0
        if ($elem -eq 'earth') { $vMul = 0.86; $sMul = 0.9 }
        if ($elem -eq 'light') { $vMul = 1.05; $sMul = 0.85 }
        if ($elem -eq 'heal') { $sMul = 0.92 }
        $o.SetHue(320, 45, 0.18, [double]$v, $sMul, $vMul)
    }
    $orbOut = $o.ScaleBy($K)
    $orbOut.Save((Join-Path $out "orb_$elem.png"))
}
$meta += "orb: $([math]::Round($orbSize*$K))px  at x $([math]::Round(($ox-80)*$K/2,1)) y $([math]::Round(($oy-845)*$K/2,1)) in magic_bar (screen px), size $([math]::Round($orbSize*$K/2,1))"

# ---- name plate : both ends from the magic bar's right end, dark middle, blue star gem on top ----
$plateW = 940; $over = 64; $bh = 125
$plate = [Hud]::Blank($plateW, $bh + $over)
$endR = $sheet.Crop(758, 845, 97, $bh)          # right end (pointed, small blue diamond)
$endL = $endR.FlipX()
$mid = $sheet.Crop(500, 845, 1, $bh)            # one column of the bar's middle
for ($x = 97; $x -lt $plateW - 97; $x++) { $plate.Paste($mid, $x, $over) }
$plate.Paste($endL, 0, $over)
$plate.Paste($endR, $plateW - 97, $over)
# gem: the blue 4-point star at the right end of the HP bar (sheet 1395..1478, 220..340)
$gem = $sheet.Crop(1393, 218, 88, 124).ScaleBy(0.95)
$plate.Paste($gem, [int](($plateW - $gem.W) / 2), $over - [int]($gem.H * 0.52))
$PK = 0.46
$plS = $plate.ScaleBy($PK)
$plS.Save((Join-Path $out 'nameplate.png'))
$meta += "nameplate: $($plS.W)x$($plS.H)  bar top y $([math]::Round($over*$PK/2,1))  inner y $([math]::Round(($over+21)*$PK/2,1))..$([math]::Round(($over+106)*$PK/2,1))  inner x $([math]::Round(60*$PK/2,1))..$([math]::Round(($plateW-60)*$PK/2,1)) (screen px)"

# ---- low HP : red version of the HP fill ----
$hp = [Hud]::Load((Join-Path $ui 'status_fill_hp.png'))
$hp.SetHue(55, 185, 0.12, 357, 1.2, 0.97)
$hp.Save((Join-Path $out 'status_fill_hp_low.png'))

# ---- low HP : the emblem (left star) with a red crystal (drawn over the frame, fades in and out) ----
$fr = [Hud]::Load((Join-Path $ui 'status_frame.png'))
$em = $fr.Clone()
for ($y = 0; $y -lt $em.H; $y++) {
    for ($x = 0; $x -lt $em.W; $x++) {
        $inEmblem = ($x -lt 236) -or ($x -lt 292 -and $y -ge 125 -and $y -le 172)
        if (-not $inEmblem) { $em.D[($y * $em.W + $x) * 4 + 3] = 0 }
    }
}
$em.SetHue(170, 260, 0.10, 354, 1.15, 1.0)
$em.Save((Join-Path $out 'status_emblem_red.png'))

# ---- heal icon for the magic palette : water icon frame, green, with a pixel cross inside ----
$pal = Join-Path $ui 'magic_palette'
$ic = [Hud]::Load((Join-Path $pal 'element_water.png'))
$ic.SetHue(175, 265, 0.15, 140, 0.95, 1.0)
$n = 23; $cell = 4
$art = [Hud]::PixelArt($n, $cell, [Func[int, int, int[]]] {
    param($x, $y)
    $c = 11.0
    $d = [math]::Sqrt(($x - $c) * ($x - $c) + ($y - $c) * ($y - $c))
    # plus sign (arms 5 wide, from 4 to 18) with a dark outline
    $inV = ($x -ge 9 -and $x -le 13 -and $y -ge 4 -and $y -le 18)
    $inH = ($y -ge 9 -and $y -le 13 -and $x -ge 4 -and $x -le 18)
    $edgeV = ($x -ge 8 -and $x -le 14 -and $y -ge 3 -and $y -le 19)
    $edgeH = ($y -ge 8 -and $y -le 14 -and $x -ge 3 -and $x -le 19)
    if ($inV -or $inH) {
        if (($inV -and $x -eq 13) -or ($inH -and $y -eq 13)) { return @(150, 232, 176, 255) }
        if (($inV -and $x -eq 9) -or ($inH -and $y -eq 9)) { return @(255, 255, 255, 255) }
        return @(222, 255, 230, 255)
    }
    if ($edgeV -or $edgeH) { return @(16, 92, 44, 255) }
    # sparkles
    foreach ($p in @(@(5, 5), @(18, 4), @(17, 18), @(4, 16))) { if ($x -eq $p[0] -and $y -eq $p[1]) { return @(240, 255, 230, 255) } }
    if ($d -lt 4.5) { return @(140, 246, 176, 255) }
    if ($d -lt 7.5) { return @(76, 214, 120, 255) }
    if ($d -lt 10) { return @(38, 160, 86, 255) }
    return @(14, 92, 52, 255)
})
$art.KeepCircle(46, 46, 45)
$ic.Paste($art, 80 - 46, 80 - 46)
$ic.Save((Join-Path $pal 'element_heal.png'))

[IO.File]::WriteAllLines((Join-Path $root 'meta.txt'), $meta)
$meta
'done'
