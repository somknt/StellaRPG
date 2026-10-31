using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

// アプリのアイコン（icon_source.png：紺の背景に、光るふちの角丸の四角）から、いろいろな大きさのアイコンを作る
// Rounded：角丸の四角の外（紺の背景と外側の光）を透明にして、四角だけを切り出す（ファビコン・ふつうのアイコン）
// Flatten：Rounded の透明な所を紺でうめる（iPhone・Android は角を自分で丸めるので、透明な所がない方がよい）
public static class IconMaker {
    static byte[] Load(string path, out int w, out int h) {
        using (var b0 = new Bitmap(path)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) g.DrawImage(b0, 0, 0, b0.Width, b0.Height);
            w = b.Width; h = b.Height; var d = new byte[w * h * 4];
            var bd = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, d, 0, d.Length); b.UnlockBits(bd); b.Dispose();
            return d;
        }
    }

    static Bitmap ToBitmap(byte[] d, int w, int h) {
        var b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var bd = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(d, 0, bd.Scan0, d.Length); b.UnlockBits(bd);
        return b;
    }

    // 背景の紺（bg）との色のちがい
    static int Dist(byte[] d, int i, Color bg) {
        return Math.Abs(d[i * 4 + 2] - bg.R) + Math.Abs(d[i * 4 + 1] - bg.G) + Math.Abs(d[i * 4] - bg.B);
    }

    // 角丸の四角（ふちの白い線の外側が x0〜x1, y0〜y1）の外を透明にして、正方形に切り出す
    // 画像のはしから、紺の背景と外側の光（色のちがいが line より小さい所）をたどって「外」にする。白い線でとまる
    // 線にすき間があっても絵の中まで入らないよう、たどれるのは四角の外と、四隅の depth ピクセル四方だけ
    // 外の所は、色のちがいが soft〜line の間だけ半分すけさせて、ふちをなめらかにする
    public static Bitmap Rounded(string path, Color bg, int x0, int y0, int x1, int y1, int line, int soft, int depth, out int outside) {
        int W, H; var d = Load(path, out W, out H);
        var mark = new bool[W * H];
        var q = new Queue<int>();
        Func<int, int, bool> allowed = (x, y) => {
            if (x < x0 || x > x1 || y < y0 || y > y1) return true;
            bool cx = x < x0 + depth || x > x1 - depth, cy = y < y0 + depth || y > y1 - depth;
            return cx && cy;
        };
        for (int x = 0; x < W; x++) { q.Enqueue(x); q.Enqueue((H - 1) * W + x); }
        for (int y = 0; y < H; y++) { q.Enqueue(y * W); q.Enqueue(y * W + W - 1); }
        outside = 0;
        while (q.Count > 0) {
            int i = q.Dequeue(); if (mark[i]) continue;
            int x = i % W, y = i / W;
            if (!allowed(x, y) || Dist(d, i, bg) >= line) continue;
            mark[i] = true; outside++;
            if (x > 0) q.Enqueue(i - 1); if (x < W - 1) q.Enqueue(i + 1);
            if (y > 0) q.Enqueue(i - W); if (y < H - 1) q.Enqueue(i + W);
        }
        for (int i = 0; i < W * H; i++) {
            if (!mark[i]) continue;
            double a = (Dist(d, i, bg) - soft) / (double)(line - soft);
            d[i * 4 + 3] = (byte)Math.Round(255 * Math.Max(0, Math.Min(1, a)));
        }
        // 正方形に切り出す（四角の真ん中を中心に、長い方の辺の長さで）
        int size = Math.Max(x1 - x0, y1 - y0) + 1;
        int sx = (x0 + x1 + 1) / 2 - size / 2, sy = (y0 + y1 + 1) / 2 - size / 2;
        var o = new byte[size * size * 4];
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
            int X = sx + x, Y = sy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            Array.Copy(d, (Y * W + X) * 4, o, (y * size + x) * 4, 4);
        }
        return ToBitmap(o, size, size);
    }

    // 透明な所を bg の色でうめる（iPhone は透明な所を黒にしてしまうので）
    public static Bitmap Flatten(Bitmap src, Color bg) {
        var b = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b)) { g.Clear(bg); g.DrawImageUnscaled(src, 0, 0); }
        return b;
    }

    // なめらかに縮める（大きく縮める時は半分ずつ縮めてから）
    public static Bitmap Resize(Bitmap src, int size) {
        Bitmap cur = src;
        while (cur.Width / 2 >= size * 2) {
            var next = Draw(cur, cur.Width / 2);
            if (cur != src) cur.Dispose();
            cur = next;
        }
        var res = Draw(cur, size);
        if (cur != src) cur.Dispose();
        return res;
    }

    static Bitmap Draw(Bitmap src, int size) {
        var b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b))
        using (var at = new ImageAttributes()) {
            g.Clear(Color.Transparent);
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;
            at.SetWrapMode(WrapMode.TileFlipXY); // ふちが半分すけないように
            g.DrawImage(src, new Rectangle(0, 0, size, size), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, at);
        }
        return b;
    }

    public static void SavePng(Bitmap b, string path) { b.Save(path, ImageFormat.Png); }

    // favicon.ico：大きさごとの PNG をそのまま入れる（Windows Vista 以降・今のブラウザはどれも読める）
    public static void SaveIco(Bitmap src, int[] sizes, string path) {
        var pngs = new List<byte[]>();
        foreach (int s in sizes) {
            using (var b = Resize(src, s)) using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); pngs.Add(ms.ToArray()); }
        }
        using (var fs = new FileStream(path, FileMode.Create))
        using (var w = new BinaryWriter(fs)) {
            w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int k = 0; k < sizes.Length; k++) {
                int s = sizes[k];
                w.Write((byte)(s >= 256 ? 0 : s)); w.Write((byte)(s >= 256 ? 0 : s));
                w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32);
                w.Write(pngs[k].Length); w.Write(offset);
                offset += pngs[k].Length;
            }
            foreach (var p in pngs) w.Write(p);
        }
    }
}
