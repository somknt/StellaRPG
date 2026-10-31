using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Img {
    public int W, H; public byte[] D; 
    public static Img Load(string path) {
        using (var b0 = new Bitmap(path)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) { g.DrawImage(b0, 0, 0, b0.Width, b0.Height); }
            var im = new Img(); im.W = b.Width; im.H = b.Height; im.D = new byte[im.W * im.H * 4];
            var bd = b.LockBits(new Rectangle(0, 0, im.W, im.H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, im.D, 0, im.D.Length); b.UnlockBits(bd); b.Dispose();
            return im;
        }
    }
    public void Save(string path) {
        var b = new Bitmap(W, H, PixelFormat.Format32bppArgb);
        var bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(D, 0, bd.Scan0, D.Length); b.UnlockBits(bd);
        b.Save(path, ImageFormat.Png); b.Dispose();
    }
    public int A(int x, int y) { return D[(y * W + x) * 4 + 3]; }

    public string AlphaHist() {
        var h = new int[17];
        for (int i = 3; i < D.Length; i += 4) h[D[i] / 16]++;
        return string.Join(",", h);
    }

    
    public List<int[]> Boxes(int thr, int gap, int minArea) {
        int cw = (W + gap - 1) / gap, ch = (H + gap - 1) / gap;
        var cell = new bool[cw * ch];
        var cnt = new int[cw * ch];
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (A(x, y) >= thr) cnt[(y / gap) * cw + x / gap]++;
        for (int i = 0; i < cell.Length; i++) cell[i] = cnt[i] >= 3;
        var seen = new bool[cw * ch]; var res = new List<int[]>();
        for (int s = 0; s < cell.Length; s++) {
            if (!cell[s] || seen[s]) continue;
            var st = new Stack<int>(); st.Push(s); seen[s] = true;
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = 0, y1 = 0, n = 0;
            while (st.Count > 0) {
                int c = st.Pop(); int cx = c % cw, cy = c / cw; n++;
                x0 = Math.Min(x0, cx); y0 = Math.Min(y0, cy); x1 = Math.Max(x1, cx); y1 = Math.Max(y1, cy);
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
                    int k = ny * cw + nx; if (cell[k] && !seen[k]) { seen[k] = true; st.Push(k); }
                }
            }
            if (n * gap * gap < minArea) continue;
            
            int px0 = W, py0 = H, px1 = 0, py1 = 0;
            for (int y = y0 * gap; y < Math.Min(H, (y1 + 1) * gap); y++)
                for (int x = x0 * gap; x < Math.Min(W, (x1 + 1) * gap); x++)
                    if (A(x, y) >= thr) { px0 = Math.Min(px0, x); py0 = Math.Min(py0, y); px1 = Math.Max(px1, x); py1 = Math.Max(py1, y); }
            res.Add(new int[] { px0, py0, px1 - px0 + 1, py1 - py0 + 1 });
        }
        return res;
    }

    
    public Img Crop(int x, int y, int w, int h, int cut, int full, bool trim) {
        var o = new Img(); o.W = w; o.H = h; o.D = new byte[w * h * 4];
        for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
            int sx = x + i, sy = y + j; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
            int si = (sy * W + sx) * 4, di = (j * w + i) * 4;
            int a = D[si + 3];
            int na = a < cut ? 0 : a >= full ? a : (int)Math.Round(255.0 * (a - cut) / (full - cut) * a / 255.0);
            o.D[di] = D[si]; o.D[di + 1] = D[si + 1]; o.D[di + 2] = D[si + 2]; o.D[di + 3] = (byte)na;
        }
        if (!trim) return o;
        int tx0 = w, ty0 = h, tx1 = -1, ty1 = -1;
        for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) if (o.D[(j * w + i) * 4 + 3] > 0) {
            tx0 = Math.Min(tx0, i); ty0 = Math.Min(ty0, j); tx1 = Math.Max(tx1, i); ty1 = Math.Max(ty1, j);
        }
        if (tx1 < 0) return o;
        return o.Crop(tx0, ty0, tx1 - tx0 + 1, ty1 - ty0 + 1, 0, 1, false);
    }

    
    public static void Overlay(string src, string dst, List<int[]> boxes) {
        using (var b0 = new Bitmap(src)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) {
                g.Clear(Color.FromArgb(255, 40, 40, 48));
                g.DrawImage(b0, 0, 0, b0.Width, b0.Height);
                var pen = new Pen(Color.Red, 2); var f = new Font("Arial", 16, FontStyle.Bold);
                for (int i = 0; i < boxes.Count; i++) {
                    var r = boxes[i]; g.DrawRectangle(pen, r[0], r[1], r[2], r[3]);
                    g.FillRectangle(Brushes.Black, r[0], r[1], 30, 20);
                    g.DrawString(i.ToString(), f, Brushes.Yellow, r[0], r[1]);
                }
            }
            b.Save(dst, ImageFormat.Png); b.Dispose();
        }
    }
}

public class Contact {
    
    public static void Make(string[] files, string dst, int cols, int cell) {
        int rows = (files.Length + cols - 1) / cols;
        var b = new Bitmap(cols * cell, rows * (cell + 16), PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b)) {
            g.Clear(Color.FromArgb(255, 20, 24, 48));
            var f = new Font("Arial", 9);
            for (int i = 0; i < files.Length; i++) {
                using (var im = new Bitmap(files[i])) {
                    int cx = (i % cols) * cell, cy = (i / cols) * (cell + 16);
                    float k = Math.Min(1f, Math.Min((cell - 4f) / im.Width, (cell - 4f) / im.Height));
                    int w = (int)(im.Width * k), h = (int)(im.Height * k);
                    g.FillRectangle(new SolidBrush(Color.FromArgb(255, 60, 120, 60)), cx + 1, cy + 1, cell - 2, cell - 2);
                    g.DrawImage(im, cx + (cell - w) / 2, cy + (cell - h) / 2, w, h);
                    g.DrawString(System.IO.Path.GetFileNameWithoutExtension(files[i]).Replace("ruins_", ""), f, Brushes.White, cx, cy + cell);
                }
            }
        }
        b.Save(dst, ImageFormat.Png); b.Dispose();
    }
}
