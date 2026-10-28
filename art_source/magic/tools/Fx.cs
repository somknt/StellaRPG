using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

// 魔法エフェクトのシート（透明 PNG）を1コマずつ切り出す
// 1. 色の濃い所（alpha >= core）を「芯」にして、コマごとの範囲（region）に入った芯をそのコマの物とする
// 2. 芯から近い順に（BFS で）まわりのうすい光・火の粉をそのコマに割りあてる（となりのコマの光は入らない）
// 3. 同じ行のコマは、決めた基準点（anchor）をそろえて、同じ大きさの画像にする
public class FxCut {
    int W, H; byte[] D; int[] lab; int[] dist;
    List<int[]> seeds = new List<int[]>(); // { x0, y0, x1, y1 } 芯の範囲

    public FxCut(string path) {
        using (var b0 = new Bitmap(path)) {
            var b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) g.DrawImage(b0, 0, 0, b0.Width, b0.Height);
            W = b.Width; H = b.Height; D = new byte[W * H * 4];
            var bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(bd.Scan0, D, 0, D.Length); b.UnlockBits(bd); b.Dispose();
        }
    }
    int A(int i) { return D[i * 4 + 3]; }

    // 芯：alpha >= core の画素をつないだかたまり（g ピクセルの粗い格子でつなぐ）。小さすぎる物は捨てる
    public void FindSeeds(int core, int g, int minPx) {
        int cw = (W + g - 1) / g, ch = (H + g - 1) / g;
        var cnt = new int[cw * ch];
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (A(y * W + x) >= core) cnt[(y / g) * cw + x / g]++;
        var seen = new bool[cw * ch];
        for (int s = 0; s < cnt.Length; s++) {
            if (cnt[s] < 2 || seen[s]) continue;
            var st = new Stack<int>(); st.Push(s); seen[s] = true;
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = 0, y1 = 0, n = 0;
            while (st.Count > 0) {
                int c = st.Pop(); int cx = c % cw, cy = c / cw; n += cnt[c];
                x0 = Math.Min(x0, cx); y0 = Math.Min(y0, cy); x1 = Math.Max(x1, cx); y1 = Math.Max(y1, cy);
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
                    int k = ny * cw + nx; if (cnt[k] >= 2 && !seen[k]) { seen[k] = true; st.Push(k); }
                }
            }
            if (n < minPx) continue;
            seeds.Add(new int[] { x0 * g, y0 * g, Math.Min(W, (x1 + 1) * g), Math.Min(H, (y1 + 1) * g) });
        }
    }

    // うすい所しかないコマ（消えかけの最後のコマなど）：範囲の中の alpha >= a の所を芯にする
    public void AddSeedFromRegion(int rx0, int ry0, int rx1, int ry1, int a) {
        int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
        for (int y = Math.Max(0, ry0); y < Math.Min(H, ry1); y++) for (int x = Math.Max(0, rx0); x < Math.Min(W, rx1); x++)
            if (A(y * W + x) >= a) { x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y); }
        if (x1 >= 0) seeds.Add(new int[] { x0, y0, x1 + 1, y1 + 1 });
    }

    // 光が点々に散ったうすいコマ（雷の消えかけの輪など）：範囲の中の芯を捨てて、範囲ぜんたいの alpha >= a を1つの芯にする
    public void ForceSeed(int rx0, int ry0, int rx1, int ry1, int a) {
        seeds.RemoveAll(s => { double cx = (s[0] + s[2]) / 2.0, cy = (s[1] + s[3]) / 2.0; return cx >= rx0 && cx < rx1 && cy >= ry0 && cy < ry1; });
        int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
        for (int y = Math.Max(0, ry0); y < Math.Min(H, ry1); y++) for (int x = Math.Max(0, rx0); x < Math.Min(W, rx1); x++)
            if (A(y * W + x) >= a) { x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y); }
        if (x1 >= 0) seeds.Add(new int[] { x0, y0, x1 + 1, y1 + 1, a });
    }

    public bool HasSeedIn(int rx0, int ry0, int rx1, int ry1) {
        foreach (var s in seeds) { double cx = (s[0] + s[2]) / 2.0, cy = (s[1] + s[3]) / 2.0; if (cx >= rx0 && cx < rx1 && cy >= ry0 && cy < ry1) return true; }
        return false;
    }

    // 画素ごとに、いちばん近い芯の番号（R ピクセルより遠い所は -1）。芯の画素から広げていく
    public void Assign(int core, int R) {
        lab = new int[W * H]; dist = new int[W * H];
        for (int i = 0; i < lab.Length; i++) { lab[i] = -1; dist[i] = int.MaxValue; }
        var q = new Queue<int>();
        for (int s = 0; s < seeds.Count; s++) {
            var r = seeds[s]; int sc = r.Length > 4 ? r[4] : core; // ForceSeed の芯は、その芯だけの濃さで
            for (int y = r[1]; y < r[3]; y++) for (int x = r[0]; x < r[2]; x++) {
                int i = y * W + x; if (A(i) < sc || lab[i] >= 0) continue;
                lab[i] = s; dist[i] = 0; q.Enqueue(i);
            }
        }
        // 芯の画素が少ない（うすいコマの）芯は、その範囲の alpha >= 40 の画素から広げる
        for (int s = 0; s < seeds.Count; s++) {
            var r = seeds[s]; bool any = false;
            for (int y = r[1]; y < r[3] && !any; y++) for (int x = r[0]; x < r[2]; x++) if (lab[y * W + x] == s) { any = true; break; }
            if (any) continue;
            for (int y = r[1]; y < r[3]; y++) for (int x = r[0]; x < r[2]; x++) {
                int i = y * W + x; if (A(i) < 40 || lab[i] >= 0) continue;
                lab[i] = s; dist[i] = 0; q.Enqueue(i);
            }
        }
        while (q.Count > 0) {
            int i = q.Dequeue(); int x = i % W, y = i / W; int d = dist[i] + 1; if (d > R) continue;
            for (int k = 0; k < 4; k++) {
                int nx = x + (k == 0 ? 1 : k == 1 ? -1 : 0), ny = y + (k == 2 ? 1 : k == 3 ? -1 : 0);
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                int j = ny * W + nx; if (dist[j] <= d) continue;
                dist[j] = d; lab[j] = lab[i]; q.Enqueue(j);
            }
        }
    }

    // 1コマ：範囲（region）に中心が入った芯の画素だけを取り出す
    public class Frm { public Bitmap Bmp; public int X, Y; public double Ax, Ay; public int CoreW, CoreH; }

    public Frm Take(int rx0, int ry0, int rx1, int ry1, string anchor, int minA) {
        var mine = new HashSet<int>();
        int cx0 = int.MaxValue, cy0 = int.MaxValue, cx1 = 0, cy1 = 0;
        for (int s = 0; s < seeds.Count; s++) {
            var r = seeds[s]; double cx = (r[0] + r[2]) / 2.0, cy = (r[1] + r[3]) / 2.0;
            if (cx >= rx0 && cx < rx1 && cy >= ry0 && cy < ry1) { mine.Add(s); cx0 = Math.Min(cx0, r[0]); cy0 = Math.Min(cy0, r[1]); cx1 = Math.Max(cx1, r[2]); cy1 = Math.Max(cy1, r[3]); }
        }
        if (mine.Count == 0) return null;
        // 取り出す画素の範囲
        int x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            int i = y * W + x; if (A(i) < minA || lab[i] < 0 || !mine.Contains(lab[i])) continue;
            x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y);
        }
        int w = x1 - x0 + 1, h = y1 - y0 + 1;
        var o = new byte[w * h * 4];
        double bx = 0, by = 0, bw = 0, ax = 0, aw = 0; int coreBottom = 0;
        for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
            int i = y * W + x; int a = A(i); if (a < minA || lab[i] < 0 || !mine.Contains(lab[i])) continue;
            int di = ((y - y0) * w + (x - x0)) * 4; int si = i * 4;
            o[di] = D[si]; o[di + 1] = D[si + 1]; o[di + 2] = D[si + 2]; o[di + 3] = D[si + 3];
            double lum = (0.299 * D[si + 2] + 0.587 * D[si + 1] + 0.114 * D[si]) / 255.0;
            double wb = Math.Pow(lum, 6) * a;               // 明るい所ほど重い（光の中心）
            bx += x * wb; by += y * wb; bw += wb;
            if (a >= 60) coreBottom = Math.Max(coreBottom, y);
        }
        // 下の基準：いちばん下の 15% の高さにある濃い画素の、横の重心
        int band = Math.Max(4, (int)((coreBottom - y0) * 0.15));
        for (int y = coreBottom - band; y <= coreBottom; y++) for (int x = x0; x <= x1; x++) {
            int i = y * W + x; int a = A(i); if (a < 60 || lab[i] < 0 || !mine.Contains(lab[i])) continue;
            ax += x * a; aw += a;
        }
        var f = new Frm(); f.X = x0; f.Y = y0; f.CoreW = cx1 - cx0; f.CoreH = cy1 - cy0;
        if (anchor == "bright" && bw > 0) { f.Ax = bx / bw - x0; f.Ay = by / bw - y0; }
        else if (anchor == "bottom" && aw > 0) { f.Ax = ax / aw - x0; f.Ay = coreBottom - y0; }
        else if (anchor == "right") { f.Ax = cx1 - x0; f.Ay = (cy0 + cy1) / 2.0 - y0; } // 飛ぶ弾：先頭（右のはし）
        else { f.Ax = (cx0 + cx1) / 2.0 - x0; f.Ay = (cy0 + cy1) / 2.0 - y0; } // "center"：芯の真ん中
        var b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var bd = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(o, 0, bd.Scan0, o.Length); b.UnlockBits(bd);
        f.Bmp = b;
        return f;
    }

    // 1行（同じアニメのコマ）を、基準点をそろえて同じ大きさで保存。メタ情報（JSON）を返す
    // square：true なら正方形（魔法陣）
    public static string SaveRow(List<Frm> fr, string dir, string name, bool square) {
        double L = 0, Rt = 0, T = 0, B = 0; int pad = 2;
        foreach (var f in fr) { L = Math.Max(L, f.Ax); Rt = Math.Max(Rt, f.Bmp.Width - f.Ax); T = Math.Max(T, f.Ay); B = Math.Max(B, f.Bmp.Height - f.Ay); }
        int w = (int)Math.Ceiling(L + Rt) + pad * 2, h = (int)Math.Ceiling(T + B) + pad * 2;
        double ax = L + pad, ay = T + pad;
        if (square) { int s = Math.Max(w, h); ax += (s - w) / 2.0; ay += (s - h) / 2.0; w = h = s; }
        double coreW = 0, coreH = 0;
        for (int k = 0; k < fr.Count; k++) {
            var f = fr[k]; coreW += f.CoreW; coreH += f.CoreH;
            using (var b = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(b)) {
                g.Clear(Color.Transparent);
                // 位置は整数にそろえる（ドット絵がぼやけないよう、拡大縮小はしない）
                g.DrawImageUnscaled(f.Bmp, (int)Math.Round(ax - f.Ax), (int)Math.Round(ay - f.Ay));
                b.Save(System.IO.Path.Combine(dir, name + "_" + (k + 1) + ".png"), ImageFormat.Png);
            }
        }
        var sb = new StringBuilder();
        sb.AppendFormat("{0}: {{ n: {1}, w: {2}, h: {3}, ax: {4}, ay: {5}, coreW: {6}, coreH: {7} }}",
            name, fr.Count, w, h, Math.Round(ax), Math.Round(ay), Math.Round(coreW / fr.Count), Math.Round(coreH / fr.Count));
        return sb.ToString();
    }
}
