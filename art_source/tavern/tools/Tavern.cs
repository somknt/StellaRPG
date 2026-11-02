using System;
using System.Collections.Generic;

// 星の酒場の素材づくり（Img.cs と一緒に使う）
public class Tavern {
    // 市松模様（透明のつもりで描きこまれた白と灰色のます目）を消す：画像のふちからつながっている、明るくて色のうすい画素を透明にする
    // キャラの白いシャツは、まわりを濃い線で囲まれているので消えない
    public static void KeyChecker(Img im, int minLight, int maxSat) {
        int W = im.W, H = im.H;
        var bg = new bool[W * H];
        var q = new Queue<int>();
        Func<int, bool> isBg = (i) => {
            int r = im.D[i * 4 + 2], g = im.D[i * 4 + 1], b = im.D[i * 4];
            int mn = Math.Min(r, Math.Min(g, b)), mx = Math.Max(r, Math.Max(g, b));
            return mn >= minLight && mx - mn <= maxSat;
        };
        for (int x = 0; x < W; x++) { q.Enqueue(x); q.Enqueue((H - 1) * W + x); }
        for (int y = 0; y < H; y++) { q.Enqueue(y * W); q.Enqueue(y * W + W - 1); }
        while (q.Count > 0) {
            int i = q.Dequeue();
            if (bg[i] || !isBg(i)) continue;
            bg[i] = true;
            int x = i % W, y = i / W;
            if (x > 0) q.Enqueue(i - 1);
            if (x < W - 1) q.Enqueue(i + 1);
            if (y > 0) q.Enqueue(i - W);
            if (y < H - 1) q.Enqueue(i + W);
        }
        for (int i = 0; i < W * H; i++) if (bg[i]) im.D[i * 4 + 3] = 0;
        // ふちの1画素：消した所にとなりあう、明るい画素はうすくする（白いふちが残らないように）
        var a2 = new byte[W * H];
        for (int i = 0; i < W * H; i++) a2[i] = im.D[i * 4 + 3];
        for (int y = 1; y < H - 1; y++) for (int x = 1; x < W - 1; x++) {
            int i = y * W + x;
            if (a2[i] == 0) continue;
            if (!(bg[i - 1] || bg[i + 1] || bg[i - W] || bg[i + W])) continue;
            int r = im.D[i * 4 + 2], g = im.D[i * 4 + 1], b = im.D[i * 4];
            int mn = Math.Min(r, Math.Min(g, b));
            if (mn >= minLight - 40) im.D[i * 4 + 3] = 110;
        }
    }

    // dst の (dx, dy) から w×h を、src の (sx, sy) の画素で塗る（全体図にかいてある前のマスターを消す）
    public static void CopyRect(Img im, int sx, int sy, int dx, int dy, int w, int h) {
        var tmp = new byte[w * h * 4];
        for (int j = 0; j < h; j++) Array.Copy(im.D, ((sy + j) * im.W + sx) * 4, tmp, j * w * 4, w * 4);
        for (int j = 0; j < h; j++) Array.Copy(tmp, j * w * 4, im.D, ((dy + j) * im.W + dx) * 4, w * 4);
    }

    // 大きさを変える（なめらかに縮める。色は乗算済みアルファで計算して、ふちが黒くならないように）
    public static Img Resize(Img im, int w, int h) {
        var src = new System.Drawing.Bitmap(im.W, im.H, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        var r0 = new System.Drawing.Rectangle(0, 0, im.W, im.H);
        var bd = src.LockBits(r0, System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        System.Runtime.InteropServices.Marshal.Copy(im.D, 0, bd.Scan0, im.D.Length); src.UnlockBits(bd);
        var dst = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        using (var g = System.Drawing.Graphics.FromImage(dst)) {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
            using (var ia = new System.Drawing.Imaging.ImageAttributes()) {
                ia.SetWrapMode(System.Drawing.Drawing2D.WrapMode.TileFlipXY);
                g.DrawImage(src, new System.Drawing.Rectangle(0, 0, w, h), 0, 0, im.W, im.H, System.Drawing.GraphicsUnit.Pixel, ia);
            }
        }
        src.Dispose();
        var o = new Img(); o.W = w; o.H = h; o.D = new byte[w * h * 4];
        var b2 = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = System.Drawing.Graphics.FromImage(b2)) { g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy; g.DrawImage(dst, 0, 0, w, h); }
        dst.Dispose();
        var bd2 = b2.LockBits(new System.Drawing.Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        System.Runtime.InteropServices.Marshal.Copy(bd2.Scan0, o.D, 0, o.D.Length); b2.UnlockBits(bd2); b2.Dispose();
        return o;
    }
    
    // いちばん大きい、つながった不透明の固まりだけ残す（四角で切った時に、となりの部品のはしが入らないように）
    public static void KeepMain(Img im, int thr) {
        int W = im.W, H = im.H;
        var lab = new int[W * H];
        int best = 0, bestN = 0, cur = 0;
        var st = new Stack<int>();
        for (int s = 0; s < W * H; s++) {
            if (lab[s] != 0 || im.D[s * 4 + 3] < thr) continue;
            cur++; int n = 0; st.Push(s); lab[s] = cur;
            while (st.Count > 0) {
                int i = st.Pop(); n++;
                int x = i % W, y = i / W;
                for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
                    int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    int k = ny * W + nx; if (lab[k] == 0 && im.D[k * 4 + 3] >= thr) { lab[k] = cur; st.Push(k); }
                }
            }
            if (n > bestN) { bestN = n; best = cur; }
        }
        // 固まりのまわり（うすいふち）は残す：固まりから2画素以内
        var keep = new bool[W * H];
        for (int i = 0; i < W * H; i++) if (lab[i] == best) keep[i] = true;
        var keep2 = (bool[])keep.Clone();
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            if (!keep[y * W + x]) continue;
            for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
                int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                keep2[ny * W + nx] = true;
            }
        }
        for (int i = 0; i < W * H; i++) if (!keep2[i]) im.D[i * 4 + 3] = 0;
    }

    // 2枚目の上に1枚目を、拡大率 k で (x, y) に重ねた確認用の絵（最近傍）
    public static void Paste(Img dst, Img src, int x, int y, double k) {
        int w = (int)(src.W * k), h = (int)(src.H * k);
        for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
            int tx = x + i, ty = y + j; if (tx < 0 || ty < 0 || tx >= dst.W || ty >= dst.H) continue;
            int si = (((int)(j / k)) * src.W + (int)(i / k)) * 4, di = (ty * dst.W + tx) * 4;
            int a = src.D[si + 3]; if (a == 0) continue;
            for (int c = 0; c < 3; c++) dst.D[di + c] = (byte)((src.D[si + c] * a + dst.D[di + c] * (255 - a)) / 255);
        }
    }
}
