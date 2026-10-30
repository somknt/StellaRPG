# Contact sheet of the HUD parts (art_source/hud/preview.png) on a dark background
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$ui = [IO.Path]::GetFullPath((Join-Path $root '..\..\js_version\assets\ui'))
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $here 'Hud.cs'))) -ReferencedAssemblies System.Drawing
$W = 1000; $H = 760
$c = [Hud]::Blank($W, $H)
$c.FillRect(0, 0, $W, $H, 40, 44, 58, 255)
$c.FillRect(500, 0, 500, $H, 96, 120, 80, 255)
$at = @(
    @('hud\level_bar.png', 10, 10), @('hud\magic_bar.png', 10, 130), @('hud\nameplate.png', 10, 220),
    @('hud\orb_fire.png', 10, 320), @('hud\orb_water.png', 70, 320), @('hud\orb_wind.png', 130, 320), @('hud\orb_earth.png', 190, 320),
    @('hud\orb_thunder.png', 250, 320), @('hud\orb_heal.png', 310, 320), @('hud\orb_light.png', 370, 320), @('hud\orb_ice.png', 430, 320), @('hud\orb_none.png', 10, 380),
    @('magic_palette\element_heal.png', 520, 10), @('magic_palette\element_water.png', 700, 10)
)
foreach ($a in $at) { $c.Paste([Hud]::Load((Join-Path $ui $a[0])), $a[1], $a[2]) }
$fr = [Hud]::Load((Join-Path $ui 'status_frame.png'))
$c.Paste($fr, 10, 440)
$c.Paste([Hud]::Load((Join-Path $ui 'hud\status_fill_hp_low.png')), 10, 440)
$c.Paste([Hud]::Load((Join-Path $ui 'hud\status_emblem_red.png')), 10, 440)
$c.Save((Join-Path $root 'preview.png'))
'ok'
