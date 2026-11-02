# 酒場の「走る」ボタンのシルエット（js_version/assets/ui/buttons/sil_run_*.png）を作る
# 主人公のダッシュの絵（右向き。足が開いているコマ）を白い型にして、足元の土ぼこりは消す（いちばん大きいかたまりだけ残す）
# 絵のふちの暗い線は透明にして、手足・マント・髪の形が分かるようにする
# 攻撃・回避・魔法のボタンのシルエット（sil_*.png）と同じ 256×256・白・まわりは透明
# 実行：powershell -NoProfile -ExecutionPolicy Bypass -File <このファイルのフルパス>
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class RunSil {
    // line：この明るさより暗い所（絵のふちの線）は透明にする。手足・マント・髪の形が分かるように
    public static void Make(string src, string dst, int size, int pad, int line) {
        using (var b = new Bitmap(src)) {
            int w = b.Width, h = b.Height;
            var on = new bool[w, h];
            var bright = new bool[w, h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                var c = b.GetPixel(x, y);
                on[x, y] = c.A > 60;
                bright[x, y] = 0.3 * c.R + 0.59 * c.G + 0.11 * c.B > line;
            }
            // いちばん大きいかたまり（つながっている所）だけ残す
            var id = new int[w, h];
            int best = 0, bestN = 0, cur = 0;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                if (!on[x, y] || id[x, y] != 0) continue;
                cur++;
                int n = 0;
                var q = new Stack<int[]>();
                q.Push(new[] { x, y }); id[x, y] = cur;
                while (q.Count > 0) {
                    var p = q.Pop(); n++;
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                        int nx = p[0] + dx, ny = p[1] + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !on[nx, ny] || id[nx, ny] != 0) continue;
                        id[nx, ny] = cur; q.Push(new[] { nx, ny });
                    }
                }
                if (n > bestN) { bestN = n; best = cur; }
            }
            int x0 = w, y0 = h, x1 = -1, y1 = -1;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (id[x, y] == best) {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            int cw = x1 - x0 + 1, ch = y1 - y0 + 1;
            using (var m = new Bitmap(cw, ch, PixelFormat.Format32bppArgb)) {
                for (int y = 0; y < ch; y++) for (int x = 0; x < cw; x++)
                    m.SetPixel(x, y, id[x + x0, y + y0] == best && bright[x + x0, y + y0] ? Color.White : Color.Transparent);
                float k = Math.Min((size - pad * 2f) / cw, (size - pad * 2f) / ch);
                int dw = (int)Math.Round(cw * k), dh = (int)Math.Round(ch * k);
                using (var o = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (var g = Graphics.FromImage(o)) {
                    g.Clear(Color.Transparent);
                    // ドット絵なので、ぼかさずに拡大する（小さく出してもふちの線のすき間が残るように）
                    g.InterpolationMode = InterpolationMode.NearestNeighbor;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.DrawImage(m, new Rectangle((size - dw) / 2, (size - dh) / 2, dw, dh));
                    o.Save(dst, ImageFormat.Png);
                }
            }
        }
    }
}
"@
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
foreach ($g in @(@('male', 3), @('female', 2))) {
    $src = Join-Path $root "js_version\assets\characters\$($g[0])\dash_right_$($g[1]).png"
    $dst = Join-Path $root "js_version\assets\ui\buttons\sil_run_$($g[0]).png"
    [RunSil]::Make($src, $dst, 256, 10, 32)
    Write-Output "作りました: $dst"
}
