# Cut the boss pictures (art_source/bosses/src) into game frames
#   creatures -> js_version/assets/enemies/<boss>/<motion>_<dir>_<1-3>.png  and walk <dir>_<1-3>.png
#   effects   -> js_version/assets/effects/boss/<name>[_<n>].png
Add-Type -AssemblyName System.Drawing
Add-Type -Path "$PSScriptRoot/Boss.cs" -ReferencedAssemblies System.Drawing
$root = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$src = "$root/art_source/bosses/src"
$FS = 320        # frame size (drawn at enemy.size * 1.875 in game)
$FOOT = 254     # feet line in the frame (= shadow line in game)

function Get-Frames($file, $rows, $cols) {
    $sh = [Sheet]::Load("$src/$file")
    $parts = $sh.Parts(100, 2, 150)
    $cellW = $sh.W / $cols; $cellH = $sh.H / $rows
    $big = @($parts | Where-Object { $_.W * $_.H -ge 20000 })
    $small = @($parts | Where-Object { $_.W * $_.H -lt 20000 })
    $frames = @{}
    foreach ($p in $big) {
        $r = [math]::Floor($p.Cy / $cellH); $c = [math]::Floor($p.Cx / $cellW)
        $key = "$r,$c"
        if ($frames.ContainsKey($key)) { Write-Warning "$file : two big parts in cell $key" }
        $frames[$key] = [System.Collections.ArrayList]@($p)
    }
    # small pieces (leaves, fur tips) join the nearest frame
    foreach ($s in $small) {
        $best = $null; $bd = 1e9
        foreach ($p in $big) {
            $dx = [math]::Max(0, [math]::Max($p.X - $s.Cx, $s.Cx - ($p.X + $p.W)))
            $dy = [math]::Max(0, [math]::Max($p.Y - $s.Cy, $s.Cy - ($p.Y + $p.H)))
            $d = $dx + $dy; if ($d -lt $bd) { $bd = $d; $best = $p }
        }
        if ($bd -lt 40) {
            $r = [math]::Floor($best.Cy / $cellH); $c = [math]::Floor($best.Cx / $cellW)
            [void]$frames["$r,$c"].Add($s)
        }
    }
    return @{ frames = $frames; cellW = $cellW; cellH = $cellH; file = $file }
}

# frames of one row -> 3 png (and mirrored copies)
#   k: scale, mode 'feet' = each frame stands on the feet line, 'union' = keep the vertical motion (jumps)
# alpha mass of one frame (sum of alpha of all its parts) and the x of the body axis
#   axis = alpha-weighted center x of the top $axisFrac of the frame (head + shoulders, the swinging tail is lower)
function Get-FrameInfo($list, $axisFrac) {
    $y0 = ($list | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
    $y1 = ($list | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
    $band = $y0 + $axisFrac * ($y1 - $y0)
    $mass = 0.0; $sx = 0.0; $sw = 0.0
    foreach ($p in $list) {
        $mass += [Axis]::Sum($p.Bmp, 0, $p.H)[2]
        $s = [Axis]::Sum($p.Bmp, 0, [int]($band - $p.Y))
        $sx += $s[0] + $p.X * $s[2]; $sw += $s[2]
    }
    $ax = if ($sw -gt 0) { $sx / $sw } else { $null }
    return @{ mass = $mass; axis = $ax }
}
# average alpha mass of a row, in frame pixels when drawn at scale k (used as the size target of $fit)
function Get-RowMass($sheet, $row, $k) {
    $t = 0.0
    foreach ($c in 0, 1, 2) { $t += (Get-FrameInfo $sheet.frames["$row,$c"] 0.45).mass }
    return $t / 3 * $k * $k
}

# $fit (optional) keeps the body steady from frame to frame:
#   @{ axis = 0.45; mass = <target mass in frame px>; lo = 0.85; hi = 1.15 }
#   - each frame is placed so its body axis (head + shoulders) is at the frame center
#   - each frame is scaled so its body has about the same amount of picture as the target (within k*lo .. k*hi)
function Save-Row($sheet, $row, $k, $outDir, $names, $mode = 'feet', $mirror = $null, $order = @(0, 1, 2), $fit = $null) {
    $info = @()
    foreach ($c in $order) {
        $list = $sheet.frames["$row,$c"]
        if (-not $list) { throw "$($sheet.file): no frame at $row,$c" }
        $x0 = ($list | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
        $y0 = ($list | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
        $x1 = ($list | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
        $y1 = ($list | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
        $info += @{ list = $list; rx0 = $x0 - $c * $sheet.cellW; rx1 = $x1 - $c * $sheet.cellW; ry1 = $y1 - $row * $sheet.cellH; x0 = $x0; y0 = $y0; x1 = $x1; y1 = $y1 }
    }
    $mid = ((($info | ForEach-Object { $_.rx0 }) | Measure-Object -Minimum).Minimum + (($info | ForEach-Object { $_.rx1 }) | Measure-Object -Maximum).Maximum) / 2
    $bottom = (($info | ForEach-Object { $_.ry1 }) | Measure-Object -Maximum).Maximum
    for ($i = 0; $i -lt $info.Count; $i++) {
        $f = $info[$i]
        $kf = $k
        $px = $FS / 2 + ($f.rx0 - $mid) * $k
        if ($fit) {
            $fi = Get-FrameInfo $f.list $fit.axis
            if ($fit.mass) { $kf = [math]::Min($k * $fit.hi, [math]::Max($k * $fit.lo, [math]::Sqrt($fit.mass / $fi.mass))) }
            if ($null -ne $fi.axis) { $px = $FS / 2 - ($fi.axis - $f.x0) * $kf }
        }
        $k0 = $k; $k = $kf
        if ($mode -eq 'feet') { $fy = $FOOT - ($f.y1 - $f.y0) * $k } else { $fy = $FOOT - ($bottom - ($f.ry1 - ($f.y1 - $f.y0))) * $k }
        $w = ($f.x1 - $f.x0) * $k; $h = ($f.y1 - $f.y0) * $k
        if ($px -lt 0 -or $fy -lt 0 -or $px + $w -gt $FS -or $fy + $h -gt $FS) { Write-Warning ("{0} row {1} frame {2}: outside the frame ({3:N0},{4:N0} {5:N0}x{6:N0})" -f $sheet.file, $row, $i, $px, $fy, $w, $h) }
        $fr = New-Object Frame $FS
        foreach ($p in $f.list) { $fr.Put($p.Bmp, $px + ($p.X - $f.x0) * $k, $fy + ($p.Y - $f.y0) * $k, $k) }
        foreach ($n in @($names)) { $fr.Save("$outDir/$($n)_$($i + 1).png", $false) }
        if ($mirror) { foreach ($n in @($mirror)) { $fr.Save("$outDir/$($n)_$($i + 1).png", $true) } }
        $fr.Dispose()
        $k = $k0
    }
}

# one frame repeated 3 times (still poses: walk down/up while there is no walking picture)
function Save-Still($sheet, $row, $col, $k, $outDir, $name) {
    Save-Row $sheet $row $k $outDir $name 'feet' $null @($col, $col, $col)
}

# ---------------- giant forest boar ----------------
$out = "$root/js_version/assets/enemies/giant_forest_boar"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem "$out/*.png" -ErrorAction SilentlyContinue | Remove-Item
$side = Get-Frames 'boar_side_sheet.png' 6 3
$KS = 0.78
Save-Row $side 0 $KS $out 'tuskAttack_right' 'feet' 'tuskAttack_left'
Save-Row $side 1 $KS $out 'chargePrepare_right' 'feet' 'chargePrepare_left'
Save-Row $side 2 $KS $out 'charge_right' 'feet' 'charge_left'
Save-Row $side 3 $KS $out 'stomp_right' 'feet' 'stomp_left'
Save-Row $side 4 $KS $out 'roar_right' 'feet' 'roar_left'
Save-Row $side 5 $KS $out 'right' 'feet' 'left'
$KF = 0.3; $KB = 0.34
$s = Get-Frames 'boar_roar_down.png' 1 3;  Save-Row $s 0 $KF $out 'roar_down'
$s = Get-Frames 'boar_roar_up.png' 1 3;    Save-Row $s 0 $KB $out 'roar_up'
# sheet 2 (front / back): walk, tusk, charge prepare, charge. Scale matched to the body size of the pictures above
$K2 = 0.66
$s = Get-Frames 'boar_sheet2_down.png' 4 3
Save-Row $s 0 $K2 $out 'down'; Save-Row $s 1 $K2 $out 'tuskAttack_down'; Save-Row $s 2 $K2 $out 'chargePrepare_down'; Save-Row $s 3 $K2 $out 'charge_down'
$s = Get-Frames 'boar_sheet2_up.png' 4 3
# charge (back view) is tall: a little smaller so it stays inside the frame
Save-Row $s 0 $K2 $out 'up'; Save-Row $s 1 $K2 $out 'tuskAttack_up'; Save-Row $s 2 $K2 $out 'chargePrepare_up'; Save-Row $s 3 0.64 $out 'charge_up'
$s = Get-Frames 'boar_stomp_down.png' 1 3; Save-Row $s 0 $KF $out 'stomp_down'
$s = Get-Frames 'boar_stomp_up.png' 1 3;   Save-Row $s 0 $KB $out 'stomp_up'

# ---------------- black corrupted wolf ----------------
$out = "$root/js_version/assets/enemies/black_corrupted_wolf"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem "$out/*.png" -ErrorAction SilentlyContinue | Remove-Item
$side = Get-Frames 'wolf_side_sheet.png' 6 3
$KS = 0.72
Save-Row $side 0 $KS $out @('run_right', 'right') 'feet' @('run_left', 'left')
Save-Row $side 1 $KS $out 'bite_right' 'feet' 'bite_left'
Save-Row $side 2 $KS $out 'claw_right' 'feet' 'claw_left'
Save-Row $side 3 $KS $out 'leapPrepare_right' 'feet' 'leapPrepare_left'
Save-Row $side 4 $KS $out 'leap_right' 'union' 'leap_left'
Save-Row $side 5 $KS $out 'howl_right' 'feet' 'howl_left'
$KF = 0.28; $KB = 0.3
$s = Get-Frames 'wolf_howl_down.png' 1 3; Save-Row $s 0 $KF $out 'howl_down'
$s = Get-Frames 'wolf_claw_down.png' 1 3; Save-Row $s 0 $KF $out 'claw_down'
# sheet 2 (front / back): walk, run, bite, leap prepare, leap
$K2 = 0.66
$s = Get-Frames "wolf_sheet2_down.png" 5 3
Save-Row $s 0 $K2 $out 'down'; Save-Row $s 1 $K2 $out 'run_down'; Save-Row $s 2 $K2 $out 'bite_down'
Save-Row $s 3 $K2 $out 'leapPrepare_down'; Save-Row $s 4 $K2 $out 'leap_down'
# back view: the tail swings left and right a lot, so every up frame is lined up on the head + shoulders
# and scaled to the same body size as the walk (no shaking between frames or motions)
$s = Get-Frames "wolf_sheet2_up.png" 5 3
$fit = @{ axis = 0.45; mass = (Get-RowMass $s 0 $K2); lo = 0.88; hi = 1.12 }
Save-Row $s 0 $K2 $out 'up' 'feet' $null @(0, 1, 2) $fit; Save-Row $s 1 $K2 $out 'run_up' 'feet' $null @(0, 1, 2) $fit
Save-Row $s 2 $K2 $out 'bite_up' 'feet' $null @(0, 1, 2) $fit; Save-Row $s 3 $K2 $out 'leapPrepare_up' 'feet' $null @(0, 1, 2) $fit
Save-Row $s 4 $K2 $out 'leap_up' 'feet' $null @(0, 1, 2) $fit
$s = Get-Frames 'wolf_howl_up.png' 1 3; Save-Row $s 0 $KB $out 'howl_up' 'feet' $null @(0, 1, 2) $fit
$s = Get-Frames 'wolf_claw_up.png' 1 3; Save-Row $s 0 $KB $out 'claw_up' 'feet' $null @(0, 1, 2) $fit

# ---------------- effects ----------------
$fxDir = "$root/js_version/assets/effects/boss"
New-Item -ItemType Directory -Force $fxDir | Out-Null
Get-ChildItem "$fxDir/*.png" -ErrorAction SilentlyContinue | Remove-Item

# whole picture, trimmed, scaled so the longer side is $size
function Save-Fx($file, $name, $size) {
    $sh = [Sheet]::Load("$src/$file")
    $parts = $sh.Parts(20, 2, 40)
    $x0 = ($parts | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
    $y0 = ($parts | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
    $x1 = ($parts | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
    $y1 = ($parts | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
    $k = $size / [math]::Max($x1 - $x0, $y1 - $y0)
    $fr = New-Object Frame ([int]$size + 4)
    $ox = ($size + 4 - ($x1 - $x0) * $k) / 2; $oy = ($size + 4 - ($y1 - $y0) * $k) / 2
    foreach ($p in $parts) { $fr.Put($p.Bmp, $ox + ($p.X - $x0) * $k, $oy + ($p.Y - $y0) * $k, $k) }
    $fr.Save("$fxDir/$name.png", $false); $fr.Dispose()
}
# 3 frames side by side (rings): each frame centered in its own square
function Save-FxRow($file, $name, $size) {
    $sh = [Sheet]::Load("$src/$file")
    $parts = $sh.Parts(20, 2, 40)
    $cw = $sh.W / 3
    for ($c = 0; $c -lt 3; $c++) {
        $ps = @($parts | Where-Object { [math]::Floor($_.Cx / $cw) -eq $c })
        # keep only pieces near the main ring of this frame (stray rocks of the next frame are dropped)
        $main = $ps | Sort-Object { $_.W * $_.H } -Descending | Select-Object -First 1
        $ps = @($ps | Where-Object { $_.Cx -ge $main.X - 30 -and $_.Cx -le $main.X + $main.W + 30 -and $_.Cy -ge $main.Y - 30 -and $_.Cy -le $main.Y + $main.H + 30 })
        $x0 = ($ps | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
        $y0 = ($ps | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
        $x1 = ($ps | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
        $y1 = ($ps | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
        $k = $size / [math]::Max($x1 - $x0, $y1 - $y0)
        $fr = New-Object Frame ([int]$size + 4)
        $ox = ($size + 4 - ($x1 - $x0) * $k) / 2; $oy = ($size + 4 - ($y1 - $y0) * $k) / 2
        foreach ($p in $ps) { $fr.Put($p.Bmp, $ox + ($p.X - $x0) * $k, $oy + ($p.Y - $y0) * $k, $k) }
        $fr.Save("$fxDir/$($name)_$($c + 1).png", $false); $fr.Dispose()
    }
}
Save-Fx 'fx_dust.png' 'dust_cloud' 220
Save-Fx 'fx_rock_burst.png' 'rock_burst' 240
Save-Fx 'fx_corrupt_shot.png' 'corrupt_shot' 160
Save-Fx 'fx_claw_slash.png' 'claw_slash' 220
Save-Fx 'fx_bite.png' 'bite_fangs' 200
Save-FxRow 'fx_boar_ring.png' 'boar_ring' 300
Save-FxRow 'fx_corrupt_ring.png' 'corrupt_ring' 300
"done"
