# 新しいバーテンダー（髭のバーテンダー）の絵を切り出す
#   入力：art_source/tavern/bartender/bartender_sheet_a.png（髭のバーテンダー・ドット絵スプライトシート）
#         art_source/tavern/bartender/bartender_sheet_b.png（バーテンダーの多彩なアクションスプライトシート）
#   1. 透明でない所の行・列のすき間から、1コマずつの場所を見つける（tools/bartender_contact.png に番号つきで出す）
#   2. bartender_pick.txt の コマ を、まわりの透明を切って（足の真ん中を絵の真ん中にして） js_version/assets/tiles/tavern/tv_bar_<名前>.png に書く
# 実行：powershell -NoProfile -ExecutionPolicy Bypass -File <このファイルのフルパス>
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
public static class Bar {
    // 透明でない所が続く区間（gap 以上あいたら切る・min より短い区間は捨てる）
    static List<int[]> Runs(int[] v, int gap, int min) {
        var o = new List<int[]>();
        int s = -1, last = -1;
        for (int i = 0; i < v.Length; i++) {
            if (v[i] > 0) { if (s < 0) s = i; last = i; }
            else if (s >= 0 && i - last > gap) { if (last - s + 1 >= min) o.Add(new[] { s, last }); s = -1; }
        }
        if (s >= 0 && last - s + 1 >= min) o.Add(new[] { s, last });
        return o;
    }
    // コマの場所 [行, 列, x, y, w, h]
    public static List<int[]> Find(Bitmap b) {
        int w = b.Width, h = b.Height;
        var a = new bool[w, h];
        var rowSum = new int[h];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (b.GetPixel(x, y).A > 40) { a[x, y] = true; rowSum[y]++; }
        var outp = new List<int[]>();
        var rows = Runs(rowSum, 6, 60);
        for (int r = 0; r < rows.Count; r++) {
            int y0 = rows[r][0], y1 = rows[r][1];
            var col = new int[w];
            for (int x = 0; x < w; x++) for (int y = y0; y <= y1; y++) if (a[x, y]) col[x]++;
            var cols = Runs(col, 5, 40);
            for (int c = 0; c < cols.Count; c++) {
                int x0 = cols[c][0], x1 = cols[c][1];
                int ty = y1, by = y0;
                for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) if (a[x, y]) { if (y < ty) ty = y; if (y > by) by = y; }
                outp.Add(new[] { r, c, x0, ty, x1 - x0 + 1, by - ty + 1 });
            }
        }
        return outp;
    }
    // 足（下の 1/4）の真ん中が絵の真ん中に来るよう、左右に透明を足して書く（腕をのばしても体がずれない）
    public static void Save(Bitmap b, int x, int y, int w, int h, string path) {
        long sx = 0, n = 0;
        for (int yy = y + h * 3 / 4; yy < y + h; yy++) for (int xx = x; xx < x + w; xx++) if (b.GetPixel(xx, yy).A > 40) { sx += xx - x; n++; }
        int ax = n > 0 ? (int)Math.Round((double)sx / n) : w / 2;
        int half = Math.Max(ax, w - ax) + 1;
        using (var o = new Bitmap(half * 2, h, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(o)) {
                g.Clear(Color.Transparent);
                g.DrawImage(b, new Rectangle(half - ax, 0, w, h), new Rectangle(x, y, w, h), GraphicsUnit.Pixel);
            }
            o.Save(path, ImageFormat.Png);
        }
    }
}
"@
$tools = $PSScriptRoot
$src = Join-Path (Split-Path -Parent $tools) 'bartender'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $tools))
$out = Join-Path $root 'js_version\assets\tiles\tavern'

$sheets = @{}
foreach ($s in 'a', 'b') {
    $bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $src "bartender_sheet_$s.png"))
    $sheets[$s] = @{ bmp = $bmp; boxes = [Bar]::Find($bmp) }
    Write-Output "シート $s ：$($sheets[$s].boxes.Count) コマ"
}

# ---------- 確認用：番号（シート 行-列）つきの一覧 ----------
$cw = 150; $ch = 170; $cols = 13
$all = @()
foreach ($s in 'a', 'b') { foreach ($bx in $sheets[$s].boxes) { $all += , @($s, $bx) } }
$rowsN = [Math]::Ceiling($all.Count / $cols)
$contact = New-Object System.Drawing.Bitmap ($cw * $cols), ($ch * $rowsN)
$g = [System.Drawing.Graphics]::FromImage($contact)
$g.Clear([System.Drawing.Color]::FromArgb(48, 40, 60))
$font = New-Object System.Drawing.Font 'Arial', 11, ([System.Drawing.FontStyle]::Bold)
for ($i = 0; $i -lt $all.Count; $i++) {
    $s = $all[$i][0]; $bx = $all[$i][1]
    $k = [Math]::Min(($cw - 10) / $bx[4], ($ch - 26) / $bx[5])
    $dx = ($i % $cols) * $cw; $dy = [Math]::Floor($i / $cols) * $ch
    $g.DrawImage($sheets[$s].bmp, (New-Object System.Drawing.RectangleF ($dx + 5), ($dy + 20), ($bx[4] * $k), ($bx[5] * $k)), (New-Object System.Drawing.RectangleF $bx[2], $bx[3], $bx[4], $bx[5]), [System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawString("$s$($bx[0])-$($bx[1]) $($bx[4])x$($bx[5])", $font, [System.Drawing.Brushes]::Yellow, ($dx + 3), ($dy + 2))
}
$g.Dispose()
$contact.Save((Join-Path $tools 'bartender_contact.png'))
$contact.Dispose()

# ---------- ゲームで使うコマ（名前 = シート, 行, 列） ----------
$pick = [ordered]@{}
if (Test-Path (Join-Path $tools 'bartender_pick.txt')) {
    foreach ($line in Get-Content -Encoding UTF8 (Join-Path $tools 'bartender_pick.txt')) {
        if ($line -match '^\s*([a-z0-9_]+)\s*=\s*([ab])(\d+)-(\d+)') { $pick[$Matches[1]] = @($Matches[2], [int]$Matches[3], [int]$Matches[4]) }
    }
}
$lines = @()
foreach ($name in $pick.Keys) {
    $p = $pick[$name]
    $bx = $sheets[$p[0]].boxes | Where-Object { $_[0] -eq $p[1] -and $_[1] -eq $p[2] } | Select-Object -First 1
    if (-not $bx) { Write-Output "見つからない: $name"; continue }
    [Bar]::Save($sheets[$p[0]].bmp, $bx[2], $bx[3], $bx[4], $bx[5], (Join-Path $out "tv_bar_$name.png"))
    $lines += "tv_bar_$name $($p[0])$($p[1])-$($p[2]) $($bx[2]) $($bx[3]) $($bx[4])x$($bx[5])"
}
if ($lines.Count) { $lines -join "`n" | Set-Content -Encoding UTF8 (Join-Path $tools 'bartender_boxes.txt'); Write-Output "書いたコマ：$($lines.Count)" }
foreach ($s in 'a', 'b') { $sheets[$s].bmp.Dispose() }
