using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

// 確認用：画像の一部を拡大して保存する（最近傍。5px ごとの目盛り）
public class Zoom {
    public static void Make(string src, string dst, int x, int y, int w, int h, int k) {
        using (var b0 = new Bitmap(src)) {
            var b = new Bitmap(w * k, h * k, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) {
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                g.DrawImage(b0, new Rectangle(0, 0, w * k, h * k), new Rectangle(x, y, w, h), GraphicsUnit.Pixel);
                var pen = new Pen(Color.FromArgb(90, 0, 255, 255), 1);
                var f = new Font("Arial", 8);
                for (int i = 0; i <= w; i += 10) { g.DrawLine(pen, i * k, 0, i * k, h * k); g.DrawString((x + i).ToString(), f, Brushes.Yellow, i * k, 0); }
                for (int j = 0; j <= h; j += 10) { g.DrawLine(pen, 0, j * k, w * k, j * k); g.DrawString((y + j).ToString(), f, Brushes.Yellow, 0, j * k); }
            }
            b.Save(dst, ImageFormat.Png); b.Dispose();
        }
    }
}
