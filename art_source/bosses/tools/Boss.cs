using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// Cut boss sprite sheets (transparent PNG) into frames.
// Parts = connected blobs of opaque pixels (on a coarse grid so thin gaps still split frames).
public class Part {
    public int Id, X, Y, W, H;
    public double Cx { get { return X + W / 2.0; } }
    public double Cy { get { return Y + H / 2.0; } }
    public Bitmap Bmp;
}

public class Sheet {
    public int W, H; public byte[] D;
    int gap, cw, ch; int[] lab;

    public static Sheet Load(string path) {
        using (var b0 = new Bitmap(path)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) { g.DrawImage(b0, 0, 0, b0.Width, b0.Height); }
            var s = new Sheet(); s.W = b.Width; s.H = b.Height; s.D = new byte[s.W * s.H * 4];
            var bd = b.LockBits(new Rectangle(0, 0, s.W, s.H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, s.D, 0, s.D.Length); b.UnlockBits(bd); b.Dispose();
            return s;
        }
    }

    int A(int x, int y) { return D[(y * W + x) * 4 + 3]; }

    public List<Part> Parts(int thr, int g, int minArea) {
        gap = g; cw = (W + g - 1) / g; ch = (H + g - 1) / g;
        var cnt = new int[cw * ch];
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (A(x, y) >= thr) cnt[(y / g) * cw + x / g]++;
        lab = new int[cw * ch];
        var res = new List<Part>(); int next = 1;
        for (int s = 0; s < lab.Length; s++) {
            if (cnt[s] < 2 || lab[s] != 0) continue;
            int id = next++;
            var st = new Stack<int>(); st.Push(s); lab[s] = id;
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = 0, y1 = 0, n = 0;
            while (st.Count > 0) {
                int c = st.Pop(); int cx = c % cw, cy = c / cw; n++;
                x0 = Math.Min(x0, cx); y0 = Math.Min(y0, cy); x1 = Math.Max(x1, cx); y1 = Math.Max(y1, cy);
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
                    int k = ny * cw + nx; if (cnt[k] >= 2 && lab[k] == 0) { lab[k] = id; st.Push(k); }
                }
            }
            if (n * g * g < minArea) { Relabel(id, -1); continue; }
            var p = new Part(); p.Id = id;
            int px0 = W, py0 = H, px1 = 0, py1 = 0;
            for (int y = Math.Max(0, (y0 - 1) * g); y < Math.Min(H, (y1 + 2) * g); y++)
                for (int x = Math.Max(0, (x0 - 1) * g); x < Math.Min(W, (x1 + 2) * g); x++)
                    if (A(x, y) > 0 && Owner(x, y) == id) { px0 = Math.Min(px0, x); py0 = Math.Min(py0, y); px1 = Math.Max(px1, x); py1 = Math.Max(py1, y); }
            p.X = px0; p.Y = py0; p.W = px1 - px0 + 1; p.H = py1 - py0 + 1;
            res.Add(p);
        }
        foreach (var p in res) p.Bmp = Extract(p);
        return res;
    }

    void Relabel(int from, int to) { for (int i = 0; i < lab.Length; i++) if (lab[i] == from) lab[i] = to; }

    // Which part owns this pixel: its own cell, or (for faint fringe pixels) a neighbouring cell
    int Owner(int x, int y) {
        int cx = x / gap, cy = y / gap; int l = lab[cy * cw + cx];
        if (l > 0) return l;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            int nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
            int k = lab[ny * cw + nx]; if (k > 0) return k;
        }
        return 0;
    }

    Bitmap Extract(Part p) {
        var o = new byte[p.W * p.H * 4];
        for (int j = 0; j < p.H; j++) for (int i = 0; i < p.W; i++) {
            int x = p.X + i, y = p.Y + j;
            if (Owner(x, y) != p.Id) continue;
            int si = (y * W + x) * 4, di = (j * p.W + i) * 4;
            o[di] = D[si]; o[di + 1] = D[si + 1]; o[di + 2] = D[si + 2]; o[di + 3] = D[si + 3];
        }
        var b = new Bitmap(p.W, p.H, PixelFormat.Format32bppArgb);
        var bd = b.LockBits(new Rectangle(0, 0, p.W, p.H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(o, 0, bd.Scan0, o.Length); b.UnlockBits(bd);
        return b;
    }
}

public static class Axis {
    // alpha-weighted sums { x, y, weight } over rows [y0, y1) of the bitmap (local coords).
    // Used to find the body axis (head / shoulders) and the center of mass
    public static double[] Sum(Bitmap b, int y0, int y1) {
        double sx = 0, sy = 0, sw = 0;
        y0 = Math.Max(0, y0); y1 = Math.Min(b.Height, y1);
        if (y1 <= y0) return new double[] { 0, 0, 0 };
        var bd = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var d = new byte[b.Width * b.Height * 4];
        Marshal.Copy(bd.Scan0, d, 0, d.Length); b.UnlockBits(bd);
        for (int y = y0; y < y1; y++) for (int x = 0; x < b.Width; x++) {
            int a = d[(y * b.Width + x) * 4 + 3]; if (a < 100) continue;
            sx += x * a; sy += y * a; sw += a;
        }
        return new double[] { sx, sy, sw };
    }
}

public class Frame {
    Bitmap b; Graphics g; int F;
    // Square frame of size F. Draw parts with Put(), then Save()
    public Frame(int size) {
        F = size; b = new Bitmap(F, F, PixelFormat.Format32bppArgb); g = Graphics.FromImage(b);
        g.Clear(Color.Transparent);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
    }
    // (x, y) = top-left of the part in frame pixels, k = scale
    public void Put(Bitmap part, double x, double y, double k) {
        using (var ia = new ImageAttributes()) {
            ia.SetWrapMode(WrapMode.TileFlipXY);
            g.DrawImage(part, new RectangleF((float)x, (float)y, (float)(part.Width * k), (float)(part.Height * k)), new RectangleF(0, 0, part.Width, part.Height), GraphicsUnit.Pixel);
        }
    }
    public void Save(string dst, bool flip) {
        if (flip) {
            using (var c = (Bitmap)b.Clone()) { c.RotateFlip(RotateFlipType.RotateNoneFlipX); c.Save(dst, ImageFormat.Png); }
        } else b.Save(dst, ImageFormat.Png);
    }
    public void Dispose() { g.Dispose(); b.Dispose(); }

    // Save a part scaled (effects): width = part.W * k, trimmed canvas
    public static void SaveScaled(string dst, Bitmap part, double k, int pad) {
        int w = (int)Math.Round(part.Width * k) + pad * 2, h = (int)Math.Round(part.Height * k) + pad * 2;
        using (var b = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(b)) {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            using (var ia = new ImageAttributes()) {
                ia.SetWrapMode(WrapMode.TileFlipXY);
                g.DrawImage(part, new Rectangle(pad, pad, w - pad * 2, h - pad * 2), 0, 0, part.Width, part.Height, GraphicsUnit.Pixel, ia);
            }
            b.Save(dst, ImageFormat.Png);
        }
    }

    // Put several bitmaps (same canvas size S, centered) together, then save (used for ring effects)
    public static void SaveCentered(string dst, Bitmap part, int S, double k) {
        using (var b = new Bitmap(S, S, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(b)) {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            float w = (float)(part.Width * k), h = (float)(part.Height * k);
            using (var ia = new ImageAttributes()) {
                ia.SetWrapMode(WrapMode.TileFlipXY);
                g.DrawImage(part, new Rectangle((int)Math.Round((S - w) / 2), (int)Math.Round((S - h) / 2), (int)Math.Round(w), (int)Math.Round(h)), 0, 0, part.Width, part.Height, GraphicsUnit.Pixel, ia);
            }
            b.Save(dst, ImageFormat.Png);
        }
    }
}
