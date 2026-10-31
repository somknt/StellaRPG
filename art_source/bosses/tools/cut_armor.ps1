# Cut the grudge armor pictures (art_source/bosses/src/armor/*.png) into game frames (cut.ps1 calls this at the end)
#   body    -> js_version/assets/enemies/grudge_armor/<pose>_<dir>_<1-3>.png  and walk <dir>_<1-3>.png (left = right mirrored)
#   effects -> js_version/assets/effects/boss/armor_<name>[_<n>].png
# The sheets (and the names they were downloaded with):
#   side.png   闇 samuraiのピクセルアートスプライトシート-2   side (right) : idle / walk / draw / slash / idle 2
#   back.png   闇鎧の samurai スプライトシート-1               back (up)    : idle / walk / draw / slash / low thrust
#   front.png  闇 samuraiのアクションスプライトシート-1         front (down) : draw / slash / stance / thrust / low stance
#   dance.png  闇 samurai の紫の剣舞スプライトシート            3/4 right    : sword dance (the second slash)
#   poses.png  闇 samuraiの12ポーズ・スプライトシート-1         3/4 right    : stab the ground / sword up / low slash / death
#   action.png 闇 samurai騎士のアクションスプライトシート-2     3/4 right    : low run / slash / stance / knee / death
#   fx.png     紫黒の魔法エフェクト素材集                       effects      : black mist, swirls, crescent slashes, streaks
#   views.png  闇の紫眼サムライ三面図                           the three views (reference, not cut)
param([string]$Root = '')
Add-Type -AssemblyName System.Drawing
if (-not ('ArmorFrame' -as [type])) { Add-Type -Path "$PSScriptRoot/Boss.cs" -ReferencedAssemblies System.Drawing }
if (-not $Root) { $Root = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent }
$src = "$Root/art_source/bosses/src/armor"
# 440 px frames, feet line at 348 (the same place as 254 / 320). A standing armor is about 170 px from the horns to the feet
# boss_data.js: look.sprite.draw = 440 / (enemy size 112) = 3.93
$FS = 440; $FOOT = 348

function Get-ArmorFrames($file, $rows, $cols) {
    $sh = [Sheet]::Load("$src/$file")
    $parts = $sh.Parts(100, 2, 150)
    $cellW = $sh.W / $cols; $cellH = $sh.H / $rows
    $big = @($parts | Where-Object { $_.W * $_.H -ge 20000 })
    $small = @($parts | Where-Object { $_.W * $_.H -lt 20000 })
    $frames = @{}
    foreach ($p in $big) {
        $key = "$([math]::Floor($p.Cy / $cellH)),$([math]::Floor($p.Cx / $cellW))"
        if ($frames.ContainsKey($key)) { Write-Warning "$file : two big parts in cell $key" }
        $frames[$key] = [System.Collections.ArrayList]@($p)
    }
    # small pieces (cloth tips, sparks) join the nearest frame
    foreach ($s in $small) {
        $best = $null; $bd = 1e9
        foreach ($p in $big) {
            $dx = [math]::Max(0, [math]::Max($p.X - $s.Cx, $s.Cx - ($p.X + $p.W)))
            $dy = [math]::Max(0, [math]::Max($p.Y - $s.Cy, $s.Cy - ($p.Y + $p.H)))
            $d = $dx + $dy; if ($d -lt $bd) { $bd = $d; $best = $p }
        }
        if ($bd -lt 40) { [void]$frames["$([math]::Floor($best.Cy / $cellH)),$([math]::Floor($best.Cx / $cellW))"].Add($s) }
    }
    # each frame on one picture, and where it stands (ArmorFrame.Anchor)
    $info = @{}
    foreach ($key in $frames.Keys) {
        $c = [ArmorFrame]::Compose([Part[]]@($frames[$key] | ForEach-Object { $_ }))
        $info[$key] = @{ c = $c; a = [ArmorFrame]::Anchor($c.Bmp) }
    }
    # the gold of the hilt sometimes joins the horns (a wide "horn"): then the head is put at the usual place from the body
    $hw = @($info.Values | ForEach-Object { $_.a[5] - $_.a[4] } | Sort-Object)[[int]($info.Count / 2)]
    $off = @($info.Values | ForEach-Object { $_.a[0] - $_.a[1] } | Sort-Object)[[int]($info.Count / 2)]
    foreach ($v in $info.Values) {
        $a = $v.a
        $head = if (($a[5] - $a[4]) -gt $hw * 1.6 -or [double]::IsNaN($a[0])) { $a[1] + $off } else { $a[0] }
        # body center = between the head (horns) and the lower body, so leaning frames do not slide too much
        $v.cx = ($head + $a[1]) / 2
    }
    return @{ info = $info; file = $file }
}

# frames given as "row,col" -> <name>_1.. png (and mirrored copies). Each frame stands on the feet line, its body center in the middle
function Save-Armor($sheet, $cells, $k, $outDir, $names, $mirror = $null) {
    for ($i = 0; $i -lt $cells.Count; $i++) {
        $v = $sheet.info[$cells[$i]]
        if (-not $v) { throw "$($sheet.file): no frame at $($cells[$i])" }
        $c = $v.c
        $px = $FS / 2 - $v.cx * $k
        $fy = $FOOT - $v.a[6] * $k
        $w = $c.W * $k; $h = $c.H * $k
        if ($px -lt 0 -or $fy -lt 0 -or $px + $w -gt $FS -or $fy + $h -gt $FS) { Write-Warning ("{0} {1}: outside the frame ({2:N0},{3:N0} {4:N0}x{5:N0})" -f $sheet.file, $cells[$i], $px, $fy, $w, $h) }
        $fr = New-Object Frame $FS
        $fr.Put($c.Bmp, $px, $fy, $k)
        foreach ($n in @($names)) { if ($n) { $fr.Save("$outDir/$($n)_$($i + 1).png", $false) } }
        foreach ($n in @($mirror)) { if ($n) { $fr.Save("$outDir/$($n)_$($i + 1).png", $true) } }
        $fr.Dispose()
    }
}
function Cells($row, $cols = @(0, 1, 2)) { return @($cols | ForEach-Object { "$row,$_" }) }

$out = "$Root/js_version/assets/enemies/grudge_armor"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem "$out/*.png" -ErrorAction SilentlyContinue | Remove-Item

# scale of each sheet: the standing frames are 170 px (side / front / back: by the height, 3/4 sheets: matched by eye to the side sheet)
# pose names (GrudgeArmorAI.spriteMotion): idle / walk / drawSword / ready / slash / slashB / dash / stab / focus / hurt / collapse (death: 'death' is a still motion in Enemy.BOSS_STILL_MOTIONS)
#   slash (and slashB = the other hand) frames: 1 = raised, 2 = the cut, 3 = swung through
$s = Get-ArmorFrames 'side.png' 5 3; $K = 0.793
Save-Armor $s (Cells 1) $K $out 'right' 'left'
Save-Armor $s (Cells 0) $K $out 'idle_right' 'idle_left'
Save-Armor $s (Cells 2) $K $out 'drawSword_right' 'drawSword_left'
Save-Armor $s (Cells 3) $K $out 'slash_right' 'slash_left'
$s = Get-ArmorFrames 'dance.png' 5 3
Save-Armor $s @('1,1', '1,2', '4,0') 0.78 $out 'slashB_right' 'slashB_left'
$s = Get-ArmorFrames 'action.png' 5 5; $K = 0.78
Save-Armor $s (Cells 3) $K $out 'ready_right' 'ready_left'
Save-Armor $s (Cells 0 @(1, 2, 3)) $K $out 'dash_right' 'dash_left'
$s = Get-ArmorFrames 'poses.png' 4 3; $K = 0.74
Save-Armor $s (Cells 0) $K $out 'stab_right' 'stab_left'
Save-Armor $s (Cells 1) $K $out 'focus_right' 'focus_left'
Save-Armor $s @('3,0', '3,0', '3,0') $K $out 'hurt_right' 'hurt_left'
Save-Armor $s (Cells 3) $K $out 'collapse_right' 'collapse_left'
# front: no walking picture -> the standing frame (a ghost: it glides on the black mist). idle_down = the walk (Enemy.getBossSprite)
# slashB (the other hand) = the slash mirrored
$s = Get-ArmorFrames 'front.png' 5 3; $K = 0.833
Save-Armor $s @('0,1', '0,1', '0,1') $K $out 'down'
Save-Armor $s @('0,1', '0,0', '0,2') $K $out 'drawSword_down'
Save-Armor $s @('1,1', '1,2', '4,2') $K $out 'slash_down' 'slashB_down'
Save-Armor $s (Cells 4) $K $out 'ready_down'
Save-Armor $s (Cells 3) $K $out 'dash_down'
# back
$s = Get-ArmorFrames 'back.png' 5 3; $K = 0.867
Save-Armor $s (Cells 1) $K $out 'up'
Save-Armor $s (Cells 0) $K $out 'idle_up'
Save-Armor $s (Cells 2) $K $out 'drawSword_up'
Save-Armor $s (Cells 3) $K $out 'slash_up' 'slashB_up'
Save-Armor $s @('2,2', '2,2', '2,2') $K $out 'ready_up'
Save-Armor $s (Cells 4) $K $out 'dash_up'

# ---------------- effects (fx.png) ----------------
$fxDir = "$Root/js_version/assets/effects/boss"
New-Item -ItemType Directory -Force $fxDir | Out-Null
Get-ChildItem "$fxDir/armor_*.png" -ErrorAction SilentlyContinue | Remove-Item
$fxSheet = [Sheet]::Load("$src/fx.png")
$fxParts = @($fxSheet.Parts(20, 2, 40))
# every piece whose center is inside the rect (sheet px @(x0, y0, x1, y1)) -> a $S square. $k > 0: the same scale for every frame
function Save-ArmorFx($name, $rects, $S, $k = 0) {
    for ($i = 0; $i -lt $rects.Count; $i++) {
        $r = $rects[$i]
        $ps = @($fxParts | Where-Object { $_.Cx -ge $r[0] -and $_.Cx -lt $r[2] -and $_.Cy -ge $r[1] -and $_.Cy -lt $r[3] })
        if (-not $ps.Count) { throw "fx.png : nothing in rect $($r -join ',')" }
        $x0 = ($ps | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
        $y0 = ($ps | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
        $x1 = ($ps | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
        $y1 = ($ps | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
        $kk = if ($k -gt 0) { $k } else { ($S - 4) / [math]::Max($x1 - $x0, $y1 - $y0) }
        if (($x1 - $x0) * $kk -gt $S -or ($y1 - $y0) * $kk -gt $S) { Write-Warning "$name $($i + 1): bigger than the square" }
        $fr = New-Object Frame $S
        $ox = ($S - ($x1 - $x0) * $kk) / 2; $oy = ($S - ($y1 - $y0) * $kk) / 2
        foreach ($p in $ps) { $fr.Put($p.Bmp, $ox + ($p.X - $x0) * $kk, $oy + ($p.Y - $y0) * $kk, $kk) }
        $fn = if ($rects.Count -eq 1) { $name } else { "$($name)_$($i + 1)" }
        $fr.Save("$fxDir/$fn.png", $false); $fr.Dispose()
    }
}
#   armor_mist_1-4 : black purple mist (mist bursts, the dark aura)
#   armor_swirl    : a ring of swirling mist (the marks where the clones come out)
#   armor_vortex   : a whirl of mist (stabbing the sword into the ground)
#   armor_slash_1-3: purple crescent cuts, small -> big (the slash of the sword)
#   armor_streak   : a long thin streak (the line of the iai)
#   armor_wave     : a flying crescent (the wind blade)
Save-ArmorFx 'armor_mist' @(@(0, 0, 430, 305), @(430, 0, 800, 305), @(800, 0, 1180, 305), @(1180, 0, 1536, 320)) 256
Save-ArmorFx 'armor_swirl' @(, @(0, 320, 400, 580)) 300
Save-ArmorFx 'armor_vortex' @(, @(400, 300, 790, 580)) 300
Save-ArmorFx 'armor_slash' @(@(0, 590, 250, 800), @(250, 590, 540, 820), @(540, 575, 890, 830)) 300 0.78
Save-ArmorFx 'armor_streak' @(, @(0, 830, 420, 1024)) 420
Save-ArmorFx 'armor_wave' @(, @(1070, 830, 1536, 1024)) 256
"armor done"
