# 魔法エフェクトのシートを切り出して js_version/assets/effects/ に置く
#   src/magic_effects_sheet.png ：魔法陣5つ・炎・水・風・雷（ChatGPT「魔法属性エフェクト素材シート」）
#   src/stone_cannon_sheet.png  ：ストーンキャノン（飛ぶ岩・砕ける・砂ぼこり。「岩石魔法弾の爆発スプライト集」）
#   src/heal_effects_sheet.png  ：ヒール（治癒の魔法陣・立ちのぼる光・十字・星のきらめき。「緑とシアンの魔法エフェクト素材集」）
# 使い方：art_source/magic で  powershell -ExecutionPolicy Bypass -File tools/cut.ps1
# 出力：assets/effects/magic_circle_<属性>.png、assets/effects/magic/<名前>_<コマ>.png、meta.txt（magic.js の MAGIC_FX に写す値）
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Add-Type -Path (Join-Path $PSScriptRoot 'Fx.cs') -ReferencedAssemblies System.Drawing
$game = Resolve-Path (Join-Path $root '..\..\js_version\assets\effects')
$out = Join-Path $game 'magic'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$meta = @()

# 1行ぶん：$cells = @(@(x0,y0,x1,y1), ...)。$faint があれば、芯のないコマは alpha >= $faint の所を芯にする
function Cut-Row($cut, $name, $cells, $anchor, $square = $false, $faint = 0) {
    $frames = New-Object 'System.Collections.Generic.List[FxCut+Frm]'
    foreach ($c in $cells) {
        $f = $cut.Take($c[0], $c[1], $c[2], $c[3], $anchor, 6)
        if ($f -eq $null) { throw "コマが見つかりません: $name $($c -join ',')" }
        $frames.Add($f)
    }
    $script:meta += [FxCut]::SaveRow($frames, $out, $name, $square)
    Write-Host "$name : $($frames.Count) コマ"
}

# ---------- 魔法属性エフェクト素材シート（1536x1024）----------
$cut = New-Object FxCut (Join-Path $root 'src\magic_effects_sheet.png')
$cut.FindSeeds(150, 5, 300)
# 消えかけのうすいコマ（芯が見つからない所）は、うすい所から芯を作る
foreach ($r in @(@(1012, 400, 1072, 540, 60), @(1300, 615, 1440, 900, 90))) {
    if (-not $cut.HasSeedIn($r[0], $r[1], $r[2], $r[3])) { $cut.AddSeedFromRegion($r[0], $r[1], $r[2], $r[3], $r[4]) }
}
# 雷の地面の光の最後（点々に散った輪）は、小さな芯が1つしか残らず輪が欠けるので、範囲ぜんたいを芯にする
$cut.ForceSeed(1350, 900, 1520, 1024, 40)
$cut.Assign(150, 26)

Cut-Row $cut 'circle' @(@(20,0,300,275), @(300,0,585,275), @(585,0,860,275), @(860,0,1140,275), @(1140,0,1430,275)) 'center' $true
Cut-Row $cut 'fire_fly'  @(@(10,280,170,388), @(170,280,310,388), @(310,280,455,388), @(455,280,600,388)) 'right'
Cut-Row $cut 'fire_hit'  @(@(10,388,145,520), @(145,388,305,520), @(305,388,460,520), @(460,388,600,520)) 'center'
Cut-Row $cut 'fire_burn' @(@(20,520,155,630), @(155,520,300,630), @(300,520,445,630), @(445,520,600,630)) 'bottom'
Cut-Row $cut 'water_fly' @(@(605,290,765,400), @(765,290,910,400), @(910,290,1070,400)) 'right'
Cut-Row $cut 'water_hit' @(@(605,400,745,545), @(745,400,880,545), @(880,400,1012,545), @(1012,400,1072,545)) 'center'
Cut-Row $cut 'wind_loop' @(@(1075,270,1225,478), @(1225,270,1375,478), @(1375,270,1530,478)) 'bottom'
Cut-Row $cut 'wind_edge' @(@(1060,478,1170,612), @(1170,478,1288,612), @(1288,478,1405,612), @(1405,478,1510,612)) 'bottom'
Cut-Row $cut 'thunder_bolt'  @(@(780,598,945,900), @(945,598,1125,900), @(1125,598,1300,900), @(1300,598,1440,900)) 'bottom'
Cut-Row $cut 'thunder_flash' @(@(740,900,942,1024), @(942,900,1155,1024), @(1155,900,1350,1024), @(1350,900,1520,1024)) 'center'

# 魔法陣は magic_circle_<属性>.png（magic.js の drawMagicCircle が使う）
$i = 1
foreach ($k in 'fire', 'water', 'wind', 'earth', 'thunder') {
    Move-Item -Force (Join-Path $out "circle_$i.png") (Join-Path $game "magic_circle_$k.png"); $i++
}

# ---------- 岩石魔法弾の爆発スプライト集（1448x1086）：ストーンキャノン ----------
$st = New-Object FxCut (Join-Path $root 'src\stone_cannon_sheet.png')
$st.FindSeeds(150, 5, 300)
$st.Assign(150, 30)
Cut-Row $st 'stone_fly'  @(@(20,120,365,330), @(365,120,722,330), @(722,120,1085,330), @(1085,120,1440,330)) 'right'
Cut-Row $st 'stone_hit'  @(@(20,400,380,760), @(380,400,770,760), @(770,400,1100,760), @(1100,400,1440,760)) 'bright'
Cut-Row $st 'stone_dust' @(@(60,800,380,1060), @(380,800,740,1060), @(740,800,1100,1060), @(1100,800,1420,1060)) 'center'

# ---------- 緑とシアンの魔法エフェクト素材集（1536x1024）：ヒール ----------
# 使うのは一部だけ。1段目：左はしの魔法陣、右の3つ（輪から光がのびていく）/ 2段目：十字が立ちのぼる光の2つ
# 3段目：左の2つ（星のきらめき）/ 4段目：十字の粒
$healSheet = Join-Path $root 'src\heal_effects_sheet.png'
# 魔法陣：大きな芯だけを芯にする（まわりの小さなきらめきで中心がずれないように）
$hc = New-Object FxCut $healSheet
$hc.FindSeeds(150, 5, 300)
$hc.Assign(150, 60)
# 1コマだけの行は @(,@(...)) と書く（@(@(...)) だと PowerShell が1段の配列にしてしまう）
Cut-Row $hc 'circle_heal' @(,@(0,0,280,316)) 'center' $true
Move-Item -Force (Join-Path $out 'circle_heal_1.png') (Join-Path $game 'magic_circle_heal.png')
# ほかのコマ：コマの間が広いので、まわりに散った小さなきらめきも芯にして、そのコマに入れる
$hl = New-Object FxCut $healSheet
$hl.FindSeeds(150, 4, 12)
$hl.Assign(150, 60)
Cut-Row $hl 'heal_rise'  @(@(755,0,985,316), @(985,0,1237,316), @(1237,0,1536,316)) 'bottom'
Cut-Row $hl 'heal_cross' @(@(895,316,1090,551), @(1090,316,1325,551)) 'bottom'
Cut-Row $hl 'heal_star'  @(@(200,551,400,731), @(0,551,200,731)) 'bright'
Cut-Row $hl 'heal_plus'  @(,@(665,731,815,866)) 'center'

$meta | Set-Content -Encoding UTF8 (Join-Path $root 'meta.txt')
$meta
