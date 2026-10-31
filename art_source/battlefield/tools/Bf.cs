using System;

// 歴戦の跡地の素材づくり（Img.cs の Img を使う）
// - Extinguish：全体図に描きこまれた松明の炎を消す（炎と、炎に照らされた暖かい色を、燃えかすの暗い色にする）
//   ゲームでは消えた松明の上に、灯っている時だけ炎の絵を重ねる（battlefield_map.js）
// - ExtinguishSprite：火のついた焚き火・火鉢の絵から、火を消した絵を作る（bowlY より上の炎は透明に、下は燃えかすに）
public static class Bf {
    static double Clamp(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    // 炎らしさ（0〜1）：赤みが強い・とても明るい所ほど 1
    static double Fire(byte r, byte g, byte b) {
        double warm = Clamp((r - b - 34) / 95.0) * Clamp((r - 95) / 90.0);
        double lum = 0.299 * r + 0.587 * g + 0.114 * b;
        double bright = Clamp((lum - 170) / 60.0) * Clamp((r - b + 10) / 60.0);
        return Math.Max(warm, bright);
    }

    // (cx, cy)：炎の真ん中 / rx：横の広さ / up・down：上・下へどこまで（楕円の中だけ変える）
    public static int Extinguish(Img im, int cx, int cy, int rx, int up, int down, int seed) {
        var rnd = new Random(seed);
        int changed = 0;
        for (int y = cy - up; y <= cy + down; y++) {
            if (y < 0 || y >= im.H) continue;
            for (int x = cx - rx; x <= cx + rx; x++) {
                if (x < 0 || x >= im.W) continue;
                double ny = y < cy ? (cy - y) / (double)up : (y - cy) / (double)down;
                double nx = (x - cx) / (double)rx;
                double d = Math.Sqrt(nx * nx + ny * ny);
                if (d >= 1) continue;
                int i = (y * im.W + x) * 4;
                byte b = im.D[i], g = im.D[i + 1], r = im.D[i + 2];
                double k = Fire(r, g, b) * Clamp((1 - d) / 0.35);
                if (k <= 0.01) continue;
                double lum = 0.299 * r + 0.587 * g + 0.114 * b;
                // 燃えかす：暗い紫がかった灰色。真ん中ほど暗く、少しだけざらつかせる
                double n = rnd.NextDouble() * 10 - 5;
                double cr = 20 + lum * 0.12 + n, cg = 17 + lum * 0.1 + n, cb = 26 + lum * 0.14 + n;
                im.D[i + 2] = (byte)Math.Round(r + (cr - r) * k);
                im.D[i + 1] = (byte)Math.Round(g + (cg - g) * k);
                im.D[i] = (byte)Math.Round(b + (cb - b) * k);
                changed++;
            }
        }
        return changed;
    }

    // 透明な素材（焚き火・火鉢）の火を消した絵。bowlY：火床（器のふち）の高さ（画像の上から px）
    public static Img ExtinguishSprite(Img src, int bowlY, int seed) {
        var o = new Img(); o.W = src.W; o.H = src.H; o.D = (byte[])src.D.Clone();
        var rnd = new Random(seed);
        for (int y = 0; y < o.H; y++) for (int x = 0; x < o.W; x++) {
            int i = (y * o.W + x) * 4;
            byte b = o.D[i], g = o.D[i + 1], r = o.D[i + 2], a = o.D[i + 3];
            if (a == 0) continue;
            double k = Fire(r, g, b);
            if (k <= 0.02) continue;
            if (y < bowlY) {
                // 器より上の炎は消す（うすく残る所も）
                o.D[i + 3] = (byte)Math.Round(a * (1 - Clamp(k * 1.6)));
                continue;
            }
            double lum = 0.299 * r + 0.587 * g + 0.114 * b;
            double n = rnd.NextDouble() * 10 - 5;
            // 器の中：燃えかす。ところどころ赤い燠火（おきび）を残す
            bool ember = rnd.NextDouble() < 0.06 && k > 0.5;
            double cr = ember ? 120 : 26 + lum * 0.1 + n, cg = ember ? 34 : 21 + lum * 0.08 + n, cb = ember ? 22 : 28 + lum * 0.1 + n;
            o.D[i + 2] = (byte)Math.Round(r + (cr - r) * k);
            o.D[i + 1] = (byte)Math.Round(g + (cg - g) * k);
            o.D[i] = (byte)Math.Round(b + (cb - b) * k);
        }
        return o;
    }

    // いちばん大きなかたまり（alpha >= thr の画素がつながった所）だけ残す。となりの部品のはみ出しを消す
    // そのかたまりから grow ピクセル以内のうすい画素（影やふち）は残す
    public static Img KeepMain(Img src, int thr, int grow) {
        int W = src.W, H = src.H;
        var lab = new int[W * H];
        int best = -1, bestN = 0, id = 0;
        var st = new System.Collections.Generic.Stack<int>();
        for (int s = 0; s < W * H; s++) {
            if (lab[s] != 0 || src.D[s * 4 + 3] < thr) continue;
            id++; int n = 0; st.Push(s); lab[s] = id;
            while (st.Count > 0) {
                int c = st.Pop(); n++; int x = c % W, y = c / W;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    int k = ny * W + nx; if (lab[k] == 0 && src.D[k * 4 + 3] >= thr) { lab[k] = id; st.Push(k); }
                }
            }
            if (n > bestN) { bestN = n; best = id; }
        }
        // 残す所：いちばん大きなかたまりから grow ピクセル以内
        var keep = new bool[W * H];
        var q = new System.Collections.Generic.Queue<int>();
        var dist = new int[W * H];
        for (int i = 0; i < W * H; i++) { dist[i] = int.MaxValue; if (lab[i] == best) { keep[i] = true; dist[i] = 0; q.Enqueue(i); } }
        while (q.Count > 0) {
            int c = q.Dequeue(); int x = c % W, y = c / W; if (dist[c] >= grow) continue;
            for (int k = 0; k < 4; k++) {
                int nx = x + (k == 0 ? 1 : k == 1 ? -1 : 0), ny = y + (k == 2 ? 1 : k == 3 ? -1 : 0);
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                int j = ny * W + nx; if (dist[j] <= dist[c] + 1 || lab[j] != 0 && lab[j] != best) continue;
                dist[j] = dist[c] + 1; keep[j] = true; q.Enqueue(j);
            }
        }
        var o = new Img(); o.W = W; o.H = H; o.D = (byte[])src.D.Clone();
        for (int i = 0; i < W * H; i++) if (!keep[i]) o.D[i * 4 + 3] = 0;
        return o.Crop(0, 0, W, H, 0, 1, true);
    }

    // 左右反転
    public static Img Flip(Img src) {
        var o = new Img(); o.W = src.W; o.H = src.H; o.D = new byte[src.D.Length];
        for (int y = 0; y < o.H; y++) for (int x = 0; x < o.W; x++)
            Array.Copy(src.D, (y * o.W + x) * 4, o.D, (y * o.W + (o.W - 1 - x)) * 4, 4);
        return o;
    }
}
