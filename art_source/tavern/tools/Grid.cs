using System;
using System.Drawing;
using System.Drawing.Imaging;

// 確認用：全体図に 50px の方眼と座標を描いて、4つに分けて保存する（当たり判定・扉の位置を決めるため）
public class Grid {
    public static void Make(string src, string dstPrefix, int step) {
        using (var b0 = new Bitmap(src)) {
            int W = b0.Width, H = b0.Height;
            var b = new Bitmap(W, H, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) {
                g.DrawImage(b0, 0, 0, W, H);
                var thin = new Pen(Color.FromArgb(110, 0, 255, 255), 1);
                var thick = new Pen(Color.FromArgb(200, 255, 255, 0), 1);
                var f = new Font("Arial", 9, FontStyle.Bold);
                for (int x = 0; x < W; x += step) g.DrawLine(x % (step * 2) == 0 ? thick : thin, x, 0, x, H);
                for (int y = 0; y < H; y += step) g.DrawLine(y % (step * 2) == 0 ? thick : thin, 0, y, W, y);
                for (int y = 0; y < H; y += step * 2)
                    for (int x = 0; x < W; x += step * 2) {
                        g.FillRectangle(Brushes.Black, x + 1, y + 1, 44, 12);
                        g.DrawString(x + "," + y, f, Brushes.Yellow, x + 1, y);
                    }
            }
            int hw = W / 2, hh = H / 2;
            for (int q = 0; q < 4; q++) {
                int ox = (q % 2) * hw, oy = (q / 2) * hh;
                using (var c = b.Clone(new Rectangle(ox, oy, hw, hh), PixelFormat.Format32bppArgb)) c.Save(dstPrefix + q + ".png", ImageFormat.Png);
            }
            b.Dispose();
        }
    }
}
