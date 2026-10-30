using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// HUD の部品を作る道具（cut.ps1 から使う）
// 画像は BGRA の byte 配列で持つ（D[i]=B, D[i+1]=G, D[i+2]=R, D[i+3]=A）
public class Hud {
    public int W, H; public byte[] D;

    public static Hud Blank(int w, int h) { var o = new Hud(); o.W = w; o.H = h; o.D = new byte[w * h * 4]; return o; }

    public static Hud Load(string path) {
        using (var b0 = new Bitmap(path)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) { g.DrawImage(b0, 0, 0, b0.Width, b0.Height); }
            var o = Blank(b.Width, b.Height);
            var bd = b.LockBits(new Rectangle(0, 0, o.W, o.H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, o.D, 0, o.D.Length); b.UnlockBits(bd); b.Dispose();
            return o;
        }
    }

    Bitmap ToBitmap() {
        var b = new Bitmap(W, H, PixelFormat.Format32bppArgb);
        var bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(D, 0, bd.Scan0, D.Length); b.UnlockBits(bd);
        return b;
    }

    public void Save(string path) { using (var b = ToBitmap()) b.Save(path, ImageFormat.Png); }

    public Hud Clone() { var o = Blank(W, H); Array.Copy(D, o.D, D.Length); return o; }

    public Hud Crop(int x, int y, int w, int h) {
        var o = Blank(w, h);
        for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
            int sx = x + i, sy = y + j; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
            Array.Copy(D, (sy * W + sx) * 4, o.D, (j * w + i) * 4, 4);
        }
        return o;
    }

    public Hud FlipX() {
        var o = Blank(W, H);
        for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) Array.Copy(D, (j * W + i) * 4, o.D, (j * W + (W - 1 - i)) * 4, 4);
        return o;
    }

    // なめらかに拡大縮小（ふちの半透明がにじまないように、事前乗算アルファで計算）
    public Hud Scale(int w, int h) {
        using (var src = ToBitmap()) {
            var pre = new Bitmap(W, H, PixelFormat.Format32bppPArgb);
            using (var g = Graphics.FromImage(pre)) { g.CompositingMode = CompositingMode.SourceCopy; g.DrawImage(src, 0, 0, W, H); }
            var dst = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (var g = Graphics.FromImage(dst)) {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                using (var ia = new ImageAttributes()) {
                    ia.SetWrapMode(WrapMode.TileFlipXY);
                    g.DrawImage(pre, new Rectangle(0, 0, w, h), 0, 0, W, H, GraphicsUnit.Pixel, ia);
                }
            }
            pre.Dispose();
            var outb = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(outb)) { g.CompositingMode = CompositingMode.SourceCopy; g.DrawImage(dst, 0, 0, w, h); }
            dst.Dispose();
            var o = Blank(w, h);
            var bd = outb.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, o.D, 0, o.D.Length); outb.UnlockBits(bd); outb.Dispose();
            return o;
        }
    }

    public Hud ScaleBy(double k) { return Scale(Math.Max(1, (int)Math.Round(W * k)), Math.Max(1, (int)Math.Round(H * k))); }

    // ふつうの重ね合わせ（src を (x, y) に置く）
    public void Paste(Hud s, int x, int y) {
        for (int j = 0; j < s.H; j++) for (int i = 0; i < s.W; i++) {
            int dx = x + i, dy = y + j; if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
            int si = (j * s.W + i) * 4, di = (dy * W + dx) * 4;
            double sa = s.D[si + 3] / 255.0; if (sa <= 0) continue;
            double da = D[di + 3] / 255.0;
            double oa = sa + da * (1 - sa);
            for (int c = 0; c < 3; c++) {
                double v = (s.D[si + c] * sa + D[di + c] * da * (1 - sa)) / oa;
                D[di + c] = (byte)Math.Max(0, Math.Min(255, Math.Round(v)));
            }
            D[di + 3] = (byte)Math.Round(oa * 255);
        }
    }

    // ---------- 色 ----------
    public static void ToHsv(int r, int g, int b, out double h, out double s, out double v) {
        double R = r / 255.0, G = g / 255.0, B = b / 255.0;
        double max = Math.Max(R, Math.Max(G, B)), min = Math.Min(R, Math.Min(G, B)), d = max - min;
        v = max; s = max <= 0 ? 0 : d / max;
        if (d <= 0) { h = 0; return; }
        if (max == R) h = 60 * (((G - B) / d) % 6);
        else if (max == G) h = 60 * ((B - R) / d + 2);
        else h = 60 * ((R - G) / d + 4);
        if (h < 0) h += 360;
    }

    public static void FromHsv(double h, double s, double v, out int r, out int g, out int b) {
        h = ((h % 360) + 360) % 360; s = Math.Max(0, Math.Min(1, s)); v = Math.Max(0, Math.Min(1, v));
        double c = v * s, x = c * (1 - Math.Abs((h / 60) % 2 - 1)), m = v - c, R = 0, G = 0, B = 0;
        if (h < 60) { R = c; G = x; } else if (h < 120) { R = x; G = c; } else if (h < 180) { G = c; B = x; }
        else if (h < 240) { G = x; B = c; } else if (h < 300) { R = x; B = c; } else { R = c; B = x; }
        r = (int)Math.Round((R + m) * 255); g = (int)Math.Round((G + m) * 255); b = (int)Math.Round((B + m) * 255);
    }

    static bool InHue(double h, double h0, double h1) { return h0 <= h1 ? (h >= h0 && h <= h1) : (h >= h0 || h <= h1); }

    // 色相が h0〜h1（0〜360。h0 > h1 なら 0 をまたぐ）で、彩度が minS 以上の色だけ、色相を shift だけ回す
    // 彩度は sMul 倍、明るさは vMul 倍。rect を指定したら、その中だけ
    public void ShiftHue(double h0, double h1, double minS, double shift, double sMul, double vMul, int rx, int ry, int rw, int rh) {
        for (int y = Math.Max(0, ry); y < Math.Min(H, ry + rh); y++) for (int x = Math.Max(0, rx); x < Math.Min(W, rx + rw); x++) {
            int i = (y * W + x) * 4; if (D[i + 3] == 0) continue;
            double h, s, v; ToHsv(D[i + 2], D[i + 1], D[i], out h, out s, out v);
            if (s < minS || !InHue(h, h0, h1)) continue;
            int r, g, b; FromHsv(h + shift, s * sMul, v * vMul, out r, out g, out b);
            D[i] = (byte)b; D[i + 1] = (byte)g; D[i + 2] = (byte)r;
        }
    }
    public void ShiftHue(double h0, double h1, double minS, double shift, double sMul, double vMul) { ShiftHue(h0, h1, minS, shift, sMul, vMul, 0, 0, W, H); }

    // 色相が h0〜h1 の色を、決まった色相 toHue にする（明るさ・彩度はそのまま）
    public void SetHue(double h0, double h1, double minS, double toHue, double sMul, double vMul) {
        for (int i = 0; i < D.Length; i += 4) {
            if (D[i + 3] == 0) continue;
            double h, s, v; ToHsv(D[i + 2], D[i + 1], D[i], out h, out s, out v);
            if (s < minS || !InHue(h, h0, h1)) continue;
            int r, g, b; FromHsv(toHue, s * sMul, v * vMul, out r, out g, out b);
            D[i] = (byte)b; D[i + 1] = (byte)g; D[i + 2] = (byte)r;
        }
    }

    // 灰色にする（無属性の玉）
    public void Gray(double k) {
        for (int i = 0; i < D.Length; i += 4) {
            if (D[i + 3] == 0) continue;
            double l = (D[i + 2] * 0.3 + D[i + 1] * 0.59 + D[i] * 0.11) * k;
            byte v = (byte)Math.Max(0, Math.Min(255, Math.Round(l)));
            D[i] = v; D[i + 1] = v; D[i + 2] = v;
        }
    }

    // 範囲の外を透明にする
    public void KeepRect(int x0, int y0, int x1, int y1) {
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (x < x0 || y < y0 || x > x1 || y > y1) D[(y * W + x) * 4 + 3] = 0;
    }

    // 円の中だけ残す（ふちは1px でなめらかに）
    public void KeepCircle(double cx, double cy, double r) {
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            double d = Math.Sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
            int i = (y * W + x) * 4;
            double k = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : (r + 0.5 - d);
            D[i + 3] = (byte)Math.Round(D[i + 3] * k);
        }
    }

    // 円の中を1色でぬる（ふちは1px でなめらかに）
    public void FillCircle(double cx, double cy, double r, int cr, int cg, int cb) {
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            double d = Math.Sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
            if (d >= r + 0.5) continue;
            double k = d <= r - 0.5 ? 1 : (r + 0.5 - d);
            int i = (y * W + x) * 4;
            D[i] = (byte)Math.Round(D[i] * (1 - k) + cb * k);
            D[i + 1] = (byte)Math.Round(D[i + 1] * (1 - k) + cg * k);
            D[i + 2] = (byte)Math.Round(D[i + 2] * (1 - k) + cr * k);
            D[i + 3] = (byte)Math.Round(D[i + 3] * (1 - k) + 255 * k);
        }
    }

    public void FillRect(int x, int y, int w, int h, int cr, int cg, int cb, int ca) {
        for (int j = Math.Max(0, y); j < Math.Min(H, y + h); j++) for (int i = Math.Max(0, x); i < Math.Min(W, x + w); i++) {
            int k = (j * W + i) * 4; D[k] = (byte)cb; D[k + 1] = (byte)cg; D[k + 2] = (byte)cr; D[k + 3] = (byte)ca;
        }
    }

    // ---------- 調べる ----------
    // 色の条件に合う画素の範囲（x0,y0,x1,y1,数）。kind：'red' / 'dark' / 'blue'
    public string Find(string kind, int rx, int ry, int rw, int rh) {
        int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1, n = 0;
        for (int y = Math.Max(0, ry); y < Math.Min(H, ry + rh); y++) for (int x = Math.Max(0, rx); x < Math.Min(W, rx + rw); x++) {
            int i = (y * W + x) * 4; if (D[i + 3] < 200) continue;
            double h, s, v; ToHsv(D[i + 2], D[i + 1], D[i], out h, out s, out v);
            bool ok = kind == "red" ? (InHue(h, 340, 25) && s > 0.45 && v > 0.35)
                    : kind == "dark" ? (v < 0.2)
                    : kind == "blue" ? (InHue(h, 180, 250) && s > 0.3)
                    : false;
            if (!ok) continue;
            n++; x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y);
        }
        return x0 + "," + y0 + "," + x1 + "," + y1 + "," + n;
    }

    public string Px(int x, int y) {
        int i = (y * W + x) * 4; return D[i + 2] + "," + D[i + 1] + "," + D[i] + "," + D[i + 3];
    }

    // 1行（y）を左から右へ：色が変わる所を出す（形を調べる用）
    public string Row(int y, int x0, int x1, int step) {
        var sb = new System.Text.StringBuilder();
        for (int x = x0; x <= x1; x += step) sb.Append(x + ":" + Px(x, y) + " ");
        return sb.ToString();
    }
    public string Col(int x, int y0, int y1, int step) {
        var sb = new System.Text.StringBuilder();
        for (int y = y0; y <= y1; y += step) sb.Append(y + ":" + Px(x, y) + " ");
        return sb.ToString();
    }

    // ---------- 星の宝石（ヒールのアイコン用） ----------
    // 低い解像度（n×n）で絵を作って、k 倍に拡大した物を返す（ドット絵らしく、ぼかさずに）
    public static Hud PixelArt(int n, int k, Func<int, int, int[]> color) {
        var o = Blank(n * k, n * k);
        for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) {
            var c = color(x, y); if (c == null || c[3] == 0) continue;
            o.FillRect(x * k, y * k, k, k, c[0], c[1], c[2], c[3]);
        }
        return o;
    }
}
